import {
  type AgentThread,
  ApiError,
  type ResearchArticle,
  agentChat,
  createResearchClientMessageId,
  getAgentThread,
  listAgentThreads,
  waitForAgentThread,
} from "@/api/client";
import { useSession } from "@/auth/session";
import { presentPaywallIfQuota, usePaywall } from "@/billing/Paywall";
import { AppTopBar } from "@/components/AppTopBar";
import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { RichText } from "@/components/RichText";
import { ScalePressable } from "@/components/ScalePressable";
import { ScreenFade } from "@/components/ScreenFade";
import { SkeletonList } from "@/components/Skeleton";
import { decodeChatSeed, seedToDraft } from "@/nav/chatAbout";
import { colors, radii, type } from "@/theme/tokens";
import { hapticSelect, hapticTap } from "@/util/haptics";
import {
  clearResearchConversationId,
  loadResearchConversationId,
  saveResearchConversationId,
} from "@/util/researchConversation";
import { shareResearchMemo } from "@/util/share";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ALL-CAPS words that look like tickers in casual questions but aren't.
const TITLE_STOPWORDS = new Set([
  "A",
  "I",
  "AND",
  "OR",
  "THE",
  "ETF",
  "ETFS",
  "VS",
  "WHY",
  "HOW",
  "NYC",
  "USA",
  "CEO",
  "IPO",
  "GDP",
]);

/** Thread title from the first message: "$NVDA?" or a bare caps token → "$NVDA brief". */
function deriveThreadTitle(msg: string): string {
  const dollar = msg.match(/\$([A-Z]{1,5})\b/)?.[1];
  if (dollar) return `$${dollar} brief`;
  for (const m of msg.matchAll(/\b([A-Z]{2,5})\b/g)) {
    const token = m[1];
    if (token && !TITLE_STOPWORDS.has(token)) return `$${token} brief`;
  }
  return msg.slice(0, 48);
}

function researchProgressLabel(article: ResearchArticle): string | undefined {
  const progress = article.progress;
  const count =
    progress?.completedTasks != null && progress.totalTasks != null
      ? `${progress.completedTasks}/${progress.totalTasks} tasks`
      : progress?.completedIterations != null && progress.maxIterations != null
        ? `${progress.completedIterations}/${progress.maxIterations} passes`
        : progress?.essentialClaimsReady != null && progress.essentialClaimsTotal != null
          ? `${progress.essentialClaimsReady}/${progress.essentialClaimsTotal} claims`
          : progress?.evidenceReady
            ? "evidence ready"
            : undefined;
  return [article.phase ?? article.status, count].filter(Boolean).join(" · ") || undefined;
}

/**
 * ChatGPT-like research surface — thread list + article briefs.
 * Tools (Derivation) run server-side; no Factory/Jobs UI.
 */
export default function ResearchChatScreen() {
  const { session, user } = useSession();
  const { presentPaywall } = usePaywall();
  const router = useRouter();
  const params = useLocalSearchParams<{ intent?: string; id?: string; seed?: string }>();
  const [mode, setMode] = useState<"list" | "chat">("list");
  const [threadId, setThreadId] = useState<string | undefined>();
  const [turns, setTurns] = useState<ResearchArticle[]>([]);
  const [title, setTitle] = useState("New research");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [memoUrl, setMemoUrl] = useState<string | undefined>();
  const inputRef = useRef<TextInput>(null);
  const retryAttemptRef = useRef<
    | {
        message: string;
        clientMessageId: string;
        acceptedConversationId?: string;
      }
    | undefined
  >(undefined);
  // Track which seed we've already consumed so a re-render (or the effect
  // re-running because of the router/params identity churn) doesn't clobber
  // a draft the user has since edited.
  const consumedSeedRef = useRef<string | null>(null);

  const threadsQ = useQuery({
    queryKey: ["agent-threads", session?.token],
    queryFn: () => listAgentThreads({ token: session?.token }),
    enabled: !!session?.token && mode === "list",
    staleTime: 15_000,
  });

  const openThread = useCallback(
    async (t: AgentThread) => {
      retryAttemptRef.current = undefined;
      setErr(null);
      setMode("chat");
      const conversationId = t.conversationId ?? t.id;
      setThreadId(conversationId);
      setTitle(t.title || "Research");
      setTurns(t.messages ?? []);
      setMemoUrl(t.memoUrl);
      try {
        const r = await getAgentThread(conversationId, { token: session?.token });
        const canonicalId = r.thread.conversationId ?? r.thread.id;
        setThreadId(canonicalId);
        void saveResearchConversationId("chat", canonicalId, user?.id);
        setTurns(r.thread.messages ?? []);
        setMemoUrl(r.thread.memoUrl);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          const persistedId = await loadResearchConversationId("chat", user?.id);
          if (persistedId === conversationId) {
            void clearResearchConversationId("chat", user?.id);
          }
          setThreadId(undefined);
          setTurns([]);
          setMemoUrl(undefined);
          setErr("This saved research is no longer available.");
        } else {
          setErr("Couldn’t load this research right now. Its saved conversation was preserved.");
        }
      }
    },
    [session?.token, user?.id],
  );

  const newChat = useCallback(
    (prefill?: string) => {
      hapticTap();
      retryAttemptRef.current = undefined;
      void clearResearchConversationId("chat", user?.id);
      setMode("chat");
      setThreadId(undefined);
      setTurns([]);
      setMemoUrl(undefined);
      setTitle("New research");
      setInput(prefill ?? "");
      setErr(null);
      if (prefill) {
        // Auto-focus so the user lands on the composer with the draft ready
        // to edit + send. Small delay lets the chat view mount first.
        setTimeout(() => inputRef.current?.focus(), 120);
      }
    },
    [user?.id],
  );

  useEffect(() => {
    if (params.intent) return;
    let active = true;
    void loadResearchConversationId("chat", user?.id).then((conversationId) => {
      if (active && conversationId) {
        void openThread({ id: conversationId, title: "Research", preview: "" });
      }
    });
    return () => {
      active = false;
    };
  }, [params.intent, user?.id, openThread]);

  // Sidebar deep-links: ?intent=new | ?intent=thread&id= | ?seed=<b64>
  useEffect(() => {
    // Universal "Chat about this" seed. We consume each unique seed exactly
    // once — if the effect re-fires with the same seed we no-op, so any
    // edits the user made to the draft aren't clobbered.
    if (params.intent === "new" && params.seed) {
      if (consumedSeedRef.current === params.seed) return;
      consumedSeedRef.current = params.seed;
      const parsed = decodeChatSeed(params.seed);
      // Malformed seed → silently fall through to an empty draft. Never
      // crash the screen just because a query string looked weird.
      const draft = parsed ? seedToDraft(parsed) : "";
      newChat(draft);
      return;
    }
    if (params.intent === "new") {
      newChat();
      return;
    }
    if (params.intent === "thread" && params.id) {
      void openThread({ id: params.id, title: "Research", preview: "" });
    }
  }, [params.intent, params.id, params.seed, openThread, newChat]);

  async function onSend() {
    const msg = input.trim();
    if (!msg || busy) return;
    const previousAttempt = retryAttemptRef.current;
    const attempt =
      previousAttempt?.message === msg
        ? previousAttempt
        : {
            message: msg,
            clientMessageId: createResearchClientMessageId(),
          };
    retryAttemptRef.current = attempt;
    setBusy(true);
    setErr(null);
    setStatus("Researching… tools running");
    const optimistic: ResearchArticle = {
      id: `user-${attempt.clientMessageId}`,
      role: "user",
      content: msg,
      createdAt: new Date().toISOString(),
      interesting: [],
      ideas: [],
      toolsUsed: [],
      sources: [],
      chartTickers: [],
    };
    setTurns((t) => (t.some((turn) => turn.id === optimistic.id) ? t : [...t, optimistic]));
    setInput("");
    try {
      let article: ResearchArticle | undefined;
      let conversationId = attempt.acceptedConversationId;
      if (!conversationId) {
        const r = await agentChat(
          msg,
          { conversationId: threadId, clientMessageId: attempt.clientMessageId },
          { token: session?.token },
        );
        conversationId = r.conversationId ?? r.threadId;
        attempt.acceptedConversationId = conversationId;
        setThreadId(conversationId);
        void saveResearchConversationId("chat", conversationId, user?.id);
        setMemoUrl(r.memoUrl);
        if (!r.pending && r.status !== "queued" && r.status !== "running") {
          article = r.article;
        }
      }

      if (!article) {
        const recovered = await waitForAgentThread(
          conversationId,
          { token: session?.token },
          {
            onProgress: (thread) => {
              setStatus(
                thread.status === "queued"
                  ? "Research queued…"
                  : "Researching… gathering more evidence",
              );
            },
          },
        );
        const canonicalId = recovered.thread.conversationId ?? recovered.thread.id;
        attempt.acceptedConversationId = canonicalId;
        setThreadId(canonicalId);
        void saveResearchConversationId("chat", canonicalId, user?.id);
        setMemoUrl(recovered.thread.memoUrl);
        const recoveredTurns = recovered.thread.messages ?? [];
        setTurns(recoveredTurns);
        article = [...recoveredTurns].reverse().find((turn) => turn.role === "assistant");
      } else {
        setTurns((turns) =>
          turns.some((turn) => turn.id === article?.id)
            ? turns
            : [...turns, article as ResearchArticle],
        );
      }

      if (!article) throw new Error("Research finished without a displayable brief.");
      retryAttemptRef.current = undefined;
      if (title === "New research") setTitle(deriveThreadTitle(msg));
      if (article.error) {
        setErr("Research hit a limit — we wrote a shorter brief instead, or try again.");
        setStatus(null);
      } else {
        const tools = article.toolsUsed?.length
          ? ` · ${article.toolsUsed.slice(0, 3).join(", ")}`
          : "";
        setStatus(`Brief ready${tools}`);
      }
    } catch (e) {
      setInput(msg);
      if (presentPaywallIfQuota(e, presentPaywall)) {
        setErr("Free generations used. Subscribe to keep researching.");
        setStatus(null);
        return;
      }
      if (e instanceof ApiError && e.status === 404) {
        void clearResearchConversationId("chat", user?.id);
        setThreadId(undefined);
        setMemoUrl(undefined);
        retryAttemptRef.current = undefined;
        setErr("This saved research is no longer available. Send again to start a new one.");
      } else {
        setErr((e as Error).message);
      }
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  if (mode === "list") {
    const threads = threadsQ.data?.threads ?? [];
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <AppTopBar
          title="Research"
          right={
            <Pressable
              style={styles.newBtn}
              onPress={() => newChat()}
              accessibilityRole="button"
              accessibilityLabel="New research chat"
            >
              <Ionicons name="add" size={16} color={colors.accentInk} />
              <Text style={styles.newBtnText}>New</Text>
            </Pressable>
          }
        />
        <Text style={styles.hint}>Article-style briefs · not advice</Text>
        <ScreenFade>
          {threadsQ.isLoading ? (
            <SkeletonList rows={5} />
          ) : threads.length === 0 ? (
            <EmptyState
              icon="sparkles-outline"
              title="No briefs yet"
              subtitle="Start a chat, or open a ticker → Research…"
            >
              <PrimaryButton
                label="Start research"
                onPress={() => newChat()}
                style={{ marginTop: 4 }}
              />
            </EmptyState>
          ) : (
            <FlatList
              style={{ flex: 1 }}
              data={threads}
              keyExtractor={(t) => t.id}
              contentContainerStyle={{ paddingBottom: 40 }}
              ItemSeparatorComponent={() => <View style={styles.sep} />}
              renderItem={({ item }) => (
                <ScalePressable
                  style={styles.row}
                  onPress={() => void openThread(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open research thread: ${item.title}`}
                >
                  <View style={styles.rowIcon}>
                    <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={2}>
                      {item.preview || "—"}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.fgDim} />
                </ScalePressable>
              )}
            />
          )}
        </ScreenFade>
      </SafeAreaView>
    );
  }

  const latestAssistantId = [...turns].reverse().find((turn) => turn.role === "assistant")?.id;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={64}
      >
        <AppTopBar
          title={title}
          leading={
            <Pressable
              onPress={() => {
                hapticSelect();
                setMode("list");
              }}
              style={styles.back}
              accessibilityRole="button"
              accessibilityLabel="Back to chats"
            >
              <Ionicons name="chevron-back" size={18} color={colors.accent2} />
              <Text style={styles.backText}>Chats</Text>
            </Pressable>
          }
          right={
            <Pressable
              onPress={() => newChat()}
              style={styles.back}
              accessibilityRole="button"
              accessibilityLabel="New chat"
            >
              <Text style={styles.backText}>New</Text>
            </Pressable>
          }
        />

        <ScrollView contentContainerStyle={styles.stream} keyboardShouldPersistTaps="handled">
          {turns.length === 0 ? (
            <Text style={styles.hint}>
              Ask about a company, a block, or a theme. You get a brief with evidence, not a chat
              dump.
            </Text>
          ) : null}
          {turns.map((t) =>
            t.role === "user" ? (
              <Text key={t.id} style={styles.q}>
                {t.content}
              </Text>
            ) : (
              <View key={t.id} style={styles.article}>
                <RichText text={t.content} />
                {researchProgressLabel(t) ? (
                  <Text style={styles.meta}>Progress · {researchProgressLabel(t)}</Text>
                ) : null}
                {t.interesting.slice(0, 4).map((x, i) => (
                  <Text key={`${i}-${x}`} style={styles.bullet}>
                    · {x}
                  </Text>
                ))}
                {t.evidence?.slice(0, 4).map((item, i) => (
                  <View key={`${i}-${item.summary}`} style={styles.evidenceRow}>
                    <Text style={styles.bullet}>Evidence · {item.summary}</Text>
                    {item.source || item.freshness ? (
                      <Text style={styles.meta}>
                        {[item.source, item.freshness].filter(Boolean).join(" · ")}
                      </Text>
                    ) : null}
                  </View>
                ))}
                {t.context?.slice(0, 2).map((item, i) => (
                  <Text key={`${i}-${item.summary}`} style={styles.bullet}>
                    Context · {item.summary}
                    {item.reason ? ` — ${item.reason}` : ""}
                  </Text>
                ))}
                {t.ideas.slice(0, 3).map((idea, i) => (
                  <View key={`${i}-${idea.title}`} style={styles.detailCard}>
                    <Text style={styles.detailTitle}>
                      {idea.title}
                      {idea.disposition ? ` · ${idea.disposition}` : ""}
                    </Text>
                    {idea.thesis ? <Text style={styles.bullet}>{idea.thesis}</Text> : null}
                    {idea.findings?.slice(0, 2).map((finding) => (
                      <Text key={finding} style={styles.meta}>
                        · {finding}
                      </Text>
                    ))}
                  </View>
                ))}
                {t.specialists?.slice(0, 3).map((specialist, i) => (
                  <View key={`${i}-${specialist.role}`} style={styles.evidenceRow}>
                    <Text style={styles.detailTitle}>
                      {specialist.role}
                      {specialist.status ? ` · ${specialist.status}` : ""}
                    </Text>
                    {specialist.analysis ? (
                      <Text style={styles.bullet}>{specialist.analysis}</Text>
                    ) : null}
                  </View>
                ))}
                {t.memo ? (
                  <View style={styles.memoCard}>
                    <Text style={styles.detailTitle}>{t.memo.title || "Research memo"}</Text>
                    {t.memo.executiveSummary ? (
                      <Text style={styles.bullet}>{t.memo.executiveSummary}</Text>
                    ) : null}
                    {t.memo.verdict ? (
                      <Text style={styles.meta}>Verdict · {t.memo.verdict}</Text>
                    ) : null}
                    {t.memo.rationale ? (
                      <Text style={styles.bullet}>{t.memo.rationale}</Text>
                    ) : null}
                    {t.memo.bullCase ? (
                      <Text style={styles.meta}>Bull · {t.memo.bullCase}</Text>
                    ) : null}
                    {t.memo.baseCase ? (
                      <Text style={styles.meta}>Base · {t.memo.baseCase}</Text>
                    ) : null}
                    {t.memo.bearCase ? (
                      <Text style={styles.meta}>Bear · {t.memo.bearCase}</Text>
                    ) : null}
                  </View>
                ) : null}
                {t.blocker ? <Text style={styles.inlineError}>Blocked · {t.blocker}</Text> : null}
                {t.error ? <Text style={styles.inlineError}>{t.error}</Text> : null}
                {t.chartTickers.slice(0, 3).map((sym) => (
                  <Pressable
                    key={sym}
                    onPress={() => router.push(`/detail/${sym}`)}
                    style={styles.tickerChip}
                    accessibilityRole="button"
                    accessibilityLabel={`Open $${sym}`}
                  >
                    <Text style={styles.tickerChipText}>${sym}</Text>
                    <Ionicons name="arrow-forward" size={11} color={colors.accent} />
                  </Pressable>
                ))}
                {t.toolsUsed.length ? (
                  <Text style={styles.tools}>Tools · {t.toolsUsed.slice(0, 5).join(" · ")}</Text>
                ) : null}
                {t.sources?.length ? (
                  <View style={styles.sourceRow}>
                    {t.sources.slice(0, 4).map((s) => {
                      const url = s.url;
                      return url ? (
                        <Pressable
                          key={`${s.label}-${url}`}
                          onPress={() => {
                            hapticTap();
                            void Linking.openURL(url);
                          }}
                          style={styles.sourceChip}
                          accessibilityRole="link"
                          accessibilityLabel={`Open source: ${s.label}`}
                        >
                          <Text style={styles.sourceChipText} numberOfLines={1}>
                            {s.label}
                          </Text>
                          <Ionicons name="open-outline" size={11} color={colors.accent} />
                        </Pressable>
                      ) : (
                        <View key={s.label} style={styles.sourceChip}>
                          <Text style={styles.sourceChipMuted} numberOfLines={1}>
                            {s.label}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
                {memoUrl && t.id === latestAssistantId ? (
                  <Pressable
                    onPress={() => {
                      hapticTap();
                      void shareResearchMemo(memoUrl, session?.token).catch((error) => {
                        setErr(error instanceof Error ? error.message : "Memo download failed.");
                      });
                    }}
                    style={styles.memoLink}
                    accessibilityRole="link"
                    accessibilityLabel="Open full research memo"
                  >
                    <Ionicons name="document-text-outline" size={13} color={colors.accent} />
                    <Text style={styles.memoLinkText}>Open memo PDF</Text>
                  </Pressable>
                ) : null}
              </View>
            ),
          )}
          {busy ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 }}>
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
            ref={inputRef}
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask Mapvest…"
            placeholderTextColor={colors.fgDim}
            editable={!busy}
            multiline
            onSubmitEditing={() => void onSend()}
            accessibilityLabel="Ask Mapvest"
          />
          <Pressable
            style={[styles.send, (!input.trim() || busy) && { opacity: 0.35 }]}
            disabled={!input.trim() || busy}
            onPress={() => void onSend()}
            accessibilityRole="button"
            accessibilityLabel="Send"
          >
            <Ionicons name="arrow-up" size={20} color={colors.accentInk} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  h1: { color: colors.fg, ...type.h1, fontSize: 28 },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
  },
  newBtnText: { color: colors.accentInk, fontWeight: "800", fontSize: 14 },
  hint: {
    color: colors.fgMuted,
    fontSize: 13,
    paddingHorizontal: 20,
    marginBottom: 12,
    lineHeight: 18,
  },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
    backgroundColor: colors.bgElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { color: colors.fg, fontSize: 16, fontWeight: "600" },
  rowSub: { color: colors.fgMuted, fontSize: 13, marginTop: 4, lineHeight: 18 },
  chatBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  back: { flexDirection: "row", alignItems: "center", padding: 6, minWidth: 64, minHeight: 44 },
  backText: { color: colors.accent2, fontWeight: "600", fontSize: 15 },
  chatTitle: { flex: 1, color: colors.fg, fontWeight: "600", textAlign: "center", fontSize: 15 },
  stream: { padding: 16, gap: 16, paddingBottom: 40 },
  q: {
    color: colors.fgMuted,
    borderLeftColor: colors.border,
    borderLeftWidth: 2,
    paddingLeft: 10,
    fontSize: 15,
  },
  article: { gap: 8 },
  bullet: { color: colors.fgMuted, fontSize: 13, lineHeight: 18 },
  meta: { color: colors.fgDim, fontSize: 11, lineHeight: 16 },
  evidenceRow: { gap: 2 },
  detailCard: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 10,
    gap: 4,
  },
  detailTitle: { color: colors.fg, fontWeight: "600", fontSize: 13 },
  memoCard: {
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 10,
    gap: 5,
    backgroundColor: colors.bgElevated,
  },
  inlineError: { color: colors.danger, fontSize: 12, lineHeight: 17 },
  memoLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    minHeight: 32,
    paddingVertical: 5,
  },
  memoLinkText: { color: colors.accent, fontWeight: "600", fontSize: 12 },
  tickerChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 32,
  },
  tickerChipText: { color: colors.accent, fontWeight: "700", fontSize: 13 },
  tools: { color: colors.fgDim, fontSize: 11 },
  sourceRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  sourceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minHeight: 28,
  },
  sourceChipText: { color: colors.accent, fontWeight: "600", fontSize: 12, flexShrink: 1 },
  sourceChipMuted: { color: colors.fgMuted, fontWeight: "600", fontSize: 12, flexShrink: 1 },
  statusText: { color: colors.accent, fontSize: 13, fontWeight: "600", marginTop: 8 },
  err: { color: colors.danger, marginTop: 8 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
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
    borderRadius: 22,
    color: colors.fg,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 120,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
