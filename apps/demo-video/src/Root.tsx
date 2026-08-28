import { Composition } from "remotion";
import { MapvestTweet } from "./MapvestTweet";
import { COMPOSITION_VARIANTS, FPS, TOTAL_DURATION_IN_FRAMES } from "./storyboard";

export const RemotionRoot = () => {
  return (
    <>
      {COMPOSITION_VARIANTS.map(({ id, format, soundtrack, width, height }) => (
        <Composition
          key={id}
          id={id}
          component={MapvestTweet}
          durationInFrames={TOTAL_DURATION_IN_FRAMES}
          fps={FPS}
          width={width}
          height={height}
          defaultProps={{ format, soundtrack }}
        />
      ))}
    </>
  );
};
