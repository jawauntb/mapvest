import { Composition } from "remotion";
import { MapvestTweet } from "./MapvestTweet";

export const FPS = 30;
export const DURATION_IN_FRAMES = 27 * FPS;

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="MapvestTweetPortrait"
        component={MapvestTweet}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{ format: "portrait" as const }}
      />
      <Composition
        id="MapvestTweetSquare"
        component={MapvestTweet}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={1080}
        height={1080}
        defaultProps={{ format: "square" as const }}
      />
    </>
  );
};
