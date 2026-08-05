import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { resolveComparable } from "@/api/client";
import type { Comparable, EtfExposure, Source } from "@/api/types";
import { useSession } from "@/auth/session";

export default function DetailSheet() {
  const params = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const brand = decodeURIComponent(params.id ?? "");

  const q = useQuery({
    queryKey: ["resolve-comparable", brand],
    enabled: !!brand,
    queryFn: () =>
      resolveComparable({ brand }, { token: session?.token }),
    staleTime: 5 * 60_000,
  });

  if (q.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  if (q.isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>{(q.error as Error).message}</Text>
      </View>
    );
  }
  const data = q.data;
  if (!data) return null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 16, gap: 20 }}>
      <View>
        <Text style={styles.h1}>{data.brand.name}</Text>
        <Text style={styles.sub}>
          {data.brand.isPublic
            ? `${data.brand.ticker?.symbol ?? ""}${
                data.brand.ticker?.exchange ? ` · ${data.brand.ticker.exchange}` : ""
              }`
            : "private"}
          {data.brand.sector ? ` · ${data.brand.sector}` : ""}
        </Text>
      </View>

      <Section title="Comparables">
        {data.comparables.length === 0 ? (
          <Text style={styles.muted}>No public comparables resolved.</Text>
        ) : (
          data.comparables.map((c) => <ComparableRow key={c.ticker} c={c} />)
        )}
      </Section>

      <Section title="ETF exposure">
        {data.etfs.length === 0 ? (
          <Text style={styles.muted}>No ETFs matched.</Text>
        ) : (
          data.etfs.map((e) => <EtfRow key={e.ticker} e={e} />)
        )}
      </Section>

      <Section title="Sources">
        <SourceList
          sources={dedupeSources([
            ...data.comparables.flatMap((c) => c.sources),
            ...data.etfs.map((e) => e.source),
          ])}
        />
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.h2}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function ComparableRow({ c }: { c: Comparable }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>
          {c.ticker} · {c.name}
        </Text>
        <Text style={styles.rowSub}>{c.reasoning}</Text>
      </View>
      <Text style={styles.score}>{Math.round(c.score * 100)}%</Text>
    </View>
  );
}

function EtfRow({ e }: { e: EtfExposure }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>
          {e.ticker} · {e.name}
        </Text>
      </View>
      <Text style={styles.score}>{(e.weight * 100).toFixed(2)}%</Text>
    </View>
  );
}

function SourceList({ sources }: { sources: Source[] }) {
  if (sources.length === 0)
    return <Text style={styles.muted}>No sources cited.</Text>;
  return (
    <View style={{ gap: 6 }}>
      {sources.map((s, i) => (
        <Pressable
          key={`${s.provider}-${s.url ?? i}`}
          onPress={() => s.url && Linking.openURL(s.url)}
        >
          <Text style={styles.link}>
            [{s.provider}] {s.url ?? "(no url)"} · {s.confidence}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function dedupeSources(list: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of list) {
    const k = `${s.provider}::${s.url ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
  },
  h1: { color: "#fff", fontSize: 28, fontWeight: "700" },
  h2: { color: "#fff", fontSize: 15, fontWeight: "600", letterSpacing: 0.4 },
  sub: { color: "#888", marginTop: 4 },
  muted: { color: "#888", fontSize: 13 },
  card: {
    backgroundColor: "#111",
    borderColor: "#222",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 12,
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  rowTitle: { color: "#fff", fontWeight: "600" },
  rowSub: { color: "#999", fontSize: 12, marginTop: 2 },
  score: { color: "#7aa2ff", fontWeight: "700" },
  link: { color: "#7aa2ff", fontSize: 12 },
  err: { color: "#ff5a5a", padding: 16, textAlign: "center" },
});
