import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONT_STACK } from "../theme";

const LABEL_IN = [0, 13] as const;
const VALUE_IN = [4, 15] as const;
// The count lands at frame 33 (1.1 s) and holds the true number for a full
// beat before ZoomThrough carries it out — a stat that exits the instant it
// lands is never read.
const COUNT = [6, 33] as const;

const nf = new Intl.NumberFormat("en-US");

export const CountUp: React.FC<{ label: string; value: number }> = ({
  label,
  value,
}) => {
  const frame = useCurrentFrame();

  // Derived from the frame every render — never from state, never from a clock.
  const countProgress = interpolate(frame, COUNT, [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.215, 0.61, 0.355, 1), // power2.out, no overshoot
  });

  const current = Math.round(value * countProgress);

  const labelIn = interpolate(frame, LABEL_IN, [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });

  const valueIn = interpolate(frame, VALUE_IN, [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
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
          gap: 28,
        }}
      >
        <div
          style={{
            fontSize: 40,
            fontWeight: 600,
            letterSpacing: "0.34em",
            textTransform: "uppercase",
            color: COLORS.dim,
            opacity: labelIn,
            transform: `translateY(${(1 - labelIn) * 16}px)`,
          }}
        >
          {label}
        </div>

        <div
          style={{
            fontSize: 244,
            fontWeight: 800,
            letterSpacing: "-0.05em",
            lineHeight: 1,
            color: COLORS.fg,
            fontVariantNumeric: "tabular-nums",
            opacity: valueIn,
            transform: `scale(${0.94 + valueIn * 0.06})`,
          }}
        >
          {nf.format(current)}
        </div>

        <div
          style={{
            width: 520 * countProgress,
            height: 4,
            background: COLORS.accent,
            opacity: 0.9 * valueIn,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
