/**
 * Push-notifications cron-like scheduler.
 *
 * Started from `src/index.ts` when `ENABLE_PUSH_SCHEDULER=1` (opt-in so local
 * dev never accidentally spams pushes). Uses `setInterval` — no external
 * dependency needed. Each tick catches its own errors so one failing notifier
 * cannot bring down the others.
 *
 * Cadences (per spec):
 *   - Every 60min: fresh local brief for users with `local_brief` on whose
 *     tracked lat/lng moved >2km since last send. When we've never seen a
 *     location for a user we skip (client must first heartbeat a location
 *     via POST /v1/push/prefs { last_lat, last_lng }).
 *   - 8am + 4pm server-local time: `runPriceAlertScan()`.
 *   - 7am server-local time: daily-brief fan-out. For each opted-in user we
 *     call `generateWatchlistBrief` (24h cache-hit is free) then push.
 *   - Every 5min: watchlist mover scan (±5% intraday).
 *
 * All schedules fire on wall-clock alignment (not "every N minutes from
 * start") — a check on each 1-minute tick reads `new Date()` and fires the
 * per-schedule work when the current hour/minute matches. This keeps the
 * behavior stable across process restarts.
 */
import { generateLocalBrief } from "./local-brief-generator.js";
import { safeExecuteWithSpan } from "./logfire.js";
import { onDailyBriefGenerated } from "./notifiers/dailyBriefNotifier.js";
import { onLocalBriefGenerated } from "./notifiers/localBriefNotifier.js";
import { runPriceAlertScan } from "./notifiers/priceAlertsNotifier.js";
import { runWatchlistMoverScan } from "./notifiers/moverNotifier.js";
import {
  listTokensForEvent,
  type PushToken,
  updatePrefs,
} from "./push-tokens-store.js";
import { generateWatchlistBrief } from "./watchlist-brief.js";
import { listWatchEntries } from "./watchlist-store.js";

const TICK_MS = 60_000; // 1 minute — checks all schedules
const MOVE_METERS_THRESHOLD = 2_000; // 2 km

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
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---- Individual schedules ----

async function runLocalBriefTick(): Promise<void> {
  return safeExecuteWithSpan("scheduler.local_brief", async (span) => {
    const tokens = await listTokensForEvent("local_brief");
    span.setAttribute("candidate_tokens", tokens.length);
    if (tokens.length === 0) return;

    const byUser = new Map<string, PushToken[]>();
    for (const t of tokens) {
      const arr = byUser.get(t.userId) ?? [];
      arr.push(t);
      byUser.set(t.userId, arr);
    }

    for (const [userId, userTokens] of byUser) {
      // Newest last_location wins across the user's devices.
      let lat: number | undefined;
      let lng: number | undefined;
      let lastSeenAt = 0;
      for (const t of userTokens) {
        const at = t.prefs.last_location_at
          ? Date.parse(t.prefs.last_location_at) || 0
          : 0;
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
      if (lat === undefined || lng === undefined) continue;

      // Prev anchor to compare against — stored per token as
      // `last_sent.local_brief_lat` / `local_brief_lng` (opportunistically).
      const prevLat = userTokens[0]?.prefs.last_sent?.local_brief_lat;
      const prevLng = userTokens[0]?.prefs.last_sent?.local_brief_lng;
      const prev =
        typeof prevLat === "string" && typeof prevLng === "string"
          ? { lat: Number(prevLat), lng: Number(prevLng) }
          : null;
      if (prev && Number.isFinite(prev.lat) && Number.isFinite(prev.lng)) {
        const d = haversineMeters(prev, { lat, lng });
        if (d < MOVE_METERS_THRESHOLD) continue;
      }
      // Generate the brief; the notifier dedupes per-day so a same-day
      // repeated location shift only pushes once.
      try {
        // eslint-disable-next-line no-await-in-loop
        const brief = await generateLocalBrief({ lat, lng });
        // eslint-disable-next-line no-await-in-loop
        await onLocalBriefGenerated(userId, brief, { lat, lng });
        // Record new anchor.
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(
          userTokens.map((t) =>
            updatePrefs(userId, t.id, {
              last_sent: {
                local_brief_lat: String(lat),
                local_brief_lng: String(lng),
              },
            }).catch(() => null),
          ),
        );
      } catch {
        /* per-user isolation */
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
    // Every hour, at minute 0: local brief opportunity.
    if (minute === 0) {
      fireOncePerHour("local_brief", now, runLocalBriefTick);
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
