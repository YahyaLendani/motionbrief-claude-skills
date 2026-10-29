import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONT_STACK } from "../theme";

export const Lockup: React.FC<{ brand: string; tagline: string }> = ({
  brand,
  tagline,
}) => {
  const frame = useCurrentFrame();

  const titleIn = interpolate(frame, [0, 19], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.19, 1, 0.22, 1),
  });

  const tagIn = interpolate(frame, [9, 27], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.215, 0.61, 0.355, 1),
  });

  return (
    <AbsoluteFill
      style={{
        background: COLORS.bg,
        justifyContent: "center",
        alignItems: "center",
        fontFamily: FONT_STACK,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 30,
        }}
      >
        <div
          style={{
            fontSize: 96,
            fontWeight: 800,
            letterSpacing: "-0.04em",
            lineHeight: 1,
            color: COLORS.fg,
            opacity: titleIn,
            transform: `translateY(${(1 - titleIn) * 46}px)`,
          }}
        >
          {brand}
        </div>
        <div
          style={{
            fontSize: 38,
            fontWeight: 500,
            letterSpacing: "-0.01em",
            color: COLORS.dim,
            opacity: tagIn,
            transform: `translateY(${(1 - tagIn) * 24}px)`,
          }}
        >
          {tagline}
        </div>
      </div>
    </AbsoluteFill>
  );
};
