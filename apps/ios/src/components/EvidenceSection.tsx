import type { Source } from "@/api/types";
import {
  confidenceLabel,
  confidenceMeaning,
  evidenceState,
  formatEvidenceFetchedAt,
  providerName,
  safeEvidenceLink,
} from "@/evidence/presentation";
import { colors, radii, type } from "@/theme/tokens";
import { Ionicons } from "@expo/vector-icons";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

/**
 * Displays only source metadata returned by the API. It intentionally avoids
 * wording such as "verified": a returned citation is useful context, not an
 * independent confirmation of the match.
 */
export function EvidenceSection({
  sources,
  showTitle = true,
}: {
  sources: readonly Source[];
  /** Detail already supplies a collapsible Evidence heading. */
  showTitle?: boolean;
}) {
  const state = evidenceState(sources);

  return (
    <View style={styles.root} accessible={false}>
      {showTitle ? (
        <View style={styles.headingRow}>
          <View style={styles.headingLabel}>
            <Ionicons name="document-text-outline" size={15} color={colors.fgMuted} />
            <Text accessibilityRole="header" style={styles.heading}>
              Evidence
            </Text>
          </View>
          {state.kind === "cited" ? <Text style={styles.count}>{state.summary}</Text> : null}
        </View>
      ) : null}

      {state.kind === "uncited" ? (
        <View accessible accessibilityLabel={state.summary} style={styles.noCitation}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.warn} />
          <View style={styles.noCitationCopy}>
            <Text style={styles.noCitationTitle}>No citations returned</Text>
            <Text style={styles.noCitationText}>
              Treat this match as low confidence until evidence is available.
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.list}>
          {sources.map((source, index) => (
            <EvidenceRow
              key={`${source.provider}-${source.url ?? "unlinked"}-${index}`}
              source={source}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function EvidenceRow({ source }: { source: Source }) {
  const provider = providerName(source.provider);
  const confidence = confidenceLabel(source.confidence);
  const meaning = confidenceMeaning(source.confidence);
  const fetchedAt = formatEvidenceFetchedAt(source.fetchedAt) ?? "Fetch time unavailable";
  const link = safeEvidenceLink(source.url);
  const accessibilityLabel = [
    provider,
    confidence,
    meaning,
    fetchedAt,
    link ? `Open source at ${link.host}` : "No web link returned",
  ].join(". ");

  const content = (
    <>
      <View style={styles.rowHeader}>
        <View style={styles.rowTitleWrap}>
          <Text style={styles.provider} numberOfLines={1}>
            {provider}
          </Text>
          <Text style={styles.confidence}>{confidence}</Text>
        </View>
        {link ? <Ionicons name="open-outline" size={16} color={colors.accent} /> : null}
      </View>
      <Text style={styles.meaning}>{meaning}</Text>
      <View style={styles.metadata}>
        <Text style={styles.metadataText}>{fetchedAt}</Text>
        <Text style={link ? styles.linkText : styles.metadataText}>
          {link ? `Open source · ${link.host}` : "No web link returned"}
        </Text>
      </View>
    </>
  );

  if (!link) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel} style={styles.row}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => {
        void Linking.openURL(link.url).catch(() => {});
      }}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens the returned source in your browser."
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  headingRow: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headingLabel: { flexDirection: "row", alignItems: "center", gap: 6 },
  heading: { color: colors.fg, ...type.label, fontSize: 13 },
  count: { color: colors.fgDim, ...type.caption, flexShrink: 1, textAlign: "right" },
  list: { gap: 8 },
  row: {
    minHeight: 44,
    gap: 6,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgSunken,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  rowPressed: { opacity: 0.76 },
  rowHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  rowTitleWrap: { flex: 1, gap: 2 },
  provider: { color: colors.fg, ...type.label, fontSize: 13 },
  confidence: { color: colors.accent, ...type.caption },
  meaning: { color: colors.fgMuted, ...type.caption, fontSize: 11 },
  metadata: { flexDirection: "row", flexWrap: "wrap", columnGap: 8, rowGap: 2 },
  metadataText: { color: colors.fgDim, ...type.caption, fontSize: 10 },
  linkText: { color: colors.accent, ...type.caption, fontSize: 10 },
  noCitation: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.warn,
    backgroundColor: colors.bgSunken,
    padding: 10,
  },
  noCitationCopy: { flex: 1, gap: 2 },
  noCitationTitle: { color: colors.fg, ...type.label, fontSize: 13 },
  noCitationText: { color: colors.fgMuted, ...type.caption, fontSize: 11 },
});
