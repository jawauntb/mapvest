import {
  type ResearchArticle,
  agentChat,
  agentChatStream,
  createResearchClientMessageId,
} from "@/api/client";
import { useSession } from "@/auth/session";
import { presentPaywallIfQuota, usePaywall } from "@/billing/Paywall";
import { RichText } from "@/components/RichText";
import { ShareButton } from "@/components/ShareButton";
import { colors, radii } from "@/theme/tokens";
import { hapticSelect, hapticTap } from "@/util/haptics";
import {
  loadResearchConversationId,
  saveResearchConversationId,
} from "@/util/researchConversation";
import { shareBriefText } from "@/util/share";
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
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  // Timeline of real progress items streamed from the SSE endpoint —
  // "Running: foo" for `event: tool`, plus reasoning strings.
  const [timeline, setTimeline] = useState<string[]>([]);
  const [timelineOpen, setTimelineOpen] = useState(false);
  // Live draft of the brief as tokens arrive. Reset per-turn; cleared when the
  // finalized article lands.
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    let cancelled = false;
    setThreadId(undefined);
    void loadResearchConversationId(`ticker:${ticker}`, user?.id).then((storedId) => {
      if (!cancelled && storedId) setThreadId(storedId);
    });
    return () => {
      cancelled = true;
    };
  }, [ticker, user?.id]);

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
    if (!msg || busy) return;
    hapticTap();
    setBusy(true);
    setErr(null);
    setStatus("Researching… tools running");
    setTimeline([]);
    setDraft("");
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

    const clientMessageId = createResearchClientMessageId();
    const conversationId =
      threadId ?? (await loadResearchConversationId(`ticker:${ticker}`, user?.id));
    if (conversationId) setThreadId(conversationId);
    let acceptedConversationId = conversationId;

    let gotArticle = false;
    try {
      const r = await agentChatStream(
        msg,
        { ticker, conversationId, clientMessageId },
        (ev) => {
          if (ev.type === "tool") {
            const d = ev.data as { name: string };
            setTimeline((t) => [...t, `Running: ${d.name}`]);
          } else if (ev.type === "reasoning") {
            const d = ev.data as { text: string; conversationId?: string };
            if (d.conversationId) {
              acceptedConversationId = d.conversationId;
              setThreadId(d.conversationId);
              void saveResearchConversationId(`ticker:${ticker}`, d.conversationId, user?.id);
            }
            if (d?.text) setTimeline((t) => [...t, d.text]);
          } else if (ev.type === "token") {
            const d = ev.data as { text: string };
            if (typeof d?.text === "string") setDraft((s) => s + d.text);
          } else if (ev.type === "article") {
            const art = ev.data as ResearchArticle;
            gotArticle = true;
            setTurns((t) => [...t, art]);
            setDraft("");
            const tools = art.toolsUsed?.length ? ` · ${art.toolsUsed.slice(0, 3).join(", ")}` : "";
            setStatus(`Brief ready${tools}`);
          } else if (ev.type === "done") {
            const d = ev.data as { conversationId?: string; threadId?: string };
            const canonicalId = d.conversationId ?? d.threadId;
            if (canonicalId) {
              acceptedConversationId = canonicalId;
              setThreadId(canonicalId);
              void saveResearchConversationId(`ticker:${ticker}`, canonicalId, user?.id);
            }
          }
        },
        { token: session?.token },
      );
      const canonicalId = r.conversationId ?? r.threadId;
      setThreadId(canonicalId);
      void saveResearchConversationId(`ticker:${ticker}`, canonicalId, user?.id);
      if (r.article && !gotArticle) {
        gotArticle = true;
        setTurns((t) => [...t, r.article]);
        setDraft("");
        const tools = r.article.toolsUsed?.length
          ? ` · ${r.article.toolsUsed.slice(0, 3).join(", ")}`
          : "";
        setStatus(`Brief ready${tools}`);
      }
    } catch (e) {
      if (presentPaywallIfQuota(e, presentPaywall)) {
        setErr("Free generations used. Subscribe to keep researching.");
        setStatus(null);
        return;
      }
      // Stream often yields a keepalive/reasoning frame then dies (proxy idle
      // close) before `article`. Always fall back to blocking /chat unless we
      // already have the brief — otherwise the user only sees
      // "stream ended without an article".
      if (!gotArticle) {
        try {
          const r = await agentChat(
            msg,
            { ticker, conversationId: acceptedConversationId, clientMessageId },
            { token: session?.token },
          );
          const canonicalId = r.conversationId ?? r.threadId;
          setThreadId(canonicalId);
          void saveResearchConversationId(`ticker:${ticker}`, canonicalId, user?.id);
          setTurns((t) => [...t, r.article]);
          setDraft("");
          const tools = r.article.toolsUsed?.length
            ? ` · ${r.article.toolsUsed.slice(0, 3).join(", ")}`
            : "";
          setStatus(`Brief ready${tools}`);
        } catch (e2) {
          if (presentPaywallIfQuota(e2, presentPaywall)) {
            setErr("Free generations used. Subscribe to keep researching.");
            setStatus(null);
            return;
          }
          setErr((e2 as Error).message || (e as Error).message);
          setStatus(null);
        }
      } else {
        setErr((e as Error).message);
        setStatus(null);
      }
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
                {t.interesting.slice(0, 4).map((x, i) => (
                  <Text key={`${i}-${x}`} style={styles.bullet}>
                    · {x}
                  </Text>
                ))}
                {t.ideas.slice(0, 2).map((idea, i) => (
                  <View key={`${i}-${idea.title}`} style={styles.idea}>
                    <Text style={styles.ideaTitle}>{idea.title}</Text>
                    {idea.thesis ? <Text style={styles.sub}>{idea.thesis}</Text> : null}
                  </View>
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
            editable={!busy}
            returnKeyType="send"
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
