import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONT_STACK } from "../theme";

const LINES = ["Brief in.", "Cut on beat.", "Same every time."];

/** Local frame each line starts on — ~1.05 s apart, overlapping. */
const LINE_STARTS = [0, 32, 63];
const ENTRY_LEN = 21; // 0.7 s

// No exit here: the lines hold until ZoomThrough carries them out on the cut.

export const KineticLines: React.FC = () => {
  const frame = useCurrentFrame();

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
          gap: 26,
          alignItems: "center",
        }}
      >
        {LINES.map((line, i) => {
          const start = LINE_STARTS[i] ?? 0;
          const p = interpolate(
            frame,
            [start, start + ENTRY_LEN],
            [0, 1],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.19, 1, 0.22, 1),
            },
          );

          const isLast = i === LINES.length - 1;

          return (
            <span
              key={line}
              style={{
                fontSize: 118,
                fontWeight: 800,
                letterSpacing: "-0.035em",
                lineHeight: 1,
                color: isLast ? COLORS.accent : COLORS.fg,
                // y + opacity only: one idea per move, nothing unreadable mid-flight
                opacity: p,
                transform: `translateY(${(1 - p) * 90}px)`,
              }}
            >
              {line}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
