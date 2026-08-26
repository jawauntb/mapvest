import type { LatLng } from "@/api/types";

/**
 * A widget location fix is only useful to the account that had a push
 * registration when the widget captured it.  The epoch is deliberately an
 * opaque, per-registration value rather than a user id or bearer token.
 */
export type WidgetRegistrationContext = {
  accountId: string;
  epoch: string;
  registeredAt: number;
  registrationId?: string;
};

export type WidgetCapturedFix = LatLng & {
  capturedAt: number;
  accountId: string;
  registrationEpoch: string;
};

export type WidgetRelayDecision =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "no-registration"
        | "account-mismatch"
        | "epoch-mismatch"
        | "pre-registration"
        | "invalid-coordinate"
        | "stale"
        | "future";
    };

function validCoordinate(coords: Pick<LatLng, "lat" | "lng">): boolean {
  return (
    Number.isFinite(coords.lat) &&
    Number.isFinite(coords.lng) &&
    Math.abs(coords.lat) <= 90 &&
    Math.abs(coords.lng) <= 180 &&
    !(coords.lat === 0 && coords.lng === 0)
  );
}

/**
 * Pure account-boundary policy for a widget fix that is about to heartbeat.
 * Keeping this free of Expo/React Native imports makes the dangerous cases
 * unit-testable and lets the heartbeat adapter use one shared decision rule.
 */
export function widgetFixRelayDecision({
  fix,
  registration,
  now,
  maxAgeMs,
}: {
  fix: Partial<WidgetCapturedFix> | null | undefined;
  registration: WidgetRegistrationContext | null | undefined;
  now: number;
  maxAgeMs: number;
}): WidgetRelayDecision {
  if (!registration) return { ok: false, reason: "no-registration" };
  if (fix?.accountId !== registration.accountId) {
    return { ok: false, reason: "account-mismatch" };
  }
  if (fix.registrationEpoch !== registration.epoch) {
    return { ok: false, reason: "epoch-mismatch" };
  }
  if (
    typeof fix?.lat !== "number" ||
    typeof fix?.lng !== "number" ||
    !validCoordinate({ lat: fix.lat, lng: fix.lng })
  ) {
    return { ok: false, reason: "invalid-coordinate" };
  }
  if (typeof fix.capturedAt !== "number" || !Number.isFinite(fix.capturedAt)) {
    return { ok: false, reason: "stale" };
  }
  if (fix.capturedAt < registration.registeredAt) {
    return { ok: false, reason: "pre-registration" };
  }
  const age = now - fix.capturedAt;
  if (age < 0) return { ok: false, reason: "future" };
  if (age > maxAgeMs) return { ok: false, reason: "stale" };
  return { ok: true };
}
