import { Audio, Video } from "@remotion/media";
import type { CSSProperties, ComponentType, ReactNode } from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import macbookIdentifyCapture from "../public/provenance/macbook-identify.json";
import {
  FPS,
  LAUNCH_MUSIC_ASSET,
  LAUNCH_STORYBOARD,
  type LaunchFormat,
  type LaunchSceneId,
  type LaunchSoundtrack,
  TOTAL_DURATION_IN_FRAMES,
  frameAt,
  sceneById,
} from "./storyboard";

export type MapvestTweetProps = {
  format: LaunchFormat;
  soundtrack: LaunchSoundtrack;
};

const COLORS = {
  background: "#080b0d",
  panel: "#11161a",
  panelRaised: "#171d22",
  border: "#273139",
  accent: "#14c4a6",
  cyan: "#2bb7ee",
  ink: "#f2f4f5",
  muted: "#929ca4",
};

const FONT_FAMILY = "Avenir Next, Helvetica Neue, Arial, sans-serif";
const hookScene = sceneById("hook");
const mapScene = sceneById("map");
const localBriefScene = sceneById("local-brief");
const cameraScene = sceneById("camera");
const resultScene = sceneById("result");
const universeScene = sceneById("universe");
const detailScene = sceneById("detail");
const researchScene = sceneById("research");
const dailyScene = sceneById("daily");
const ctaScene = sceneById("cta");

const macbookDetected = macbookIdentifyCapture.identification.detected[0]!;
const macbookInvestable = macbookIdentifyCapture.investables[0]!;
const macbookIdentifySource =
  macbookInvestable.sources.find(({ provider }) => provider === "openrouter") ??
  macbookInvestable.sources[0]!;
const macbookIdentifyProviders = macbookInvestable.sources
  .map(({ provider }) => provider)
  .join(" + ");
const macbookIdentifyFetchedAt = `${macbookIdentifySource.fetchedAt
  .slice(0, 16)
  .replace("T", " ")} UTC`;

const sentenceCase = (value: string) =>
  `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`;

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const sceneOpacity = (frame: number, duration: number) =>
  interpolate(frame, [0, 12, duration - 14, duration], [0, 1, 1, 0], clamp);

const rise = (frame: number, delay = 0) => {
  const progress = interpolate(frame, [delay, delay + 22], [0, 1], clamp);
  return {
    opacity: progress,
    transform: `translateY(${interpolate(progress, [0, 1], [34, 0])}px)`,
  };
};

const researchCompletion = (frame: number) => interpolate(frame, [108, 126], [0, 1], clamp);

const Background = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const drift = interpolate(frame, [0, durationInFrames], [-70, 90]);

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.background, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.026) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.026) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage: "linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 760,
          height: 760,
          borderRadius: "50%",
          left: -280 + drift,
          top: -300,
          background: "rgba(20,196,166,0.18)",
          filter: "blur(120px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 620,
          height: 620,
          borderRadius: "50%",
          right: -320 - drift * 0.4,
          bottom: -260,
          background: "rgba(43,183,238,0.13)",
          filter: "blur(110px)",
        }}
      />
    </AbsoluteFill>
  );
};

const Wordmark = ({ width }: { width: number }) => (
  <Img src={staticFile("brand/wordmark.svg")} style={{ display: "block", width }} />
);

const Kicker = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      color: COLORS.accent,
      fontFamily: FONT_FAMILY,
      fontSize: 23,
      fontWeight: 800,
      letterSpacing: "0.16em",
      textTransform: "uppercase",
    }}
  >
    {children}
  </div>
);

const Pill = ({
  children,
  tone = "accent",
}: { children: ReactNode; tone?: "accent" | "muted" }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 12,
      border: `1px solid ${tone === "accent" ? "rgba(20,196,166,0.48)" : COLORS.border}`,
      borderRadius: 999,
      background: tone === "accent" ? "rgba(20,196,166,0.11)" : "rgba(17,22,26,0.88)",
      color: tone === "accent" ? COLORS.accent : COLORS.muted,
      padding: "13px 19px",
      fontFamily: FONT_FAMILY,
      fontSize: 20,
      fontWeight: 700,
      letterSpacing: "0.03em",
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </div>
);

const PhoneFrame = ({ children, width }: { children: ReactNode; width: number }) => (
  <div
    style={{
      position: "relative",
      width,
      aspectRatio: "1206 / 2622",
      overflow: "hidden",
      flex: "0 0 auto",
      border: "7px solid #2a3238",
      borderRadius: width > 500 ? 72 : 54,
      background: "#07090a",
      boxShadow: "0 40px 100px rgba(0,0,0,0.58), 0 0 0 1px rgba(255,255,255,0.08)",
    }}
  >
    {children}
    <div
      style={{
        pointerEvents: "none",
        position: "absolute",
        inset: 0,
        borderRadius: "inherit",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)",
        zIndex: 20,
      }}
    />
  </div>
);

const fillMedia: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const fillVideo: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
};

const DeviceMedia = ({ src }: { src: string }) => <Img src={staticFile(src)} style={fillMedia} />;

const ScanCorners = ({ frame }: { frame: number }) => {
  const pulse = 0.65 + Math.sin(frame / 7) * 0.2;
  const corner: CSSProperties = {
    position: "absolute",
    width: 62,
    height: 62,
    borderColor: COLORS.accent,
    borderStyle: "solid",
    opacity: pulse,
  };

  return (
    <div style={{ position: "absolute", inset: "13% 12%", zIndex: 4 }}>
      <div style={{ ...corner, left: 0, top: 0, borderWidth: "5px 0 0 5px" }} />
      <div style={{ ...corner, right: 0, top: 0, borderWidth: "5px 5px 0 0" }} />
      <div style={{ ...corner, left: 0, bottom: 0, borderWidth: "0 0 5px 5px" }} />
      <div style={{ ...corner, right: 0, bottom: 0, borderWidth: "0 5px 5px 0" }} />
      <div
        style={{
          position: "absolute",
          left: 18,
          right: 18,
          top: `${interpolate(frame % 80, [0, 79], [8, 90])}%`,
          height: 3,
          background: `linear-gradient(90deg, transparent, ${COLORS.accent}, transparent)`,
          boxShadow: `0 0 22px ${COLORS.accent}`,
        }}
      />
    </div>
  );
};

const CameraViewport = ({ frame }: { frame: number }) => {
  const scale = interpolate(frame, [0, 150], [1.08, 1.02], clamp);

  return (
    <div
      style={{
        position: "absolute",
        zIndex: 3,
        left: 0,
        right: 0,
        top: "11.55%",
        bottom: "18.35%",
        overflow: "hidden",
        background: "#050607",
      }}
    >
      <Img
        src={staticFile(resultScene.asset)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
          filter: "contrast(1.04) saturate(0.88) brightness(0.83)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.22), transparent 22%, transparent 70%, rgba(0,0,0,0.38))",
        }}
      />
      <ScanCorners frame={frame} />
    </div>
  );
};

const TapRipple = ({ frame }: { frame: number }) => {
  const pulseFrame = frame % 80;
  const scale = interpolate(pulseFrame, [18, 38], [0.6, 1.8], clamp);
  const opacity = interpolate(pulseFrame, [18, 25, 40], [0, 0.85, 0], clamp);

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "88.1%",
        width: 92,
        height: 92,
        marginLeft: -46,
        marginTop: -46,
        border: `5px solid ${COLORS.accent}`,
        borderRadius: "50%",
        opacity,
        transform: `scale(${scale})`,
        zIndex: 15,
      }}
    />
  );
};

const SceneLayout = ({
  portrait,
  copy,
  phone,
  children,
}: {
  portrait: boolean;
  copy: ReactNode;
  phone: ReactNode;
  children?: ReactNode;
}) => (
  <AbsoluteFill
    style={{
      padding: portrait ? "116px 74px 70px" : "64px 62px",
      display: "flex",
      flexDirection: portrait ? "column" : "row",
      alignItems: "center",
      justifyContent: "center",
      gap: portrait ? 58 : 64,
      color: COLORS.ink,
    }}
  >
    <div
      style={{
        width: portrait ? "100%" : 452,
        display: "flex",
        flexDirection: "column",
        alignItems: portrait ? "center" : "flex-start",
        textAlign: portrait ? "center" : "left",
        gap: 23,
      }}
    >
      {copy}
      {children}
    </div>
    {phone}
  </AbsoluteFill>
);

const HookScene = ({ portrait }: { portrait: boolean }) => {
  const frame = useCurrentFrame();
  const opacity = sceneOpacity(frame, hookScene.durationInFrames);
  const wordScale = spring({ frame, fps: FPS, config: { damping: 16, stiffness: 110 } });

  return (
    <AbsoluteFill
      style={{
        opacity,
        alignItems: "center",
        justifyContent: "center",
        padding: portrait ? 84 : 64,
        textAlign: "center",
        color: COLORS.ink,
      }}
    >
      <div
        style={{
          ...rise(frame, 0),
          transform: `scale(${interpolate(wordScale, [0, 1], [0.82, 1])})`,
          marginBottom: portrait ? 92 : 55,
        }}
      >
        <Wordmark width={portrait ? 330 : 275} />
      </div>
      <div
        style={{
          ...rise(frame, 8),
          maxWidth: 950,
          fontFamily: FONT_FAMILY,
          fontSize: portrait ? 116 : 92,
          fontWeight: 900,
          lineHeight: 0.96,
          letterSpacing: "-0.055em",
          textTransform: "uppercase",
        }}
      >
        {hookScene.copy.headline}
        <br />
        <span style={{ color: COLORS.accent }}>{hookScene.copy.accent}</span>
      </div>
      <div
        style={{
          ...rise(frame, 20),
          marginTop: portrait ? 64 : 43,
          color: COLORS.muted,
          fontFamily: FONT_FAMILY,
          fontSize: portrait ? 27 : 23,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        {hookScene.copy.body}
      </div>
    </AbsoluteFill>
  );
};

const SceneHeadline = ({
  frame,
  portrait,
  headline,
  accent,
}: {
  frame: number;
  portrait: boolean;
  headline: string;
  accent: string;
}) => (
  <div
    style={{
      ...rise(frame, 8),
      fontFamily: FONT_FAMILY,
      fontSize: portrait ? 70 : 58,
      fontWeight: 850,
      lineHeight: 1.02,
      letterSpacing: "-0.045em",
    }}
  >
    {headline}
    <br />
    <span style={{ color: COLORS.accent }}>{accent}</span>
  </div>
);

const SceneBody = ({
  frame,
  portrait,
  children,
}: {
  frame: number;
  portrait: boolean;
  children: ReactNode;
}) => (
  <div
    style={{
      ...rise(frame, 15),
      maxWidth: 520,
      color: COLORS.muted,
      fontFamily: FONT_FAMILY,
      fontSize: portrait ? 26 : 22,
      lineHeight: 1.4,
    }}
  >
    {children}
  </div>
);

const MapPhone = ({ width }: { width: number }) => (
  <PhoneFrame width={width}>
    <Video src={staticFile(mapScene.asset)} muted objectFit="cover" style={fillVideo} />
  </PhoneFrame>
);

const MapScene = ({ portrait }: { portrait: boolean }) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity(frame, mapScene.durationInFrames) }}>
      <SceneLayout
        portrait={portrait}
        copy={
          <>
            <div style={rise(frame, 2)}>
              <Kicker>{mapScene.copy.kicker}</Kicker>
            </div>
            <SceneHeadline
              frame={frame}
              portrait={portrait}
              headline={mapScene.copy.headline}
              accent={mapScene.copy.accent}
            />
            <SceneBody frame={frame} portrait={portrait}>
              {mapScene.copy.body}
            </SceneBody>
          </>
        }
        phone={<MapPhone width={portrait ? 570 : 420} />}
      >
        <Pill>● LIVE NEARBY MAP</Pill>
      </SceneLayout>
    </AbsoluteFill>
  );
};

const LocalBriefPhone = ({ width }: { width: number }) => (
  <PhoneFrame width={width}>
    <Video src={staticFile(localBriefScene.asset)} muted objectFit="cover" style={fillVideo} />
  </PhoneFrame>
);

const LocalBriefScene = ({ portrait }: { portrait: boolean }) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity(frame, localBriefScene.durationInFrames) }}>
      <SceneLayout
        portrait={portrait}
        copy={
          <>
            <div style={rise(frame, 2)}>
              <Kicker>{localBriefScene.copy.kicker}</Kicker>
            </div>
            <SceneHeadline
              frame={frame}
              portrait={portrait}
              headline={localBriefScene.copy.headline}
              accent={localBriefScene.copy.accent}
            />
            <SceneBody frame={frame} portrait={portrait}>
              {localBriefScene.copy.body}
            </SceneBody>
          </>
        }
        phone={<LocalBriefPhone width={portrait ? 570 : 420} />}
      >
        <Pill>LOCATION-AWARE · SOURCED</Pill>
      </SceneLayout>
    </AbsoluteFill>
  );
};

const CameraPhone = ({ width }: { width: number }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [22, 150], [0.08, 1], clamp);

  return (
    <PhoneFrame width={width}>
      <DeviceMedia src="camera-live.png" />
      <Sequence durationInFrames={90}>
        <Video src={staticFile(cameraScene.asset)} muted objectFit="cover" style={fillVideo} />
      </Sequence>
      <CameraViewport frame={frame} />
      <TapRipple frame={frame} />
      <div
        style={{
          position: "absolute",
          zIndex: 12,
          left: "10%",
          right: "10%",
          bottom: "20.8%",
          height: 9,
          overflow: "hidden",
          borderRadius: 999,
          background: "rgba(255,255,255,0.18)",
        }}
      >
        <div
          style={{
            width: `${progress * 100}%`,
            height: "100%",
            borderRadius: 999,
            background: `linear-gradient(90deg, ${COLORS.accent}, ${COLORS.cyan})`,
            boxShadow: `0 0 18px ${COLORS.accent}`,
          }}
        />
      </div>
    </PhoneFrame>
  );
};

const CameraScene = ({ portrait }: { portrait: boolean }) => {
  const frame = useCurrentFrame();
  const opacity = sceneOpacity(frame, cameraScene.durationInFrames);

  return (
    <AbsoluteFill style={{ opacity }}>
      <SceneLayout
        portrait={portrait}
        copy={
          <>
            <div style={rise(frame, 3)}>
              <Kicker>{cameraScene.copy.kicker}</Kicker>
            </div>
            <div
              style={{
                ...rise(frame, 8),
                fontFamily: FONT_FAMILY,
                fontSize: portrait ? 74 : 67,
                fontWeight: 850,
                lineHeight: 1.02,
                letterSpacing: "-0.045em",
              }}
            >
              {cameraScene.copy.headline}
              <br />
              <span style={{ color: COLORS.accent }}>{cameraScene.copy.accent}</span>
            </div>
            <div
              style={{
                ...rise(frame, 14),
                maxWidth: 520,
                color: COLORS.muted,
                fontFamily: FONT_FAMILY,
                fontSize: portrait ? 27 : 23,
                lineHeight: 1.38,
              }}
            >
              {cameraScene.copy.body}
            </div>
          </>
        }
        phone={<CameraPhone width={portrait ? 570 : 420} />}
      >
        <Pill>● LIVE CAMERA FLOW</Pill>
      </SceneLayout>
    </AbsoluteFill>
  );
};

const ResultCard = ({ frame, portrait }: { frame: number; portrait: boolean }) => {
  const pop = spring({ frame: frame - 8, fps: FPS, config: { damping: 13, stiffness: 145 } });

  return (
    <div
      style={{
        width: "100%",
        maxWidth: portrait ? 710 : 450,
        border: "1px solid rgba(20,196,166,0.42)",
        borderRadius: 30,
        padding: portrait ? "30px 34px" : "26px 28px",
        background: "linear-gradient(145deg, rgba(23,29,34,0.98), rgba(12,18,20,0.95))",
        boxShadow: "0 26px 70px rgba(0,0,0,0.42), inset 0 1px rgba(255,255,255,0.06)",
        opacity: pop,
        transform: `scale(${interpolate(pop, [0, 1], [0.88, 1])})`,
      }}
    >
      <div
        style={{
          fontFamily: FONT_FAMILY,
          fontSize: portrait ? 60 : 47,
          fontWeight: 900,
          letterSpacing: "-0.05em",
          whiteSpace: "nowrap",
        }}
      >
        {macbookInvestable.brand.name.toUpperCase()} <span style={{ color: COLORS.muted }}>→</span>{" "}
        <span style={{ color: COLORS.accent }}>${macbookInvestable.brand.ticker.symbol}</span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 13,
          marginTop: 17,
          color: COLORS.accent,
          fontFamily: FONT_FAMILY,
          fontSize: portrait ? 26 : 22,
          fontWeight: 750,
        }}
      >
        <span
          style={{
            width: 13,
            height: 13,
            borderRadius: "50%",
            background: COLORS.accent,
            boxShadow: `0 0 16px ${COLORS.accent}`,
          }}
        />
        {sentenceCase(macbookInvestable.confidence)} confidence
      </div>
      <div
        style={{
          marginTop: 19,
          paddingTop: 16,
          borderTop: `1px solid ${COLORS.border}`,
          color: COLORS.muted,
          fontFamily: FONT_FAMILY,
          fontSize: portrait ? 16 : 13,
          fontWeight: 700,
          lineHeight: 1.4,
          letterSpacing: "0.035em",
          textTransform: "uppercase",
        }}
      >
        Sources: {macbookIdentifyProviders} · {macbookIdentifyFetchedAt}
        <br />
        Quote provider: {macbookInvestable.quote.provider}
      </div>
    </div>
  );
};

const StaticCameraPhone = ({ width }: { width: number }) => (
  <PhoneFrame width={width}>
    <DeviceMedia src="camera-live.png" />
    <div
      style={{
        position: "absolute",
        zIndex: 3,
        left: 0,
        right: 0,
        top: "11.55%",
        bottom: "18.35%",
        overflow: "hidden",
      }}
    >
      <Img
        src={staticFile(resultScene.asset)}
        style={{ width: "100%", height: "100%", objectFit: "cover", filter: "brightness(0.84)" }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(0,0,0,.14), transparent 60%, rgba(0,0,0,.35))",
        }}
      />
    </div>
  </PhoneFrame>
);

const ResultScene = ({ portrait }: { portrait: boolean }) => {
  const frame = useCurrentFrame();
  const opacity = sceneOpacity(frame, resultScene.durationInFrames);

  return (
    <AbsoluteFill style={{ opacity }}>
      <SceneLayout
        portrait={portrait}
        copy={
          <>
            <div style={rise(frame, 0)}>
              <Kicker>{resultScene.copy.kicker}</Kicker>
            </div>
            <ResultCard frame={frame} portrait={portrait} />
            <div
              style={{
                ...rise(frame, 18),
                maxWidth: 520,
                color: COLORS.muted,
                fontFamily: FONT_FAMILY,
                fontSize: portrait ? 25 : 22,
                lineHeight: 1.4,
              }}
            >
              {macbookDetected.product} · {resultScene.copy.body}
            </div>
          </>
        }
        phone={<StaticCameraPhone width={portrait ? 530 : 410} />}
      />
    </AbsoluteFill>
  );
};

const UniversePhone = ({ width }: { width: number }) => (
  <PhoneFrame width={width}>
    <Video src={staticFile(universeScene.asset)} muted objectFit="cover" style={fillVideo} />
    <div
      style={{
        position: "absolute",
        zIndex: 8,
        top: "48.5%",
        right: 0,
        bottom: 0,
        left: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: width > 500 ? 18 : 13,
        padding: "0 11%",
        textAlign: "center",
        background:
          "linear-gradient(to bottom, rgba(8,11,13,0.28), rgba(8,11,13,0.96) 18%, #080b0d 52%)",
      }}
    >
      <div
        style={{
          display: "grid",
          width: width > 500 ? 70 : 52,
          height: width > 500 ? 70 : 52,
          placeItems: "center",
          border: "1px solid rgba(20,196,166,0.48)",
          borderRadius: "50%",
          background: "rgba(20,196,166,0.1)",
          color: COLORS.accent,
          fontFamily: FONT_FAMILY,
          fontSize: width > 500 ? 32 : 24,
        }}
      >
        ◇
      </div>
      <div
        style={{
          color: COLORS.accent,
          fontFamily: FONT_FAMILY,
          fontSize: width > 500 ? 24 : 18,
          fontWeight: 850,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        Private by default
      </div>
      <div
        style={{
          maxWidth: 350,
          color: COLORS.muted,
          fontFamily: FONT_FAMILY,
          fontSize: width > 500 ? 23 : 17,
          fontWeight: 650,
          lineHeight: 1.35,
        }}
      >
        Your complete find journal stays yours.
      </div>
    </div>
  </PhoneFrame>
);

const UniverseScene = ({ portrait }: { portrait: boolean }) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity(frame, universeScene.durationInFrames) }}>
      <SceneLayout
        portrait={portrait}
        copy={
          <>
            <div style={rise(frame, 2)}>
              <Kicker>{universeScene.copy.kicker}</Kicker>
            </div>
            <SceneHeadline
              frame={frame}
              portrait={portrait}
              headline={universeScene.copy.headline}
              accent={universeScene.copy.accent}
            />
            <SceneBody frame={frame} portrait={portrait}>
              {universeScene.copy.body}
            </SceneBody>
          </>
        }
        phone={<UniversePhone width={portrait ? 570 : 420} />}
      >
        <Pill>DISCOVERIES · WATCHLISTS · BRIEFS</Pill>
      </SceneLayout>
    </AbsoluteFill>
  );
};

const DetailPhone = ({ width }: { width: number }) => {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, detailScene.durationInFrames], [1.025, 1], clamp);

  return (
    <PhoneFrame width={width}>
      <DeviceMedia src="detail-aapl-loaded.png" />
      <Sequence durationInFrames={102}>
        <Video
          src={staticFile(detailScene.asset)}
          muted
          objectFit="cover"
          style={{ ...fillVideo, transform: `scale(${zoom})` }}
        />
      </Sequence>
    </PhoneFrame>
  );
};

const DetailScene = ({ portrait }: { portrait: boolean }) => {
  const frame = useCurrentFrame();
  const opacity = sceneOpacity(frame, detailScene.durationInFrames);

  return (
    <AbsoluteFill style={{ opacity }}>
      <SceneLayout
        portrait={portrait}
        copy={
          <>
            <div style={rise(frame, 2)}>
              <Kicker>{detailScene.copy.kicker}</Kicker>
            </div>
            <div
              style={{
                ...rise(frame, 8),
                fontFamily: FONT_FAMILY,
                fontSize: portrait ? 72 : 64,
                fontWeight: 850,
                lineHeight: 1.02,
                letterSpacing: "-0.045em",
              }}
            >
              {detailScene.copy.headline}
              <br />
              <span style={{ color: COLORS.accent }}>{detailScene.copy.accent}</span>
            </div>
            <div
              style={{
                ...rise(frame, 15),
                maxWidth: 520,
                color: COLORS.muted,
                fontFamily: FONT_FAMILY,
                fontSize: portrait ? 26 : 23,
                lineHeight: 1.4,
              }}
            >
              {detailScene.copy.body} Values stay inside the captured UI.
            </div>
          </>
        }
        phone={<DetailPhone width={portrait ? 570 : 420} />}
      >
        <Pill>LIVE MARKET UI</Pill>
      </SceneLayout>
    </AbsoluteFill>
  );
};

const ScreenshotCrop = ({
  src,
  position,
  label,
}: { src: string; position: string; label: string }) => (
  <div style={{ width: "100%" }}>
    <div
      style={{
        marginBottom: 9,
        color: COLORS.muted,
        fontFamily: FONT_FAMILY,
        fontSize: 17,
        fontWeight: 750,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </div>
    <div
      style={{
        position: "relative",
        width: "100%",
        height: 148,
        overflow: "hidden",
        border: `1px solid ${COLORS.border}`,
        borderRadius: 18,
        background: COLORS.panel,
      }}
    >
      <Img
        src={staticFile(src)}
        style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: position }}
      />
    </div>
  </div>
);

const ResearchPhone = ({ width }: { width: number }) => {
  const frame = useCurrentFrame();
  const completeOpacity = researchCompletion(frame);

  return (
    <PhoneFrame width={width}>
      <DeviceMedia src="research-start.png" />
      <Img
        src={staticFile("research-running.png")}
        style={{ ...fillMedia, opacity: interpolate(frame, [10, 25], [0, 1], clamp) }}
      />
      <Sequence from={22} durationInFrames={150}>
        <Video src={staticFile(researchScene.asset)} muted objectFit="cover" style={fillVideo} />
      </Sequence>
      <Img
        src={staticFile("research-complete.png")}
        style={{
          ...fillMedia,
          opacity: completeOpacity,
          transform: `scale(${interpolate(frame, [108, 195], [1.035, 1], clamp)})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          zIndex: 9,
          right: "4.5%",
          top: "6.5%",
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: completeOpacity > 0.5 ? COLORS.accent : COLORS.cyan,
          boxShadow: `0 0 18px ${completeOpacity > 0.5 ? COLORS.accent : COLORS.cyan}`,
        }}
      />
    </PhoneFrame>
  );
};

const ResearchScene = ({ portrait }: { portrait: boolean }) => {
  const frame = useCurrentFrame();
  const opacity = sceneOpacity(frame, researchScene.durationInFrames);
  const completion = researchCompletion(frame);

  return (
    <AbsoluteFill style={{ opacity }}>
      <SceneLayout
        portrait={portrait}
        copy={
          <>
            <div style={rise(frame, 1)}>
              <Kicker>{researchScene.copy.kicker}</Kicker>
            </div>
            <div
              style={{
                ...rise(frame, 7),
                fontFamily: FONT_FAMILY,
                fontSize: portrait ? 71 : 62,
                fontWeight: 850,
                lineHeight: 1.02,
                letterSpacing: "-0.045em",
              }}
            >
              {researchScene.copy.headline}
              <br />
              <span style={{ color: COLORS.accent }}>{researchScene.copy.accent}</span>
            </div>
            <div
              style={{
                ...rise(frame, 14),
                maxWidth: 520,
                color: COLORS.muted,
                fontFamily: FONT_FAMILY,
                fontSize: portrait ? 26 : 22,
                lineHeight: 1.38,
              }}
            >
              {researchScene.copy.body}
            </div>
          </>
        }
        phone={<ResearchPhone width={portrait ? 555 : 410} />}
      >
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: portrait ? "row" : "column",
            gap: 14,
            opacity: completion,
          }}
        >
          <ScreenshotCrop src="research-complete.png" position="center 7%" label="Brief summary" />
          <ScreenshotCrop
            src="research-complete.png"
            position="center 88%"
            label="Completion + evidence"
          />
        </div>
      </SceneLayout>
    </AbsoluteFill>
  );
};

const DailyPhone = ({ width }: { width: number }) => (
  <PhoneFrame width={width}>
    <Video src={staticFile(dailyScene.asset)} muted objectFit="cover" style={fillVideo} />
  </PhoneFrame>
);

const DailyScene = ({ portrait }: { portrait: boolean }) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity(frame, dailyScene.durationInFrames) }}>
      <SceneLayout
        portrait={portrait}
        copy={
          <>
            <div style={rise(frame, 2)}>
              <Kicker>{dailyScene.copy.kicker}</Kicker>
            </div>
            <SceneHeadline
              frame={frame}
              portrait={portrait}
              headline={dailyScene.copy.headline}
              accent={dailyScene.copy.accent}
            />
            <SceneBody frame={frame} portrait={portrait}>
              {dailyScene.copy.body}
            </SceneBody>
          </>
        }
        phone={<DailyPhone width={portrait ? 570 : 420} />}
      >
        <Pill>WATCHLIST · DAILY CONTEXT</Pill>
      </SceneLayout>
    </AbsoluteFill>
  );
};

const EndScene = ({ portrait }: { portrait: boolean }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 14], [0, 1], clamp);
  const scale = spring({ frame, fps: FPS, config: { damping: 17, stiffness: 95 } });

  return (
    <AbsoluteFill
      style={{
        opacity,
        padding: portrait ? 90 : 60,
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        color: COLORS.ink,
      }}
    >
      <div style={{ transform: `scale(${interpolate(scale, [0, 1], [0.9, 1])})` }}>
        <Img
          src={staticFile(ctaScene.asset)}
          style={{ width: portrait ? 150 : 120, height: portrait ? 150 : 120, margin: "0 auto" }}
        />
        <div
          style={{
            marginTop: portrait ? 62 : 40,
            maxWidth: 920,
            fontFamily: FONT_FAMILY,
            fontSize: portrait ? 105 : 78,
            fontWeight: 900,
            lineHeight: 0.98,
            letterSpacing: "-0.055em",
            textTransform: "uppercase",
          }}
        >
          {ctaScene.copy.headline}
          <br />
          <span style={{ color: COLORS.accent }}>{ctaScene.copy.accent}</span>
        </div>
        <div
          style={{
            marginTop: portrait ? 40 : 28,
            color: COLORS.muted,
            fontFamily: FONT_FAMILY,
            fontSize: portrait ? 28 : 23,
            fontWeight: 650,
          }}
        >
          {ctaScene.copy.body}
        </div>
        <div
          style={{
            marginTop: portrait ? 36 : 28,
            display: "inline-flex",
            border: "1px solid rgba(20,196,166,0.5)",
            borderRadius: 999,
            padding: portrait ? "20px 38px" : "16px 31px",
            background: "rgba(20,196,166,0.1)",
            color: COLORS.ink,
            fontFamily: FONT_FAMILY,
            fontSize: portrait ? 34 : 27,
            fontWeight: 800,
            letterSpacing: "0.02em",
          }}
        >
          mapvest.app
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SCENE_COMPONENTS: Record<LaunchSceneId, ComponentType<{ portrait: boolean }>> = {
  hook: HookScene,
  map: MapScene,
  "local-brief": LocalBriefScene,
  camera: CameraScene,
  result: ResultScene,
  universe: UniverseScene,
  detail: DetailScene,
  research: ResearchScene,
  daily: DailyScene,
  cta: EndScene,
};

const TimelineProgress = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1], clamp);

  return (
    <div
      style={{
        position: "absolute",
        zIndex: 100,
        left: 0,
        right: 0,
        bottom: 0,
        height: 8,
        background: "rgba(255,255,255,0.08)",
      }}
    >
      <div
        style={{
          width: `${progress * 100}%`,
          height: "100%",
          background: `linear-gradient(90deg, ${COLORS.accent}, ${COLORS.cyan})`,
        }}
      />
    </div>
  );
};

const musicVolume = (frame: number) =>
  interpolate(
    frame,
    [0, frameAt(1.25), TOTAL_DURATION_IN_FRAMES - frameAt(2), TOTAL_DURATION_IN_FRAMES],
    [0, 0.78, 0.78, 0],
    clamp,
  );

export const MapvestTweet = ({ format, soundtrack }: MapvestTweetProps) => {
  const portrait = format === "portrait";

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.background }}>
      <Background />
      {soundtrack === "music" ? (
        <Audio src={staticFile(LAUNCH_MUSIC_ASSET)} volume={musicVolume} />
      ) : null}
      {LAUNCH_STORYBOARD.map((scene) => {
        const SceneComponent = SCENE_COMPONENTS[scene.id];
        return (
          <Sequence
            key={scene.id}
            from={scene.startFrame}
            durationInFrames={scene.durationInFrames}
            premountFor={FPS}
          >
            <SceneComponent portrait={portrait} />
          </Sequence>
        );
      })}
      <TimelineProgress />
    </AbsoluteFill>
  );
};
