export const FPS = 30;
export const LAUNCH_MUSIC_ASSET = "music/mapvest-launch.mp3" as const;

export type LaunchFormat = "portrait" | "square";
export type LaunchSoundtrack = "music" | "silent";

export const frameAt = (seconds: number) => Math.round(seconds * FPS);

export const LAUNCH_SCENE_IDS = [
  "hook",
  "map",
  "local-brief",
  "camera",
  "result",
  "universe",
  "detail",
  "research",
  "daily",
  "cta",
] as const;

export type LaunchSceneId = (typeof LAUNCH_SCENE_IDS)[number];

export type LaunchSceneCopy = {
  kicker: string;
  headline: string;
  accent: string;
  body: string;
};

export type LaunchScene = {
  id: LaunchSceneId;
  startFrame: number;
  endFrame: number;
  durationInFrames: number;
  copy: LaunchSceneCopy;
  asset: string;
};

const defineScene = ({
  id,
  start,
  end,
  copy,
  asset,
}: {
  id: LaunchSceneId;
  start: number;
  end: number;
  copy: LaunchSceneCopy;
  asset: string;
}): LaunchScene => {
  const startFrame = frameAt(start);
  const endFrame = frameAt(end);

  return {
    id,
    startFrame,
    endFrame,
    durationInFrames: endFrame - startFrame,
    copy,
    asset,
  };
};

export const LAUNCH_STORYBOARD = [
  defineScene({
    id: "hook",
    start: 0,
    end: 3,
    copy: {
      kicker: "Mapvest",
      headline: "See the market",
      accent: "in the world around you.",
      body: "Map places, scan products, research stocks, and brief your watchlist.",
    },
    asset: "brand/wordmark.svg",
  }),
  defineScene({
    id: "map",
    start: 2.4,
    end: 9.6,
    copy: {
      kicker: "01 · Live map",
      headline: "Investable places,",
      accent: "right around you.",
      body: "Explore nearby companies and turn the streets around you into market context.",
    },
    asset: "map-nearby.mp4",
  }),
  defineScene({
    id: "local-brief",
    start: 9.1,
    end: 16.5,
    copy: {
      kicker: "02 · Local Economy Brief",
      headline: "A neighborhood becomes",
      accent: "an investment brief.",
      body: "Build a sourced read on the public companies shaping a place.",
    },
    asset: "local-economy-brief.mp4",
  }),
  defineScene({
    id: "camera",
    start: 16,
    end: 22.8,
    copy: {
      kicker: "03 · Camera",
      headline: "Point. Tap.",
      accent: "Investable.",
      body: "A MacBook test image runs through the real camera flow.",
    },
    asset: "camera-flow.mp4",
  }),
  defineScene({
    id: "result",
    start: 22.3,
    end: 27,
    copy: {
      kicker: "Verified recognition",
      headline: "Apple",
      accent: "$AAPL",
      body: "The production recognition path returns the ticker with sourced confidence.",
    },
    asset: "macbook-test.png",
  }),
  defineScene({
    id: "universe",
    start: 26.5,
    end: 34,
    copy: {
      kicker: "04 · Your Universe",
      headline: "One place for",
      accent: "everything you follow.",
      body: "Move from nearby discoveries to the companies and themes that matter to you.",
    },
    asset: "universe.mp4",
  }),
  defineScene({
    id: "detail",
    start: 33.5,
    end: 40,
    copy: {
      kicker: "05 · Market detail",
      headline: "Chart + sources,",
      accent: "in one place.",
      body: "Open real AAPL detail without leaving the discovery flow.",
    },
    asset: "market-detail-aapl.mp4",
  }),
  defineScene({
    id: "research",
    start: 39.5,
    end: 48.3,
    copy: {
      kicker: "06 · Sourced Research",
      headline: "Ask a question.",
      accent: "Get the evidence.",
      body: "“Give me a research brief on $AAPL.” Sources remain attached to the result.",
    },
    asset: "research-aapl.mp4",
  }),
  defineScene({
    id: "daily",
    start: 47.8,
    end: 55.5,
    copy: {
      kicker: "07 · Mapvest Daily",
      headline: "Your watchlist,",
      accent: "briefed every day.",
      body: "Catch up on the names you saved with a focused daily market brief.",
    },
    asset: "watchlist-daily.mp4",
  }),
  defineScene({
    id: "cta",
    start: 55,
    end: 58.5,
    copy: {
      kicker: "Mapvest",
      headline: "The world is your",
      accent: "watchlist.",
      body: "Start exploring at mapvest.app.",
    },
    asset: "brand/mark.svg",
  }),
] as const satisfies readonly LaunchScene[];

export const sceneById = (id: LaunchSceneId): LaunchScene => {
  const scene = LAUNCH_STORYBOARD.find((candidate) => candidate.id === id);
  if (!scene) {
    throw new Error(`Unknown launch scene: ${id}`);
  }
  return scene;
};

export const TOTAL_DURATION_IN_FRAMES = Math.max(
  ...LAUNCH_STORYBOARD.map(({ endFrame }) => endFrame),
);

export const VISUAL_TIMELINE_ID = "mapvest-launch-v1" as const;

export const COMPOSITION_VARIANTS = [
  {
    id: "MapvestLaunchPortraitMusic",
    outputFilename: "mapvest-launch-portrait-music.mp4",
    format: "portrait",
    soundtrack: "music",
    width: 1080,
    height: 1920,
    visualTimeline: VISUAL_TIMELINE_ID,
  },
  {
    id: "MapvestLaunchPortraitSilent",
    outputFilename: "mapvest-launch-portrait-silent.mp4",
    format: "portrait",
    soundtrack: "silent",
    width: 1080,
    height: 1920,
    visualTimeline: VISUAL_TIMELINE_ID,
  },
  {
    id: "MapvestLaunchSquareMusic",
    outputFilename: "mapvest-launch-square-music.mp4",
    format: "square",
    soundtrack: "music",
    width: 1080,
    height: 1080,
    visualTimeline: VISUAL_TIMELINE_ID,
  },
  {
    id: "MapvestLaunchSquareSilent",
    outputFilename: "mapvest-launch-square-silent.mp4",
    format: "square",
    soundtrack: "silent",
    width: 1080,
    height: 1080,
    visualTimeline: VISUAL_TIMELINE_ID,
  },
] as const satisfies readonly {
  id: string;
  outputFilename: string;
  format: LaunchFormat;
  soundtrack: LaunchSoundtrack;
  width: number;
  height: number;
  visualTimeline: typeof VISUAL_TIMELINE_ID;
}[];
