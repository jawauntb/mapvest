import {
  AppleJwsError,
  assertAppleSubscription,
  verifyAppleSignedTransaction,
} from "./apple-jws.js";
import {
  AppleSubscriptionConflictError,
  clearAppleSubscription,
  findUserIdByAppleOriginalTransactionId,
  getEntitlementState,
  markAppleSubscribed,
} from "./entitlements.js";

export { AppleJwsError, AppleSubscriptionConflictError };

/**
 * Verify a StoreKit 2 JWS and grant (or drop) Mapvest Pro for this user.
 */
export async function redeemAppleTransaction(userId: string, signedTransaction: string) {
  const raw = await verifyAppleSignedTransaction(signedTransaction);
  try {
    const tx = assertAppleSubscription(raw);
    await markAppleSubscribed(userId, tx.originalTransactionId);
  } catch (err) {
    if (
      err instanceof AppleJwsError &&
      (err.message === "expired" || err.message === "revoked") &&
      raw.originalTransactionId
    ) {
      const owner = await findUserIdByAppleOriginalTransactionId(raw.originalTransactionId);
      if (owner === userId) await clearAppleSubscription(userId);
    }
    throw err;
  }
  return getEntitlementState({ userId });
}
