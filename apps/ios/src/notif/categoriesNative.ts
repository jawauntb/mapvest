import * as Notifications from "expo-notifications";
import { PUSH_CATEGORY_DEFINITIONS } from "./categories";

let registration: Promise<void> | null = null;

/** Register foreground-only navigation actions after session/bootstrap is safe. */
export function registerNotificationCategories(): Promise<void> {
  if (registration) return registration;
  registration = Promise.all(
    PUSH_CATEGORY_DEFINITIONS.map((category) =>
      Notifications.setNotificationCategoryAsync(category.identifier, category.actions),
    ),
  )
    .then(() => undefined)
    .catch((error) => {
      registration = null;
      throw error;
    });
  return registration;
}
