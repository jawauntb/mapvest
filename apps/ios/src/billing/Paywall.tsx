import { confirmApplePurchase, startCheckout, startPortal } from "@/api/client";
import { isQuotaExceeded } from "@/api/errors";
import { useSession } from "@/auth/session";
import {
  isAppleUserCancelled,
  openAppleSubscriptionManagement,
  purchaseAppleSubscription,
  resolveAppleProductId,
  restoreAppleSubscription,
} from "@/billing/appleIap";
import { ENTITLEMENTS_QUERY_KEY } from "@/billing/useEntitlements";
import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, elevation, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AppState,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

type PaywallCtx = {
  visible: boolean;
  presentPaywall: () => void;
  dismissPaywall: () => void;
};

const Ctx = createContext<PaywallCtx | null>(null);

export function usePaywall(): PaywallCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePaywall must be used inside <PaywallProvider>");
  return v;
}

/** If `err` is a spent free-tier meter, open the paywall and return true. */
export function presentPaywallIfQuota(err: unknown, present: () => void): boolean {
  if (!isQuotaExceeded(err)) return false;
  present();
  return true;
}

/**
 * Global subscribe sheet. iOS charges through StoreKit 2 (Guideline 3.1.1).
 * Web (and this sheet's Android stub) uses Stripe Checkout. After a native
 * purchase the JWS is posted to `POST /v1/billing/apple` so quota lifts on
 * the same account as web Stripe.
 */
export function PaywallProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const resumeAfterAuth = useRef(false);
  const { session } = useSession();

  useEffect(() => {
    if (session && resumeAfterAuth.current) {
      resumeAfterAuth.current = false;
      setVisible(true);
    }
  }, [session]);

  const qc = useQueryClient();
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void qc.invalidateQueries({ queryKey: ENTITLEMENTS_QUERY_KEY });
      }
    });
    return () => sub.remove();
  }, [qc]);

  const presentPaywall = useCallback(() => setVisible(true), []);
  const dismissPaywall = useCallback(() => setVisible(false), []);

  const value = useMemo<PaywallCtx>(
    () => ({ visible, presentPaywall, dismissPaywall }),
    [visible, presentPaywall, dismissPaywall],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <PaywallSheet visible={visible} resumeAfterAuth={resumeAfterAuth} onClose={dismissPaywall} />
    </Ctx.Provider>
  );
}

function PaywallSheet({
  visible,
  resumeAfterAuth,
  onClose,
}: {
  visible: boolean;
  resumeAfterAuth: { current: boolean };
  onClose: () => void;
}) {
  const { session } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"checkout" | "portal" | "restore" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function subscribe() {
    setErr(null);
    if (!session?.token) {
      resumeAfterAuth.current = true;
      onClose();
      router.push("/auth");
      return;
    }
    setBusy("checkout");
    try {
      if (Platform.OS === "ios") {
        let productId = resolveAppleProductId();
        try {
          const intent = await startCheckout(
            { platform: "ios", successUrl: "https://mapvest.app/app?billing=success" },
            { token: session.token },
          );
          productId = resolveAppleProductId(intent.productId);
        } catch {
          /* checkout 503s until APPLE_IAP_PRODUCT_ID is set; StoreKit still uses the default sku */
        }
        const purchase = await purchaseAppleSubscription(productId);
        await confirmApplePurchase({ signedTransaction: purchase.jws }, { token: session.token });
        await purchase.finish();
        onClose();
        return;
      }
      const platform = Platform.OS === "android" ? "android" : "ios";
      const intent = await startCheckout(
        { platform, successUrl: "https://mapvest.app/app?billing=success" },
        { token: session.token },
      );
      if (intent.channel === "stripe" && intent.url) {
        await Linking.openURL(intent.url);
        return;
      }
      if (intent.channel === "google_play") {
        setErr("Play Billing is not on this build.");
        return;
      }
      setErr("Could not start checkout.");
    } catch (e) {
      if (isAppleUserCancelled(e)) return;
      setErr(e instanceof Error ? e.message : "Could not start checkout.");
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: ENTITLEMENTS_QUERY_KEY });
    }
  }

  async function restore() {
    if (!session?.token || Platform.OS !== "ios") return;
    setErr(null);
    setBusy("restore");
    try {
      const intent = await startCheckout({ platform: "ios" }, { token: session.token }).catch(
        () => null,
      );
      const productId = resolveAppleProductId(intent?.productId);
      const purchase = await restoreAppleSubscription(productId);
      if (!purchase) {
        setErr("No App Store subscription found for this Apple ID.");
        return;
      }
      await confirmApplePurchase({ signedTransaction: purchase.jws }, { token: session.token });
      await purchase.finish();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not restore purchases.");
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: ENTITLEMENTS_QUERY_KEY });
    }
  }

  async function manage() {
    if (!session?.token) return;
    setErr(null);
    setBusy("portal");
    try {
      if (Platform.OS === "ios") {
        await openAppleSubscriptionManagement();
        return;
      }
      const { url } = await startPortal({ token: session.token });
      await Linking.openURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not open billing portal.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={[styles.card, elevation.lg]}>
          <Text style={styles.kicker}>Mapvest Pro</Text>
          <Text style={styles.title}>50 free generations used</Text>
          <Text style={styles.body}>
            Identify, research briefs, and memos are metered. Map and nearby stay free. Pro is
            $20/month and follows the account you sign in with.
          </Text>
          <Text style={styles.body}>
            This is research, not a brokerage, and not investment advice. Mapvest never places
            trades.
          </Text>
          <PrimaryButton
            label={
              !session
                ? "Sign in to subscribe"
                : busy === "checkout"
                  ? Platform.OS === "ios"
                    ? "Waiting for App Store…"
                    : "Opening checkout…"
                  : "Subscribe $20/mo"
            }
            busy={busy === "checkout"}
            onPress={() => void subscribe()}
            style={{ alignSelf: "stretch" }}
            accessibilityLabel={session ? "Subscribe 20 dollars per month" : "Sign in to subscribe"}
          />
          {session ? (
            <Pressable
              onPress={() => {
                hapticSelect();
                void manage();
              }}
              disabled={busy === "portal"}
              style={styles.secondary}
              accessibilityRole="button"
              accessibilityLabel="Manage subscription"
            >
              <Text style={styles.secondaryText}>
                {busy === "portal" ? "Opening…" : "Already subscribed? Manage"}
              </Text>
            </Pressable>
          ) : null}
          {session && Platform.OS === "ios" ? (
            <Pressable
              onPress={() => {
                hapticSelect();
                void restore();
              }}
              disabled={busy === "restore"}
              style={styles.secondary}
              accessibilityRole="button"
              accessibilityLabel="Restore App Store purchases"
            >
              <Text style={styles.secondaryText}>
                {busy === "restore" ? "Restoring…" : "Restore purchases"}
              </Text>
            </Pressable>
          ) : null}
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <Pressable
            onPress={() => {
              hapticSelect();
              onClose();
            }}
            style={styles.secondary}
            accessibilityRole="button"
            accessibilityLabel="Not now"
          >
            <View style={styles.notNowRow}>
              <Ionicons name="close" size={14} color={colors.fgMuted} />
              <Text style={styles.secondaryText}>Not now. Map stays free.</Text>
            </View>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 22,
    gap: 12,
  },
  kicker: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  title: { color: colors.fg, ...type.h2, fontSize: 22 },
  body: { color: colors.fgMuted, ...type.body, fontSize: 15, lineHeight: 22 },
  secondary: {
    alignItems: "center",
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: "center",
  },
  secondaryText: { color: colors.fgMuted, fontSize: 15, fontWeight: "700" },
  notNowRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  err: { color: colors.danger, fontSize: 13, lineHeight: 18 },
});
