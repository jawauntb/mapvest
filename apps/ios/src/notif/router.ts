/** Account-safe notification routing uses only the typed delivery envelope. */
import {
  type NotificationData,
  type PushNotificationDelivery,
  parsePushNotificationDelivery,
  pathFromPushDelivery,
} from "./delivery";

export type NotifData = NotificationData;

export function pathFromNotificationData(
  data: NotifData | null | undefined,
  actionIdentifier?: string,
): string | null {
  const delivery = parsePushNotificationDelivery(data);
  return delivery ? pathFromPushDelivery(delivery, actionIdentifier) : null;
}

export function pathFromPendingDelivery(
  delivery: PushNotificationDelivery,
  actionIdentifier?: string,
): string {
  return pathFromPushDelivery(delivery, actionIdentifier);
}
