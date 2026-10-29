import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";

// The brief's `cinematic-zoom` transition. The outgoing beat pushes through
// the camera and finishes ON the cut; the next beat arrives from just behind
// it. The exit is the transition — a fade-out, a gap, then a fade-in renders
// as a jump cut with a dip of black in the middle.
const ENTER = 15; // 0.5 s
const EXIT = 12; // 0.4 s

export const ZoomThrough: React.FC<{
  durationInFrames: number;
  enter?: boolean;
  exit?: boolean;
  children: React.ReactNode;
}> = ({ durationInFrames, enter = true, exit = true, children }) => {
  const frame = useCurrentFrame();

  const inP = enter
    ? interpolate(frame, [0, ENTER], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.bezier(0.19, 1, 0.22, 1), // expo.out
      })
    : 1;

  const outP = exit
    ? interpolate(frame, [durationInFrames - EXIT, durationInFrames], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.in(Easing.quad), // power2.in
      })
    : 0;

  const scale = (0.92 + 0.08 * inP) * (1 + 0.14 * outP);
  const blur = 6 * (1 - inP) + 6 * outP;

  return (
    <AbsoluteFill
      style={{
        opacity: 1 - outP,
        transform: `scale(${scale})`,
        filter: blur > 0.01 ? `blur(${blur}px)` : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
