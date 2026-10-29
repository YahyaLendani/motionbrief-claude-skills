import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { BEATS, COLORS } from "./theme";
import { Wordmark } from "./beats/Wordmark";
import { KineticLines } from "./beats/KineticLines";
import { CountUp } from "./beats/CountUp";
import { Lockup } from "./beats/Lockup";
import { ZoomThrough } from "./ZoomThrough";

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
        {/* Frame 0 is the thumbnail: the mark is already there, no zoom in. */}
        <ZoomThrough durationInFrames={WORDMARK_LEN} enter={false}>
          <Wordmark brand={brand} />
        </ZoomThrough>
      </Sequence>

      <Sequence from={BEATS.lines} durationInFrames={LINES_LEN} name="Lines">
        <ZoomThrough durationInFrames={LINES_LEN}>
          <KineticLines />
        </ZoomThrough>
      </Sequence>

      <Sequence
        from={BEATS.countUp}
        durationInFrames={COUNTUP_LEN}
        name="CountUp"
      >
        <ZoomThrough durationInFrames={COUNTUP_LEN}>
          <CountUp label="renders" value={statValue} />
        </ZoomThrough>
      </Sequence>

      <Sequence
        from={BEATS.lockup}
        durationInFrames={LOCKUP_LEN}
        name="Lockup"
      >
        {/* The last beat holds to the end — nothing to cut to. */}
        <ZoomThrough durationInFrames={LOCKUP_LEN} exit={false}>
          <Lockup brand={brand} tagline={tagline} />
        </ZoomThrough>
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
