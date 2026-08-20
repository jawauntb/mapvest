/**
 * Push-notifications cron-like scheduler.
 *
 * Started from `src/index.ts` when `ENABLE_PUSH_SCHEDULER=1` (opt-in so local
 * dev never accidentally spams pushes). Uses `setInterval` — no external
 * dependency needed. Each tick catches its own errors so one failing notifier
 * cannot bring down the others.
 *
 * Cadences (per spec):
 *   - Every 60min: the movement tick. One >2km move detection per user, two
 *     consumers: a fresh local brief for users with `local_brief` on, and the
 *     uncaught-nearby arrival push for users with `uncaught_nearby` on. When
 *     we've never seen a location for a user we skip (client must first
 *     heartbeat a location via POST /v1/push/prefs { last_lat, last_lng }).
 *   - 8am + 4pm server-local time: `runPriceAlertScan()`.
 *   - 7am server-local time: daily-brief fan-out. For each opted-in user we
 *     call `generateWatchlistBrief` (24h cache-hit is free) then push.
 *   - Every 5min: watchlist mover scan (±5% intraday).
 *   - Every 15min (offset to :07): find-evolution scan — finds up +10/25/50/
 *     100% since their `found_price`, one push per find per tier ever.
 *   - Saturday 12:00 **UTC**: `runRivalryWeeklyClose()` — scores each open
 *     weekly matchup off the week's five settled sessions.
 *
 * All schedules fire on wall-clock alignment (not "every N minutes from
 * start"): a check on each 1-minute tick reads `new Date()` and fires the
 * per-schedule work when the current hour/minute matches. This keeps the
 * behavior stable across process restarts. Every schedule reads server-local
 * time except the rivalry close, which is UTC-anchored to match its
 * `mondayUtc(...)` week key.
 */
import { generateLocalBrief } from "./local-brief-generator.js";
import { safeExecuteWithSpan } from "./logfire.js";
import { onDailyBriefGenerated } from "./notifiers/dailyBriefNotifier.js";
import { runFindEvolutionScan } from "./notifiers/findEvolutionNotifier.js";
import { onLocalBriefGenerated } from "./notifiers/localBriefNotifier.js";
import { runWatchlistMoverScan } from "./notifiers/moverNotifier.js";
import { runPriceAlertScan } from "./notifiers/priceAlertsNotifier.js";
import { runRivalryWeeklyClose } from "./notifiers/rivalryNotifier.js";
import { onUserMovedFar } from "./notifiers/uncaughtNearbyNotifier.js";
import { type PushToken, listTokensForEvent, updatePrefs } from "./push-tokens-store.js";
import { generateWatchlistBrief } from "./watchlist-brief.js";
import { listWatchEntries } from "./watchlist-store.js";

const TICK_MS = 60_000; // 1 minute — checks all schedules
const MOVE_METERS_THRESHOLD = 2_000; // 2 km

// Per-consumer movement anchors inside the shared `prefs.last_sent` map.
const LB_LAT = "local_brief_lat";
const LB_LNG = "local_brief_lng";
const UN_LAT = "uncaught_lat";
const UN_LNG = "uncaught_lng";

// Track last-fired minute per schedule so an accidental double-tick within
// the same minute never fires twice. Keys: schedule id → "YYYYMMDDHHMM".
const lastFired = new Map<string, string>();

function nowKey(now: Date, granularity: "hour" | "minute"): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return granularity === "hour" ? `${y}${m}${d}${h}` : `${y}${m}${d}${h}${min}`;
}

function fireOncePerMinute(id: string, now: Date, run: () => Promise<void>): void {
  const key = nowKey(now, "minute");
  if (lastFired.get(id) === key) return;
  lastFired.set(id, key);
  run().catch(() => {
    /* every notifier already swallows internally; belt+suspenders here. */
  });
}

function fireOncePerHour(id: string, now: Date, run: () => Promise<void>): void {
  const key = nowKey(now, "hour");
  if (lastFired.get(id) === key) return;
  lastFired.set(id, key);
  run().catch(() => {
    /* silent — see fireOncePerMinute */
  });
}

// Haversine — meters between two lat/lng. Used to decide "moved 2km+".
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---- Individual schedules ----

/**
 * Newest heartbeat fix across a user's devices, or null when we've never seen
 * one. `last_lat` / `last_lng` are written by the client heartbeat.
 */
function latestFix(userTokens: PushToken[]): { lat: number; lng: number } | null {
  let lat: number | undefined;
  let lng: number | undefined;
  let lastSeenAt = 0;
  for (const t of userTokens) {
    const at = t.prefs.last_location_at ? Date.parse(t.prefs.last_location_at) || 0 : 0;
    if (
      typeof t.prefs.last_lat === "number" &&
      typeof t.prefs.last_lng === "number" &&
      at >= lastSeenAt
    ) {
      lat = t.prefs.last_lat;
      lng = t.prefs.last_lng;
      lastSeenAt = at;
    }
  }
  if (lat === undefined || lng === undefined) return null;
  return { lat, lng };
}

/**
 * Previously-anchored location for one consumer, stored per token in
 * `last_sent[latKey] / last_sent[lngKey]` (opportunistically, as strings).
 * Each consumer keeps its own anchor so a failure in one branch never
 * advances — or stalls — the other.
 */
function readAnchor(
  userTokens: PushToken[],
  latKey: string,
  lngKey: string,
): { lat: number; lng: number } | null {
  for (const t of userTokens) {
    const rawLat = t.prefs.last_sent?.[latKey];
    const rawLng = t.prefs.last_sent?.[lngKey];
    if (typeof rawLat !== "string" || typeof rawLng !== "string") continue;
    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

/** The one movement rule: no anchor yet counts as moved, else >2km. */
function movedFar(anchor: { lat: number; lng: number } | null, fix: { lat: number; lng: number }) {
  if (!anchor) return true;
  return haversineMeters(anchor, fix) >= MOVE_METERS_THRESHOLD;
}

async function writeAnchor(
  userId: string,
  userTokens: PushToken[],
  latKey: string,
  lngKey: string,
  fix: { lat: number; lng: number },
): Promise<void> {
  await Promise.all(
    userTokens.map((t) =>
      updatePrefs(userId, t.id, {
        last_sent: { [latKey]: String(fix.lat), [lngKey]: String(fix.lng) },
      }).catch(() => null),
    ),
  );
}

/**
 * Movement tick. Detects ">2km since last anchor" once per user and fans that
 * single signal out to its consumers:
 *   1. local brief (`local_brief` opt-in) — roadmap B1,
 *   2. uncaught-nearby arrival push (`uncaught_nearby` opt-in) — roadmap B4.
 * Neither consumer does its own movement detection.
 */
async function runMovementTick(): Promise<void> {
  return safeExecuteWithSpan("scheduler.movement", async (span) => {
    const [briefTokens, uncaughtTokens] = await Promise.all([
      listTokensForEvent("local_brief"),
      listTokensForEvent("uncaught_nearby"),
    ]);
    span.setAttributes({
      candidate_tokens: briefTokens.length,
      uncaught_tokens: uncaughtTokens.length,
    });
    if (briefTokens.length === 0 && uncaughtTokens.length === 0) return;

    const briefUsers = new Set(briefTokens.map((t) => t.userId));
    const uncaughtUsers = new Set(uncaughtTokens.map((t) => t.userId));

    // Union by user, tokens deduped by id — one movement decision per user
    // even when their devices opted into different events.
    const byUser = new Map<string, PushToken[]>();
    const seenTokens = new Set<string>();
    for (const t of [...briefTokens, ...uncaughtTokens]) {
      if (seenTokens.has(t.id)) continue;
      seenTokens.add(t.id);
      const arr = byUser.get(t.userId) ?? [];
      arr.push(t);
      byUser.set(t.userId, arr);
    }

    for (const [userId, userTokens] of byUser) {
      const fix = latestFix(userTokens);
      if (!fix) continue;

      if (briefUsers.has(userId) && movedFar(readAnchor(userTokens, LB_LAT, LB_LNG), fix)) {
        // Generate the brief; the notifier dedupes per-day so a same-day
        // repeated location shift only pushes once.
        try {
          // eslint-disable-next-line no-await-in-loop
          const brief = await generateLocalBrief(fix);
          // eslint-disable-next-line no-await-in-loop
          await onLocalBriefGenerated(userId, brief, fix);
          // eslint-disable-next-line no-await-in-loop
          await writeAnchor(userId, userTokens, LB_LAT, LB_LNG, fix);
        } catch {
          /* per-user isolation — anchor stays put so the next tick retries */
        }
      }

      // B4: same >2km trigger, independent opt-in and independent anchor. The
      // notifier owns its own scoring, threshold and per-day budget — most
      // arrivals are silent by design.
      if (uncaughtUsers.has(userId) && movedFar(readAnchor(userTokens, UN_LAT, UN_LNG), fix)) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await onUserMovedFar(userId, fix);
          // eslint-disable-next-line no-await-in-loop
          await writeAnchor(userId, userTokens, UN_LAT, UN_LNG, fix);
        } catch {
          /* per-user isolation */
        }
      }
    }
  });
}

async function runDailyBriefTick(): Promise<void> {
  return safeExecuteWithSpan("scheduler.daily_brief", async (span) => {
    const tokens = await listTokensForEvent("daily_brief");
    span.setAttribute("candidate_tokens", tokens.length);
    if (tokens.length === 0) return;
    const userIds = [...new Set(tokens.map((t) => t.userId))];
    for (const userId of userIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const entries = await listWatchEntries(userId);
        if (entries.length === 0) continue;
        // eslint-disable-next-line no-await-in-loop
        const brief = await generateWatchlistBrief({ userId, entries });
        // eslint-disable-next-line no-await-in-loop
        await onDailyBriefGenerated(userId, brief);
      } catch {
        /* per-user isolation */
      }
    }
  });
}

async function runRivalryCloseTick(): Promise<void> {
  return safeExecuteWithSpan("scheduler.rivalry_close", async (span) => {
    const result = await runRivalryWeeklyClose();
    span.setAttributes({
      rivalries_scanned: result.rivalriesScanned,
      rounds_closed: result.roundsClosed,
      pushes_sent: result.pushesSent,
      xp_grants: result.xpGrants,
      skipped_no_data: result.skippedNoData,
    });
  });
}

async function runFindEvolutionTick(): Promise<void> {
  return safeExecuteWithSpan("scheduler.find_evolution", async (span) => {
    const result = await runFindEvolutionScan();
    span.setAttributes({
      users_scanned: result.usersScanned,
      evolutions_pushed: result.evolutionsPushed,
    });
  });
}

// ---- Main tick ----

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the scheduler. Idempotent — calling twice is a no-op.
 * Respects `ENABLE_PUSH_SCHEDULER=1` — otherwise returns without starting.
 */
export function startPushScheduler(): void {
  if (started) return;
  if (process.env.ENABLE_PUSH_SCHEDULER !== "1") {
    console.log("[scheduler] ENABLE_PUSH_SCHEDULER!=1 — push scheduler disabled");
    return;
  }
  started = true;

  const tick = () => {
    const now = new Date();
    const minute = now.getMinutes();
    const hour = now.getHours();

    // Every 5 minutes: watchlist mover scan.
    if (minute % 5 === 0) {
      fireOncePerMinute("mover", now, async () => {
        await runWatchlistMoverScan();
      });
    }
    // Every 15 minutes: find-evolution scan. Offset off the 5-minute grid so
    // it never shares a tick with the mover scan's quote fan-out.
    if (minute % 15 === 7) {
      fireOncePerMinute("find_evolution", now, runFindEvolutionTick);
    }
    // Every hour, at minute 0: movement tick (local brief + uncaught nearby).
    if (minute === 0) {
      fireOncePerHour("movement", now, runMovementTick);
    }
    // 8:00 and 16:00 local: price alert scan.
    if ((hour === 8 || hour === 16) && minute === 0) {
      fireOncePerHour(`price_alerts_${hour}`, now, async () => {
        await runPriceAlertScan();
      });
    }
    // 7:00 local: daily-brief fan-out.
    if (hour === 7 && minute === 0) {
      fireOncePerHour("daily_brief", now, runDailyBriefTick);
    }
    // Saturday 12:00 UTC: rivalry weekly close. Day and hour are read in UTC
    // (not server-local like the schedules above) because the round's week
    // key is `mondayUtc(...)` — anchoring the fire to the same clock keeps
    // one close per rivalry per calendar week wherever the API is deployed.
    // Noon Saturday UTC is comfortably after Friday's US close, so all five
    // sessions of the round have settled daily bars.
    if (now.getUTCDay() === 6 && now.getUTCHours() === 12 && now.getUTCMinutes() === 0) {
      fireOncePerMinute("rivalry_close", now, runRivalryCloseTick);
    }
  };

  timer = setInterval(tick, TICK_MS);
  console.log("[scheduler] push scheduler started (1-minute ticks)");
}

/** Test hook. */
export function _stopPushScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  lastFired.clear();
}
