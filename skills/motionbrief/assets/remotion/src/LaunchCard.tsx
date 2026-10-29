import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { BEATS, COLORS } from "./theme";
import { Wordmark } from "./beats/Wordmark";
import { KineticLines } from "./beats/KineticLines";
import { CountUp } from "./beats/CountUp";
import { Lockup } from "./beats/Lockup";

export type LaunchCardProps = {
  brand: string;
  tagline: string;
  statValue: number;
};

// Beat lengths in frames at 30 fps. These sum to the composition duration.
const WORDMARK_LEN = BEATS.lines - BEATS.wordmark; // 75
const LINES_LEN = BEATS.countUp - BEATS.lines; // 135
const COUNTUP_LEN = BEATS.lockup - BEATS.countUp; // 60
const LOCKUP_LEN = 90; // 3 s — the closing line holds 2.1 s

export const LaunchCard: React.FC<LaunchCardProps> = ({
  brand,
  tagline,
  statValue,
}) => {
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <Sequence
        from={BEATS.wordmark}
        durationInFrames={WORDMARK_LEN}
        name="Wordmark"
        layout="absolute-fill"
      >
        <Wordmark brand={brand} />
      </Sequence>

      <Sequence from={BEATS.lines} durationInFrames={LINES_LEN} name="Lines">
        <KineticLines />
      </Sequence>

      <Sequence
        from={BEATS.countUp}
        durationInFrames={COUNTUP_LEN}
        name="CountUp"
      >
        <CountUp label="renders" value={statValue} />
      </Sequence>

      <Sequence
        from={BEATS.lockup}
        durationInFrames={LOCKUP_LEN}
        name="Lockup"
      >
        <Lockup brand={brand} tagline={tagline} />
      </Sequence>

      {/* Vignette sits above every beat — one depth cue, not three. */}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background:
            "radial-gradient(120% 90% at 50% 45%, transparent 40%, rgba(0,0,0,0.55) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
