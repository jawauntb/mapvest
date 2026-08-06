import { type ResearchArticle, agentChat } from "@/api/client";
import { useSession } from "@/auth/session";
import { RichText } from "@/components/RichText";
import { colors, radii } from "@/theme/tokens";
import { hapticSelect, hapticTap } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

/** Ticker-bound research brief — not a top-level Chat tab. */
export function ResearchSheet({
  ticker,
  visible,
  onClose,
}: {
  ticker: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { session } = useSession();
  const [threadId, setThreadId] = useState<string | undefined>();
  const [turns, setTurns] = useState<ResearchArticle[]>([]);
  const [input, setInput] = useState(`What’s the story on $${ticker}?`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function onSend() {
    const msg = input.trim();
    if (!msg || busy) return;
    hapticTap();
    setBusy(true);
    setErr(null);
    setStatus("Researching… tools running");
    setTurns((t) => [
      ...t,
      {
        id: `u-${Date.now()}`,
        role: "user",
        content: msg,
        createdAt: new Date().toISOString(),
        interesting: [],
        ideas: [],
        toolsUsed: [],
        sources: [],
        chartTickers: [ticker],
      },
    ]);
    setInput("");
    try {
      const r = await agentChat(msg, { ticker, threadId }, { token: session?.token });
      if (r.threadId) setThreadId(r.threadId);
      setTurns((t) => [...t, r.article]);
      const tools = r.article.toolsUsed?.length
        ? ` · ${r.article.toolsUsed.slice(0, 3).join(", ")}`
        : "";
      setStatus(`Brief ready${tools}`);
    } catch (e) {
      setErr((e as Error).message);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <View style={styles.bar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>Research · ${ticker}</Text>
            <Text style={styles.sub}>Brief-style · tools behind the scenes · not advice</Text>
          </View>
          <Pressable
            onPress={() => {
              hapticSelect();
              onClose();
            }}
            style={styles.close}
            accessibilityRole="button"
            accessibilityLabel="Close research"
          >
            <Ionicons name="close" size={18} color={colors.fg} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.stream}>
          {turns.length === 0 ? (
            <Text style={styles.sub}>Ask something focused. You’ll get a lede + evidence.</Text>
          ) : null}
          {turns.map((t) =>
            t.role === "user" ? (
              <Text key={t.id} style={styles.q}>
                {t.content}
              </Text>
            ) : (
              <View key={t.id} style={styles.article}>
                <RichText text={t.content} />
                {t.interesting.slice(0, 4).map((x, i) => (
                  <Text key={i} style={styles.bullet}>
                    · {x}
                  </Text>
                ))}
                {t.ideas.slice(0, 2).map((idea, i) => (
                  <View key={i} style={styles.idea}>
                    <Text style={styles.ideaTitle}>{idea.title}</Text>
                    {idea.thesis ? <Text style={styles.sub}>{idea.thesis}</Text> : null}
                  </View>
                ))}
                {t.toolsUsed.length ? (
                  <Text style={styles.tools}>Tools · {t.toolsUsed.slice(0, 5).join(" · ")}</Text>
                ) : null}
              </View>
            ),
          )}
          {busy ? (
            <View style={styles.statusRow}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.statusText}>{status ?? "Researching…"}</Text>
            </View>
          ) : status ? (
            <Text style={styles.statusText}>{status}</Text>
          ) : null}
          {err ? <Text style={styles.err}>{err}</Text> : null}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={`Ask about $${ticker}…`}
            placeholderTextColor={colors.fgDim}
            editable={!busy}
            onSubmitEditing={() => void onSend()}
            accessibilityLabel={`Ask about $${ticker}`}
          />
          <Pressable
            style={[styles.send, (!input.trim() || busy) && { opacity: 0.4 }]}
            disabled={!input.trim() || busy}
            onPress={() => void onSend()}
            accessibilityRole="button"
            accessibilityLabel="Ask"
          >
            {busy ? (
              <ActivityIndicator color={colors.accentInk} size="small" />
            ) : (
              <Ionicons name="arrow-up" size={18} color={colors.accentInk} />
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: 12 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  kicker: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  sub: { color: colors.fgMuted, fontSize: 12, marginTop: 2, lineHeight: 16 },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgElevated,
  },
  stream: { padding: 16, gap: 16, paddingBottom: 40 },
  q: {
    color: colors.fgMuted,
    borderLeftColor: colors.border,
    borderLeftWidth: 2,
    paddingLeft: 10,
    fontSize: 14,
  },
  article: { gap: 8 },
  bullet: { color: colors.fgMuted, fontSize: 13, lineHeight: 18 },
  idea: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 10,
    gap: 4,
  },
  ideaTitle: { color: colors.fg, fontWeight: "600", fontSize: 14 },
  tools: { color: colors.fgDim, fontSize: 11, marginTop: 4 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  statusText: { color: colors.accent, fontSize: 13, fontWeight: "600", marginTop: 8 },
  err: { color: colors.danger, marginTop: 8 },
  composer: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    color: colors.fg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
  },
  send: {
    width: 44,
    height: 44,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
});
