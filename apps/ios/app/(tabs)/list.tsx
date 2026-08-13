import { type Quote, fetchNearby, fetchQuotesMap } from "@/api/client";
import type { NearbyItem } from "@/api/types";
import { useSession } from "@/auth/session";
import { ChatAboutButton } from "@/components/ChatAboutButton";
import { EmptyState } from "@/components/EmptyState";
import { ScalePressable } from "@/components/ScalePressable";
import { ScreenFade } from "@/components/ScreenFade";
import { SectorRing, buildSegments } from "@/components/SectorRing";
import { SkeletonList } from "@/components/Skeleton";
import { openChatAbout } from "@/nav/chatAbout";
import { colors, elevation, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { investablePinColor, sectorColor } from "@/util/sectors";
import { saveLastLocationForWidgets } from "@/widgets/widgetLocation";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type SortKey = "distance" | "sector" | "public";

const SORTS: { key: SortKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "distance", label: "Distance", icon: "navigate-outline" },
  { key: "public", label: "Public", icon: "trending-up-outline" },
  { key: "sector", label: "Sector", icon: "grid-outline" },
];

export default function ListScreen() {
  const router = useRouter();
  const { session } = useSession();
  const [origin, setOrigin] = useState<{ lat: number; lng: number }>({
    lat: 37.7749,
    lng: -122.4194,
  });
  const [sort, setSort] = useState<SortKey>("distance");

  useEffect(() => {
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const next = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      setOrigin(next);
      void saveLastLocationForWidgets(next);
    })();
  }, []);

  const q = useQuery({
    queryKey: ["nearby-list", origin.lat.toFixed(3), origin.lng.toFixed(3)],
    queryFn: () => fetchNearby({ ...origin, radius: 1500, limit: 80 }, { token: session?.token }),
    staleTime: 60_000,
  });

  const items = useMemo<NearbyItem[]>(() => {
    const raw = q.data?.items ?? [];
    const decorated = raw.map((i) => ({
      i,
      d: haversine(origin, i.place.location),
    }));
    decorated.sort((a, b) => {
      switch (sort) {
        case "distance":
          return a.d - b.d;
        case "sector":
          return (a.i.investable?.brand.sector ?? "zzz").localeCompare(
            b.i.investable?.brand.sector ?? "zzz",
          );
        case "public": {
          const av = a.i.investable?.brand.isPublic ? 0 : 1;
          const bv = b.i.investable?.brand.isPublic ? 0 : 1;
          if (av !== bv) return av - bv;
          return a.d - b.d;
        }
      }
    });
    return decorated.map((x) => x.i);
  }, [q.data, sort, origin]);

  const tickers = useMemo(() => {
    const out: string[] = [];
    for (const i of items) {
      const t = i.investable?.brand.ticker?.symbol ?? i.investable?.comparables?.[0]?.ticker;
      if (t && !out.includes(t)) out.push(t);
      if (out.length >= 20) break;
    }
    return out;
  }, [items]);

  const quotesQ = useQuery({
    queryKey: ["list-quotes", tickers.join(",")],
    queryFn: () => fetchQuotesMap(tickers, { token: session?.token }),
    enabled: tickers.length > 0,
    staleTime: 60_000,
  });
  const quotes: Record<string, Quote> = quotesQ.data ?? {};

  // Sector composition of the currently-visible items. Cheap: O(n) over
  // items, memoized on items identity. Priority:
  //   1. Public brand's own sector.
  //   2. Private brand's declared sector (still meaningful for grouping).
  //   3. First OSM/place type as a fuzzy fallback ("cafe", "supermarket").
  //   4. "Unknown" — rolled into "Other" by buildSegments if it's small.
  const sectorSegments = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of items) {
      const inv = i.investable;
      const raw = inv?.brand.sector ?? i.place.types[0] ?? "Unknown";
      const key = (raw ?? "Unknown").trim() || "Unknown";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return buildSegments(counts, 6);
  }, [items]);

  // Build a `list` seed from the currently visible items — capped at 20 so
  // the resulting message doesn't balloon. Only real ticker + name info; we
  // never leak coordinates through the chat prefill.
  const chatSeedItems = useMemo(
    () =>
      items.slice(0, 20).map((i) => ({
        ticker: i.investable?.brand.ticker?.symbol ?? i.investable?.comparables?.[0]?.ticker,
        name: i.place.name,
        sector: i.investable?.brand.sector,
      })),
    [items],
  );

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Text style={styles.lesson}>Nearby places — tap one for the ticker.</Text>
      {(q.isLoading || sectorSegments.length > 0) && (
        <View style={styles.ringWrap}>
          <SectorRing segments={sectorSegments} loading={q.isLoading} />
        </View>
      )}
      {items.length > 0 ? (
        <View style={styles.chatPillWrap}>
          <ChatAboutButton
            label="Chat about this list"
            accessibilityLabel="Chat about this nearby list"
            onPress={() =>
              openChatAbout(router, {
                kind: "list",
                label: `${items.length} nearby brands`,
                items: chatSeedItems,
              })
            }
          />
        </View>
      ) : null}
      <View style={styles.sortRow}>
        {SORTS.map(({ key, label, icon }) => (
          <ScalePressable
            key={key}
            onPress={() => {
              hapticSelect();
              setSort(key);
            }}
            style={[styles.chip, sort === key && styles.chipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: sort === key }}
            accessibilityLabel={`Sort by ${label}`}
          >
            <Ionicons
              name={icon}
              size={13}
              color={sort === key ? colors.accentInk : colors.fgMuted}
            />
            <Text style={[styles.chipText, sort === key && styles.chipTextOn]}>{label}</Text>
          </ScalePressable>
        ))}
      </View>

      <ScreenFade>
        {q.isLoading ? (
          <SkeletonList rows={7} />
        ) : q.isError ? (
          <EmptyState
            icon="alert-circle-outline"
            title="Could not load nearby brands"
            subtitle={(q.error as Error).message}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon="location-outline"
            title="Nothing nearby yet"
            subtitle="Move around or check location permissions — investable brands within 1.5km show up here."
          />
        ) : (
          <FlatList
            style={{ flex: 1 }}
            data={items}
            keyExtractor={(i) => i.place.id}
            renderItem={({ item }) => {
              const t =
                item.investable?.brand.ticker?.symbol ?? item.investable?.comparables?.[0]?.ticker;
              const quote = t ? quotes[t.toUpperCase()] : undefined;
              const accent = item.investable?.brand.isPublic
                ? sectorColor(item.investable.brand.sector)
                : pinColor(item);
              const up = (quote?.change ?? 0) >= 0;
              return (
                <ScalePressable
                  style={styles.row}
                  onPress={() => {
                    if (t) router.push(`/detail/${t}`);
                    else router.push(`/detail/${encodeURIComponent(item.place.name)}`);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${listTitle(item)}`}
                >
                  <View style={[styles.dot, { backgroundColor: accent }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{listTitle(item)}</Text>
                    <Text style={styles.sub}>
                      {formatItem(item)} · {formatDistance(haversine(origin, item.place.location))}
                    </Text>
                  </View>
                  <View style={styles.priceCol}>
                    {quote ? (
                      <>
                        <Text style={styles.price}>${quote.price.toFixed(2)}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                          <Ionicons
                            name={up ? "caret-up" : "caret-down"}
                            size={9}
                            color={up ? colors.accent : colors.danger}
                          />
                          <Text style={{ color: up ? colors.accent : colors.danger, fontSize: 12 }}>
                            {quote.changePct.toFixed(2)}%
                          </Text>
                        </View>
                      </>
                    ) : (
                      <Ionicons name="chevron-forward" size={16} color={colors.fgDim} />
                    )}
                  </View>
                </ScalePressable>
              );
            }}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            contentContainerStyle={{ paddingBottom: 40 }}
          />
        )}
      </ScreenFade>
    </SafeAreaView>
  );
}

function listTitle(i: NearbyItem): string {
  const t = i.investable?.brand.ticker?.symbol;
  if (t && i.investable?.brand.isPublic) return `${t}  ${i.place.name}`;
  const comp = i.investable?.comparables?.[0]?.ticker;
  if (comp) return `≈ ${comp}  ${i.place.name}`;
  return i.place.name;
}

function formatItem(i: NearbyItem): string {
  const inv = i.investable;
  if (!inv) return i.place.types[0] ?? "unlisted";
  if (inv.brand.isPublic) return `${inv.brand.sector ?? "public"}`;
  if (inv.comparables.length > 0) {
    return `private · ≈ ${inv.comparables.map((c) => c.ticker).join(", ")}`;
  }
  return `private · ${inv.etfs.length} ETFs`;
}

function pinColor(i: NearbyItem): string {
  const inv = i.investable;
  return investablePinColor({
    isPublic: inv?.brand.isPublic,
    sector: inv?.brand.sector,
    hasComps: !!(inv?.comparables.length || inv?.etfs.length),
  });
}

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  lesson: {
    color: colors.fgMuted,
    fontSize: 13,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  ringWrap: { paddingTop: 8, paddingBottom: 12 },
  chatPillWrap: {
    flexDirection: "row",
    justifyContent: "flex-start",
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 2,
  },
  sortRow: { flexDirection: "row", gap: 8, padding: 12 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    minHeight: 36,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.fgMuted, fontSize: 13, fontWeight: "600" },
  chipTextOn: { color: colors.accentInk, fontWeight: "700" },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.bg,
  },
  name: { color: colors.fg, ...type.body, fontWeight: "600", fontSize: 16 },
  sub: { color: colors.fgDim, fontSize: 12, marginTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5, ...elevation.sm },
  priceCol: { alignItems: "flex-end", minWidth: 72 },
  price: { color: colors.fg, fontSize: 15, fontWeight: "700" },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 16 },
});
