import type { PushEventKey, PushPrefs } from "./prefs";

export type NotificationBundleKey = "nearby" | "universe" | "research";
export type NotificationBundleState = "off" | "on" | "some";

export type NotificationBundle = {
  key: NotificationBundleKey;
  label: string;
  description: string;
  events: PushEventKey[];
};

export const NOTIFICATION_BUNDLES: NotificationBundle[] = [
  {
    key: "nearby",
    label: "Nearby Discovery",
    description: "A useful company near you, a local brief, or a finished camera result.",
    events: ["uncaught_nearby", "local_brief", "identify_done"],
  },
  {
    key: "universe",
    label: "My Universe",
    description: "Meaningful moves and new milestones for companies you saved or found.",
    events: ["watchlist_mover", "find_evolution"],
  },
  {
    key: "research",
    label: "Research Ready",
    description: "A memo or agent response is finished and ready to read.",
    events: ["memo_finished", "agent_response"],
  },
];

export const INDIVIDUAL_NOTIFICATION_EVENTS: PushEventKey[] = ["daily_brief", "price_alerts"];

export function notificationBundleState(
  prefs: PushPrefs,
  bundle: NotificationBundle,
): NotificationBundleState {
  const enabled = bundle.events.filter((event) => prefs[event] === true).length;
  if (enabled === 0) return "off";
  return enabled === bundle.events.length ? "on" : "some";
}

export function notificationBundlePatch(
  bundle: NotificationBundle,
  enabled: boolean,
): Partial<PushPrefs> {
  return Object.fromEntries(bundle.events.map((event) => [event, enabled])) as Partial<PushPrefs>;
}

export function notificationBundleValueLabel(state: NotificationBundleState): string {
  if (state === "on") return "On";
  if (state === "some") return "Some on";
  return "Off";
}
