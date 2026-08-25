import { addToWatchlist, requestMagicLink, verifyMagicLink } from "@/api/client";
import { parseSaveContinuation, saveContinuationDestination } from "@/auth/saveContinuation";
import { useSession } from "@/auth/session";
import { BrandMark } from "@/components/BrandMark";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenFade } from "@/components/ScreenFade";
import { colors, radii } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Stage = "email" | "code";

export default function AuthScreen() {
  const { signIn } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{
    intent?: string | string[];
    ticker?: string | string[];
    name?: string | string[];
    sector?: string | string[];
    source?: string | string[];
  }>();
  const continuation = useMemo(
    () =>
      parseSaveContinuation({
        intent: params.intent,
        ticker: params.ticker,
        name: params.name,
        sector: params.sector,
        source: params.source,
      }),
    [params.intent, params.name, params.sector, params.source, params.ticker],
  );
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const submitInFlight = useRef(false);
  const verifiedSessionToken = useRef<string | null>(null);
  // v0.1: API returns devCode inline (AUTH_RETURN_CODE=1) since email isn't
  // wired yet. Show it under the code input so the demo can complete.
  const [devCode, setDevCode] = useState<string | null>(null);

  async function sendLink() {
    setErr(null);
    setBusy(true);
    try {
      const r = await requestMagicLink(email.trim().toLowerCase());
      if (r.devCode) setDevCode(r.devCode);
      setStage("code");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send magic link.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setErr(null);
    setBusy(true);
    setStatus(
      verifiedSessionToken.current && continuation
        ? `Saving $${continuation.ticker} to your watchlist…`
        : "Verifying your code…",
    );
    let navigating = false;
    try {
      let sessionToken = verifiedSessionToken.current;
      if (!sessionToken) {
        const { session, user } = await verifyMagicLink(email.trim().toLowerCase(), code.trim());
        await signIn(session, user);
        sessionToken = session.token;
        verifiedSessionToken.current = sessionToken;
      }
      if (continuation) {
        setStatus(`Saving $${continuation.ticker} to your watchlist…`);
        await addToWatchlist(
          {
            ticker: continuation.ticker,
            name: continuation.name,
            sector: continuation.sector,
            source: continuation.source,
          },
          { token: sessionToken },
        );
        // Detail pushed Auth on top of this same ticker route. Going back
        // restores that live screen and avoids Detail → Auth → Detail copies.
        if (continuation.source === "detail" && router.canGoBack()) {
          router.back();
        } else {
          router.replace(saveContinuationDestination(continuation) as never);
        }
      } else {
        router.replace("/(tabs)/map");
      }
      navigating = true;
    } catch (e) {
      setStatus(null);
      const detail = e instanceof Error ? e.message : "Please try again.";
      setErr(
        verifiedSessionToken.current && continuation
          ? `You're signed in, but $${continuation.ticker} wasn't saved. ${detail}`
          : detail,
      );
    } finally {
      // Keep the CTA locked until the completed route replaces this screen.
      // A double press cannot create a second post-auth save request.
      if (!navigating) {
        submitInFlight.current = false;
        setBusy(false);
      }
    }
  }

  const retryingVerifiedSave = Boolean(verifiedSessionToken.current && continuation);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScreenFade>
          <View style={styles.container}>
            <View style={styles.mark}>
              <BrandMark size={56} />
            </View>
            <Text style={styles.title}>Mapvest</Text>
            <Text style={styles.subtitle}>
              {stage === "email"
                ? continuation
                  ? `Sign in to save $${continuation.ticker}. We’ll return to its details when it’s saved.`
                  : "Enter your email — we'll send you a one-time code."
                : retryingVerifiedSave
                  ? `You’re signed in. Retry saving $${continuation?.ticker ?? "this ticker"}.`
                  : `We sent a code to ${email}. Enter it below.`}
            </Text>

            <View style={styles.inputWrap}>
              <Ionicons
                name={stage === "email" ? "mail-outline" : "keypad-outline"}
                size={17}
                color={colors.fgDim}
                style={{ marginLeft: 14 }}
              />
              {stage === "email" ? (
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="you@example.com"
                  placeholderTextColor={colors.fgDim}
                  style={styles.input}
                  onSubmitEditing={sendLink}
                  accessibilityLabel="Email address"
                />
              ) : (
                <TextInput
                  value={code}
                  onChangeText={setCode}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="number-pad"
                  placeholder="6-digit code"
                  placeholderTextColor={colors.fgDim}
                  style={styles.input}
                  editable={!retryingVerifiedSave}
                  onSubmitEditing={retryingVerifiedSave ? undefined : submitCode}
                  accessibilityLabel="6-digit code"
                  accessibilityState={{ disabled: retryingVerifiedSave }}
                />
              )}
            </View>

            {devCode && stage === "code" && !retryingVerifiedSave ? (
              <Pressable
                onPress={() => setCode(devCode)}
                accessibilityRole="button"
                accessibilityLabel="Fill demo code"
              >
                <Text style={styles.devCode}>Demo code (tap to fill): {devCode}</Text>
              </Pressable>
            ) : null}

            {status ? (
              <Text accessibilityLiveRegion="polite" style={styles.status}>
                {status}
              </Text>
            ) : null}
            {err ? <Text style={styles.err}>{err}</Text> : null}

            <PrimaryButton
              label={
                stage === "email"
                  ? "Send code"
                  : verifiedSessionToken.current && continuation
                    ? "Retry save"
                    : "Verify"
              }
              onPress={stage === "email" ? sendLink : submitCode}
              busy={busy}
              disabled={stage === "email" ? !email : retryingVerifiedSave ? false : !code}
              style={{ marginTop: 4 }}
            />

            {stage === "code" && !verifiedSessionToken.current ? (
              <Pressable
                onPress={() => {
                  hapticSelect();
                  setStage("email");
                }}
                accessibilityRole="button"
                accessibilityLabel="Use a different email"
              >
                <Text style={styles.linkText}>Use a different email</Text>
              </Pressable>
            ) : null}
          </View>
        </ScreenFade>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, paddingHorizontal: 24, justifyContent: "center", gap: 16 },
  mark: { alignSelf: "flex-start", marginBottom: 4 },
  title: { color: colors.fg, fontSize: 36, lineHeight: 40, fontWeight: "800", letterSpacing: -0.4 },
  subtitle: { color: colors.fgMuted, fontSize: 15, lineHeight: 20 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bgElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    color: colors.fg,
    paddingHorizontal: 10,
    paddingVertical: 14,
    fontSize: 16,
    minHeight: 44,
  },
  err: { color: colors.danger, fontSize: 13 },
  status: { color: colors.fgMuted, fontSize: 13 },
  devCode: {
    color: colors.accent,
    fontSize: 13,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
  linkText: { color: colors.accent2, textAlign: "center", paddingTop: 8, minHeight: 44 },
});
