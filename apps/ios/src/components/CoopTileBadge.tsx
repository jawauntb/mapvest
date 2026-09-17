import { fetchTerritory } from "@/api/territory";
import { colors, radii } from "@/theme/tokens";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";

/**
 * Compact "x/N this week" affordance for a map tile with in-progress co-op
 * state (Universe Roadmap §4 Item 4 — co-op tile uncover, "the weekly raid").
 * Renders nothing for a tile with zero co-op activity this cycle; flips to a
 * jade "Tile uncovered" pill once the threshold is met. The actual
 * completion moment is the push (`notifyTileUncovered` server-side) — this
 * badge is only the live readout for whoever is looking at the map, not just
 * contributors.
 *
 * `lat`/`lng` are the map's current center (same tile-scoped read as
 * `GET /v1/territory`, reusing the tile primitives — no second tile system).
 * Signed-out sessions render nothing: `/v1/territory` is bearer-required.
 */
export function CoopTileBadge({
  lat,
  lng,
  token,
}: {
  lat: number;
  lng: number;
  token?: string;
}) {
  const query = useQuery({
    queryKey: ["territory-coop", lat.toFixed(3), lng.toFixed(3)],
    queryFn: () => fetchTerritory({ lat, lng }, { token }),
    enabled: !!token,
    staleTime: 30_000,
  });

  const coop = query.data?.coop;
  if (!coop || coop.contributors === 0) return null;

  return (
    <View
      style={[styles.pill, coop.uncovered && styles.pillUncovered]}
      accessibilityRole="text"
      accessibilityLabel={
        coop.uncovered
          ? "This tile was uncovered by the co-op raid this week"
          : `${coop.contributors} of ${coop.threshold} Finders captured in this tile this week`
      }
    >
      <Text style={[styles.text, coop.uncovered && styles.textUncovered]}>
        {coop.uncovered ? "Tile uncovered" : `${coop.contributors}/${coop.threshold} this week`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    height: 26,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.accent2Muted,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: 10,
  },
  pillUncovered: {
    borderColor: colors.accentMuted,
  },
  text: {
    color: colors.accent2,
    fontSize: 12,
    fontWeight: "700",
  },
  textUncovered: {
    color: colors.accent,
  },
});
