/**
 * Thin wrapper around the Expo Push Service.
 *
 * https://docs.expo.dev/push-notifications/sending-notifications/
 *
 * We POST batches of ≤100 messages to `https://exp.host/--/api/v2/push/send`
 * with our access-token when EXPO_ACCESS_TOKEN is set. Retries on 429/5xx with
 * exponential backoff (up to 3 attempts). Failures are logged via
 * safeExecuteWithSpan and NEVER thrown to callers — a push outage must not
 * take down the transaction that produced the event.
 */
import { safeExecuteWithSpan } from "./logfire.js";
import {
  type PushDeliveryDedupe,
  type PushEventKey,
  type PushToken,
  claimPushDelivery,
  finalizePushDelivery,
  withPushDeliveryHandoff,
} from "./push-tokens-store.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 3;
const DEFAULT_MAX_CONCURRENT_HANDOFFS = 4;

// A handoff reserves one database connection for its session advisory locks.
// Keep that bounded per process so a push burst cannot consume the pool used
// by the rest of the API. The bounded batch still preserves delivery order per
// physical Expo token in the store-level gate.
let activeHandoffs = 0;
const handoffWaiters: Array<() => void> = [];

function maxConcurrentHandoffs(): number {
  const configured = Number.parseInt(process.env.PUSH_MAX_CONCURRENT_HANDOFFS ?? "", 10);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(configured, 32)
    : DEFAULT_MAX_CONCURRENT_HANDOFFS;
}

async function acquireHandoffSlot(): Promise<() => void> {
  const max = maxConcurrentHandoffs();
  // A waiting caller receives a permit directly from `releaseHandoffSlot`.
  // It must not re-check/increment `activeHandoffs` after wake-up: doing so
  // lets a newly arriving caller barge in between release and resumption.
  if (activeHandoffs >= max || handoffWaiters.length > 0) {
    await new Promise<void>((resolve) => handoffWaiters.push(resolve));
  } else {
    activeHandoffs += 1;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = handoffWaiters.shift();
    if (next) {
      // Transfer the existing permit; activeHandoffs stays unchanged.
      next();
      return;
    }
    activeHandoffs -= 1;
  };
}

async function withHandoffSlot<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquireHandoffSlot();
  try {
    return await fn();
  } finally {
    release();
  }
}

export type PushMessage = {
  to: string; // ExponentPushToken[…]
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  priority?: "default" | "normal" | "high";
  channelId?: string;
  ttl?: number;
};

export type SendPushResult = {
  successes: number;
  failures: number;
  invalidTokens: string[];
  successfulTokens: string[];
};

function emptySendResult(): SendPushResult {
  return { successes: 0, failures: 0, invalidTokens: [], successfulTokens: [] };
}

function mergeSendResults(into: SendPushResult, result: SendPushResult): void {
  into.successes += result.successes;
  into.failures += result.failures;
  into.invalidTokens.push(...result.invalidTokens);
  into.successfulTokens.push(...result.successfulTokens);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type ExpoTicket = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

type ExpoResponse = {
  data?: ExpoTicket[];
  errors?: Array<{ code?: string; message?: string }>;
};

async function postBatch(
  batch: PushMessage[],
): Promise<{ tickets: ExpoTicket[]; retriable: boolean }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(batch),
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 429 || res.status >= 500) {
    return { tickets: [], retriable: true };
  }
  if (!res.ok) {
    // 4xx (other than 429) — non-retriable; treat every message as errored.
    return {
      tickets: batch.map(() => ({
        status: "error",
        message: `expo push ${res.status}`,
      })),
      retriable: false,
    };
  }
  const j = (await res.json()) as ExpoResponse;
  const tickets = Array.isArray(j.data) ? j.data : [];
  return { tickets, retriable: false };
}

/**
 * Send `messages` via the Expo Push Service. Never throws — a failed batch
 * increments the failure counter and (for known "gone" tokens) surfaces the
 * offending token strings so callers can unregister them.
 */
async function sendExpoPush(params: {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<SendPushResult> {
  return safeExecuteWithSpan("push.dispatch", async (span) => {
    const uniqueTokens = [...new Set(params.tokens.filter(Boolean))];
    span.setAttributes({
      recipient_count: uniqueTokens.length,
      title: params.title.slice(0, 60),
    });
    if (uniqueTokens.length === 0) {
      return emptySendResult();
    }

    const messages: PushMessage[] = uniqueTokens.map((to) => ({
      to,
      title: params.title,
      body: params.body,
      data: params.data ?? {},
      sound: "default",
      priority: "high",
    }));

    let successes = 0;
    let failures = 0;
    const invalidTokens: string[] = [];
    const successfulTokens: string[] = [];

    for (const batch of chunk(messages, BATCH_SIZE)) {
      let tickets: ExpoTicket[] = [];
      let attempt = 0;
      let sent = false;
      while (attempt < MAX_ATTEMPTS && !sent) {
        attempt += 1;
        try {
          const result = await postBatch(batch);
          if (result.retriable) {
            if (attempt >= MAX_ATTEMPTS) {
              failures += batch.length;
              sent = true;
              break;
            }
            await sleep(200 * 2 ** (attempt - 1));
            continue;
          }
          tickets = result.tickets;
          sent = true;
        } catch (err) {
          span.recordException(err);
          if (attempt >= MAX_ATTEMPTS) {
            failures += batch.length;
            sent = true;
            break;
          }
          await sleep(200 * 2 ** (attempt - 1));
        }
      }

      // Correlate tickets back to tokens by index (Expo preserves order).
      for (let i = 0; i < batch.length; i++) {
        const t = tickets[i];
        if (!t) {
          failures += 1;
          continue;
        }
        if (t.status === "ok") {
          successes += 1;
          if (batch[i]?.to) successfulTokens.push(batch[i]!.to);
        } else {
          failures += 1;
          // DeviceNotRegistered / InvalidCredentials → surface the token so
          // the caller can prune it. Other errors (MessageTooBig, RateExceeded)
          // are transient at the ticket level and left alone.
          const kind = t.details?.error ?? "";
          if (kind === "DeviceNotRegistered" || kind === "InvalidCredentials") {
            const bad = batch[i]?.to;
            if (bad) invalidTokens.push(bad);
          }
        }
      }
    }

    span.setAttributes({ successes, failures, invalid_count: invalidTokens.length });
    return { successes, failures, invalidTokens, successfulTokens };
  }).catch((): SendPushResult => {
    // safeExecuteWithSpan rethrows, but the internal Expo sender should NEVER
    // expose an exception to the claim-aware facade.
    // an exception — swallow here to guarantee fire-and-forget safety.
    return emptySendResult();
  });
}

/**
 * The only notifier-facing delivery API. Candidate selection is followed by
 * a short server-side lease, a fresh ownership/consent check immediately
 * before the Expo handoff, and claim-validated durable dedupe afterwards.
 * Expo may accept a request in the small interval after validation; that
 * downstream timing cannot be retracted, so account isolation is guaranteed
 * for server selection/state rather than pretending APNs is cancellable.
 */
export async function deliverPush(params: {
  tokens: PushToken[];
  dedupe: PushDeliveryDedupe[];
  eventKey?: PushEventKey;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  leaseMs?: number;
}): Promise<SendPushResult> {
  const result = emptySendResult();
  // Claim, validate, send, and finalize one Expo-sized batch at a time. A
  // single batch has a bounded retry budget; later batches are selected fresh
  // after earlier network work completes rather than letting their leases age.
  for (const batch of chunk(params.tokens, BATCH_SIZE)) {
    const batchResult = await withHandoffSlot(async () => {
      const claims = await claimPushDelivery(batch, params.dedupe, params.eventKey, params.leaseMs);
      if (claims.length === 0) return emptySendResult();

      const sent = await withPushDeliveryHandoff(claims, params.eventKey, async (valid) => {
        if (valid.length === 0) return emptySendResult();
        return sendExpoPush({
          tokens: valid.map((claim) => claim.expoToken),
          title: params.title,
          body: params.body,
          data: params.data,
        });
      });
      await finalizePushDelivery(
        claims,
        new Set(sent.successfulTokens),
        new Set(sent.invalidTokens),
      );
      return sent;
    });
    mergeSendResults(result, batchResult);
  }
  return result;
}
