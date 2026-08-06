import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
// v0.1.1: use RN Linking (built-in) instead of expo-web-browser (native module,
// needs pod install + rebuild). Same UX: taps open the URL in Safari.
const WebBrowser = { openBrowserAsync: (url: string) => Linking.openURL(url) };
import {
  addToWatchlist,
  agentChat,
  fetchAnalysis,
  fetchChart,
  fetchQuote,
  generateMemo,
  listWatchlist,
  openInRobinhood,
  removeFromWatchlist,
  resolveComparable,
  saveMemoToWatchlist,
  secFilings,
} from "@/api/client";
import type { Comparable, EtfExposure, Source } from "@/api/types";
import { useSession } from "@/auth/session";
import { useSidebar } from "@/nav/SidebarContext";
import { openChatAbout } from "@/nav/chatAbout";
import { ChatAboutButton } from "@/components/ChatAboutButton";
import { SetAlertButton } from "@/components/SetAlertButton";
import { TickerNewsSection } from "@/components/TickerNewsSection";
import { ChartMedia } from "@/components/ChartMedia";
import { RichText } from "@/components/RichText";
import { ScreenFade } from "@/components/ScreenFade";
import { colors, elevation, radii, type } from "@/theme/tokens";
import { API_URL } from "@/util/env";
import { hapticSelect, hapticSuccess, hapticTap } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ResearchSheet } from "../ResearchSheet";

const CHART_CHIPS = [
  { id: "auction", label: "Auction" },
  { id: "performance", label: "Seasonality" },
  { id: "regression", label: "Regression" },
  { id: "ridge-growth", label: "Ridge" },
  { id: "flow-compass", label: "Flow" },
  { id: "torque", label: "Torque" },
] as const;

const PERIODS = ["1mo", "3mo", "1y", "2y"] as const;
type TabKey = "overview" | "advanced";

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
async function fetchOptionsLink(ticker: string, token?: string): Promise<OptionsLink> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/v1/options?ticker=${encodeURIComponent(ticker)}`, {
    method: "GET",
    headers,
  });
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
  const router = useRouter();
  const brand = decodeURIComponent(params.id ?? "");

  const q = useQuery({
    queryKey: ["resolve-comparable", brand],
    enabled: !!brand,
    queryFn: () => resolveComparable({ brand }, { token: session?.token }),
    staleTime: 5 * 60_000,
  });

  const urlTicker = /^[A-Z][A-Z0-9.]{0,5}$/.test(brand.toUpperCase())
    ? brand.toUpperCase()
    : undefined;
  // Prefer listed brand ticker, then typed URL symbol, then top comparable.
  // Never let a comparable steal charts for a typed ticker like MCD.
  const ticker = q.data?.brand.ticker?.symbol ?? urlTicker ?? q.data?.comparables?.[0]?.ticker;

  const [tab, setTab] = useState<TabKey>("overview");
  const [researchOpen, setResearchOpen] = useState(false);
  const [chartType, setChartType] = useState<(typeof CHART_CHIPS)[number]["id"]>("auction");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("1mo");

  // Overview always loads auction 1mo; Advanced loads selected chip/period.
  const activeType = tab === "overview" ? "auction" : chartType;
  const activePeriod = tab === "overview" ? "1mo" : period;

  const quoteQ = useQuery({
    queryKey: ["quote", ticker],
    enabled: !!ticker,
    queryFn: () => fetchQuote(ticker!, { token: session?.token }),
    staleTime: 60_000,
  });

  const chartQ = useQuery({
    queryKey: ["chart", ticker, activeType, activePeriod],
    enabled: !!ticker,
    queryFn: () => fetchChart(activeType, ticker!, activePeriod, { token: session?.token }),
    staleTime: 5 * 60_000,
  });

  const analysisQ = useQuery({
    queryKey: ["analysis", ticker],
    enabled: !!ticker,
    queryFn: () => fetchAnalysis(ticker!, { token: session?.token }),
    staleTime: 5 * 60_000,
  });

  const secQ = useQuery({
    queryKey: ["sec", ticker],
    enabled: !!ticker && tab === "advanced",
    queryFn: () => secFilings(ticker!, { token: session?.token }),
    staleTime: 30 * 60_000,
  });

  if (q.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.fg} />
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

  const quote = quoteQ.data?.quote;

  /**
   * Native OS share sheet — "Open in Messages / Mail / Notes / any app that
   * registers a share extension" (Claude, ChatGPT, etc. all show up here on
   * iOS the same way "Open in…" does for a photo). Mirrors the inbound path:
   * `apps/ios/app/share-intent.tsx` receives images shared *into* Mapvest;
   * this is the outbound half, sharing *out of* the detail sheet.
   */
  async function onShare() {
    hapticTap();
    const label = ticker ? `$${ticker}` : data!.brand.name;
    const priceLine = quote
      ? ` — $${quote.price.toFixed(2)} (${quote.change >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%)`
      : "";
    const deepLink = `mapvest://detail/${encodeURIComponent(ticker ?? data!.brand.name)}`;
    const message = `${data!.brand.name} (${label})${priceLine} — via Mapvest\n${deepLink}`;
    try {
      await Share.share(
        Platform.OS === "ios" ? { message, url: deepLink, title: data!.brand.name } : { message },
      );
    } catch {
      // User cancelled or the share sheet failed to open — nothing to surface.
    }
  }

  return (
    <ScreenFade>
      <ScrollView style={styles.root} contentContainerStyle={{ padding: 16, gap: 20 }}>
        <Stack.Screen
          options={{
            title: "Investable",
            // Hide iOS's native back chevron/pill so it can't stack behind
            // our own — that was the cause of the misalignment.
            headerBackVisible: false,
            // Center the headerLeft slot vertically within the header. Without
            // this the slot stretches full-height and the child pill sits at
            // the top of its container rather than the vertical middle.
            headerLeftContainerStyle: {
              paddingLeft: 12,
              alignItems: "center",
              justifyContent: "center",
            },
            headerLeft: () => (
              <Pressable
                onPress={() => router.replace("/(tabs)/home")}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Back to home"
                // Own the pill explicitly so its geometry is deterministic —
                // no reliance on native back-button chrome poking through.
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  gap: 2,
                  borderRadius: 999,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.border,
                  backgroundColor: colors.bgElevated,
                }}
              >
                <Ionicons name="chevron-back" size={18} color={colors.fg} />
                <Text
                  style={{
                    color: colors.fg,
                    fontSize: 15,
                    fontWeight: "700",
                    includeFontPadding: false,
                    // Nudges the text baseline to match the chevron's optical
                    // center on iOS. Without this the text reads 1px high.
                    lineHeight: 18,
                  }}
                >
                  Home
                </Text>
              </Pressable>
            ),
            headerRight: () => <DetailHeaderRight ticker={ticker} />,
            headerRightContainerStyle: {
              paddingRight: 12,
              alignItems: "center",
              justifyContent: "center",
            },
          }}
        />
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
          {quote ? (
            <View style={styles.quoteRow}>
              <Text style={styles.quotePrice}>${quote.price.toFixed(2)}</Text>
              <Text
                style={[
                  styles.quoteChange,
                  { color: quote.change >= 0 ? colors.accent : colors.danger },
                ]}
              >
                {quote.change >= 0 ? "+" : ""}
                {quote.change.toFixed(2)} ({quote.changePct.toFixed(2)}%)
              </Text>
            </View>
          ) : null}
          {/* Above-the-fold: Open in Robinhood + Set alert must not wait on
              agent overview. Both are pure user-actions with no LLM latency. */}
          {ticker && session?.token ? (
            <View style={[styles.badgeRow, { marginTop: 12 }]}>
              <RobinhoodOpenBadge ticker={ticker} token={session.token} />
              <SetAlertButton ticker={ticker} />
            </View>
          ) : null}
          <View style={styles.tabRow}>
            {(["overview", "advanced"] as TabKey[]).map((t) => (
              <Pressable
                key={t}
                onPress={() => {
                  hapticSelect();
                  setTab(t);
                }}
                style={[styles.tabBtn, tab === t && styles.tabBtnOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t }}
                accessibilityLabel={t === "overview" ? "Overview" : "Advanced"}
              >
                <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>
                  {t === "overview" ? "Overview" : "Advanced"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {tab === "overview" ? (
          <>
            {ticker ? <AgentOverviewBlock ticker={ticker} token={session?.token} /> : null}

            {ticker ? (
              <Section title={`Auction · $${ticker} · 1mo`}>
                <ChartImageBlock
                  q={chartQ}
                  ticker={ticker}
                  label="Auction"
                  showLevels
                  chartType="auction"
                  period="1mo"
                />
              </Section>
            ) : null}

            {ticker ? <TickerNewsSection ticker={ticker} token={session?.token} /> : null}

            {analysisQ.data ? <AnalysisSnapshotBlock data={analysisQ.data} /> : null}

            {ticker ? (
              <View style={{ gap: 10 }}>
                <Pressable
                  onPress={() => {
                    hapticTap();
                    setResearchOpen(true);
                  }}
                  style={({ pressed }) => [styles.researchBtn, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Research $${ticker}`}
                >
                  <LinearGradient
                    colors={colors.gradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.researchBtnGrad}
                  >
                    <Ionicons name="sparkles" size={18} color={colors.accentInk} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.researchBtnText}>Research…</Text>
                      <Text style={styles.researchBtnSub}>ask follow-ups · agent tools</Text>
                    </View>
                  </LinearGradient>
                </Pressable>
                <WatchlistActions
                  ticker={ticker}
                  name={data.brand.name}
                  sector={data.brand.sector}
                  token={session?.token}
                />
                <View style={styles.badgeRow}>
                  {publicTicker ? (
                    <OptionsBadge ticker={publicTicker} token={session?.token} />
                  ) : (
                    <UnderlyingBadge
                      brand={data.brand.name}
                      sector={data.brand.sector}
                      token={session?.token}
                    />
                  )}
                </View>
                <ResearchSheet
                  ticker={ticker}
                  visible={researchOpen}
                  onClose={() => setResearchOpen(false)}
                />
              </View>
            ) : null}

            <Section title="Comparables">
              {data.comparables.length === 0 ? (
                <Text style={styles.muted}>No public comparables resolved.</Text>
              ) : (
                data.comparables.map((c, i) => <ComparableRow key={`${c.ticker}-${i}`} c={c} />)
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
          </>
        ) : (
          <>
            {ticker ? (
              <ChartStrip
                q={chartQ}
                ticker={ticker}
                chartType={chartType}
                period={period}
                onType={setChartType}
                onPeriod={setPeriod}
              />
            ) : null}

            {analysisQ.data ? <AnalysisAdvancedBlock data={analysisQ.data} /> : null}

            {ticker ? (
              <Section title="SEC filings">
                {secQ.isLoading ? (
                  <ActivityIndicator color={colors.fg} />
                ) : secQ.isError ? (
                  <Text style={styles.muted}>SEC pack unavailable.</Text>
                ) : (secQ.data?.Citations?.length ?? 0) > 0 ? (
                  secQ.data!.Citations.slice(0, 8).map((c, i) => (
                    <Pressable
                      key={`${c.URL}-${i}`}
                      onPress={() => Linking.openURL(c.URL)}
                      style={styles.row}
                    >
                      {/* `flex: 1` wrapper is required — `styles.row` is
                          `flexDirection: "row"`, and without it a long
                          `Form · Label` line pushes right off the card. */}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.link}>
                          {c.Form} · {c.Label}
                        </Text>
                      </View>
                    </Pressable>
                  ))
                ) : (
                  <Text style={styles.muted}>No filings returned.</Text>
                )}
              </Section>
            ) : null}

            <Section title="Sources">
              <SourceList
                sources={dedupeSources([
                  ...data.comparables.flatMap((c) => c.sources),
                  ...data.etfs.map((e) => e.source),
                ])}
              />
            </Section>
          </>
        )}
      </ScrollView>
    </ScreenFade>
  );
}

/**
 * Detail screen header-right: sidebar burger + quick-save star. Lets the user
 * open the app menu from a Stack screen (tabs already carry the burger via
 * their layout) and toggle watchlist membership without scrolling to the
 * Save/Memo actions block further down the page.
 */
function DetailHeaderRight({ ticker }: { ticker: string }) {
  const { session } = useSession();
  const { openSidebar } = useSidebar();
  const router = useRouter();
  const qc = useQueryClient();
  const wlQ = useQuery({
    queryKey: ["watchlist", session?.token],
    queryFn: () => listWatchlist({ token: session!.token }),
    enabled: !!session?.token,
    staleTime: 15_000,
  });
  const saved = !!wlQ.data?.items?.some((e) => e.ticker.toUpperCase() === ticker.toUpperCase());
  const addM = useMutation({
    mutationFn: () =>
      addToWatchlist({ ticker, source: "detail" }, { token: session!.token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist", session?.token] }),
  });
  const rmM = useMutation({
    mutationFn: () => removeFromWatchlist(ticker, { token: session!.token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist", session?.token] }),
  });
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {ticker ? (
        <ChatAboutButton
          onPress={() => openChatAbout(router, { kind: "ticker", ticker })}
          accessibilityLabel={`Chat about $${ticker}`}
        />
      ) : null}
      {session?.token ? (
        <Pressable
          onPress={() => {
            hapticSelect();
            saved ? rmM.mutate() : addM.mutate();
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={saved ? `Remove ${ticker} from watchlist` : `Save ${ticker}`}
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name={saved ? "star" : "star-outline"}
            size={20}
            color={saved ? colors.accent : colors.fgMuted}
          />
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => {
          hapticSelect();
          openSidebar();
        }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Open menu"
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="menu-outline" size={22} color={colors.fg} />
      </Pressable>
    </View>
  );
}

/**
 * Renders "Open in Robinhood" on every public ticker page above the fold.
 * The button opens Robinhood's public stock page (no auth needed). If the
 * user has connected their Robinhood MCP under Settings, the /v1/robinhood
 * endpoint may return a personalized linkOut (e.g. pre-filled order intent);
 * that's a bonus, not a requirement. The button never gates on MCP state.
 * Mapvest does not submit broker orders — it only deep-links.
 */
function RobinhoodOpenBadge({ ticker, token }: { ticker: string; token: string }) {
  const rh = useQuery({
    queryKey: ["robinhood-open", ticker, token],
    queryFn: () => openInRobinhood(ticker, { token }),
    // Fire regardless of MCP state — the endpoint returns a plain deep-link
    // even without an MCP token; the token only enriches the response.
    enabled: !!ticker,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Always render the deep-link. Robinhood's stock page is a public URL that
  // requires no credentials to open — the MCP token gates richer features
  // (auto-populated order tickets) but must never gate the button itself.
  // If configured, prefer the API's linkOut in case it's been personalized.
  const url =
    rh.data?.linkOut ?? `https://robinhood.com/us/en/stocks/${encodeURIComponent(ticker)}/`;

  if (!ticker) return null;

  const onPress = async () => {
    // Prefer the Robinhood app over Safari. Two-step fallback:
    //   1) Try the custom scheme robinhood://stocks/<TICKER> — opens the app
    //      directly if installed. Requires "robinhood" in Info.plist's
    //      LSApplicationQueriesSchemes; without it canOpenURL returns false
    //      on iOS and we drop to step 2, which is still fine.
    //   2) Universal Link via Linking.openURL — iOS auto-routes to the
    //      installed Robinhood app; falls back to Safari if not installed.
    //      NOTE: never use WebBrowser.openBrowserAsync here — it forces the
    //      URL into SFSafariViewController and iOS never gets the chance to
    //      hand it off to the app.
    const appScheme = `robinhood://stocks/${encodeURIComponent(ticker)}`;
    try {
      const canOpenApp = await Linking.canOpenURL(appScheme).catch(() => false);
      if (canOpenApp) {
        await Linking.openURL(appScheme);
        return;
      }
    } catch {
      // fall through to Universal Link
    }
    Linking.openURL(url).catch(() => {});
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`Open ${ticker} in Robinhood`}
      style={({ pressed }) => [
        styles.badge,
        styles.robinhoodBadge,
        styles.robinhoodBadgeHero,
        pressed && styles.badgePressed,
      ]}
    >
      <Text style={[styles.badgeText, styles.robinhoodBadgeText]}>Open in Robinhood</Text>
      <Ionicons name="arrow-forward" size={13} color={colors.accent} />
    </Pressable>
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
      <Text style={styles.badgeText}>{opt.isLoading ? "Options …" : `Options ${ticker}`}</Text>
      {!opt.isLoading ? <Ionicons name="arrow-forward" size={12} color={colors.accent2} /> : null}
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
        {link.isLoading ? "Underlying analyzer …" : "Underlying analyzer"}
      </Text>
      {!link.isLoading ? <Ionicons name="arrow-forward" size={12} color={colors.accent2} /> : null}
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

function ChartImageBlock({
  q,
  ticker,
  label,
  showLevels,
  chartType,
  period,
}: {
  q: ReturnType<typeof useQuery>;
  ticker: string;
  label: string;
  showLevels?: boolean;
  chartType?: string;
  period?: string;
}) {
  const data = q.data as Awaited<ReturnType<typeof fetchChart>> | undefined;
  if (q.isLoading || q.isFetching) return <ActivityIndicator color={colors.fg} />;
  if (q.isError) return <Text style={styles.err}>{(q.error as Error).message}</Text>;
  if (!data?.image?.data) return <Text style={styles.muted}>No chart.</Text>;
  const typeSlug = chartType ?? data.type ?? label.toLowerCase().replace(/\s+/g, "-");
  const per = period ?? data.period ?? "1mo";
  const filename =
    data.image.filename ?? `${ticker}-${typeSlug}-${per}.png`.replace(/[^\w.-]+/g, "_");
  return (
    <View style={{ gap: 8 }}>
      <ChartMedia
        uri={`data:${data.image.mime};base64,${data.image.data}`}
        filename={filename}
        accessibilityLabel={`${ticker} ${label} chart`}
      />
      {showLevels && data.levels ? (
        <Text style={styles.muted}>
          POC {fmtLvl(data.levels.poc)} · VAH {fmtLvl(data.levels.vah)} · VAL{" "}
          {fmtLvl(data.levels.val)}
          {data.provider ? ` · ${data.provider}` : ""}
        </Text>
      ) : null}
    </View>
  );
}

function AgentOverviewBlock({
  ticker,
  token,
}: {
  ticker: string;
  token?: string;
}) {
  // Lazy-load: the agent brief costs 5–15s and was the single biggest blocker
  // on this screen. Now the page paints instantly and the user opts in via
  // the button below. If the query was cached from a previous visit (staleTime
  // 30min) we honor the cache and skip the button — feels the same as before.
  const qc = useQueryClient();
  const key = ["agent-overview", ticker, token ?? "anon"];
  const hasCache = !!qc.getQueryData(key);
  const [wantBrief, setWantBrief] = useState(hasCache);
  const overviewQ = useQuery({
    queryKey: key,
    enabled: !!ticker && wantBrief,
    staleTime: 30 * 60_000,
    retry: 1,
    queryFn: () =>
      agentChat(
        `Write a detailed investor overview of $${ticker} for the Investable sheet. Use Markdown with blank lines between sections. Required sections with ## headings: (1) What's the story now, (2) Business & moat, (3) Catalysts & risks, (4) Valuation & market context, (5) What to watch next. 450–750 words. Use short paragraphs and a few bullets under risks/catalysts. Cite tools/sources when used. Research-only; not advice; no trades.`,
        { ticker },
        { token },
      ),
  });

  if (!wantBrief) {
    return (
      <Section title={`Overview · $${ticker}`}>
        <Pressable
          onPress={() => {
            hapticSelect();
            setWantBrief(true);
          }}
          style={({ pressed }) => [styles.loadBriefBtn, pressed && { opacity: 0.75 }]}
          accessibilityRole="button"
          accessibilityLabel="Load full agent brief"
        >
          <Ionicons name="sparkles-outline" size={16} color={colors.accent} />
          <Text style={styles.loadBriefText}>Load full brief</Text>
          <Text style={styles.loadBriefSub}>~5–15s · fresh from the research agent</Text>
        </Pressable>
      </Section>
    );
  }

  return (
    <Section title={`Overview · $${ticker}`}>
      {overviewQ.isLoading || overviewQ.isFetching ? (
        <View style={{ gap: 8 }}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>Writing a longer agent brief…</Text>
        </View>
      ) : overviewQ.isError ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.errInline}>
            {(overviewQ.error as Error).message || "Overview failed"}
          </Text>
          <Pressable onPress={() => void overviewQ.refetch()} style={styles.miniBtn}>
            <Text style={styles.miniBtnText}>Retry overview</Text>
          </Pressable>
        </View>
      ) : (
        // `alignSelf: "stretch"` pins the block to the card's inner width so
        // long agent prose can't push its parent wider than the ScrollView
        // content column. Without it, RN can size a column-flex View to its
        // intrinsic content width and let a single long line spill right.
        <View style={{ gap: 10, alignSelf: "stretch", width: "100%" }}>
          <RichText text={overviewQ.data?.article.content ?? ""} />
          {(overviewQ.data?.article.interesting?.length ?? 0) > 0 ? (
            <View style={{ gap: 4, alignSelf: "stretch", width: "100%" }}>
              {overviewQ.data!.article.interesting.slice(0, 5).map((line) => (
                <Text key={line} style={[styles.muted, { flexShrink: 1 }]}>
                  · {line}
                </Text>
              ))}
            </View>
          ) : null}
          <Pressable onPress={() => void overviewQ.refetch()} style={styles.miniBtn}>
            <Text style={styles.miniBtnText}>Refresh overview</Text>
          </Pressable>
        </View>
      )}
    </Section>
  );
}

function ChartStrip({
  q,
  ticker,
  chartType,
  period,
  onType,
  onPeriod,
}: {
  q: ReturnType<typeof useQuery>;
  ticker: string;
  chartType: (typeof CHART_CHIPS)[number]["id"];
  period: (typeof PERIODS)[number];
  onType: (t: (typeof CHART_CHIPS)[number]["id"]) => void;
  onPeriod: (p: (typeof PERIODS)[number]) => void;
}) {
  const label = CHART_CHIPS.find((c) => c.id === chartType)?.label ?? chartType;
  return (
    <Section title={`${label} · $${ticker} · ${period}`}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {CHART_CHIPS.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => onType(c.id)}
              style={[styles.chip, chartType === c.id && styles.chipActive]}
            >
              <Text style={[styles.chipText, chartType === c.id && styles.chipTextActive]}>
                {c.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 8 }}>
        {PERIODS.map((p) => (
          <Pressable
            key={p}
            onPress={() => onPeriod(p)}
            style={[styles.periodBtn, period === p && styles.periodBtnActive]}
          >
            <Text style={[styles.periodText, period === p && styles.periodTextActive]}>{p}</Text>
          </Pressable>
        ))}
      </View>
      <ChartImageBlock
        q={q}
        ticker={ticker}
        label={label}
        showLevels={chartType === "auction"}
        chartType={chartType}
        period={period}
      />
    </Section>
  );
}

function AnalysisSnapshotBlock({
  data,
}: {
  data: Awaited<ReturnType<typeof fetchAnalysis>>;
}) {
  return (
    <Section title="At a glance">
      <Text style={[styles.muted, { flexShrink: 1 }]}>
        {[
          data.sector,
          data.industry,
          data.annualVolatility != null ? `vol ${(data.annualVolatility * 100).toFixed(1)}%` : null,
          data.fiftyTwoWeekLow != null || data.fiftyTwoWeekHigh != null
            ? `52w ${fmtLvl(data.fiftyTwoWeekLow)}–${fmtLvl(data.fiftyTwoWeekHigh)}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ") || "—"}
      </Text>
      {data.brief ? (
        <View style={{ marginTop: 10, alignSelf: "stretch", width: "100%" }}>
          <RichText text={data.brief} mutedStyle={styles.muted} />
        </View>
      ) : null}
    </Section>
  );
}

function AnalysisAdvancedBlock({
  data,
}: {
  data: Awaited<ReturnType<typeof fetchAnalysis>>;
}) {
  const rows: [string, string][] = [
    ["Sector", data.sector ?? "—"],
    ["Industry", data.industry ?? "—"],
    ["Price", data.price != null ? `$${data.price.toFixed(2)}` : "—"],
    [
      "Ann. vol",
      data.annualVolatility != null ? `${(data.annualVolatility * 100).toFixed(1)}%` : "—",
    ],
    ["52w low", fmtLvl(data.fiftyTwoWeekLow)],
    ["52w high", fmtLvl(data.fiftyTwoWeekHigh)],
    ["P/E", data.trailingPe != null ? String(data.trailingPe) : "—"],
    ["Mkt cap", data.marketCap != null ? String(data.marketCap) : "—"],
  ];
  return (
    <Section title="Financials">
      {rows.map(([k, v]) => (
        <View key={k} style={styles.finRow}>
          <Text style={styles.finKey}>{k}</Text>
          <Text style={styles.finVal}>{v}</Text>
        </View>
      ))}
      {data.brief ? <Text style={[styles.muted, { marginTop: 10 }]}>{data.brief}</Text> : null}
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
  if (sources.length === 0) return <Text style={styles.muted}>No sources cited.</Text>;
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
  const router = useRouter();
  const sym = ticker.trim().toUpperCase();
  const [memo, setMemo] = useState<{ provider: string; text: string } | null>(null);
  const [memoSaved, setMemoSaved] = useState(false);
  /** Optimistic override so ★ fills immediately on tap. */
  const [optimisticSaved, setOptimisticSaved] = useState<boolean | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);

  const wl = useQuery({
    queryKey: ["watchlist", token],
    queryFn: () => (token ? listWatchlist({ token }) : Promise.resolve({ items: [] })),
    enabled: !!token,
    staleTime: 30_000,
  });
  const serverSaved = wl.data?.items.some((e) => e.ticker.toUpperCase() === sym) ?? false;
  const isSaved = optimisticSaved ?? serverSaved;

  const saveM = useMutation({
    mutationFn: () =>
      addToWatchlist({ ticker: sym, name, sector, source: "detail" }, { token: token! }),
    onMutate: () => {
      setOptimisticSaved(true);
      setStatusLine("Saving…");
    },
    onSuccess: () => {
      hapticSuccess();
      setStatusLine("Saved to watchlist");
      void qc.invalidateQueries({ queryKey: ["watchlist", token] });
    },
    onError: (e) => {
      setOptimisticSaved(false);
      setStatusLine((e as Error).message || "Save failed");
    },
  });

  const removeM = useMutation({
    mutationFn: () => removeFromWatchlist(sym, { token: token! }),
    onMutate: () => {
      setOptimisticSaved(false);
      setStatusLine("Removing…");
    },
    onSuccess: () => {
      setStatusLine("Removed from watchlist");
      void qc.invalidateQueries({ queryKey: ["watchlist", token] });
    },
    onError: (e) => {
      setOptimisticSaved(true);
      setStatusLine((e as Error).message || "Remove failed");
    },
  });

  const memoM = useMutation({
    mutationFn: () => generateMemo(sym, { token }),
    onMutate: () => setStatusLine("Generating memo…"),
    onSuccess: (r) => {
      setMemo({ provider: r.provider, text: r.memo });
      setStatusLine("Memo ready");
    },
    onError: (e) => setStatusLine((e as Error).message || "Memo failed"),
  });

  const saveMemoM = useMutation({
    mutationFn: () => {
      if (!memo || !token) throw new Error("no memo / not signed in");
      return addToWatchlist({ ticker: sym, name, sector, source: "detail" }, { token }).then(() =>
        saveMemoToWatchlist(sym, memo.text, memo.provider, { token }),
      );
    },
    onMutate: () => {
      setOptimisticSaved(true);
      setStatusLine("Saving memo…");
    },
    onSuccess: () => {
      hapticSuccess();
      setMemoSaved(true);
      setStatusLine("Memo saved");
      void qc.invalidateQueries({ queryKey: ["watchlist", token] });
    },
    onError: (e) => setStatusLine((e as Error).message || "Memo save failed"),
  });

  const saving = saveM.isPending || removeM.isPending;

  if (!token) {
    return (
      <View style={{ gap: 8 }}>
        <Text style={styles.muted}>
          Sign in to save this ticker, generate memos, and open Research briefs.
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            onPress={() => router.push("/auth")}
            style={({ pressed }) => [
              styles.actionBtn,
              styles.actionBtnActive,
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
          >
            <Text style={[styles.actionBtnText, { color: colors.accentInk }]}>Sign in</Text>
          </Pressable>
          <Pressable
            onPress={() => memoM.mutate()}
            disabled={memoM.isPending}
            style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="Generate memo"
          >
            {memoM.isPending ? (
              <ActivityIndicator color={colors.fg} />
            ) : (
              <>
                <Ionicons name="document-text-outline" size={15} color={colors.fg} />
                <Text style={styles.actionBtnText}>Generate memo</Text>
              </>
            )}
          </Pressable>
        </View>
        {statusLine ? <Text style={styles.statusLine}>{statusLine}</Text> : null}
        {memo ? (
          <View style={styles.memoCard}>
            <Text style={styles.memoProvider}>{memo.provider}</Text>
            <Text style={styles.memoText}>{memo.text}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          onPress={() => {
            hapticTap();
            isSaved ? removeM.mutate() : saveM.mutate();
          }}
          disabled={saving}
          accessibilityRole="button"
          accessibilityState={{ selected: isSaved, busy: saving }}
          accessibilityLabel={isSaved ? `Remove ${sym} from watchlist` : `Save ${sym} to watchlist`}
          style={({ pressed }) => [
            styles.actionBtn,
            isSaved ? styles.actionBtnActive : null,
            saving && { opacity: 0.7 },
            pressed && { opacity: 0.7 },
          ]}
        >
          {saving ? (
            <ActivityIndicator color={isSaved ? colors.accentInk : colors.fg} />
          ) : (
            <>
              <Ionicons
                name={isSaved ? "star" : "star-outline"}
                size={15}
                color={isSaved ? colors.accentInk : colors.fg}
              />
              <Text style={[styles.actionBtnText, isSaved && { color: colors.accentInk }]}>
                {isSaved ? "Saved" : "Save"}
              </Text>
            </>
          )}
        </Pressable>
        <Pressable
          onPress={() => memoM.mutate()}
          disabled={memoM.isPending}
          style={({ pressed }) => [
            styles.actionBtn,
            memoM.isPending && { opacity: 0.7 },
            pressed && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={memo ? "Regenerate memo" : "Generate memo"}
        >
          {memoM.isPending ? (
            <ActivityIndicator color={colors.fg} />
          ) : (
            <>
              <Ionicons
                name={memo ? "refresh-outline" : "document-text-outline"}
                size={15}
                color={colors.fg}
              />
              <Text style={styles.actionBtnText}>{memo ? "Regenerate memo" : "Memo"}</Text>
            </>
          )}
        </Pressable>
      </View>

      {statusLine ? (
        <Text
          style={[
            styles.statusLine,
            (saveM.isError || removeM.isError || memoM.isError) && styles.err,
          ]}
        >
          {statusLine}
        </Text>
      ) : null}

      {memoM.isError ? <Text style={styles.err}>{(memoM.error as Error).message}</Text> : null}

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
            accessibilityRole="button"
            accessibilityLabel="Save memo to watchlist"
          >
            {!saveMemoM.isPending ? (
              <Ionicons
                name={memoSaved ? "checkmark-circle" : "bookmark-outline"}
                size={15}
                color={memoSaved ? colors.accentInk : colors.fg}
              />
            ) : null}
            <Text style={[styles.actionBtnText, memoSaved && { color: colors.accentInk }]}>
              {saveMemoM.isPending
                ? "Saving…"
                : memoSaved
                  ? "Memo saved"
                  : "Save memo to watchlist"}
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
  root: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  h1: { color: colors.fg, ...type.h1, fontSize: 28 },
  h2: { color: colors.fg, ...type.label, fontSize: 15 },
  sub: { color: colors.fgMuted, marginTop: 4 },
  muted: { color: colors.fgMuted, fontSize: 13 },
  card: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: 12,
    gap: 12,
    ...elevation.sm,
  },
  chartZoom: {
    width: "100%",
    height: 260,
    borderRadius: radii.md,
    backgroundColor: colors.bgSunken,
    overflow: "hidden",
  },
  chartZoomContent: { alignItems: "center", justifyContent: "center" },
  chartImg: {
    width: 360,
    height: 240,
    borderRadius: radii.md,
    backgroundColor: colors.bgSunken,
  },
  chartHint: { color: colors.fgDim, fontSize: 11 },
  overviewBody: { color: colors.fg, fontSize: 14, lineHeight: 21 },
  errInline: { color: colors.danger, fontSize: 13 },
  loadBriefBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  loadBriefText: { color: colors.accent, fontWeight: "700", fontSize: 14 },
  loadBriefSub: { color: colors.fgDim, fontSize: 11, marginLeft: "auto" },
  miniBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minHeight: 32,
  },
  miniBtnText: { color: colors.accent, fontSize: 12, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  rowTitle: { color: colors.fg, fontWeight: "600" },
  rowSub: { color: colors.fgMuted, fontSize: 12, marginTop: 2 },
  score: { color: colors.accent2, fontWeight: "700" },
  link: { color: colors.accent2, fontSize: 12 },
  err: { color: colors.danger, padding: 16, textAlign: "center" },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.accent2Muted,
    borderColor: colors.accent2,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: 6,
    paddingHorizontal: 12,
    minHeight: 32,
  },
  robinhoodBadge: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accent,
  },
  robinhoodBadgeHero: {
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  robinhoodBadgeText: {
    color: colors.accent,
    fontSize: 14,
  },
  badgeDisabled: { opacity: 0.5 },
  badgePressed: { opacity: 0.8 },
  badgeText: {
    color: colors.accent2,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flex: 1,
    minHeight: 44,
  },
  actionBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  actionBtnText: { color: colors.fg, fontSize: 14, fontWeight: "600" },
  statusLine: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  memoCard: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: 14,
    gap: 12,
  },
  memoProvider: {
    color: colors.accent,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  memoText: { color: colors.fg, fontSize: 14, lineHeight: 21 },
  chip: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
    minHeight: 32,
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.fg, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: colors.accentInk },
  periodBtn: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingVertical: 5,
    paddingHorizontal: 8,
    minHeight: 28,
    justifyContent: "center",
  },
  periodBtnActive: { borderColor: colors.accent },
  periodText: { color: colors.fgMuted, fontSize: 11 },
  periodTextActive: { color: colors.accent },
  quoteRow: { flexDirection: "row", alignItems: "baseline", gap: 10, marginTop: 8 },
  quotePrice: { color: colors.fg, ...type.h1, fontSize: 28 },
  quoteChange: { fontSize: 15, fontWeight: "600" },
  tabRow: { flexDirection: "row", gap: 8, marginTop: 14 },
  tabBtn: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
    minHeight: 32,
    justifyContent: "center",
  },
  tabBtnOn: { backgroundColor: colors.fg, borderColor: colors.fg },
  tabText: { color: colors.fgMuted, fontSize: 13, fontWeight: "600" },
  tabTextOn: { color: colors.bg },
  researchBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radii.lg,
    padding: 3,
    overflow: "hidden",
  },
  researchBtnGrad: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radii.lg - 3,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  researchBtnText: { color: colors.accentInk, fontSize: 15, fontWeight: "800" },
  researchBtnSub: { color: colors.accentInk, opacity: 0.85, fontSize: 12, fontWeight: "600" },
  finRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  finKey: { color: colors.fgMuted, fontSize: 13 },
  finVal: { color: colors.fg, fontSize: 13, fontWeight: "600" },
});
