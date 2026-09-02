/**
 * Prism — the full-stack memo dashboard for one ticker.
 *
 * Prism splits a ticker's price into macro, factor, regime, spectral, entropy,
 * fundamental, and filing components and recombines them into bull / neutral /
 * bear scenarios, a recommendation, entry and exit levels, and a memo you can
 * question. The engine lives in the sibling analyzer service; Mapvest proxies
 * it at `/v1/prism/*`.
 *
 * Three behaviours are load-bearing on this screen:
 *
 *   1. **The build is slow and the screen says so.** `POST /v1/prism` runs the
 *      whole engine (1–3 minutes). `usePrismPacket` shows staged progress and
 *      simultaneously polls `GET /v1/prism/:ticker` every five seconds, so a
 *      dropped request still ends with the packet on screen.
 *   2. **A null section is a rendered section.** Every card mounts whether or
 *      not the engine produced its data; when it did not, the card says
 *      "unavailable" and names the reason from the packet's own error ledger.
 *      Nothing here silently disappears and nothing renders a null as zero.
 *   3. **Sections mount lazily.** The page carries a dozen charts; they mount a
 *      viewport ahead of the reader and never unmount.
 *
 * The chat composer sits at the very bottom of ~18 cards, so the scroll view
 * needs the same two things every other input surface in this app has
 * (`app/(tabs)/research.tsx`, `app/ResearchSheet.tsx`, `app/(tabs)/settings.tsx`):
 * a `KeyboardAvoidingView` so the keyboard does not cover the input, and
 * `keyboardShouldPersistTaps="handled"` so the first tap on Send (or on a
 * suggestion chip) fires instead of being eaten dismissing the keyboard.
 */
import { type PrismPacket, normalizeTicker } from "@/api/prism";
import { useSession } from "@/auth/session";
import { presentPaywallIfQuota, usePaywall } from "@/billing/Paywall";
import { AppTopBar } from "@/components/AppTopBar";
import { ChartErrorBoundary } from "@/components/ChartErrorBoundary";
import { ScreenFade } from "@/components/ScreenFade";
import {
  EigenSection,
  EntropySection,
  FactorSection,
  FilingsSection,
  FundamentalsSection,
  HorizonSection,
  LazySection,
  LevelsSection,
  MacroSection,
  MemoSection,
  NewsSection,
  PrismBuildProgress,
  PrismChatSection,
  PrismEmptyState,
  PrismExportBar,
  PrismHero,
  RecentSection,
  RegimeSection,
  RelationalSection,
  ScenariosSection,
  ScrollReachContext,
  SeasonalitySection,
  SectionCard,
  SectionSkeleton,
  SpectralSection,
  VolatilitySection,
  usePrismPacket,
} from "@/prism";
import { colors, radii, space, type } from "@/theme/tokens";
import { hapticTap } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function PrismScreen() {
  const router = useRouter();
  const { session } = useSession();
  const token = session?.token;
  const { presentPaywall } = usePaywall();
  const params = useLocalSearchParams<{ ticker: string | string[] }>();
  const raw = Array.isArray(params.ticker) ? params.ticker[0] : params.ticker;
  const ticker = normalizeTicker(raw);

  const state = usePrismPacket(ticker, token);
  const { packet, status, building, stage, elapsedMs } = state;

  // A spent free-tier meter is a paywall, not an error message.
  useEffect(() => {
    if (state.buildErrorRaw) presentPaywallIfQuota(state.buildErrorRaw, presentPaywall);
  }, [state.buildErrorRaw, presentPaywall]);

  // Lazy-mount horizon: how far down the content the reader could possibly see.
  // Monotonic, so a mounted section stays mounted.
  const [reach, setReach] = useState(1400);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement } = e.nativeEvent;
    const next = contentOffset.y + layoutMeasurement.height * 1.5;
    setReach((prev) => (next > prev + 200 ? next : prev));
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ title: ticker ? `${ticker} Prism` : "Prism" }} />
      <AppTopBar
        title={ticker ? `Prism · ${ticker}` : "Prism"}
        brandTitle
        leading={
          <Pressable
            // Same rule as detail's HomeBackButton: keep the trail when there
            // is one, flatten to Home on a cold start or a deep link, never
            // leave the reader on a screen with a dead back button.
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
                return;
              }
              router.replace("/(tabs)/home");
            }}
            hitSlop={12}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={22} color={colors.fg} />
          </Pressable>
        }
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScreenFade>
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={64}
            onScroll={onScroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            refreshControl={
              <RefreshControl
                refreshing={state.refreshing}
                onRefresh={state.refresh}
                tintColor={colors.fgMuted}
              />
            }
          >
            {!ticker ? (
              <SectionCard
                title="No ticker in this link"
                subtitle="Open Prism from a company page to load its packet."
                unavailable="the route carried no symbol"
              />
            ) : (
              <ScrollReachContext.Provider value={reach}>
                <Text style={styles.lede}>
                  One ticker, split into its components — macro, factors, regime, cycles, entropy,
                  fundamentals, filings — and recombined into scenarios you can argue with.
                </Text>

                {packet ? <PrismHero packet={packet} /> : null}

                {building ? (
                  <PrismBuildProgress stage={stage} elapsedMs={elapsedMs} ticker={ticker} />
                ) : null}

                {!packet && !building && status === "missing" ? (
                  <PrismEmptyState
                    ticker={ticker}
                    onBuild={() => state.build()}
                    busy={false}
                    note={state.buildError}
                  />
                ) : null}

                {!packet && !building && status === "error" ? (
                  <SectionCard title="Prism is unavailable" unavailable={state.error ?? "unknown"}>
                    <Pressable
                      onPress={() => {
                        hapticTap();
                        state.refresh();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Try loading the packet again"
                      style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]}
                    >
                      <Text style={styles.retryText}>Try again</Text>
                    </Pressable>
                  </SectionCard>
                ) : null}

                {!packet && !building && status === "loading" ? (
                  <SectionSkeleton height={200} />
                ) : null}

                {packet ? (
                  <>
                    <PrismExportBar
                      ticker={ticker}
                      token={token}
                      onRebuild={() => state.build({ force: true })}
                      rebuilding={building}
                    />

                    {state.buildError ? <Text style={styles.error}>{state.buildError}</Text> : null}

                    <ChartErrorBoundary>
                      <MemoSection packet={packet} />
                    </ChartErrorBoundary>

                    <LazySection minHeight={280}>
                      <ChartErrorBoundary>
                        <HorizonSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={320}>
                      <ChartErrorBoundary>
                        <ScenariosSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={260}>
                      <ChartErrorBoundary>
                        <RegimeSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={280}>
                      <ChartErrorBoundary>
                        <SeasonalitySection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={260}>
                      <ChartErrorBoundary>
                        <RelationalSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={320}>
                      <ChartErrorBoundary>
                        <SpectralSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={260}>
                      <ChartErrorBoundary>
                        <EntropySection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={240}>
                      <ChartErrorBoundary>
                        <FactorSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={240}>
                      <ChartErrorBoundary>
                        <EigenSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={280}>
                      <ChartErrorBoundary>
                        <FundamentalsSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={240}>
                      <ChartErrorBoundary>
                        <MacroSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={240}>
                      <ChartErrorBoundary>
                        <VolatilitySection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={240}>
                      <ChartErrorBoundary>
                        <LevelsSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={220}>
                      <ChartErrorBoundary>
                        <RecentSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={280}>
                      <ChartErrorBoundary>
                        <FilingsSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={240}>
                      <ChartErrorBoundary>
                        <NewsSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={220}>
                      <PrismChatSection ticker={ticker} token={token} />
                    </LazySection>

                    <PacketLedger packet={packet} />
                  </>
                ) : null}
              </ScrollReachContext.Provider>
            )}

            <Text style={styles.footer}>
              Research only. Not investment advice. Prism never places orders.
            </Text>
          </ScrollView>
        </ScreenFade>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * The honesty ledger: which sources answered, what failed, and when this packet
 * was built. It is the last card on purpose — but it is always there, because a
 * packet with failed sections should never look like a complete one.
 */
function PacketLedger({ packet }: { packet: PrismPacket }) {
  const errors = packet.meta?.errors ?? [];
  const sources = packet.sources ?? [];
  const cache = packet.meta?.cache ?? {};
  return (
    <SectionCard
      eyebrow="Provenance"
      title="Sources and gaps"
      subtitle={`Engine ${packet.engine_version ?? "—"} · as of ${packet.as_of} · ${sources.length} source${sources.length === 1 ? "" : "s"}`}
    >
      {errors.length === 0 ? (
        <Text style={styles.note}>Every section computed. No sources failed on this run.</Text>
      ) : (
        <View style={{ gap: 4 }}>
          <Text style={styles.ledgerTitle}>
            {errors.length} section{errors.length === 1 ? "" : "s"} could not be computed
          </Text>
          {errors.map((entry, i) => (
            <Text key={`${entry.source}-${i}`} style={styles.ledgerRow}>
              · <Text style={styles.ledgerSource}>{entry.source}</Text> — {entry.error}
            </Text>
          ))}
        </View>
      )}
      {Object.keys(cache).length > 0 ? (
        <Text style={styles.note}>
          Cache:{" "}
          {Object.entries(cache)
            .map(([key, value]) => `${key} ${value}`)
            .join(" · ")}
        </Text>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  iconBtn: { padding: 4 },
  content: { padding: space.lg, gap: space.lg, paddingBottom: 64 },
  lede: { color: colors.fgMuted, fontSize: 13, lineHeight: 19 },
  note: { color: colors.fgMuted, fontSize: 12, lineHeight: 17 },
  error: { color: colors.danger, fontSize: 12.5, lineHeight: 18 },
  retry: {
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  retryText: { color: colors.fg, ...type.label },
  ledgerTitle: { color: colors.warn, fontSize: 12.5, fontWeight: "700" },
  ledgerRow: { color: colors.fgMuted, fontSize: 12, lineHeight: 18 },
  ledgerSource: { color: colors.fg, fontWeight: "700" },
  footer: {
    color: colors.fgMuted,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: space.sm,
  },
});
