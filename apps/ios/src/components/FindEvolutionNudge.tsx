import type { Quote } from "@/api/client";
import {
  type FindEvolutionEnrollmentContext,
  type FindEvolutionOptInResult,
  type NotificationSession,
  resolveFindEvolutionEnrollmentCompletion,
  shouldOfferFindEvolutionNudge,
} from "@/notif/findEvolutionOptIn";
import {
  dismissFindEvolutionNudge,
  getFindEvolutionDevicePrefs,
  readFindEvolutionNudgeDismissal,
  serializeFindEvolutionOptIn,
} from "@/notif/findEvolutionOptInNative";
import { colors, radii, type } from "@/theme/tokens";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";

type NudgeState = "loading" | "hidden" | "ready" | "enabling" | "enabled" | "denied" | "error";

type FindEvolutionNudgeProps = {
  session?: { token: string } | null;
  userId?: string | null;
  authGeneration: number;
  ticker?: string | null;
  isPublic: boolean;
  /** The full identify response identity; guards against stale async results. */
  candidate: object;
  /** The API only attaches this to a public result after it receives a quote. */
  quote?: Pick<Quote, "price"> | null;
};

/**
 * A quiet post-value invitation to the existing Find evolution notifier.
 * It is not a modal and performs no permission work until its CTA is tapped.
 */
export function FindEvolutionNudge({
  session,
  userId,
  authGeneration,
  ticker,
  isPublic,
  candidate,
  quote,
}: FindEvolutionNudgeProps) {
  const [state, setState] = useState<NudgeState>("loading");
  const enablingRef = useRef(false);
  const [enrollmentInFlight, setEnrollmentInFlight] =
    useState<FindEvolutionEnrollmentContext | null>(null);
  const enabledEnrollmentRef = useRef<FindEvolutionEnrollmentContext | null>(null);
  const sessionToken = session?.token;
  const activeSession = useMemo<NotificationSession | null>(
    () => (sessionToken && userId ? { token: sessionToken, userId, authGeneration } : null),
    [authGeneration, sessionToken, userId],
  );
  const foundPrice = quote?.price;
  const candidateKey = `${userId ?? ""}:${sessionToken ?? ""}:${authGeneration}:${isPublic}:${ticker ?? ""}:${foundPrice ?? ""}`;
  const currentContext: FindEvolutionEnrollmentContext | null =
    userId && sessionToken ? { userId, sessionToken, authGeneration, candidate } : null;
  const currentContextRef = useRef<FindEvolutionEnrollmentContext | null>(currentContext);
  const renderedCandidateRef = useRef(candidate);
  const renderedCandidateKeyRef = useRef(candidateKey);
  const candidateChangedDuringRender =
    renderedCandidateRef.current !== candidate || renderedCandidateKeyRef.current !== candidateKey;
  currentContextRef.current = currentContext;
  renderedCandidateRef.current = candidate;
  renderedCandidateKeyRef.current = candidateKey;
  const baseEligible = shouldOfferFindEvolutionNudge({
    userId,
    isPublic,
    ticker,
    foundPrice,
    dismissed: false,
  });
  const serializedEnable = useMemo(
    () =>
      activeSession
        ? serializeFindEvolutionOptIn(activeSession, () => {
            const current = currentContextRef.current;
            return Boolean(
              current &&
                current.userId === activeSession.userId &&
                current.sessionToken === activeSession.token &&
                current.authGeneration === activeSession.authGeneration,
            );
          })
        : null,
    [activeSession],
  );
  const enrollmentMatchesCurrentCandidate = Boolean(
    enrollmentInFlight &&
      currentContext &&
      enrollmentInFlight.userId === currentContext.userId &&
      enrollmentInFlight.sessionToken === currentContext.sessionToken &&
      enrollmentInFlight.authGeneration === currentContext.authGeneration &&
      enrollmentInFlight.candidate === currentContext.candidate,
  );
  // Effects reset state for a new identify response after commit. Hiding for
  // this render prevents the previous response's success or busy copy from
  // flashing on the newer Camera result.
  const renderedState: NudgeState =
    candidateChangedDuringRender ||
    (enrollmentInFlight !== null && !enrollmentMatchesCurrentCandidate)
      ? "loading"
      : state;
  const showingOffer = renderedState === "ready" || renderedState === "enabling";

  useEffect(() => {
    return () => {
      currentContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const isAlreadyEnabledForCurrentAccount = () => {
      const enabled = enabledEnrollmentRef.current;
      return Boolean(
        enabled &&
          enabled.userId === userId &&
          enabled.sessionToken === activeSession?.token &&
          enabled.authGeneration === activeSession?.authGeneration,
      );
    };
    const setAlreadyEnabledState = () => {
      const enabled = enabledEnrollmentRef.current;
      setState(enabled?.candidate === candidate ? "enabled" : "hidden");
    };

    if (!activeSession || !userId || !baseEligible) {
      setState("hidden");
      return () => {
        cancelled = true;
      };
    }
    if (isAlreadyEnabledForCurrentAccount()) {
      setAlreadyEnabledState();
      return () => {
        cancelled = true;
      };
    }

    setState("loading");
    void Promise.all([
      readFindEvolutionNudgeDismissal(userId),
      getFindEvolutionDevicePrefs(activeSession),
    ])
      .then(([dismissed, remote]) => {
        if (cancelled || dismissed === null) return;
        if (isAlreadyEnabledForCurrentAccount()) {
          setAlreadyEnabledState();
          return;
        }
        const eligible = shouldOfferFindEvolutionNudge({
          userId,
          isPublic,
          ticker,
          foundPrice,
          dismissed,
          existingFindEvolutionPreference: remote.prefs.find_evolution,
        });
        setState(eligible ? "ready" : "hidden");
      })
      .catch(() => {
        // We cannot safely distinguish a new user from an existing Settings
        // choice without the server response, so hide instead of overriding.
        if (!cancelled) setState("hidden");
      });

    return () => {
      cancelled = true;
    };
  }, [activeSession, baseEligible, candidate, foundPrice, isPublic, ticker, userId]);

  const dismiss = () => {
    if (!userId || renderedState === "enabling") return;
    setState("hidden");
    void dismissFindEvolutionNudge(userId);
  };

  const enable = async () => {
    if (!serializedEnable || !currentContext || enablingRef.current) return;
    const action = currentContext;
    enablingRef.current = true;
    setEnrollmentInFlight(action);
    setState("enabling");
    let result: FindEvolutionOptInResult;
    try {
      result = await serializedEnable();
    } catch {
      // The helper contains its own failure mapping; retain a last-resort
      // fallback so an unexpected native exception cannot claim success.
      result = { status: "persistence-failed" };
    }

    const finish = () => {
      enablingRef.current = false;
      setEnrollmentInFlight((inFlight) => (inFlight === action ? null : inFlight));
    };

    const completion = resolveFindEvolutionEnrollmentCompletion(
      result,
      action,
      currentContextRef.current,
    );
    if (completion === "ignore") {
      finish();
      return;
    }
    if (result.status === "enabled") {
      enabledEnrollmentRef.current = action;
      void dismissFindEvolutionNudge(action.userId);
    }
    if (completion === "enabled") {
      setState("enabled");
      finish();
      return;
    }
    if (completion === "hidden") {
      setState("hidden");
      finish();
      return;
    }
    setState(completion);
    finish();
  };

  if (renderedState === "loading" || renderedState === "hidden") return null;

  return (
    <View style={styles.card}>
      {!showingOffer ? (
        <View style={styles.heading}>
          <Ionicons name="pulse-outline" size={16} color={colors.accent} />
          <Text accessibilityRole="header" style={styles.title}>
            Keep all your finds in view
          </Text>
        </View>
      ) : null}

      {renderedState === "enabled" ? (
        <Text accessibilityLiveRegion="polite" style={styles.success}>
          Find evolution notifications are on for all your finds on this device. Change them anytime
          in Settings.
        </Text>
      ) : renderedState === "denied" ? (
        <>
          <Text accessibilityLiveRegion="polite" style={styles.copy}>
            Notifications are off in iOS. No evolution alerts were enabled.
          </Text>
          <View style={styles.actions}>
            <Pressable
              onPress={() => void Linking.openSettings().catch(() => {})}
              style={styles.primaryButton}
              accessibilityRole="button"
              accessibilityLabel="Open iOS notification settings"
            >
              <Text style={styles.primaryButtonText}>Open iOS Settings</Text>
            </Pressable>
            <Pressable
              onPress={() => void enable()}
              style={styles.secondaryButton}
              accessibilityRole="button"
              accessibilityLabel="Retry enabling Find evolution notifications"
            >
              <Text style={styles.secondaryButtonText}>Try again</Text>
            </Pressable>
          </View>
          <Pressable
            onPress={dismiss}
            style={styles.dismissButton}
            accessibilityRole="button"
            accessibilityLabel="Dismiss Find evolution notifications offer"
          >
            <Text style={styles.dismissText}>Not now</Text>
          </Pressable>
        </>
      ) : renderedState === "error" ? (
        <>
          <Text accessibilityLiveRegion="polite" style={styles.copy}>
            Mapvest could not enable evolution notifications. No alert was turned on. Check your
            connection or notification settings and try again.
          </Text>
          <View style={styles.actions}>
            <Pressable
              onPress={() => void enable()}
              style={styles.primaryButton}
              accessibilityRole="button"
              accessibilityLabel="Retry enabling Find evolution notifications"
            >
              <Text style={styles.primaryButtonText}>Try again</Text>
            </Pressable>
            <Pressable
              onPress={dismiss}
              style={styles.secondaryButton}
              accessibilityRole="button"
              accessibilityLabel="Dismiss Find evolution notifications offer"
            >
              <Text style={styles.secondaryButtonText}>Not now</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={[styles.copy, styles.offerCopy]}>
            Get an optional note when any of your finds reaches a +10%, +25%, +50%, or +100%
            milestone from its captured price. Collection, not advice.
          </Text>
          <View style={styles.actions}>
            <Pressable
              onPress={() => void enable()}
              disabled={renderedState === "enabling"}
              style={[styles.primaryButton, renderedState === "enabling" && styles.buttonBusy]}
              accessibilityRole="button"
              accessibilityState={{
                disabled: renderedState === "enabling",
                busy: renderedState === "enabling",
              }}
              accessibilityLabel="Track Find evolutions for all your finds"
            >
              {renderedState === "enabling" ? <ActivityIndicator color={colors.accentInk} /> : null}
              {renderedState !== "enabling" ? (
                <Ionicons name="pulse-outline" size={15} color={colors.accentInk} />
              ) : null}
              <Text style={styles.primaryButtonText}>
                {renderedState === "enabling" ? "Turning on…" : "Track all finds"}
              </Text>
            </Pressable>
            <Pressable
              onPress={dismiss}
              disabled={renderedState === "enabling"}
              style={[styles.secondaryButton, renderedState === "enabling" && styles.buttonBusy]}
              accessibilityRole="button"
              accessibilityState={{ disabled: renderedState === "enabling" }}
              accessibilityLabel="Dismiss Find evolution notifications offer"
            >
              <Text style={styles.secondaryButtonText}>Not now</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 6,
    marginTop: 4,
    padding: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgGlass,
  },
  heading: { flexDirection: "row", alignItems: "center", gap: 7 },
  title: { color: colors.fg, ...type.label, fontSize: 14, fontWeight: "800" },
  copy: { color: colors.fgMuted, ...type.body, fontSize: 13, lineHeight: 19 },
  offerCopy: { fontSize: 12, lineHeight: 17 },
  success: { color: colors.accent, ...type.body, fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  primaryButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    flexGrow: 1,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  primaryButtonText: { color: colors.accentInk, fontSize: 13, fontWeight: "800" },
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryButtonText: { color: colors.fg, fontSize: 13, fontWeight: "700" },
  dismissButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  dismissText: { color: colors.fgMuted, fontSize: 13, fontWeight: "700" },
  buttonBusy: { opacity: 0.6 },
});
