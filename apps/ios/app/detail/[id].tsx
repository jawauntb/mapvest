import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
// v0.1.1: use RN Linking (built-in) instead of expo-web-browser (native module,
// needs pod install + rebuild). Same UX: taps open the URL in Safari.
const WebBrowser = { openBrowserAsync: (url: string) => Linking.openURL(url) };
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import {
  addToWatchlist,
  fetchAuctionChart,
  generateMemo,
  listWatchlist,
  removeFromWatchlist,
  resolveComparable,
  saveMemoToWatchlist,
} from "@/api/client";
import type { Comparable, EtfExposure, Source } from "@/api/types";
import { useSession } from "@/auth/session";
import { API_URL } from "@/util/env";

type OptionsLink = { ticker: string; linkOut: string; note: string };
type UnderlyingLink = {
  brand?: string;
  sector?: string;
  linkOut: string;
  note: string;
};

/**
 * v0.1 link-out fetcher. Kept inline here (not in `@/api/client`) because
 * this endpoint is a scaffold for v0.2 and hasn't earned a top-level client
 * helper yet. See docs/SYSTEM_DESIGN.md D10.
 */
async function fetchOptionsLink(
  ticker: string,
  token?: string,
): Promise<OptionsLink> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(
    `${API_URL}/v1/options?ticker=${encodeURIComponent(ticker)}`,
    { method: "GET", headers },
  );
  if (!res.ok) throw new Error(`options ${res.status}`);
  return (await res.json()) as OptionsLink;
}

/**
 * v0.1 link-out fetcher for the sibling `the-underlying-analyzer-reboot`
 * repo. Same shape/rationale as `fetchOptionsLink` — inline until v0.2
 * promotes it into `@/api/client`. See docs/SYSTEM_DESIGN.md D10.
 */
async function fetchUnderlyingLink(
  brand: string,
  sector: string | undefined,
  token?: string,
): Promise<UnderlyingLink> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const qs = new URLSearchParams({ brand });
  if (sector) qs.set("sector", sector);
  const res = await fetch(`${API_URL}/v1/underlying?${qs.toString()}`, {
    method: "GET",
    headers,
  });
  if (!res.ok) throw new Error(`underlying ${res.status}`);
  return (await res.json()) as UnderlyingLink;
}

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

  const ticker =
    q.data?.brand.ticker?.symbol ??
    q.data?.comparables?.[0]?.ticker ??
    (/^[A-Z][A-Z0-9.]{0,5}$/.test(brand.toUpperCase()) ? brand.toUpperCase() : undefined);

  const chartQ = useQuery({
    queryKey: ["auction-chart", ticker, "1m"],
    enabled: !!ticker,
    queryFn: () => fetchAuctionChart(ticker!, "1m", { token: session?.token }),
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

  const publicTicker = data.brand.ticker?.symbol;

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
        {publicTicker ? (
          <View style={styles.badgeRow}>
            <OptionsBadge ticker={publicTicker} token={session?.token} />
          </View>
        ) : (
          <View style={styles.badgeRow}>
            <UnderlyingBadge
              brand={data.brand.name}
              sector={data.brand.sector}
              token={session?.token}
            />
          </View>
        )}
      </View>

      {ticker ? <AuctionChartBlock q={chartQ} ticker={ticker} /> : null}

      {publicTicker ? (
        <WatchlistActions
          ticker={publicTicker}
          name={data.brand.name}
          sector={data.brand.sector}
          token={session?.token}
        />
      ) : null}

      <Section title="Comparables">
        {data.comparables.length === 0 ? (
          <Text style={styles.muted}>No public comparables resolved.</Text>
        ) : (
          data.comparables.map((c, i) => (
            <ComparableRow key={`${c.ticker}-${i}`} c={c} />
          ))
        )}
      </Section>

      <Section title="ETF exposure">
        {data.etfs.length === 0 ? (
          <Text style={styles.muted}>No ETFs matched.</Text>
        ) : (
          data.etfs.map((e, i) => <EtfRow key={`${e.ticker}-${i}`} e={e} />)
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

/**
 * v0.1 link-out to the sibling `option_derivation` repo. Hits
 * GET /v1/options?ticker=… which today returns a `linkOut` URL and a note;
 * v0.2 will proxy to the deployed sibling service. See
 * docs/SYSTEM_DESIGN.md D10 for the boundary decision.
 */
function OptionsBadge({ ticker, token }: { ticker: string; token?: string }) {
  const opt = useQuery({
    queryKey: ["options-link", ticker],
    queryFn: () => fetchOptionsLink(ticker, token),
    staleTime: 60 * 60_000,
  });

  const onPress = async () => {
    const url = opt.data?.linkOut;
    if (!url) return;
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      // Fallback to system browser if the in-app browser is unavailable.
      Linking.openURL(url).catch(() => {});
    }
  };

  const ready = !!opt.data?.linkOut;

  return (
    <Pressable
      onPress={onPress}
      disabled={!ready}
      accessibilityRole="link"
      accessibilityLabel={`Options for ${ticker}`}
      style={({ pressed }) => [
        styles.badge,
        !ready && styles.badgeDisabled,
        pressed && ready && styles.badgePressed,
      ]}
    >
      <Text style={styles.badgeText}>
        {opt.isLoading ? "Options …" : `Options ${ticker} →`}
      </Text>
    </Pressable>
  );
}

/**
 * v0.1 link-out to the sibling `the-underlying-analyzer-reboot` repo. Only
 * rendered when the investable is private (no ticker resolved). Hits
 * GET /v1/underlying?brand=…&sector=… which today returns `{ linkOut, note }`;
 * v0.2 will proxy to the deployed sibling. See docs/SYSTEM_DESIGN.md D10.
 */
function UnderlyingBadge({
  brand,
  sector,
  token,
}: {
  brand: string;
  sector?: string;
  token?: string;
}) {
  const link = useQuery({
    queryKey: ["underlying-link", brand, sector ?? ""],
    queryFn: () => fetchUnderlyingLink(brand, sector, token),
    staleTime: 60 * 60_000,
  });

  const onPress = async () => {
    const url = link.data?.linkOut;
    if (!url) return;
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      // Fallback to system browser if the in-app browser is unavailable.
      Linking.openURL(url).catch(() => {});
    }
  };

  const ready = !!link.data?.linkOut;

  return (
    <Pressable
      onPress={onPress}
      disabled={!ready}
      accessibilityRole="link"
      accessibilityLabel={`Underlying analyzer for ${brand}`}
      style={({ pressed }) => [
        styles.badge,
        !ready && styles.badgeDisabled,
        pressed && ready && styles.badgePressed,
      ]}
    >
      <Text style={styles.badgeText}>
        {link.isLoading ? "Underlying analyzer …" : "Underlying analyzer →"}
      </Text>
    </Pressable>
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

function AuctionChartBlock({
  q,
  ticker,
}: {
  q: ReturnType<typeof useQuery>;
  ticker: string;
}) {
  const data = q.data as Awaited<ReturnType<typeof fetchAuctionChart>> | undefined;
  return (
    <Section title={`Auction · $${ticker} · 1m`}>
      {q.isLoading ? (
        <ActivityIndicator color="#fff" />
      ) : q.isError ? (
        <Text style={styles.err}>{(q.error as Error).message}</Text>
      ) : data?.image?.data ? (
        <View style={{ gap: 8 }}>
          <Image
            source={{ uri: `data:${data.image.mime};base64,${data.image.data}` }}
            style={styles.chartImg}
            resizeMode="contain"
            accessibilityLabel={`${ticker} 1 month auction chart`}
          />
          {data.levels ? (
            <Text style={styles.muted}>
              POC {fmtLvl(data.levels.poc)} · VAH {fmtLvl(data.levels.vah)} · VAL{" "}
              {fmtLvl(data.levels.val)}
              {data.provider ? ` · ${data.provider}` : ""}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text style={styles.muted}>No chart.</Text>
      )}
    </Section>
  );
}

function fmtLvl(n?: number): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) : "—";
}

function ComparableRow({ c }: { c: Comparable }) {
  const router = useRouter();
  return (
    <Pressable
      style={styles.row}
      onPress={() => router.push(`/detail/${encodeURIComponent(c.ticker)}`)}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>
          ${c.ticker} · {c.name}
        </Text>
        <Text style={styles.rowSub}>{c.reasoning}</Text>
      </View>
      <Text style={styles.score}>{Math.round(c.score * 100)}%</Text>
    </Pressable>
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

/**
 * Save-to-watchlist + generate-memo actions. Sits under the ticker header on
 * the detail sheet whenever the brand resolved to a public ticker.
 */
function WatchlistActions({
  ticker,
  name,
  sector,
  token,
}: {
  ticker: string;
  name: string;
  sector?: string;
  token?: string;
}) {
  const qc = useQueryClient();
  const [memo, setMemo] = useState<{ provider: string; text: string } | null>(null);
  const [memoSaved, setMemoSaved] = useState(false);

  // Poll the watchlist to know if this ticker is already saved.
  const wl = useQuery({
    queryKey: ["watchlist", token],
    queryFn: () => (token ? listWatchlist({ token }) : Promise.resolve({ items: [] })),
    enabled: !!token,
    staleTime: 30_000,
  });
  const isSaved = wl.data?.items.some((e) => e.ticker === ticker) ?? false;

  const saveM = useMutation({
    mutationFn: () =>
      addToWatchlist(
        { ticker, name, sector, source: "detail" },
        { token: token! },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist", token] }),
  });

  const removeM = useMutation({
    mutationFn: () => removeFromWatchlist(ticker, { token: token! }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist", token] }),
  });

  const memoM = useMutation({
    mutationFn: () => generateMemo(ticker, { token }),
    onSuccess: (r) => setMemo({ provider: r.provider, text: r.memo }),
  });

  const saveMemoM = useMutation({
    mutationFn: () => {
      if (!memo || !token) throw new Error("no memo / not signed in");
      // Ensure the ticker is in the list first (add is idempotent server-side).
      return addToWatchlist(
        { ticker, name, sector, source: "detail" },
        { token },
      ).then(() =>
        saveMemoToWatchlist(ticker, memo.text, memo.provider, { token }),
      );
    },
    onSuccess: () => {
      setMemoSaved(true);
      qc.invalidateQueries({ queryKey: ["watchlist", token] });
    },
  });

  if (!token) return null;

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          onPress={() => (isSaved ? removeM.mutate() : saveM.mutate())}
          disabled={saveM.isPending || removeM.isPending}
          style={({ pressed }) => [
            styles.actionBtn,
            isSaved ? styles.actionBtnActive : null,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={[styles.actionBtnText, isSaved && { color: "#000" }]}>
            {saveM.isPending || removeM.isPending
              ? "…"
              : isSaved
                ? "★ Saved"
                : "☆ Save"}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => memoM.mutate()}
          disabled={memoM.isPending}
          style={({ pressed }) => [
            styles.actionBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={styles.actionBtnText}>
            {memoM.isPending ? "Generating…" : memo ? "↻ Regenerate memo" : "📝 Generate memo"}
          </Text>
        </Pressable>
      </View>

      {memoM.isError ? (
        <Text style={styles.err}>{(memoM.error as Error).message}</Text>
      ) : null}

      {memo ? (
        <View style={styles.memoCard}>
          <Text style={styles.memoProvider}>{memo.provider} · investment brief</Text>
          <Text style={styles.memoText}>{memo.text}</Text>
          <Pressable
            onPress={() => saveMemoM.mutate()}
            disabled={saveMemoM.isPending || memoSaved}
            style={({ pressed }) => [
              styles.actionBtn,
              memoSaved && styles.actionBtnActive,
              pressed && { opacity: 0.7 },
              { alignSelf: "flex-start" },
            ]}
          >
            <Text
              style={[styles.actionBtnText, memoSaved && { color: "#000" }]}
            >
              {saveMemoM.isPending
                ? "Saving…"
                : memoSaved
                  ? "✓ Memo saved"
                  : "💾 Save memo to watchlist"}
            </Text>
          </Pressable>
        </View>
      ) : null}
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
  chartImg: {
    width: "100%",
    height: 240,
    borderRadius: 8,
    backgroundColor: "#0a0a0a",
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  rowTitle: { color: "#fff", fontWeight: "600" },
  rowSub: { color: "#999", fontSize: 12, marginTop: 2 },
  score: { color: "#7aa2ff", fontWeight: "700" },
  link: { color: "#7aa2ff", fontSize: 12 },
  err: { color: "#ff5a5a", padding: 16, textAlign: "center" },
  badgeRow: { flexDirection: "row", marginTop: 12 },
  badge: {
    backgroundColor: "#1a2440",
    borderColor: "#2b3d6e",
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  badgeDisabled: { opacity: 0.5 },
  badgePressed: { backgroundColor: "#22305a" },
  badgeText: {
    color: "#7aa2ff",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  actionBtn: {
    backgroundColor: "#141414",
    borderColor: "#2a2a2a",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flex: 1,
    alignItems: "center",
  },
  actionBtnActive: {
    backgroundColor: "#3ee68a",
    borderColor: "#3ee68a",
  },
  actionBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  memoCard: {
    backgroundColor: "#0e0e0e",
    borderColor: "#222",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  memoProvider: {
    color: "#3ee68a",
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  memoText: { color: "#e6e6e6", fontSize: 14, lineHeight: 21 },
});
