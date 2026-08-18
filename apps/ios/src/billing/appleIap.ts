import { Platform } from "react-native";

/** App Store Connect product id. Must match `APPLE_IAP_PRODUCT_ID` on the API. */
export const MAPVEST_PRO_IOS_PRODUCT_ID = "mapvest_pro_monthly";

export function resolveAppleProductId(fromCheckout?: string): string {
  const id = fromCheckout?.trim();
  return id || MAPVEST_PRO_IOS_PRODUCT_ID;
}

export type ApplePurchaseResult = {
  jws: string;
  finish: () => Promise<void>;
};

export function isAppleUserCancelled(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code: unknown }).code) : "";
  return code === "user-cancelled" || code === "E_USER_CANCELLED";
}

async function iosIap() {
  if (Platform.OS !== "ios") {
    throw new Error("App Store billing is iOS-only on this build.");
  }
  return import("expo-iap");
}

/**
 * StoreKit 2 purchase. Returns the signed transaction JWS. Caller must POST
 * it to `/v1/billing/apple` then `finish()` so Apple does not retry.
 */
export async function purchaseAppleSubscription(productId: string): Promise<ApplePurchaseResult> {
  const iap = await iosIap();
  await iap.initConnection();
  await iap.fetchProducts({ skus: [productId], type: "subs" });
  const purchase = await new Promise<import("expo-iap").Purchase>((resolve, reject) => {
    const ok = iap.purchaseUpdatedListener((p) => {
      ok.remove();
      fail.remove();
      resolve(p);
    });
    const fail = iap.purchaseErrorListener((e) => {
      ok.remove();
      fail.remove();
      reject(e);
    });
    void iap
      .requestPurchase({
        request: { apple: { sku: productId } },
        type: "subs",
      })
      .catch((e) => {
        ok.remove();
        fail.remove();
        reject(e);
      });
  });
  const jws = purchase.purchaseToken;
  if (!jws) throw new Error("StoreKit did not return a signed transaction.");
  return {
    jws,
    finish: () => iap.finishTransaction({ purchase, isConsumable: false }),
  };
}

/** Restore current entitlements and return the latest JWS for this product, if any. */
export async function restoreAppleSubscription(
  productId: string,
): Promise<ApplePurchaseResult | null> {
  const iap = await iosIap();
  await iap.initConnection();
  if (typeof iap.restorePurchases === "function") {
    await iap.restorePurchases();
  }
  const purchases = await iap.getAvailablePurchases();
  const match = purchases.find((p) => p.productId === productId && p.purchaseToken);
  if (!match?.purchaseToken) return null;
  return {
    jws: match.purchaseToken,
    finish: () => iap.finishTransaction({ purchase: match, isConsumable: false }),
  };
}

export async function openAppleSubscriptionManagement(): Promise<void> {
  const iap = await iosIap();
  if (typeof iap.showManageSubscriptionsIOS === "function") {
    await iap.showManageSubscriptionsIOS();
    return;
  }
  const { Linking } = await import("react-native");
  await Linking.openURL("https://apps.apple.com/account/subscriptions");
}
