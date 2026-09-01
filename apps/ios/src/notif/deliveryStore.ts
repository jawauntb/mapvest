import AsyncStorage from "@react-native-async-storage/async-storage";
import { createPushDeliveryStore } from "./deliveryStoreCore";

export type { PushDeliveryScope, PushDeliveryStorage } from "./deliveryStoreCore";
export { createPushDeliveryStore } from "./deliveryStoreCore";

export const pushDeliveryStore = createPushDeliveryStore(AsyncStorage);

export function clearPushDeliveryLedger(): Promise<void> {
  return pushDeliveryStore.clear();
}
