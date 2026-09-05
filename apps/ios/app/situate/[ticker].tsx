/**
 * Situate — the single-name research dashboard for one ticker.
 *
 * Situate frames a stock rather than forecasting its price: what you're exposed
 * to (factor + macro betas), the odds per horizon (empirical base rates beside
 * the options-implied distribution), what the options are pricing, and what the
 * business is saying — recombined into a *posture* (odds favorable / balanced /
 * odds unfavorable), cheap/rich zones, and a memo you can question. The engine
 * lives in the sibling analyzer service; Mapvest proxies it at `/v1/situate/*`.
 *
 * Three behaviours are load-bearing on this screen, all inherited from the
 * Prism sibling:
 *   1. The build is slow and the screen says so — `POST /v1/situate` runs the
 *      whole engine (1–3 minutes). `useSituatePacket` shows staged progress and
 *      polls `GET /v1/situate/:ticker` every five seconds.
 *   2. A null section is a rendered section — every card mounts and says
 *      "unavailable: <reason>" when the engine had nothing. Nothing renders a
 *      null as zero.
 *   3. Sections mount lazily a viewport ahead of the reader and never unmount.
 */
import { type SituatePacket, normalizeTicker } from "@/api/situate";
import { useSession } from "@/auth/session";
import { presentPaywallIfQuota, usePaywall } from "@/billing/Paywall";
import { AppTopBar } from "@/components/AppTopBar";
import { ChartErrorBoundary } from "@/components/ChartErrorBoundary";
import { ScreenFade } from "@/components/ScreenFade";
import {
  BusinessSection,
  ConfidenceSection,
  ExposureSection,
  LazySection,
  MemoSection,
  OddsSection,
  PostureHero,
  PricedInSection,
  ScenariosSection,
  ScrollReachContext,
  SectionCard,
  SectionSkeleton,
  SituateBuildProgress,
  SituateChatSection,
  SituateEmptyState,
  SituateExportBar,
  StateSection,
  ZonesSection,
  useSituatePacket,
} from "@/situate";
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

export default function SituateScreen() {
  const router = useRouter();
  const { session } = useSession();
  const token = session?.token;
  const { presentPaywall } = usePaywall();
  const params = useLocalSearchParams<{ ticker: string | string[] }>();
  const raw = Array.isArray(params.ticker) ? params.ticker[0] : params.ticker;
  const ticker = normalizeTicker(raw);

  const state = useSituatePacket(ticker, token);
  const { packet, status, building, stage, elapsedMs } = state;

  // A spent free-tier meter is a paywall, not an error message.
  useEffect(() => {
    if (state.buildErrorRaw) presentPaywallIfQuota(state.buildErrorRaw, presentPaywall);
  }, [state.buildErrorRaw, presentPaywall]);

  const [reach, setReach] = useState(1400);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement } = e.nativeEvent;
    const next = contentOffset.y + layoutMeasurement.height * 1.5;
    setReach((prev) => (next > prev + 200 ? next : prev));
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ title: ticker ? `${ticker} Situate` : "Situate" }} />
      <AppTopBar
        title={ticker ? `Situate · ${ticker}` : "Situate"}
        brandTitle
        leading={
          <Pressable
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
                subtitle="Open Situate from a company page to load its packet."
                unavailable="the route carried no symbol"
              />
            ) : (
              <ScrollReachContext.Provider value={reach}>
                <Text style={styles.lede}>
                  One ticker, situated — what you're exposed to, the odds per horizon (base rates
                  beside the options-implied distribution), and what the business is saying. A
                  posture on the odds, not a price call.
                </Text>

                {packet ? <PostureHero packet={packet} /> : null}

                {building ? (
                  <SituateBuildProgress stage={stage} elapsedMs={elapsedMs} ticker={ticker} />
                ) : null}

                {!packet && !building && status === "missing" ? (
                  <SituateEmptyState
                    ticker={ticker}
                    onBuild={() => state.build()}
                    busy={false}
                    note={state.buildError}
                  />
                ) : null}

                {!packet && !building && status === "error" ? (
                  <SectionCard
                    title="Situate is unavailable"
                    unavailable={state.error ?? "unknown"}
                  >
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
                    <SituateExportBar
                      ticker={ticker}
                      token={token}
                      onRebuild={() => state.build({ force: true })}
                      rebuilding={building}
                    />

                    {state.buildError ? <Text style={styles.error}>{state.buildError}</Text> : null}

                    <ChartErrorBoundary>
                      <MemoSection packet={packet} />
                    </ChartErrorBoundary>

                    {/* SPEC §3(3): explain exposure (and state) before the odds/opinion. */}
                    <LazySection minHeight={280}>
                      <ChartErrorBoundary>
                        <ExposureSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={280}>
                      <ChartErrorBoundary>
                        <StateSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={320}>
                      <ChartErrorBoundary>
                        <OddsSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={260}>
                      <ChartErrorBoundary>
                        <PricedInSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={300}>
                      <ChartErrorBoundary>
                        <BusinessSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={280}>
                      <ChartErrorBoundary>
                        <ZonesSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={260}>
                      <ChartErrorBoundary>
                        <ScenariosSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={240}>
                      <ChartErrorBoundary>
                        <ConfidenceSection packet={packet} />
                      </ChartErrorBoundary>
                    </LazySection>

                    <LazySection minHeight={220}>
                      <SituateChatSection ticker={ticker} token={token} />
                    </LazySection>

                    <PacketLedger packet={packet} />
                  </>
                ) : null}
              </ScrollReachContext.Provider>
            )}

            <Text style={styles.footer}>
              Research only. Not investment advice. Situate never places orders, never says buy or
              sell, and never prints a point price target.
            </Text>
          </ScrollView>
        </ScreenFade>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * The honesty ledger: which sources answered, what failed, and when this packet
 * was built. Always present, so a packet with failed sections never looks like
 * a complete one.
 */
function PacketLedger({ packet }: { packet: SituatePacket }) {
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
