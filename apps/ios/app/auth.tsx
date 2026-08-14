import { requestMagicLink, verifyMagicLink } from "@/api/client";
import { useSession } from "@/auth/session";
import { BrandMark } from "@/components/BrandMark";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenFade } from "@/components/ScreenFade";
import { colors, radii } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
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
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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
    setErr(null);
    setBusy(true);
    try {
      const { session, user } = await verifyMagicLink(email.trim().toLowerCase(), code.trim());
      await signIn(session, user);
      router.replace("/(tabs)/map");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invalid code. Try again.");
    } finally {
      setBusy(false);
    }
  }

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
                ? "Enter your email — we'll send you a one-time code."
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
                  onSubmitEditing={submitCode}
                  accessibilityLabel="6-digit code"
                />
              )}
            </View>

            {devCode && stage === "code" ? (
              <Pressable
                onPress={() => setCode(devCode)}
                accessibilityRole="button"
                accessibilityLabel="Fill demo code"
              >
                <Text style={styles.devCode}>Demo code (tap to fill): {devCode}</Text>
              </Pressable>
            ) : null}

            {err ? <Text style={styles.err}>{err}</Text> : null}

            <PrimaryButton
              label={stage === "email" ? "Send code" : "Verify"}
              onPress={stage === "email" ? sendLink : submitCode}
              busy={busy}
              disabled={stage === "email" ? !email : !code}
              style={{ marginTop: 4 }}
            />

            {stage === "code" ? (
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
  devCode: {
    color: colors.accent,
    fontSize: 13,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
  linkText: { color: colors.accent2, textAlign: "center", paddingTop: 8, minHeight: 44 },
});
