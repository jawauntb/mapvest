import type { PrismCitation } from "@/api/prism";
import { colors, radii, space, type } from "@/theme/tokens";
import { hapticTap } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { PRISM_DIM } from "./constants";
import { CitationRow, SectionCard } from "./ui";
import { type PrismChatTurn, usePrismChat } from "./usePrismChat";

const SUGGESTIONS = [
  "What would change this call?",
  "Which signal is doing the most work here?",
  "What is the bear case in one paragraph?",
];

/**
 * Ask the packet a question.
 *
 * The engine answers strictly from the stored packet, so this is not a general
 * chat — it is an interrogation of numbers that are already on this screen.
 * The thread is client-held and sent with each turn; if the engine returns a
 * conversation id it takes over persistence.
 */
export function PrismChatSection({ ticker, token }: { ticker: string; token?: string }) {
  const chat = usePrismChat(ticker, token);
  const [draft, setDraft] = useState("");

  const submit = (text: string) => {
    const message = text.trim();
    if (!message || chat.pending) return;
    hapticTap();
    chat.send(message);
    setDraft("");
  };

  return (
    <SectionCard
      eyebrow="Chat"
      title={`Ask about ${ticker}`}
      subtitle="Answers come only from this packet, with citations back into it."
      right={
        chat.turns.length > 0 ? (
          <Pressable
            onPress={chat.reset}
            accessibilityRole="button"
            accessibilityLabel="Clear this thread"
            hitSlop={10}
          >
            <Ionicons name="refresh-outline" size={16} color={colors.fgMuted} />
          </Pressable>
        ) : undefined
      }
    >
      {chat.turns.length === 0 ? (
        <View style={styles.suggestions}>
          {SUGGESTIONS.map((suggestion) => (
            <Pressable
              key={suggestion}
              onPress={() => submit(suggestion)}
              accessibilityRole="button"
              accessibilityLabel={suggestion}
              style={({ pressed }) => [styles.suggestion, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.suggestionText}>{suggestion}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {chat.turns.map((turn) => (
        <View
          key={turn.id}
          style={[
            styles.turn,
            turn.role === "user" ? styles.turnUser : styles.turnAssistant,
            turn.failed ? styles.turnFailed : null,
          ]}
        >
          <Text style={turn.role === "user" ? styles.turnTextUser : styles.turnText}>
            {turn.content}
          </Text>
          <TurnCitations turn={turn} />
        </View>
      ))}

      {chat.pending ? (
        <View style={styles.pending}>
          <ActivityIndicator color={colors.fgMuted} />
          <Text style={styles.pendingText}>Reading the packet…</Text>
        </View>
      ) : null}

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={`Ask about ${ticker}…`}
          // Not `colors.fgDim`: 4.44:1 on the sunken ground is under AA for a
          // 14px placeholder. PRISM_DIM is 5.60:1 and still clearly a hint.
          placeholderTextColor={PRISM_DIM}
          style={styles.input}
          multiline
          maxLength={4000}
          editable={!chat.pending}
          returnKeyType="send"
          blurOnSubmit
          onSubmitEditing={() => submit(draft)}
          accessibilityLabel={`Ask a question about ${ticker}`}
        />
        <Pressable
          onPress={() => submit(draft)}
          disabled={chat.pending || draft.trim().length === 0}
          accessibilityRole="button"
          accessibilityLabel="Send question"
          accessibilityState={{ disabled: chat.pending || draft.trim().length === 0 }}
          style={({ pressed }) => [
            styles.send,
            (chat.pending || draft.trim().length === 0) && { opacity: 0.4 },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Ionicons name="arrow-up" size={17} color={colors.accentInk} />
        </Pressable>
      </View>

      {/* No separate error line: a failed turn is rendered in the thread with
          the same copy, and printing it twice reads as two failures. */}
    </SectionCard>
  );
}

/**
 * A chat answer's citations, resolved on the spot.
 *
 * The engine returns the full citation ({id, claim, source, url}) for every id
 * it cites and `usePrismChat` keeps all of it. Printing "[C3] [C5]" and
 * dropping the rest breaks this card's own promise ("citations back into it"):
 * the memo's citation list is a dozen cards above, so the reader has nothing to
 * resolve a bare id against. Three are shown inline; more collapse behind a
 * disclosure so a long answer does not bury its own text.
 */
const INLINE_CITATIONS = 3;

function TurnCitations({ turn }: { turn: PrismChatTurn }) {
  const citations: PrismCitation[] = turn.citations ?? [];
  const [expanded, setExpanded] = useState(false);
  if (citations.length === 0) return null;
  const collapsed = citations.length > INLINE_CITATIONS && !expanded;
  const shown = collapsed ? citations.slice(0, INLINE_CITATIONS) : citations;
  return (
    <View style={styles.citationBlock}>
      {shown.map((c) => (
        <CitationRow key={c.id} id={c.id} claim={c.claim} source={c.source} url={c.url} />
      ))}
      {citations.length > INLINE_CITATIONS ? (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={
            collapsed
              ? `Show all ${citations.length} sources for this answer`
              : "Show fewer sources"
          }
          hitSlop={8}
          style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
        >
          <Text style={styles.citationToggle}>
            {collapsed ? `${citations.length - INLINE_CITATIONS} more sources` : "Show fewer"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  suggestions: { gap: 6 },
  suggestion: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: "flex-start",
  },
  suggestionText: { color: colors.fgMuted, fontSize: 12.5 },
  turn: {
    borderRadius: radii.md,
    padding: space.md,
    gap: 4,
    maxWidth: "94%",
  },
  turnUser: { backgroundColor: colors.accentMuted, alignSelf: "flex-end" },
  turnAssistant: {
    backgroundColor: colors.bgSunken,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignSelf: "flex-start",
  },
  turnFailed: { borderColor: colors.danger },
  turnText: { color: colors.fg, fontSize: 13.5, lineHeight: 20 },
  turnTextUser: { color: colors.fg, fontSize: 13.5, lineHeight: 20, fontWeight: "600" },
  citationBlock: { gap: 2, marginTop: 2 },
  citationToggle: {
    color: colors.accent,
    fontSize: 11.5,
    fontWeight: "700",
    paddingVertical: 4,
  },
  pending: { flexDirection: "row", alignItems: "center", gap: 8 },
  pendingText: { color: colors.fgMuted, fontSize: 12 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: space.sm },
  input: {
    flex: 1,
    color: colors.fg,
    backgroundColor: colors.bgSunken,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    maxHeight: 120,
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
