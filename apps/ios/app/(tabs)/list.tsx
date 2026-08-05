import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { fetchNearby } from "@/api/client";
import type { NearbyItem } from "@/api/types";
import { useSession } from "@/auth/session";

type SortKey = "distance" | "sector" | "public";

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
      setOrigin({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    })();
  }, []);

  const q = useQuery({
    queryKey: ["nearby-list", origin.lat.toFixed(3), origin.lng.toFixed(3)],
    queryFn: () =>
      fetchNearby({ ...origin, radius: 1500, limit: 80 }, { token: session?.token }),
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
          return (
            (a.i.investable?.brand.sector ?? "zzz").localeCompare(
              b.i.investable?.brand.sector ?? "zzz",
            )
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

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.sortRow}>
        {(["distance", "public", "sector"] as SortKey[]).map((k) => (
          <Pressable
            key={k}
            onPress={() => setSort(k)}
            style={[styles.chip, sort === k && styles.chipOn]}
          >
            <Text style={[styles.chipText, sort === k && styles.chipTextOn]}>
              {k}
            </Text>
          </Pressable>
        ))}
      </View>

      {q.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : q.isError ? (
        <View style={styles.center}>
          <Text style={styles.err}>{(q.error as Error).message}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.place.id}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => {
                const t = item.investable?.brand.ticker?.symbol;
                if (t) router.push(`/detail/${t}`);
                else router.push(`/detail/${encodeURIComponent(item.place.name)}`);
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{listTitle(item)}</Text>
                <Text style={styles.sub}>
                  {formatItem(item)} ·{" "}
                  {formatDistance(haversine(origin, item.place.location))}
                </Text>
              </View>
              <View
                style={[styles.dot, { backgroundColor: pinColor(item) }]}
              />
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}
    </SafeAreaView>
  );
}

function listTitle(i: NearbyItem): string {
  const t = i.investable?.brand.ticker?.symbol;
  if (t && i.investable?.brand.isPublic) return `$${t}  ${i.place.name}`;
  const comp = i.investable?.comparables?.[0]?.ticker;
  if (comp) return `≈$${comp}  ${i.place.name}`;
  return i.place.name;
}

function formatItem(i: NearbyItem): string {
  const inv = i.investable;
  if (!inv) return i.place.types[0] ?? "unlisted";
  if (inv.brand.isPublic)
    return `${inv.brand.ticker?.symbol ?? "public"} · ${inv.brand.sector ?? ""}`;
  if (inv.comparables.length > 0) {
    return `private · ≈ ${inv.comparables.map((c) => c.ticker).join(", ")}`;
  }
  return `private · ${inv.etfs.length} ETFs`;
}

function pinColor(i: NearbyItem): string {
  const inv = i.investable;
  if (!inv) return "#666";
  if (inv.brand.isPublic) return "#3ac47d";
  if (inv.comparables.length || inv.etfs.length) return "#f5a524";
  return "#ff5a5a";
}

function haversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) *
      Math.cos(toRad(b.lat)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  sortRow: { flexDirection: "row", gap: 8, padding: 12 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#333",
  },
  chipOn: { backgroundColor: "#fff", borderColor: "#fff" },
  chipText: { color: "#aaa", fontSize: 13 },
  chipTextOn: { color: "#000", fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  name: { color: "#fff", fontSize: 16, fontWeight: "600" },
  sub: { color: "#888", fontSize: 12, marginTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  sep: { height: 1, backgroundColor: "#111" },
  err: { color: "#ff5a5a", padding: 16, textAlign: "center" },
});
