import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import { fetchNearby } from "@/api/client";
import type { NearbyItem } from "@/api/types";
import { useSession } from "@/auth/session";
const FALLBACK_REGION: Region = {
  latitude: 37.7749,
  longitude: -122.4194,
  latitudeDelta: 0.03,
  longitudeDelta: 0.03,
};

export default function MapScreen() {
  const router = useRouter();
  const { session } = useSession();
  const [region, setRegion] = useState<Region>(FALLBACK_REGION);
  const [permErr, setPermErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setPermErr("Location permission denied. Showing San Francisco.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setRegion({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      });
    })();
  }, []);

  const nearbyQuery = useQuery({
    queryKey: ["nearby", region.latitude.toFixed(3), region.longitude.toFixed(3)],
    queryFn: () =>
      fetchNearby(
        { lat: region.latitude, lng: region.longitude, radius: 1500, limit: 50 },
        { token: session?.token },
      ),
    staleTime: 60_000,
  });

  const items = useMemo(() => nearbyQuery.data?.items ?? [], [nearbyQuery.data]);

  function openItem(item: NearbyItem) {
    const ticker = item.investable?.brand.ticker?.symbol;
    const comp = item.investable?.comparables?.[0]?.ticker;
    const id = ticker ?? comp ?? item.place.name;
    router.push(`/detail/${encodeURIComponent(id)}`);
  }

  return (
    <View style={styles.root}>
      <MapView
        provider={Platform.OS === "ios" ? PROVIDER_GOOGLE : PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFillObject}
        initialRegion={region}
        region={region}
        onRegionChangeComplete={setRegion}
        showsUserLocation
        showsMyLocationButton
      >
        {items.map((item) => (
          <Marker
            key={item.place.id}
            coordinate={{
              latitude: item.place.location.lat,
              longitude: item.place.location.lng,
            }}
            title={markerTitle(item)}
            description={describeItem(item)}
            pinColor={pinColor(item)}
            onPress={() => openItem(item)}
            onCalloutPress={() => openItem(item)}
          />
        ))}
      </MapView>

      <View pointerEvents="none" style={styles.overlay}>
        {nearbyQuery.isFetching ? <ActivityIndicator color="#fff" /> : null}
        {permErr ? <Text style={styles.warn}>{permErr}</Text> : null}
        {nearbyQuery.isError ? (
          <Text style={styles.warn}>
            {(nearbyQuery.error as Error).message || "Could not load nearby brands."}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function markerTitle(item: NearbyItem): string {
  const t = item.investable?.brand.ticker?.symbol;
  if (t && item.investable?.brand.isPublic) return `$${t} · ${item.place.name}`;
  const comp = item.investable?.comparables?.[0]?.ticker;
  if (comp) return `≈$${comp} · ${item.place.name}`;
  return item.place.name;
}

function describeItem(item: NearbyItem): string {
  const inv = item.investable;
  if (!inv) return item.place.types.slice(0, 3).join(", ") || "unlisted";
  if (inv.brand.isPublic) {
    return `${inv.brand.sector ?? "public"} · tap for Research / Save`;
  }
  if (inv.comparables.length > 0) {
    return `private · comps ${inv.comparables.map((c) => c.ticker).join(", ")}`;
  }
  return "private · no validated ticker";
}

function pinColor(item: NearbyItem): string {
  const inv = item.investable;
  // react-native-maps pinColor only accepts named colors on Apple pins;
  // Google accepts hex. Prefer sector-tinted named fallbacks for reliability.
  if (!inv) return "gray";
  if (inv.brand.isPublic) {
    const sector = (inv.brand.sector ?? "").toLowerCase();
    if (sector.includes("tech") || sector.includes("communication")) return "blue";
    if (sector.includes("health")) return "purple";
    if (sector.includes("energy")) return "yellow";
    if (sector.includes("financ")) return "violet";
    if (sector.includes("staple") || sector.includes("defensive")) return "green";
    if (sector.includes("discretionary") || sector.includes("cyclical")) return "orange";
    return "green";
  }
  if (inv.comparables.length > 0 || inv.etfs.length > 0) return "orange";
  return "red";
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  overlay: {
    position: "absolute",
    top: 16,
    left: 16,
    right: 16,
    alignItems: "center",
    gap: 8,
  },
  warn: {
    color: "#fff",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    fontSize: 12,
  },
});
