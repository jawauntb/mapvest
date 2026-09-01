import type {
  PushNotificationDelivery as ApiPushNotificationDelivery,
  PushNotificationTarget,
} from "@/api/types";
/**
 * This client-side schema mirrors packages/core because Expo Metro does not
 * resolve the Bun workspace package. Keep the validation at this boundary so
 * routing and replay admission share one runtime source of truth.
 */

export const PUSH_DELIVERY_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const PUSH_DELIVERY_LEDGER_LIMIT = 64;

export const PUSH_ACTION_IDS = {
  viewMap: "mapvest-view-map",
  viewCompany: "mapvest-view-company",
  settings: "mapvest-notification-settings",
} as const;

export type NotificationTarget = PushNotificationTarget;
export type PushNotificationDelivery = ApiPushNotificationDelivery;

export type NotificationData = Record<string, unknown> & { mapvest?: unknown };

export type PushDeliveryLedgerEntry = {
  delivery: PushNotificationDelivery;
  status: "pending" | "handled";
  admittedAt: string;
  handledAt?: string;
};

export type PushDeliveryAdmissionReason =
  | "accepted"
  | "malformed"
  | "expired"
  | "not-yet-valid"
  | "installation-mismatch"
  | "account-mismatch"
  | "duplicate"
  | "capacity";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}

function optionalBoundedString(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  return boundedString(value, max) ?? null;
}

function boundedNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

function canonicalIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString() === value ? value : undefined;
}

function parsePushNotificationTarget(value: unknown): PushNotificationTarget | null {
  const target = record(value);
  if (!target || typeof target.type !== "string") return null;
  switch (target.type) {
    case "home": {
      if (
        target.section !== undefined &&
        target.section !== "daily-brief" &&
        target.section !== "local-brief"
      ) {
        return null;
      }
      return { type: "home", ...(target.section ? { section: target.section } : {}) };
    }
    case "map": {
      const placeId = optionalBoundedString(target.placeId, 256);
      const ticker = optionalBoundedString(target.ticker, 24);
      const label = optionalBoundedString(target.label, 160);
      const reason = optionalBoundedString(target.reason, 240);
      if (placeId === null || ticker === null || label === null || reason === null) return null;
      const lat = target.lat === undefined ? undefined : boundedNumber(target.lat, -90, 90);
      const lng = target.lng === undefined ? undefined : boundedNumber(target.lng, -180, 180);
      if (
        (target.lat !== undefined && lat === undefined) ||
        (target.lng !== undefined && lng === undefined)
      ) {
        return null;
      }
      if (
        (lat === undefined) !== (lng === undefined) ||
        (!placeId && !ticker && lat === undefined)
      ) {
        return null;
      }
      return {
        type: "map",
        ...(placeId ? { placeId } : {}),
        ...(ticker ? { ticker } : {}),
        ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
        ...(label ? { label } : {}),
        ...(reason ? { reason } : {}),
      };
    }
    case "company": {
      const ticker = boundedString(target.ticker, 24);
      return ticker ? { type: "company", ticker } : null;
    }
    case "research": {
      const threadId = optionalBoundedString(target.threadId, 256);
      return threadId === null ? null : { type: "research", ...(threadId ? { threadId } : {}) };
    }
    case "alerts":
    case "camera":
    case "universe":
    case "settings":
      return { type: target.type };
    default:
      return null;
  }
}

export function parsePushNotificationDelivery(
  data: NotificationData | null | undefined,
): PushNotificationDelivery | null {
  const value = record(data?.mapvest);
  if (!value || value.schemaVersion !== 1) return null;
  const deliveryId = boundedString(value.deliveryId, 128);
  const installationId = boundedString(value.installationId, 128);
  const issuedAt = canonicalIsoDate(value.issuedAt);
  const expiresAt = canonicalIsoDate(value.expiresAt);
  const eventKind = boundedString(value.eventKind, 64);
  const target = parsePushNotificationTarget(value.target);
  if (!deliveryId || !installationId || !issuedAt || !expiresAt || !eventKind || !target) {
    return null;
  }
  return { schemaVersion: 1, deliveryId, installationId, issuedAt, expiresAt, eventKind, target };
}

export function prunePushDeliveryEntries(
  entries: Record<string, PushDeliveryLedgerEntry>,
  nowMs: number,
): Record<string, PushDeliveryLedgerEntry> {
  return Object.fromEntries(
    Object.entries(entries).filter(([, entry]) => {
      const expiresAt = Date.parse(entry.delivery.expiresAt);
      return Number.isFinite(expiresAt) && expiresAt + PUSH_DELIVERY_CLOCK_SKEW_MS >= nowMs;
    }),
  );
}

export function pushDeliveryAdmissionReason(args: {
  delivery: PushNotificationDelivery | null;
  installationId: string;
  currentAccountId: string;
  claimOwnerAccountId: string;
  entries: Record<string, PushDeliveryLedgerEntry>;
  nowMs?: number;
  limit?: number;
}): PushDeliveryAdmissionReason {
  const delivery = args.delivery;
  if (!delivery) return "malformed";
  if (!args.currentAccountId || args.claimOwnerAccountId !== args.currentAccountId) {
    return "account-mismatch";
  }
  if (!args.installationId || delivery.installationId !== args.installationId) {
    return "installation-mismatch";
  }
  const now = args.nowMs ?? Date.now();
  const issuedAt = Date.parse(delivery.issuedAt);
  const expiresAt = Date.parse(delivery.expiresAt);
  if (issuedAt > now + PUSH_DELIVERY_CLOCK_SKEW_MS) return "not-yet-valid";
  if (expiresAt + PUSH_DELIVERY_CLOCK_SKEW_MS < now || expiresAt <= issuedAt) return "expired";
  if (args.entries[delivery.deliveryId]) return "duplicate";
  const retained = prunePushDeliveryEntries(args.entries, now);
  if (Object.keys(retained).length >= (args.limit ?? PUSH_DELIVERY_LEDGER_LIMIT)) return "capacity";
  return "accepted";
}

function query(params: Record<string, string | number | undefined>): string {
  const value = Object.entries(params)
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`)
    .join("&");
  return value ? `?${value}` : "";
}

export function pathFromPushDelivery(
  delivery: PushNotificationDelivery,
  actionIdentifier?: string,
): string {
  if (actionIdentifier === PUSH_ACTION_IDS.settings) return "/(tabs)/settings";
  const target = delivery.target;
  if (actionIdentifier === PUSH_ACTION_IDS.viewCompany) {
    const ticker = target.type === "company" || target.type === "map" ? target.ticker : undefined;
    return ticker ? `/detail/${encodeURIComponent(ticker)}` : "/(tabs)/map";
  }
  if (actionIdentifier === PUSH_ACTION_IDS.viewMap && target.type !== "map") {
    return "/(tabs)/map";
  }
  switch (target.type) {
    case "home":
      return `/(tabs)/home${query({ section: target.section })}`;
    case "map":
      return `/(tabs)/map${query({
        source: "notification",
        deliveryId: delivery.deliveryId,
        placeId: target.placeId,
        ticker: target.ticker,
        lat: target.lat,
        lng: target.lng,
        label: target.label,
        reason: target.reason,
      })}`;
    case "company":
      return `/detail/${encodeURIComponent(target.ticker)}`;
    case "research":
      return target.threadId
        ? `/(tabs)/research?intent=thread&id=${encodeURIComponent(target.threadId)}`
        : "/(tabs)/research";
    case "alerts":
      return "/alerts";
    case "camera":
      return "/(tabs)/camera";
    case "universe":
      return "/universe";
    case "settings":
      return "/(tabs)/settings";
  }
}
