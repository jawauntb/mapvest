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
import { agentChat, type ResearchArticle } from "@/api/client";
import { useSession } from "@/auth/session";
import { RichText } from "@/components/RichText";

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
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.bar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>Research · ${ticker}</Text>
            <Text style={styles.sub}>Brief-style · tools behind the scenes · not advice</Text>
          </View>
          <Pressable onPress={onClose} style={styles.close}>
            <Text style={styles.closeText}>Close</Text>
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
              <ActivityIndicator color="#3ee68a" />
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
            placeholderTextColor="#666"
            editable={!busy}
            onSubmitEditing={() => void onSend()}
          />
          <Pressable
            style={[styles.send, (!input.trim() || busy) && { opacity: 0.4 }]}
            disabled={!input.trim() || busy}
            onPress={() => void onSend()}
          >
            <Text style={styles.sendText}>{busy ? "…" : "Ask"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a", paddingTop: 12 },
  bar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomColor: "#1f1f1f",
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  kicker: {
    color: "#3ee68a",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  sub: { color: "#888", fontSize: 12, marginTop: 2, lineHeight: 16 },
  close: { paddingVertical: 6, paddingHorizontal: 10 },
  closeText: { color: "#fff", fontWeight: "600" },
  stream: { padding: 16, gap: 16, paddingBottom: 40 },
  q: {
    color: "#aaa",
    borderLeftColor: "#333",
    borderLeftWidth: 2,
    paddingLeft: 10,
    fontSize: 14,
  },
  article: { gap: 8 },
  lede: { color: "#fff", fontSize: 17, fontWeight: "600", lineHeight: 24 },
  bullet: { color: "#aaa", fontSize: 13, lineHeight: 18 },
  idea: {
    borderColor: "#222",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  ideaTitle: { color: "#fff", fontWeight: "600", fontSize: 14 },
  tools: { color: "#555", fontSize: 11, marginTop: 4 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  statusText: { color: "#3ee68a", fontSize: 13, fontWeight: "600", marginTop: 8 },
  err: { color: "#ff6b6b", marginTop: 8 },
  composer: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderTopColor: "#1f1f1f",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    backgroundColor: "#141414",
    borderColor: "#2a2a2a",
    borderWidth: 1,
    borderRadius: 10,
    color: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  send: {
    backgroundColor: "#3ee68a",
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  sendText: { color: "#000", fontWeight: "700" },
});
