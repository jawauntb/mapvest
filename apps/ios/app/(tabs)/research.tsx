import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  agentChat,
  getAgentThread,
  listAgentThreads,
  type AgentThread,
  type ResearchArticle,
} from "@/api/client";
import { useSession } from "@/auth/session";

/**
 * ChatGPT-like research surface — thread list + article briefs.
 * Tools (Derivation) run server-side; no Factory/Jobs UI.
 */
export default function ResearchChatScreen() {
  const { session } = useSession();
  const router = useRouter();
  const [mode, setMode] = useState<"list" | "chat">("list");
  const [threadId, setThreadId] = useState<string | undefined>();
  const [turns, setTurns] = useState<ResearchArticle[]>([]);
  const [title, setTitle] = useState("New research");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const threadsQ = useQuery({
    queryKey: ["agent-threads", session?.token],
    queryFn: () => listAgentThreads({ token: session?.token }),
    enabled: !!session?.token && mode === "list",
    staleTime: 15_000,
  });

  const openThread = useCallback(
    async (t: AgentThread) => {
      setErr(null);
      setMode("chat");
      setThreadId(t.id);
      setTitle(t.title || "Research");
      try {
        const r = await getAgentThread(t.id, { token: session?.token });
        setTurns(r.thread.messages ?? []);
      } catch {
        setTurns([]);
      }
    },
    [session?.token],
  );

  function newChat() {
    setMode("chat");
    setThreadId(undefined);
    setTurns([]);
    setTitle("New research");
    setInput("");
    setErr(null);
  }

  async function onSend() {
    const msg = input.trim();
    if (!msg || busy) return;
    setBusy(true);
    setErr(null);
    const optimistic: ResearchArticle = {
      id: `u-${Date.now()}`,
      role: "user",
      content: msg,
      createdAt: new Date().toISOString(),
      interesting: [],
      ideas: [],
      toolsUsed: [],
      sources: [],
      chartTickers: [],
    };
    setTurns((t) => [...t, optimistic]);
    setInput("");
    try {
      const r = await agentChat(msg, { threadId }, { token: session?.token });
      if (r.threadId) setThreadId(r.threadId);
      setTurns((t) => [...t, r.article]);
      if (title === "New research") setTitle(msg.slice(0, 48));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (mode === "list") {
    const threads = threadsQ.data?.threads ?? [];
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.header}>
          <Text style={styles.h1}>Research</Text>
          <Pressable style={styles.newBtn} onPress={newChat}>
            <Text style={styles.newBtnText}>+ New</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>
          Article-style briefs · Derivation tools behind the scenes · not advice
        </Text>
        {threadsQ.isLoading ? (
          <ActivityIndicator color="#fff" style={{ marginTop: 40 }} />
        ) : threads.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No briefs yet</Text>
            <Text style={styles.hint}>
              Start a chat, or open a ticker → Research…
            </Text>
            <Pressable style={styles.newBtnWide} onPress={newChat}>
              <Text style={styles.newBtnText}>Start research</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={threads}
            keyExtractor={(t) => t.id}
            contentContainerStyle={{ paddingBottom: 40 }}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            renderItem={({ item }) => (
              <Pressable style={styles.row} onPress={() => void openThread(item)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={2}>
                    {item.preview || "—"}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={64}
      >
        <View style={styles.chatBar}>
          <Pressable onPress={() => setMode("list")} style={styles.back}>
            <Text style={styles.backText}>‹ Chats</Text>
          </Pressable>
          <Text style={styles.chatTitle} numberOfLines={1}>
            {title}
          </Text>
          <Pressable onPress={newChat} style={styles.back}>
            <Text style={styles.backText}>New</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.stream} keyboardShouldPersistTaps="handled">
          {turns.length === 0 ? (
            <Text style={styles.hint}>
              Ask about a ticker or theme. You’ll get a lede + evidence, not a chat dump.
            </Text>
          ) : null}
          {turns.map((t) =>
            t.role === "user" ? (
              <Text key={t.id} style={styles.q}>
                {t.content}
              </Text>
            ) : (
              <View key={t.id} style={styles.article}>
                <Text style={styles.lede}>{t.content}</Text>
                {t.interesting.slice(0, 4).map((x, i) => (
                  <Text key={i} style={styles.bullet}>
                    · {x}
                  </Text>
                ))}
                {t.chartTickers.slice(0, 3).map((sym) => (
                  <Pressable
                    key={sym}
                    onPress={() => router.push(`/detail/${sym}`)}
                    style={styles.tickerChip}
                  >
                    <Text style={styles.tickerChipText}>${sym} →</Text>
                  </Pressable>
                ))}
                {t.toolsUsed.length ? (
                  <Text style={styles.tools}>
                    Tools · {t.toolsUsed.slice(0, 5).join(" · ")}
                  </Text>
                ) : null}
              </View>
            ),
          )}
          {busy ? <ActivityIndicator color="#fff" style={{ marginTop: 12 }} /> : null}
          {err ? <Text style={styles.err}>{err}</Text> : null}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask Mapvest…"
            placeholderTextColor="#666"
            editable={!busy}
            multiline
            onSubmitEditing={() => void onSend()}
          />
          <Pressable
            style={[styles.send, (!input.trim() || busy) && { opacity: 0.35 }]}
            disabled={!input.trim() || busy}
            onPress={() => void onSend()}
          >
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  h1: { color: "#fff", fontSize: 28, fontWeight: "700" },
  hint: { color: "#888", fontSize: 13, paddingHorizontal: 20, marginBottom: 12, lineHeight: 18 },
  newBtn: {
    backgroundColor: "#1a5cff",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  newBtnWide: {
    backgroundColor: "#1a5cff",
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 16,
    alignSelf: "center",
  },
  newBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "600", marginBottom: 8 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: "#222", marginLeft: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  rowTitle: { color: "#fff", fontSize: 16, fontWeight: "600" },
  rowSub: { color: "#888", fontSize: 13, marginTop: 4, lineHeight: 18 },
  chevron: { color: "#555", fontSize: 22 },
  chatBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomColor: "#1f1f1f",
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  back: { padding: 6, minWidth: 64 },
  backText: { color: "#5B8CFF", fontWeight: "600", fontSize: 15 },
  chatTitle: { flex: 1, color: "#fff", fontWeight: "600", textAlign: "center", fontSize: 15 },
  stream: { padding: 16, gap: 16, paddingBottom: 40 },
  q: {
    color: "#aaa",
    borderLeftColor: "#333",
    borderLeftWidth: 2,
    paddingLeft: 10,
    fontSize: 15,
  },
  article: { gap: 8 },
  lede: { color: "#fff", fontSize: 17, fontWeight: "600", lineHeight: 24 },
  bullet: { color: "#aaa", fontSize: 13, lineHeight: 18 },
  tickerChip: {
    alignSelf: "flex-start",
    backgroundColor: "#141414",
    borderColor: "#2a2a2a",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tickerChipText: { color: "#3ee68a", fontWeight: "700", fontSize: 13 },
  tools: { color: "#555", fontSize: 11 },
  err: { color: "#ff6b6b", marginTop: 8 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
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
    borderRadius: 22,
    color: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 120,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1a5cff",
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: { color: "#fff", fontSize: 18, fontWeight: "700" },
});
