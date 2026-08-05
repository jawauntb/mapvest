import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { requestMagicLink, verifyMagicLink } from "@/api/client";
import { useSession } from "@/auth/session";

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
      const { session, user } = await verifyMagicLink(
        email.trim().toLowerCase(),
        code.trim(),
      );
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
        <View style={styles.container}>
          <Text style={styles.title}>Mapvest</Text>
          <Text style={styles.subtitle}>
            {stage === "email"
              ? "Enter your email — we'll send you a one-time code."
              : `We sent a code to ${email}. Enter it below.`}
          </Text>

          {stage === "email" ? (
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor="#666"
              style={styles.input}
              onSubmitEditing={sendLink}
            />
          ) : (
            <TextInput
              value={code}
              onChangeText={setCode}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="number-pad"
              placeholder="6-digit code"
              placeholderTextColor="#666"
              style={styles.input}
              onSubmitEditing={submitCode}
            />
          )}

          {devCode && stage === "code" ? (
            <Pressable onPress={() => setCode(devCode)}>
              <Text style={styles.devCode}>
                Demo code (tap to fill): {devCode}
              </Text>
            </Pressable>
          ) : null}

          {err ? <Text style={styles.err}>{err}</Text> : null}

          <Pressable
            style={[styles.button, busy && { opacity: 0.6 }]}
            onPress={stage === "email" ? sendLink : submitCode}
            disabled={busy || (stage === "email" ? !email : !code)}
          >
            {busy ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.buttonText}>
                {stage === "email" ? "Send code" : "Verify"}
              </Text>
            )}
          </Pressable>

          {stage === "code" ? (
            <Pressable onPress={() => setStage("email")}>
              <Text style={styles.linkText}>Use a different email</Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  container: { flex: 1, paddingHorizontal: 24, justifyContent: "center", gap: 16 },
  title: { color: "#fff", fontSize: 40, fontWeight: "700" },
  subtitle: { color: "#aaa", fontSize: 15, lineHeight: 20 },
  input: {
    backgroundColor: "#111",
    color: "#fff",
    padding: 14,
    borderRadius: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#222",
  },
  err: { color: "#ff5a5a", fontSize: 13 },
  devCode: {
    color: "#3ee68a",
    fontSize: 13,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
  button: {
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonText: { color: "#000", fontWeight: "600", fontSize: 16 },
  linkText: { color: "#7aa2ff", textAlign: "center", paddingTop: 8 },
});
