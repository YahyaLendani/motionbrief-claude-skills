import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  random,
  useCurrentFrame,
} from "remotion";
import { COLORS, FONT_STACK } from "../theme";

const COLS = 24;
const ROWS = 14;
const DOT_COUNT = COLS * ROWS;

// No exit here: ZoomThrough in LaunchCard carries the beat out on the cut.
export const Wordmark: React.FC<{ brand: string }> = ({ brand }) => {
  const frame = useCurrentFrame();

  // The mark is on screen at frame 0 and settles into place. It never enters
  // from an empty frame — frame 0 is the thumbnail on social players.
  const markIn = interpolate(frame, [0, 27], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.19, 1, 0.22, 1), // expo.out
  });

  const ruleIn = interpolate(frame, [27, 48], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.23, 1, 0.32, 1), // power4.out
  });

  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <AbsoluteFill
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          gridTemplateRows: `repeat(${ROWS}, 1fr)`,
          opacity: 0.16,
        }}
      >
        {new Array(DOT_COUNT).fill(true).map((_, i) => {
          const seed = `dot-${i}`;
          const r = random(seed);
          const delay = random(`${seed}-delay`) * 12;
          const scale = interpolate(frame, [delay, delay + 8], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.cubic),
          });
          if (r > 0.55) {
            return null; // deterministic sparsity — never Math.random
          }
          return (
            <div
              key={i}
              style={{
                width: 3,
                height: 3,
                borderRadius: 1,
                background: COLORS.fg,
                placeSelf: "center",
                opacity: (0.25 + r * 1.1) * scale,
              }}
            />
          );
        })}
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          fontFamily: FONT_STACK,
        }}
      >
        <div style={{ position: "relative" }}>
          <div
            style={{
              fontSize: 172,
              fontWeight: 800,
              letterSpacing: "-0.045em",
              lineHeight: 1,
              color: COLORS.fg,
              transform: `translateY(${(1 - markIn) * 34}px) scale(${
                0.985 + markIn * 0.015
              })`,
              filter: `blur(${(1 - markIn) * 7}px)`,
            }}
          >
            {brand.slice(0, 3).toUpperCase()}
            <span style={{ color: COLORS.accent }}>
              {brand.slice(3).toUpperCase()}
            </span>
          </div>
          <div
            style={{
              position: "absolute",
              left: "50%",
              bottom: -44,
              height: 3,
              width: 520 * ruleIn,
              background: COLORS.accent,
              transform: "translateX(-50%)",
            }}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
