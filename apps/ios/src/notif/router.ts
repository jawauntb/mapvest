/**
 * Deep-link routes for notification taps.
 *
 * Called from `_layout.tsx`'s `Notifications.addNotificationResponseReceivedListener`.
 * Given the notification's `data.kind`, returns a path to push (or null when
 * the notification carries no deep-link intent).
 */
export type NotifData = {
  kind?: string;
  ticker?: string;
  threadId?: string;
  lat?: number;
  lng?: number;
  brand?: string;
  tickers?: string[];
  changePct?: number;
};

export function pathFromNotificationData(data: NotifData | null | undefined): string | null {
  if (!data || !data.kind) return null;
  switch (data.kind) {
    case "daily_brief":
      return "/(tabs)/home";
    case "local_brief":
      return "/(tabs)/home";
    case "price_alert":
      return "/alerts";
    case "agent_response":
      return data.threadId
        ? `/(tabs)/research?intent=thread&id=${encodeURIComponent(data.threadId)}`
        : "/(tabs)/research";
    case "memo_finished":
      return data.ticker ? `/detail/${encodeURIComponent(data.ticker)}` : "/(tabs)/saved";
    case "identify_done":
      return data.ticker ? `/detail/${encodeURIComponent(data.ticker)}` : "/(tabs)/camera";
    case "watchlist_mover":
      return data.ticker ? `/detail/${encodeURIComponent(data.ticker)}` : "/(tabs)/home";
    default:
      return null;
  }
}
