import {
  type PushNotificationDelivery as ApiPushNotificationDelivery,
  PushNotificationDelivery as PushNotificationDeliverySchema,
  type PushNotificationTarget,
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

export function parsePushNotificationDelivery(
  data: NotificationData | null | undefined,
): PushNotificationDelivery | null {
  const parsed = PushNotificationDeliverySchema.safeParse(data?.mapvest);
  return parsed.success ? parsed.data : null;
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
