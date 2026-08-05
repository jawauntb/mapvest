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
        { lat: region.latitude, lng: region.longitude, radius: 800, limit: 40 },
        { token: session?.token },
      ),
    staleTime: 60_000,
  });

  const items = useMemo(() => nearbyQuery.data?.items ?? [], [nearbyQuery.data]);

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
            title={item.place.name}
            description={describeItem(item)}
            pinColor={pinColor(item)}
            onCalloutPress={() => {
              const ticker = item.investable?.brand.ticker?.symbol;
              if (ticker) router.push(`/detail/${ticker}`);
              else router.push(`/detail/${encodeURIComponent(item.place.name)}`);
            }}
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

function describeItem(item: NearbyItem): string {
  const inv = item.investable;
  if (!inv) return item.place.types.join(", ");
  const t = inv.brand.ticker?.symbol;
  return t ? `${inv.brand.name} · ${t}` : inv.brand.name;
}

function pinColor(item: NearbyItem): string {
  const inv = item.investable;
  if (!inv) return "gray";
  if (inv.brand.isPublic) return "green";
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
