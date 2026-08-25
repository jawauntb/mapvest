/**
 * Orbit view — one company's value chain, made visible (Universe Roadmap §3 C2).
 *
 * Layout is the economics, not decoration: the company sits in the middle,
 * its **suppliers** sit below it (the inputs it stands on), its **buyers**
 * sit above it (the demand it stands under), and its competitors /
 * complements sit beside it. Every node is one cited `CompanyEdge`; tapping
 * the ⓘ (or long-pressing the node) shows why the edge exists and opens its
 * source.
 *
 * Constellation rule (same visual language as the map's silhouette pins in
 * app/(tabs)/map.tsx): a node whose ticker is **not** in the user's finds is
 * an *uncaught* node — muted, silhouetted, tagged "uncaught". Caught nodes
 * are lit. The caught set comes from the token-scoped 200-row finds query, which is a
 * different query from the graph, so catching a node relights it on the next
 * finds refresh **without refetching the graph** (the C2 acceptance test).
 *
 * A counterparty with no ticker is *private*, not uncaught — the extractor
 * never invents a symbol (AGENTS.md §4), so there is nothing to catch. Those
 * render quiet and are not navigable.
 *
 * Everything here fails soft: `/v1/graph` and `/v1/pulse` ship this wave, so
 * a 404 collapses the whole component to a single muted line and never blocks
 * the screen hosting it.
 *
 * No new deps — plain RN views, same as the watchlist sector bar.
 */
import { isQuotaExceeded } from "@/api/errors";
import { listFinds } from "@/api/finds";
import {
  type CompanyEdge,
  type CompanyEdgeType,
  type DemandPulse,
  fetchCompanyGraph,
  fetchDemandPulse,
} from "@/api/graph";
import type { Source } from "@/api/types";
import { usePaywall } from "@/billing/Paywall";
import { findsQueryKey } from "@/finds/queryKeys";
import { colors, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

export type OrbitVariant = "compact" | "full";

/** How many nodes a lane shows before collapsing the rest into "+N". */
const LANE_CAP: Record<OrbitVariant, number> = { compact: 3, full: 8 };

const LANE_TITLES: Record<CompanyEdgeType, string> = {
  buys_from: "Buyers",
  supplies: "Suppliers",
  competes_with: "Competes with",
  complements: "Complements",
};

/** Relationship read from the counterparty's side, for the reasoning panel. */
function relationLine(edge: CompanyEdge, subject: string): string {
  switch (edge.edgeType) {
    case "supplies":
      return `Supplier · sells to $${subject}`;
    case "buys_from":
      return `Buyer · buys from $${subject}`;
    case "competes_with":
      return `Competitor of $${subject}`;
    default:
      return `Complement to $${subject}`;
  }
}

/** Heaviest first, one node per counterparty. */
function laneEdges(edges: CompanyEdge[], kind: CompanyEdgeType): CompanyEdge[] {
  const best = new Map<string, CompanyEdge>();
  for (const e of edges) {
    if (e.edgeType !== kind) continue;
    const key = (e.dstTicker ?? e.dstName).trim().toUpperCase();
    if (!key) continue;
    const prev = best.get(key);
    if (!prev || e.weight > prev.weight) best.set(key, e);
  }
  return [...best.values()].sort((a, b) => b.weight - a.weight);
}

/** Weight → emphasis tier. Heavier relationships read louder. */
function emphasis(weight: number): "strong" | "medium" | "faint" {
  if (weight >= 0.6) return "strong";
  if (weight >= 0.3) return "medium";
  return "faint";
}

/** "+12%" / "-4%" — one decimal only when it would otherwise read as 0%. */
function fmtPct(n: number): string {
  const abs = Math.abs(n);
  const body = abs >= 10 ? n.toFixed(0) : n.toFixed(1);
  return `${n >= 0 ? "+" : ""}${body}%`;
}

function hostOf(url: string): string {
  const host = url.match(/^https?:\/\/([^/]+)/i)?.[1];
  return host ? host.replace(/^www\./i, "") : url;
}

export function OrbitView({
  ticker,
  name,
  token,
  variant = "compact",
}: {
  ticker: string;
  /** Company name for the center node; falls back to the ticker. */
  name?: string;
  token?: string;
  variant?: OrbitVariant;
}) {
  const router = useRouter();
  const { presentPaywall } = usePaywall();
  const symbol = ticker.trim().toUpperCase();
  const [selected, setSelected] = useState<CompanyEdge | null>(null);

  // retry:false + read-only `.data` — a 404 while /v1/graph is still shipping
  // must look like "no graph yet", not like a broken screen.
  const graphQ = useQuery({
    queryKey: ["company-graph", symbol],
    enabled: !!symbol,
    queryFn: () => fetchCompanyGraph(symbol, { token }),
    staleTime: 30 * 60_000,
    retry: false,
  });

  const edges = graphQ.data?.edges ?? [];

  // The pulse is the weighted trajectory of this company's *buyers*, so it is
  // only asked for once the graph proves there are buyer edges to aggregate.
  // /v1/pulse is metered exactly like /v1/graph — firing it for a ticker with
  // no `buys_from` edges would spend a generation to be told "unknown".
  const pulseQ = useQuery({
    queryKey: ["demand-pulse", symbol],
    enabled: !!symbol && edges.some((e) => e.edgeType === "buys_from"),
    queryFn: () => fetchDemandPulse(symbol, { token }),
    staleTime: 30 * 60_000,
    retry: false,
  });

  // Same 200-row key as Universe; Home/Map intentionally use a separate
  // 100-row projection so the two server limits cannot share stale data.
  const findsQ = useQuery({
    queryKey: findsQueryKey(token, 200),
    enabled: !!token,
    queryFn: () => listFinds({ token }, 200),
    staleTime: 60_000,
    retry: false,
  });

  const caught = useMemo(() => {
    const out = new Set<string>();
    for (const find of findsQ.data?.finds ?? []) {
      const t = (find.ticker ?? find.comparable)?.trim().toUpperCase();
      if (t) out.add(t);
    }
    return out;
  }, [findsQ.data]);

  const lanes = useMemo(
    () => ({
      buyers: laneEdges(edges, "buys_from"),
      suppliers: laneEdges(edges, "supplies"),
      competitors: laneEdges(edges, "competes_with"),
      complements: laneEdges(edges, "complements"),
    }),
    [edges],
  );

  if (!symbol) return <Text style={styles.muted}>No ticker to map.</Text>;
  if (graphQ.isLoading) return <Text style={styles.muted}>Mapping the value chain…</Text>;
  if (graphQ.isError) {
    // A spent free-tier meter is not "unavailable" — route it through the same
    // paywall every other billable action uses (see detail/[id].tsx).
    if (isQuotaExceeded(graphQ.error)) {
      return (
        <Pressable onPress={presentPaywall} hitSlop={8}>
          <Text style={styles.muted}>
            Free limit reached — subscribe to map the value chain. Tap to see plans.
          </Text>
        </Pressable>
      );
    }
    return <Text style={styles.muted}>Value chain unavailable.</Text>;
  }
  if (edges.length === 0) {
    return <Text style={styles.muted}>No cited value chain for ${symbol} yet.</Text>;
  }

  const cap = LANE_CAP[variant];
  const openNode = (edge: CompanyEdge) => {
    if (!edge.dstTicker) {
      // Private counterparty — nothing to open, so the tap explains itself.
      setSelected(edge);
      return;
    }
    hapticSelect();
    router.push(`/detail/${encodeURIComponent(edge.dstTicker)}`);
  };
  const showEdge = (edge: CompanyEdge) => {
    hapticSelect();
    setSelected((prev) => (prev?.id === edge.id ? null : edge));
  };

  return (
    <View style={styles.root}>
      <PulseStat pulse={pulseQ.data} />

      <Lane
        title={LANE_TITLES.buys_from}
        caption="demand above"
        icon="arrow-up"
        edges={lanes.buyers}
        cap={cap}
        caught={caught}
        onOpen={openNode}
        onInfo={showEdge}
        selectedId={selected?.id}
      />

      <View style={styles.middle}>
        <SideLane
          title={LANE_TITLES.competes_with}
          edges={lanes.competitors}
          cap={variant === "compact" ? 2 : 4}
          caught={caught}
          align="flex-end"
          onOpen={openNode}
          onInfo={showEdge}
          selectedId={selected?.id}
        />
        <View style={styles.center}>
          <Text style={styles.centerTicker} numberOfLines={1}>
            ${symbol}
          </Text>
          {name && name.toUpperCase() !== symbol ? (
            <Text style={styles.centerName} numberOfLines={1}>
              {name}
            </Text>
          ) : null}
        </View>
        <SideLane
          title={LANE_TITLES.complements}
          edges={lanes.complements}
          cap={variant === "compact" ? 2 : 4}
          caught={caught}
          align="flex-start"
          onOpen={openNode}
          onInfo={showEdge}
          selectedId={selected?.id}
        />
      </View>

      <Lane
        title={LANE_TITLES.supplies}
        caption="inputs below"
        icon="arrow-down"
        edges={lanes.suppliers}
        cap={cap}
        caught={caught}
        onOpen={openNode}
        onInfo={showEdge}
        selectedId={selected?.id}
      />

      {selected ? (
        <EdgePanel
          edge={selected}
          subject={symbol}
          caught={!!selected.dstTicker && caught.has(selected.dstTicker.toUpperCase())}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </View>
  );
}

/** "Demand pulse +12% · expanding" — hidden entirely when nothing resolved. */
function PulseStat({ pulse }: { pulse?: DemandPulse }) {
  if (!pulse || pulse.pulse === null || pulse.interpretation === "unknown") return null;
  const ink =
    pulse.interpretation === "expanding"
      ? colors.accent
      : pulse.interpretation === "contracting"
        ? colors.danger
        : colors.fgMuted;
  return (
    <View style={styles.pulseRow}>
      <Ionicons name="pulse-outline" size={13} color={ink} />
      <Text style={styles.pulseLabel}>Demand pulse</Text>
      <Text style={[styles.pulseValue, { color: ink }]}>
        {fmtPct(pulse.pulse)} · {pulse.interpretation}
      </Text>
    </View>
  );
}

function Lane({
  title,
  caption,
  icon,
  edges,
  cap,
  caught,
  onOpen,
  onInfo,
  selectedId,
}: {
  title: string;
  caption: string;
  icon: "arrow-up" | "arrow-down";
  edges: CompanyEdge[];
  cap: number;
  caught: Set<string>;
  onOpen: (edge: CompanyEdge) => void;
  onInfo: (edge: CompanyEdge) => void;
  selectedId?: string;
}) {
  if (edges.length === 0) return null;
  const shown = edges.slice(0, cap);
  const rest = edges.length - shown.length;
  return (
    <View style={styles.lane}>
      <View style={styles.laneHeader}>
        <Ionicons name={icon} size={11} color={colors.fgDim} />
        <Text style={styles.laneTitle}>{title}</Text>
        <Text style={styles.laneCaption}>· {caption}</Text>
      </View>
      <View style={styles.laneChips}>
        {shown.map((edge) => (
          <NodeChip
            key={edge.id}
            edge={edge}
            caught={caught}
            onOpen={onOpen}
            onInfo={onInfo}
            selected={selectedId === edge.id}
          />
        ))}
        {rest > 0 ? <Text style={styles.more}>+{rest}</Text> : null}
      </View>
    </View>
  );
}

function SideLane({
  title,
  edges,
  cap,
  caught,
  align,
  onOpen,
  onInfo,
  selectedId,
}: {
  title: string;
  edges: CompanyEdge[];
  cap: number;
  caught: Set<string>;
  align: "flex-start" | "flex-end";
  onOpen: (edge: CompanyEdge) => void;
  onInfo: (edge: CompanyEdge) => void;
  selectedId?: string;
}) {
  // The column keeps its width even when empty so the center node stays
  // centered whether or not the company has comps on both sides.
  const shown = edges.slice(0, cap);
  const rest = edges.length - shown.length;
  return (
    <View style={[styles.sideLane, { alignItems: align }]}>
      {shown.length > 0 ? <Text style={styles.sideTitle}>{title}</Text> : null}
      {shown.map((edge) => (
        <NodeChip
          key={edge.id}
          edge={edge}
          caught={caught}
          onOpen={onOpen}
          onInfo={onInfo}
          selected={selectedId === edge.id}
        />
      ))}
      {rest > 0 ? <Text style={styles.more}>+{rest}</Text> : null}
    </View>
  );
}

/**
 * One node. Tap → detail (when it has a ticker). Long-press or the ⓘ → the
 * edge's reasoning + source. Uncaught nodes wear the map's silhouette.
 */
function NodeChip({
  edge,
  caught,
  onOpen,
  onInfo,
  selected,
}: {
  edge: CompanyEdge;
  caught: Set<string>;
  onOpen: (edge: CompanyEdge) => void;
  onInfo: (edge: CompanyEdge) => void;
  selected: boolean;
}) {
  const dst = edge.dstTicker?.trim().toUpperCase();
  const isPrivate = !dst;
  const uncaught = !!dst && !caught.has(dst);
  const tier = emphasis(edge.weight);
  const label = dst ?? edge.dstName;
  const state = isPrivate ? " — private, no ticker" : uncaught ? " — not caught yet" : "";

  return (
    <Pressable
      onPress={() => onOpen(edge)}
      onLongPress={() => onInfo(edge)}
      delayLongPress={250}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={`${edge.dstName}${state}`}
      accessibilityHint="Long press for why this edge exists"
      style={({ pressed }) => [
        styles.chip,
        tier === "strong" && styles.chipStrong,
        tier === "faint" && styles.chipFaint,
        uncaught && styles.chipUncaught,
        isPrivate && styles.chipPrivate,
        selected && styles.chipSelected,
        pressed && { opacity: 0.7 },
      ]}
    >
      {uncaught ? <View style={styles.uncaughtDot} /> : null}
      <Text
        style={[
          styles.chipText,
          tier === "strong" && styles.chipTextStrong,
          tier === "faint" && styles.chipTextFaint,
          (uncaught || isPrivate) && styles.chipTextMuted,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Pressable
        onPress={() => onInfo(edge)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Why ${edge.dstName} is here`}
      >
        <Ionicons
          name="information-circle-outline"
          size={13}
          color={selected ? colors.accent : colors.fgDim}
        />
      </Pressable>
    </Pressable>
  );
}

/** Reasoning + citations for one edge. Inline (never a nested modal sheet). */
function EdgePanel({
  edge,
  subject,
  caught,
  onClose,
}: {
  edge: CompanyEdge;
  subject: string;
  caught: boolean;
  onClose: () => void;
}) {
  const cited = edge.sources.filter((s): s is Source & { url: string } => !!s.url);
  return (
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.panelTitle} numberOfLines={2}>
            {edge.dstTicker ? `$${edge.dstTicker} · ` : ""}
            {edge.dstName}
          </Text>
          <Text style={styles.panelRelation}>
            {relationLine(edge, subject)} · strength {Math.round(edge.weight * 100)}%
            {edge.asOf ? ` · as of ${edge.asOf}` : ""}
          </Text>
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={16} color={colors.fgMuted} />
        </Pressable>
      </View>

      <Text style={styles.panelBody}>{edge.reasoning}</Text>

      {edge.dstTicker && !caught ? (
        <Text style={styles.panelUncaught}>Uncaught — find it in the wild to light it up.</Text>
      ) : null}

      {cited.length > 0 ? (
        cited.slice(0, 4).map((s, i) => (
          <Pressable
            key={`${s.url}-${i}`}
            onPress={() => Linking.openURL(s.url).catch(() => {})}
            hitSlop={6}
            accessibilityRole="link"
            accessibilityLabel={`Open source on ${hostOf(s.url)}`}
          >
            <Text style={styles.panelLink} numberOfLines={1}>
              {s.provider} · {hostOf(s.url)}
            </Text>
          </Pressable>
        ))
      ) : (
        <Text style={styles.panelNoSource}>No linkable citation on this edge.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  muted: { color: colors.fgMuted, fontSize: 13 },

  pulseRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  pulseLabel: { color: colors.fgMuted, ...type.caption },
  pulseValue: { fontSize: 12, fontWeight: "700" },

  lane: { gap: 6 },
  laneHeader: { flexDirection: "row", alignItems: "center", gap: 4 },
  laneTitle: { color: colors.fgMuted, ...type.caption },
  laneCaption: { color: colors.fgDim, fontSize: 10, fontWeight: "600" },
  laneChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  more: { color: colors.fgDim, fontSize: 11, fontWeight: "700" },

  middle: { flexDirection: "row", alignItems: "center", gap: 8 },
  sideLane: { flex: 1, gap: 6 },
  sideTitle: { color: colors.fgDim, fontSize: 10, fontWeight: "600" },
  center: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.accentMuted,
    backgroundColor: colors.bgSunken,
    alignItems: "center",
    minWidth: 96,
  },
  centerTicker: { color: colors.accent, fontSize: 16, fontWeight: "800", letterSpacing: -0.2 },
  centerName: { color: colors.fgMuted, fontSize: 11, marginTop: 2, maxWidth: 140 },

  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    maxWidth: "100%",
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  chipStrong: { borderColor: colors.borderStrong, paddingVertical: 7 },
  chipFaint: { opacity: 0.88 },
  /** Same silhouette language as the map's uncaught pins. */
  chipUncaught: {
    opacity: 0.6,
    backgroundColor: colors.bgSunken,
    borderColor: colors.borderStrong,
  },
  chipPrivate: { borderStyle: "dashed" },
  chipSelected: { borderColor: colors.accent },
  uncaughtDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.fgMuted,
  },
  chipText: { color: colors.fg, fontSize: 12, fontWeight: "600", flexShrink: 1 },
  chipTextStrong: { fontSize: 13, fontWeight: "800" },
  chipTextFaint: { fontSize: 11, fontWeight: "600" },
  chipTextMuted: { color: colors.fgMuted },

  panel: {
    gap: 6,
    padding: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSunken,
  },
  panelHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  panelTitle: { color: colors.fg, fontSize: 13, fontWeight: "700" },
  panelRelation: { color: colors.fgDim, fontSize: 11, marginTop: 2 },
  panelBody: { color: colors.fgMuted, fontSize: 12, lineHeight: 18 },
  panelUncaught: { color: colors.fgDim, fontSize: 11, fontStyle: "italic" },
  panelLink: { color: colors.accent2, fontSize: 11 },
  panelNoSource: { color: colors.fgDim, fontSize: 11 },
});
