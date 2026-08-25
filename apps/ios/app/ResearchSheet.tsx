import {
  ApiError,
  type ResearchArticle,
  agentChat,
  agentChatStream,
  createResearchClientMessageId,
  getAgentThread,
  waitForAgentThread,
} from "@/api/client";
import { useSession } from "@/auth/session";
import { presentPaywallIfQuota, usePaywall } from "@/billing/Paywall";
import { RichText } from "@/components/RichText";
import { ShareButton } from "@/components/ShareButton";
import { colors, radii } from "@/theme/tokens";
import { hapticSelect, hapticTap } from "@/util/haptics";
import {
  clearResearchConversationId,
  loadResearchConversationId,
  saveResearchConversationId,
} from "@/util/researchConversation";
import { shareBriefText, shareResearchMemo } from "@/util/share";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  LayoutAnimation,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Keyboard overlap for composers inside a pageSheet Modal. iOS's
 * KeyboardAvoidingView is unreliable there: it diffs its own sheet-local
 * frame against the keyboard's *screen* frame, under-padding by the sheet's
 * top gap — which left the send button hidden behind the keyboard. A
 * pageSheet's bottom edge is flush with the screen, so the keyboard's
 * on-screen height is exactly the inset the composer needs.
 */
function useSheetKeyboardOverlap(): number {
  const [overlap, setOverlap] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const animate = (duration?: number | null) =>
      LayoutAnimation.configureNext({
        duration: Math.max(duration ?? 250, 10),
        update: { type: LayoutAnimation.Types.keyboard },
      });
    const change = Keyboard.addListener("keyboardWillChangeFrame", (e) => {
      animate(e.duration);
      setOverlap(Math.max(0, Dimensions.get("screen").height - e.endCoordinates.screenY));
    });
    const hide = Keyboard.addListener("keyboardWillHide", (e) => {
      animate(e.duration);
      setOverlap(0);
    });
    return () => {
      change.remove();
      hide.remove();
    };
  }, []);
  return overlap;
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
  const { session, user } = useSession();
  const { presentPaywall } = usePaywall();
  const insets = useSafeAreaInsets();
  const keyboardOverlap = useSheetKeyboardOverlap();
  const [threadId, setThreadId] = useState<string | undefined>();
  const [turns, setTurns] = useState<ResearchArticle[]>([]);
  const [input, setInput] = useState(`What’s the story on $${ticker}?`);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreBlocked, setRestoreBlocked] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [memoUrl, setMemoUrl] = useState<string | undefined>();
  const [elapsedMs, setElapsedMs] = useState(0);
  // Timeline of real progress items streamed from the SSE endpoint —
  // "Running: foo" for `event: tool`, plus reasoning strings.
  const [timeline, setTimeline] = useState<string[]>([]);
  const [timelineOpen, setTimelineOpen] = useState(false);
  // Live draft of the brief as tokens arrive. Reset per-turn; cleared when the
  // finalized article lands.
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<ScrollView | null>(null);
  const retryAttemptRef = useRef<
    | {
        ticker: string;
        message: string;
        clientMessageId: string;
        acceptedConversationId?: string;
      }
    | undefined
  >(undefined);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setRestoring(true);
    setRestoreBlocked(false);
    setErr(null);
    setStatus("Loading saved research…");
    setThreadId(undefined);
    setTurns([]);
    setMemoUrl(undefined);
    void (async () => {
      const scope = `ticker:${ticker}`;
      const storedId = await loadResearchConversationId(scope, user?.id);
      if (cancelled) return;
      if (!storedId) {
        setStatus(null);
        setRestoring(false);
        return;
      }
      setThreadId(storedId);
      try {
        const result = await getAgentThread(storedId, { token: session?.token });
        if (cancelled) return;
        const canonicalId = result.thread.conversationId ?? result.thread.id;
        setThreadId(canonicalId);
        void saveResearchConversationId(scope, canonicalId, user?.id);
        setTurns(result.thread.messages ?? []);
        setMemoUrl(result.thread.memoUrl);
        setStatus(
          result.thread.status === "queued" || result.thread.status === "running"
            ? "Saved research is still running"
            : "Saved research loaded",
        );
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          void clearResearchConversationId(scope, user?.id);
          setThreadId(undefined);
          setMemoUrl(undefined);
          setStatus(null);
          setErr("This saved research is no longer available. You can start a new one.");
        } else {
          setRestoreBlocked(true);
          setStatus(null);
          setErr(
            "Couldn’t load the saved research. Reopen this sheet before continuing; the conversation was preserved.",
          );
        }
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.token, ticker, user?.id, visible]);

  // Elapsed ticker only — the stage cycler is gone now that we stream real
  // events; the timeline is fed by `agentChatStream`'s onEvent callback.
  useEffect(() => {
    if (!busy) return;
    setElapsedMs(0);
    const start = Date.now();
    const tick = setInterval(() => setElapsedMs(Date.now() - start), 250);
    return () => clearInterval(tick);
  }, [busy]);

  async function onSend() {
    const msg = input.trim();
    if (!msg || busy || restoring || restoreBlocked) return;
    const previousAttempt = retryAttemptRef.current;
    const attempt =
      previousAttempt?.ticker === ticker && previousAttempt.message === msg
        ? previousAttempt
        : {
            ticker,
            message: msg,
            clientMessageId: createResearchClientMessageId(),
          };
    retryAttemptRef.current = attempt;
    hapticTap();
    setBusy(true);
    setErr(null);
    setStatus("Researching… tools running");
    setTimeline([]);
    setDraft("");
    const optimistic: ResearchArticle = {
      id: `user-${attempt.clientMessageId}`,
      role: "user",
      content: msg,
      createdAt: new Date().toISOString(),
      interesting: [],
      ideas: [],
      toolsUsed: [],
      sources: [],
      chartTickers: [ticker],
    };
    setTurns((turns) =>
      turns.some((turn) => turn.id === optimistic.id) ? turns : [...turns, optimistic],
    );
    setInput("");

    const scope = `ticker:${ticker}`;
    const baseConversationId = threadId ?? (await loadResearchConversationId(scope, user?.id));
    if (baseConversationId) setThreadId(baseConversationId);
    let acceptedConversationId = attempt.acceptedConversationId;
    let streamAccepted = false;
    let gotArticle = false;
    const saveAcceptedConversation = (conversationId: string) => {
      acceptedConversationId = conversationId;
      attempt.acceptedConversationId = conversationId;
      setThreadId(conversationId);
      void saveResearchConversationId(scope, conversationId, user?.id);
    };
    const showArticle = (article: ResearchArticle) => {
      gotArticle = true;
      setTurns((turns) =>
        turns.some((turn) => turn.id === article.id) ? turns : [...turns, article],
      );
      setDraft("");
      if (article.error) {
        setErr(article.error);
        setStatus(null);
        return;
      }
      const tools = article.toolsUsed?.length
        ? ` · ${article.toolsUsed.slice(0, 3).join(", ")}`
        : "";
      setStatus(`Brief ready${tools}`);
    };
    const recoverAcceptedConversation = async (conversationId: string) => {
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
      saveAcceptedConversation(canonicalId);
      setMemoUrl(recovered.thread.memoUrl);
      const recoveredTurns = recovered.thread.messages ?? [];
      setTurns(recoveredTurns);
      setDraft("");
      const article = [...recoveredTurns].reverse().find((turn) => turn.role === "assistant");
      if (!article) throw new Error("Research finished without a displayable brief.");
      gotArticle = true;
      if (article.error) {
        setErr("Research stopped before it could finish the brief.");
        setStatus(null);
      } else {
        const tools = article.toolsUsed?.length
          ? ` · ${article.toolsUsed.slice(0, 3).join(", ")}`
          : "";
        setStatus(`Brief ready${tools}`);
      }
    };

    try {
      if (acceptedConversationId) {
        await recoverAcceptedConversation(acceptedConversationId);
      } else {
        try {
          const r = await agentChatStream(
            msg,
            {
              ticker,
              conversationId: baseConversationId,
              clientMessageId: attempt.clientMessageId,
            },
            (ev) => {
              if (ev.type === "tool") {
                const d = ev.data as { name: string };
                setTimeline((timeline) => [...timeline, `Running: ${d.name}`]);
              } else if (ev.type === "reasoning") {
                const d = ev.data as { text: string; conversationId?: string };
                if (d.conversationId) {
                  streamAccepted = true;
                  saveAcceptedConversation(d.conversationId);
                }
                if (d?.text) setTimeline((timeline) => [...timeline, d.text]);
              } else if (ev.type === "token") {
                const d = ev.data as { text: string };
                if (typeof d?.text === "string") setDraft((draft) => draft + d.text);
              } else if (ev.type === "article") {
                showArticle(ev.data as ResearchArticle);
              } else if (ev.type === "done") {
                const d = ev.data as { conversationId?: string; threadId?: string };
                const canonicalId = d.conversationId ?? d.threadId;
                if (canonicalId) {
                  streamAccepted = true;
                  saveAcceptedConversation(canonicalId);
                }
              }
            },
            { token: session?.token },
          );
          saveAcceptedConversation(r.conversationId ?? r.threadId);
          if (!gotArticle) showArticle(r.article);
        } catch (streamError) {
          if (!gotArticle) {
            if (streamError instanceof ApiError && streamError.isQuotaExceeded) throw streamError;
            if (streamAccepted && acceptedConversationId) {
              await recoverAcceptedConversation(acceptedConversationId);
            } else {
              const r = await agentChat(
                msg,
                {
                  ticker,
                  conversationId: baseConversationId,
                  clientMessageId: attempt.clientMessageId,
                },
                { token: session?.token },
              );
              const canonicalId = r.conversationId ?? r.threadId;
              saveAcceptedConversation(canonicalId);
              setMemoUrl(r.memoUrl);
              if (r.pending || r.status === "queued" || r.status === "running") {
                await recoverAcceptedConversation(canonicalId);
              } else {
                showArticle(r.article);
              }
            }
          }
        }
      }
      if (gotArticle && acceptedConversationId) {
        void getAgentThread(acceptedConversationId, { token: session?.token })
          .then((result) => setMemoUrl(result.thread.memoUrl))
          .catch(() => {
            /* The finished brief remains usable when the optional PDF lookup fails. */
          });
      }
      retryAttemptRef.current = undefined;
    } catch (error) {
      setInput(msg);
      if (presentPaywallIfQuota(error, presentPaywall)) {
        setErr("Free generations used. Subscribe to keep researching.");
        setStatus(null);
      } else if (error instanceof ApiError && error.status === 404) {
        void clearResearchConversationId(scope, user?.id);
        setThreadId(undefined);
        setMemoUrl(undefined);
        retryAttemptRef.current = undefined;
        setErr("This saved research is no longer available. Send again to start a new one.");
        setStatus(null);
      } else {
        setErr((error as Error).message);
        setStatus(null);
      }
    } finally {
      setBusy(false);
    }
  }

  const latestAssistantId = [...turns].reverse().find((turn) => turn.role === "assistant")?.id;

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
          {(() => {
            const latestArticle = [...turns].reverse().find((t) => t.role !== "user");
            return latestArticle ? (
              <ShareButton
                onPress={() => {
                  const [firstLine, ...rest] = latestArticle.content.split("\n");
                  void shareBriefText({
                    ticker,
                    headline: firstLine ?? `$${ticker} research`,
                    body: rest.join("\n").trim() || latestArticle.content,
                  });
                }}
                accessibilityLabel="Share latest brief"
              />
            ) : null;
          })()}
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

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.stream}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
        >
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
                {t.ideas.slice(0, 2).map((idea, i) => (
                  <View key={`${i}-${idea.title}`} style={styles.idea}>
                    <Text style={styles.ideaTitle}>
                      {idea.title}
                      {idea.disposition ? ` · ${idea.disposition}` : ""}
                    </Text>
                    {idea.thesis ? <Text style={styles.sub}>{idea.thesis}</Text> : null}
                    {idea.findings?.slice(0, 2).map((finding) => (
                      <Text key={finding} style={styles.meta}>
                        · {finding}
                      </Text>
                    ))}
                  </View>
                ))}
                {t.specialists?.slice(0, 3).map((specialist, i) => (
                  <View key={`${i}-${specialist.role}`} style={styles.evidenceRow}>
                    <Text style={styles.ideaTitle}>
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
                    <Text style={styles.ideaTitle}>{t.memo.title || "Research memo"}</Text>
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
            <View style={{ gap: 12 }}>
              {draft ? (
                <View style={styles.draftCard}>
                  <RichText text={draft} />
                  <Text style={styles.draftCaret}>▍</Text>
                </View>
              ) : null}
              <View style={styles.progressCard}>
                <View style={styles.progressHeader}>
                  <ActivityIndicator color={colors.accent} />
                  <Text style={styles.progressTitle}>
                    {timeline[timeline.length - 1] ?? "Researching…"}
                  </Text>
                  <Text style={styles.progressElapsed}>{(elapsedMs / 1000).toFixed(1)}s</Text>
                </View>
                {timeline.length > 1 ? (
                  <Pressable
                    onPress={() => setTimelineOpen((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      timelineOpen ? "Hide reasoning steps" : "Show reasoning steps"
                    }
                  >
                    <Text style={styles.progressToggle}>
                      {timelineOpen ? "Hide steps" : `${timeline.length} steps · show`}
                    </Text>
                  </Pressable>
                ) : null}
                {timelineOpen ? (
                  <View style={{ gap: 4, marginTop: 2 }}>
                    {timeline.map((line, i) => (
                      <Text key={`${i}-${line}`} style={styles.timelineLine}>
                        {i + 1 === timeline.length ? "▸" : "✓"} {line}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            </View>
          ) : status ? (
            <Pressable
              onPress={() => setTimelineOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={timelineOpen ? "Hide steps" : "Show steps"}
            >
              <Text style={styles.statusText}>
                {status}
                {timeline.length ? ` · ${timeline.length} steps` : ""}
              </Text>
              {timelineOpen && timeline.length ? (
                <View style={{ gap: 4, marginTop: 6 }}>
                  {timeline.map((line, i) => (
                    <Text key={`${i}-${line}`} style={styles.timelineLine}>
                      ✓ {line}
                    </Text>
                  ))}
                </View>
              ) : null}
            </Pressable>
          ) : null}
          {err ? <Text style={styles.err}>{err}</Text> : null}
        </ScrollView>

        <View
          style={[
            styles.composer,
            {
              paddingBottom: keyboardOverlap > 0 ? 12 : Math.max(insets.bottom, 12),
              marginBottom: keyboardOverlap,
            },
          ]}
        >
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={`Ask about $${ticker}…`}
            placeholderTextColor={colors.fgDim}
            editable={!busy && !restoring && !restoreBlocked}
            returnKeyType="send"
            onSubmitEditing={() => void onSend()}
            accessibilityLabel={`Ask about $${ticker}`}
          />
          <Pressable
            style={[
              styles.send,
              (!input.trim() || busy || restoring || restoreBlocked) && { opacity: 0.4 },
            ]}
            disabled={!input.trim() || busy || restoring || restoreBlocked}
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
  meta: { color: colors.fgDim, fontSize: 11, lineHeight: 16 },
  evidenceRow: { gap: 2 },
  idea: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 10,
    gap: 4,
  },
  ideaTitle: { color: colors.fg, fontWeight: "600", fontSize: 14 },
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
  tools: { color: colors.fgDim, fontSize: 11, marginTop: 4 },
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
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  statusText: { color: colors.accent, fontSize: 13, fontWeight: "600", marginTop: 8 },
  progressCard: {
    marginTop: 8,
    padding: 12,
    gap: 8,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  draftCard: {
    padding: 12,
    gap: 6,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  draftCaret: {
    color: colors.accent,
    fontSize: 12,
    marginTop: 2,
  },
  progressHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  progressTitle: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  progressElapsed: {
    color: colors.fgDim,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  progressToggle: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "600",
  },
  timelineLine: {
    color: colors.fgMuted,
    fontSize: 12,
    lineHeight: 17,
  },
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
