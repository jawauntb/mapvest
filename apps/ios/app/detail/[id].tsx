import {
  addToWatchlist,
  agentChat,
  fetchAnalysis,
  fetchFinancialRatios,
  fetchQuote,
  generateMemo,
  listWatchlist,
  openInRobinhood,
  removeFromWatchlist,
  resolveComparable,
  saveMemoToWatchlist,
  secFilings,
} from "@/api/client";
import { coerceResolve, looksLikeTicker, routeParam } from "@/api/resolveFallback";
import type { Comparable, EtfExposure, ResolveComparableResponse, Source } from "@/api/types";
import { useSession } from "@/auth/session";
import { presentPaywallIfQuota, usePaywall } from "@/billing/Paywall";
import { ChartErrorBoundary } from "@/components/ChartErrorBoundary";
import { ChartsSection } from "@/components/ChartsSection";
import { OptionsChainSection } from "@/components/OptionsChainSection";
import { OrbitView } from "@/components/OrbitView";
import { RichText } from "@/components/RichText";
import { SetAlertButton } from "@/components/SetAlertButton";
import { TickerNewsSection } from "@/components/TickerNewsSection";
import { useSidebar } from "@/nav/SidebarContext";
import { openChatAbout } from "@/nav/chatAbout";
import { colors, elevation, radii, type } from "@/theme/tokens";
import { formatCompact, formatDecimal, formatMoney, formatPct } from "@/util/format";
import { hapticSelect, hapticSuccess, hapticTap } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
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

export default function DetailSheet() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const { session } = useSession();
  const brand = routeParam(params.id);

  const q = useQuery({
    queryKey: ["resolve-comparable", brand],
    enabled: !!brand,
    queryFn: () => resolveComparable({ brand }, { token: session?.token }),
    staleTime: 5 * 60_000,
  });

  const urlTicker = looksLikeTicker(brand);
  const data: ResolveComparableResponse = coerceResolve(q.data, brand, urlTicker);
  // Prefer listed brand ticker, then typed URL symbol, then top comparable.
  // Never let a comparable steal charts for a typed ticker like MCD.
  const ticker = data.brand.ticker?.symbol ?? urlTicker ?? data.comparables[0]?.ticker;
  // Brand-name opens still show the skeleton; ticker URLs paint immediately.
  const identityLoading = q.isLoading && !q.data && !urlTicker;

  const [researchOpen, setResearchOpen] = useState(false);
  /**
   * Stagger heavy blocks so the sheet paints immediately. Stage 0 = header /
   * comps shell; 1 = price chart + auction; 2 = news / agent / actions.
   * Timers used to fire during the loading spinner, then one commit mounted
   * charts + nested page sheets and killed TestFlight.
   */
  const [stage, setStage] = useState(0);
  useEffect(() => {
    setStage(0);
    if (!brand || identityLoading) return;
    const t1 = setTimeout(() => setStage(1), 80);
    const t2 = setTimeout(() => setStage(2), 280);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [brand, identityLoading]);

  const quoteQ = useQuery({
    queryKey: ["quote", ticker],
    enabled: !!ticker,
    queryFn: () => fetchQuote(ticker!, { token: session?.token }),
    staleTime: 60_000,
  });

  const analysisQ = useQuery({
    queryKey: ["analysis", ticker],
    enabled: !!ticker && stage >= 1,
    queryFn: () => fetchAnalysis(ticker!, { token: session?.token }),
    staleTime: 5 * 60_000,
  });

  const ratiosQ = useQuery({
    queryKey: ["financial-ratios", ticker],
    enabled: !!ticker && stage >= 1,
    queryFn: () => fetchFinancialRatios(ticker!, { token: session?.token }),
    staleTime: 30 * 60_000,
  });

  const secQ = useQuery({
    queryKey: ["sec", ticker],
    enabled: !!ticker && stage >= 2,
    queryFn: () => secFilings(ticker!, { token: session?.token }),
    staleTime: 30 * 60_000,
  });

  const publicTicker = data.brand.ticker?.symbol;
  const quote = quoteQ.data?.quote;
  const listedTicker = (publicTicker ?? urlTicker)?.toUpperCase();
  const isListed = Boolean((data.brand.isPublic && publicTicker) || (listedTicker && quote));
  const companyName = [quote?.name, analysisQ.data?.name, data.brand.name]
    .find((n) => !!n && n.trim().toUpperCase() !== listedTicker)
    ?.trim();
  const dedupedSources = dedupeSources([
    ...data.comparables.flatMap((c) => c.sources ?? []),
    ...data.etfs.map((e) => e.source).filter((s): s is Source => !!s),
  ]);

  /**
   * Native OS share sheet — "Open in Messages / Mail / Notes / any app that
   * registers a share extension" (Claude, ChatGPT, etc. all show up here on
   * iOS the same way "Open in…" does for a photo). Mirrors the inbound path:
   * `apps/ios/app/share-intent.tsx` receives images shared *into* Mapvest;
   * this is the outbound half, sharing *out of* the detail sheet.
   */
  async function onShare() {
    const label = ticker ? `$${ticker}` : data.brand.name;
    const priceLine = quote
      ? ` — $${fmtLvl(quote.price)} (${quote.change >= 0 ? "+" : ""}${fmtLvl(quote.changePct)}%)`
      : "";
    const deepLink = `mapvest://detail/${encodeURIComponent(ticker ?? data.brand.name)}`;
    const message = `${data.brand.name} (${label})${priceLine} — via Mapvest\n${deepLink}`;
    try {
      await Share.share(
        Platform.OS === "ios" ? { message, url: deepLink, title: data.brand.name } : { message },
      );
    } catch {
      // User cancelled or the share sheet failed to open — nothing to surface.
    }
  }

  // Keep the native header stable while the load sequence re-renders this
  // screen many times in quick succession (resolve → stage timers → quote).
  // Recreating headerLeft/headerRight closures on every render re-configures
  // RNSScreenStackHeaderConfig mid push-transition — native churn we can
  // avoid by memoizing on the ticker only. onShare reads live data via ref.
  const onShareRef = useRef(onShare);
  onShareRef.current = onShare;
  const screenOptions = useMemo(
    () => ({
      title: "Investable",
      // Hide iOS's native back chevron/pill so it can't stack behind
      // our own — that was the cause of the misalignment.
      headerBackVisible: false,
      headerLeft: () => <HomeBackButton />,
      headerRight: () => (
        <DetailHeaderRight ticker={ticker ?? ""} onShare={() => void onShareRef.current()} />
      ),
    }),
    [ticker],
  );

  return (
    <View style={styles.root}>
      <Stack.Screen options={screenOptions} />
      <ScrollView style={styles.root} contentContainerStyle={{ padding: 16, gap: 20 }}>
        {identityLoading ? (
          <>
            <View>
              <Text style={styles.h1}>{brand || "…"}</Text>
              <Text style={styles.sub}>Loading investable details…</Text>
            </View>
            <View style={styles.staggerSkeleton}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.muted}>Pulling ticker, comps, and sources</Text>
            </View>
            <View style={styles.staggerSkeleton}>
              <View style={styles.skelBar} />
              <View style={[styles.skelBar, { width: "70%" }]} />
              <View style={[styles.skelBar, { width: "55%" }]} />
            </View>
          </>
        ) : null}
        {q.isError ? (
          <View style={styles.staggerSkeleton}>
            <Text style={styles.errInline}>
              {(q.error as Error).message || "Could not refresh identity"}
            </Text>
            <Pressable onPress={() => void q.refetch()} style={styles.miniBtn}>
              <Text style={styles.miniBtnText}>Retry identity</Text>
            </Pressable>
          </View>
        ) : null}

        {!identityLoading ? (
          <>
            <View>
              <Text style={styles.h1}>{listedTicker ?? data.brand.name}</Text>
              {companyName ? <Text style={styles.sub}>{companyName}</Text> : null}
              <Text style={styles.sub}>
                {isListed
                  ? [data.brand.ticker?.exchange, data.brand.sector].filter(Boolean).join(" · ")
                  : ["Private", data.brand.sector].filter(Boolean).join(" · ")}
              </Text>
              {quote ? (
                <>
                  <View style={styles.quoteRow}>
                    <Text style={styles.quotePrice}>${fmtLvl(quote.price)}</Text>
                    <Text
                      style={[
                        styles.quoteChange,
                        {
                          color:
                            typeof quote.change === "number" && quote.change >= 0
                              ? colors.accent
                              : colors.danger,
                        },
                      ]}
                    >
                      {typeof quote.change === "number" && quote.change >= 0 ? "+" : ""}
                      {fmtLvl(quote.change)} ({fmtLvl(quote.changePct)}%)
                    </Text>
                  </View>
                  <Text style={styles.quoteDisclaimer}>
                    {quote.disclaimer || "Market-data freshness depends on subscription"}
                  </Text>
                </>
              ) : null}
            </View>

            {!isListed ? (
              <Section title="Comparables">
                {data.comparables.length === 0 ? (
                  <Text style={styles.muted}>No public comparables resolved.</Text>
                ) : (
                  data.comparables.map((c, i) => <ComparableRow key={`${c.ticker}-${i}`} c={c} />)
                )}
              </Section>
            ) : null}

            {stage >= 1 && ticker ? (
              <ChartErrorBoundary>
                <ChartsSection ticker={ticker} token={session?.token} />
              </ChartErrorBoundary>
            ) : null}

            {/* The brief and the news feed are the reason people open this
                sheet, so they sit right under the chart. The brief stays
                opt-in — it spends metered quota — and both keep their stage-2
                mount so the sheet still paints before they exist. */}
            {stage >= 2 && ticker ? (
              <AgentOverviewBlock ticker={ticker} token={session?.token} />
            ) : null}

            {stage >= 2 && ticker ? (
              <TickerNewsSection ticker={ticker} token={session?.token} />
            ) : null}

            {stage >= 2 && ticker ? (
              <View style={{ gap: 10 }}>
                <WatchlistActions
                  ticker={ticker}
                  name={companyName ?? listedTicker ?? data.brand.name}
                  sector={data.brand.sector}
                  token={session?.token}
                />
                <Pressable
                  onPress={() => {
                    hapticTap();
                    setResearchOpen(true);
                  }}
                  style={({ pressed }) => [styles.researchBtn, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Research ${ticker}`}
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
                {session?.token ? (
                  <View style={styles.badgeRow}>
                    <RobinhoodOpenBadge ticker={ticker} token={session.token} />
                    <SetAlertButton ticker={ticker} />
                  </View>
                ) : null}
                {researchOpen ? (
                  <ResearchSheet
                    ticker={ticker}
                    visible={researchOpen}
                    onClose={() => setResearchOpen(false)}
                  />
                ) : null}
              </View>
            ) : null}

            {ticker ? (
              <FinancialRatiosSection
                data={analysisQ.data}
                isError={analysisQ.isError}
                isLoading={analysisQ.isLoading}
              />
            ) : null}

            {ticker ? (
              <MassiveRatiosSection
                data={ratiosQ.data}
                isError={ratiosQ.isError}
                isLoading={ratiosQ.isLoading}
              />
            ) : null}

            {stage >= 2 && ticker ? (
              /* Collapsed by default like the ratio panels — and because
                 CollapsibleSection unmounts its children, the two options
                 fetches don't fire until someone actually opens it. */
              <CollapsibleSection title="Options · Massive">
                <OptionsChainSection
                  ticker={ticker}
                  token={session?.token}
                  underlyingPrice={quote?.price}
                />
              </CollapsibleSection>
            ) : null}

            {isListed && data.comparables.length > 0 ? (
              <Section title="Comparables">
                {data.comparables.map((c, i) => (
                  <ComparableRow key={`${c.ticker}-${i}`} c={c} />
                ))}
              </Section>
            ) : null}

            {!isListed || data.etfs.length > 0 ? (
              <Section title="ETF exposure">
                {data.etfs.length === 0 ? (
                  <Text style={styles.muted}>No ETFs matched.</Text>
                ) : (
                  data.etfs.map((e, i) => <EtfRow key={`${e.ticker}-${i}`} e={e} />)
                )}
              </Section>
            ) : null}

            {stage >= 2 && ticker ? (
              <ValueChainSection ticker={ticker} name={companyName} token={session?.token} />
            ) : null}

            {ticker ? (
              <CollapsibleSection title="SEC filings">
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
              </CollapsibleSection>
            ) : null}

            {dedupedSources.length > 0 ? (
              <CollapsibleSection title={`Sources · ${dedupedSources.length}`}>
                <SourceList sources={dedupedSources} />
              </CollapsibleSection>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function HomeBackButton() {
  const router = useRouter();
  // Only flatten to Home when there is nothing to go back to (deep link, share
  // extension, cold start). With history, going back keeps the trail the user
  // built — detail → comparable → detail no longer collapses to the tab root.
  const onPress = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/home");
  };
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Back"
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
        marginLeft: 4,
      }}
    >
      <Ionicons name="chevron-back" size={18} color={colors.fg} />
      <Text
        style={{
          color: colors.fg,
          fontSize: 15,
          fontWeight: "700",
          includeFontPadding: false,
          lineHeight: 18,
        }}
      >
        Home
      </Text>
    </Pressable>
  );
}

/**
 * Detail screen header-right: sidebar burger + quick-save star. Lets the user
 * open the app menu from a Stack screen (tabs already carry the burger via
 * their layout) and toggle watchlist membership without scrolling to the
 * Save/Memo actions block further down the page.
 */
function DetailHeaderRight({ ticker, onShare }: { ticker: string; onShare?: () => void }) {
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
  const saved = !!wlQ.data?.items?.some((e) => e.ticker?.toUpperCase() === ticker.toUpperCase());
  const addM = useMutation({
    mutationFn: () => addToWatchlist({ ticker, source: "detail" }, { token: session!.token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist", session?.token] }),
  });
  const rmM = useMutation({
    mutationFn: () => removeFromWatchlist(ticker, { token: session!.token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist", session?.token] }),
  });
  const headerIcon = {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {onShare ? (
        <Pressable
          onPress={() => {
            hapticSelect();
            onShare();
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={ticker ? `Share $${ticker}` : "Share this investable"}
          style={headerIcon}
        >
          <Ionicons name="share-outline" size={18} color={colors.accent} />
        </Pressable>
      ) : null}
      {ticker ? (
        <Pressable
          onPress={() => {
            hapticSelect();
            openChatAbout(router, { kind: "ticker", ticker });
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Chat about $${ticker}`}
          style={headerIcon}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.accent} />
        </Pressable>
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
        <Ionicons name="menu-outline" size={24} color={colors.fg} />
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.h2}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

/**
 * Section variant that folds its card away. Collapsed content is unmounted so
 * heavy children (base64 chart PNGs, filing rows) never render while hidden —
 * the react-query hooks stay in the parent, only the JSX collapses.
 */
function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  // Track only explicit taps so the default can settle async — e.g. Analytics
  // pops open once a typed ticker's quote proves the name is listed.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? defaultOpen;
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        onPress={() => {
          hapticSelect();
          setToggled(!open);
        }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.collapseHeader, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.h2}>{title}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.fgMuted} />
      </Pressable>
      {open ? <View style={styles.card}>{children}</View> : null}
    </View>
  );
}

/**
 * Value chain (Universe Roadmap §3 C2) — the company's suppliers, buyers,
 * competitors and complements as a compact orbit, with a link to the
 * full-screen version at app/orbit/[ticker].tsx.
 *
 * Collapsed by default on purpose: `CollapsibleSection` unmounts its children,
 * so `/v1/graph` (a metered endpoint — a cache miss spends provider money) is
 * only ever called once the user opens the section. Loading / 404 / empty all
 * degrade to a one-line muted state inside `OrbitView`, so this section can
 * never block the rest of the sheet.
 */
function ValueChainSection({
  ticker,
  name,
  token,
}: {
  ticker: string;
  name?: string;
  token?: string;
}) {
  const router = useRouter();
  return (
    <CollapsibleSection title="Value chain">
      <OrbitView ticker={ticker} name={name} token={token} variant="compact" />
      <Pressable
        onPress={() => {
          hapticSelect();
          const q = name ? `?name=${encodeURIComponent(name)}` : "";
          router.push(`/orbit/${encodeURIComponent(ticker)}${q}`);
        }}
        style={({ pressed }) => [styles.miniBtn, pressed && styles.badgePressed]}
        accessibilityRole="button"
        accessibilityLabel={`Open the full orbit for ${ticker}`}
      >
        <Text style={styles.miniBtnText}>Open orbit</Text>
        <Ionicons name="arrow-forward" size={13} color={colors.accent} />
      </Pressable>
    </CollapsibleSection>
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
      <Section title="Full brief">
        <Pressable
          onPress={() => {
            hapticSelect();
            setWantBrief(true);
          }}
          style={({ pressed }) => [styles.loadBriefBtn, pressed && { opacity: 0.75 }]}
          accessibilityRole="button"
          accessibilityLabel="Load full agent brief"
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.loadBriefText}>Load full brief</Text>
            <Text style={styles.loadBriefSub}>~5–15s · fresh from the research agent</Text>
          </View>
          <Ionicons name="sparkles-outline" size={16} color={colors.accent} />
        </Pressable>
      </Section>
    );
  }

  return (
    <Section title="Full brief">
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
          <RichText text={overviewQ.data?.article?.content ?? ""} />
          {(overviewQ.data?.article?.interesting?.length ?? 0) > 0 ? (
            <View style={{ gap: 4, alignSelf: "stretch", width: "100%" }}>
              {(overviewQ.data?.article?.interesting ?? []).slice(0, 5).map((line) => (
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

function FinancialRatiosSection({
  data,
  isError,
  isLoading,
}: {
  data?: Awaited<ReturnType<typeof fetchAnalysis>>;
  isError: boolean;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <CollapsibleSection title="Financial ratios">
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>Loading ratios…</Text>
        </View>
      </CollapsibleSection>
    );
  }
  if (isError) {
    return (
      <CollapsibleSection title="Financial ratios">
        <Text style={styles.muted}>Financial ratios unavailable right now.</Text>
      </CollapsibleSection>
    );
  }
  if (!data) return null;

  const rows: [string, string][] = [
    ["P/E", fmtLoose(data.trailingPe, (n) => formatDecimal(n))],
    ["Mkt cap", fmtLoose(data.marketCap, formatCompact)],
    ["Price", formatMoney(data.price)],
    ["Ann. vol", formatPct(data.annualVolatility)],
    ["52w low", fmtLvl(data.fiftyTwoWeekLow)],
    ["52w high", fmtLvl(data.fiftyTwoWeekHigh)],
  ];
  const hasRatio = rows.some(([, value]) => value !== "—");
  if (!hasRatio) {
    return (
      <CollapsibleSection title="Financial ratios">
        <Text style={styles.muted}>No financial ratios were reported for this ticker.</Text>
      </CollapsibleSection>
    );
  }

  return (
    <CollapsibleSection title="Financial ratios">
      <View style={styles.ratioGrid}>
        {rows.map(([label, value]) => (
          <View key={label} style={styles.ratioCard}>
            <Text style={styles.ratioLabel}>{label}</Text>
            <Text style={styles.ratioValue}>{value}</Text>
          </View>
        ))}
      </View>
      {data.brief ? <Text style={[styles.muted, { marginTop: 10 }]}>{data.brief}</Text> : null}
    </CollapsibleSection>
  );
}

function MassiveRatiosSection({
  data,
  isError,
  isLoading,
}: {
  data?: Awaited<ReturnType<typeof fetchFinancialRatios>>;
  isError: boolean;
  isLoading: boolean;
}) {
  const ratio = data?.ratios[0];
  return (
    <CollapsibleSection title="Massive financial ratios">
      {isLoading ? <Text style={styles.muted}>Loading end-of-day ratios…</Text> : null}
      {!isLoading && isError ? (
        <Text style={styles.muted}>Ratios unavailable right now.</Text>
      ) : null}
      {!isLoading && !isError && !ratio ? (
        <Text style={styles.muted}>No ratios reported for this ticker.</Text>
      ) : null}
      {ratio ? (
        <View style={styles.ratioGrid}>
          {[
            ["P/E", formatDecimal(ratio.priceToEarnings)],
            ["P/B", formatDecimal(ratio.priceToBook)],
            ["P/S", formatDecimal(ratio.priceToSales)],
            ["Div. yield", formatPct(ratio.dividendYield)],
            ["ROE", formatPct(ratio.returnOnEquity)],
            ["ROA", formatPct(ratio.returnOnAssets)],
            ["D/E", formatDecimal(ratio.debtToEquity)],
            ["As of", ratio.date ?? "—"],
          ].map(([label, value]) => (
            <View key={label} style={styles.ratioCard}>
              <Text style={styles.ratioLabel}>{label}</Text>
              <Text style={styles.ratioValue}>{value}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </CollapsibleSection>
  );
}

/**
 * `/v1/analysis` forwards provider fields as-is, so `marketCap` / `trailingPe`
 * arrive as a number *or* a numeric string ("3410000000000"). Numeric strings
 * are formatted like numbers; a provider's own display string ("3.41T", "N/A")
 * passes through untouched rather than becoming "NaN".
 */
function fmtLoose(value: string | number | undefined, format: (n: number) => string): string {
  if (typeof value === "number") return Number.isFinite(value) ? format(value) : "—";
  const raw = value?.trim();
  if (!raw) return "—";
  const parsed = Number(raw.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? format(parsed) : raw;
}

/**
 * Bare 2dp level — no currency symbol, because these call sites supply their own
 * ("$" in the quote header, a trailing "%" for `changePct`, which arrives as a
 * percentage number rather than a fraction). Rounding lives in `@/util/format`.
 */
function fmtLvl(n?: number): string {
  return formatDecimal(n);
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
          {c.ticker} · {c.name}
        </Text>
        <Text style={styles.rowSub}>{c.reasoning}</Text>
      </View>
      {/* A missing score reads as 0% here rather than "—": the row is a match
          confidence, and a blank would look like a broken cell. */}
      <Text style={styles.score}>
        {formatPct(Number.isFinite(c.score) ? c.score : 0, { dp: 0 })}
      </Text>
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
      <Text style={styles.score}>{formatPct(e.weight, { dp: 2 })}</Text>
    </View>
  );
}

function SourceList({ sources }: { sources: Source[] }) {
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
  const { presentPaywall } = usePaywall();
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
  const entry = wl.data?.items?.find((e) => e.ticker?.toUpperCase() === sym);
  const serverSaved = !!entry;
  const isSaved = optimisticSaved ?? serverSaved;
  // A memo persisted on the watchlist entry hydrates the card until a fresh
  // one is generated this session — it's already saved, so offer regenerate.
  const savedMemo = entry?.memo ? { provider: entry.memoProvider ?? "", text: entry.memo } : null;
  const displayMemo = memo ?? savedMemo;
  const displayMemoSaved = memo ? memoSaved : !!savedMemo;

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
      setMemoSaved(false);
      setStatusLine("Memo ready");
    },
    onError: (e) => {
      if (presentPaywallIfQuota(e, presentPaywall)) {
        setStatusLine("Free generations used. Subscribe to keep generating memos.");
        return;
      }
      setStatusLine((e as Error).message || "Memo failed");
    },
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
            <Text style={styles.memoProvider}>Mapvest research</Text>
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
          accessibilityLabel={displayMemo ? "Regenerate memo" : "Generate memo"}
        >
          {memoM.isPending ? (
            <ActivityIndicator color={colors.fg} />
          ) : (
            <>
              <Ionicons
                name={displayMemo ? "refresh-outline" : "document-text-outline"}
                size={15}
                color={colors.fg}
              />
              <Text style={styles.actionBtnText}>{displayMemo ? "Regenerate memo" : "Memo"}</Text>
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

      {displayMemo ? (
        <View style={styles.memoCard}>
          <Text style={styles.memoProvider}>Research brief</Text>
          <Text style={styles.memoText}>{displayMemo.text}</Text>
          <Pressable
            onPress={() => saveMemoM.mutate()}
            disabled={saveMemoM.isPending || displayMemoSaved}
            style={({ pressed }) => [
              styles.actionBtn,
              displayMemoSaved && styles.actionBtnActive,
              pressed && { opacity: 0.7 },
              { alignSelf: "flex-start" },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Save memo to watchlist"
          >
            {!saveMemoM.isPending ? (
              <Ionicons
                name={displayMemoSaved ? "checkmark-circle" : "bookmark-outline"}
                size={15}
                color={displayMemoSaved ? colors.accentInk : colors.fg}
              />
            ) : null}
            <Text style={[styles.actionBtnText, displayMemoSaved && { color: colors.accentInk }]}>
              {saveMemoM.isPending
                ? "Saving…"
                : displayMemoSaved
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
  staggerSkeleton: {
    gap: 10,
    padding: 16,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    alignItems: "flex-start",
  },
  skelBar: {
    height: 12,
    width: "88%",
    borderRadius: 6,
    backgroundColor: colors.bgSunken,
  },
  h1: { color: colors.fg, ...type.h1, fontSize: 28 },
  h2: { color: colors.fg, ...type.label, fontSize: 15 },
  sub: { color: colors.fgMuted, marginTop: 4 },
  muted: { color: colors.fgMuted, fontSize: 13 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  card: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: 12,
    gap: 12,
    ...elevation.sm,
  },
  collapseHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  overviewBody: { color: colors.fg, fontSize: 14, lineHeight: 21 },
  errInline: { color: colors.danger, fontSize: 13 },
  loadBriefBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  loadBriefText: { color: colors.accent, fontWeight: "700", fontSize: 14 },
  loadBriefSub: { color: colors.fgDim, fontSize: 11, flexShrink: 1 },
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
  quoteRow: { flexDirection: "row", alignItems: "baseline", gap: 10, marginTop: 8 },
  quotePrice: { color: colors.fg, ...type.h1, fontSize: 28 },
  quoteChange: { fontSize: 15, fontWeight: "600" },
  quoteDisclaimer: { color: colors.fgDim, fontSize: 11, marginTop: 4 },
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
  ratioGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  ratioCard: {
    minWidth: "30%",
    flexGrow: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 9,
    backgroundColor: colors.bgElevated,
  },
  ratioLabel: { color: colors.fgDim, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  ratioValue: { color: colors.fg, fontSize: 14, fontWeight: "700", marginTop: 3 },
});
