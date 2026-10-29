import React from "react";
import { Composition } from "remotion";
import { LaunchCard } from "./LaunchCard";
import { DURATION_IN_FRAMES, FPS, HEIGHT, WIDTH } from "./theme";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="LaunchCard"
        component={LaunchCard}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{
          brand: "Motions",
          tagline: "Every cut, on the beat.",
          statValue: 12480,
        }}
      />
    </>
  );
};
