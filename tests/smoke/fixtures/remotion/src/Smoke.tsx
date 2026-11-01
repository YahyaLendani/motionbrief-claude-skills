import React from "react";
import { AbsoluteFill, Easing, Sequence, cancelRender, continueRender, delayRender, interpolate, useCurrentFrame } from "remotion";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-800.css";

const fontsLoading = delayRender("Loading Inter");
Promise.all([500, 800].map((weight) => document.fonts.load(`${weight} 1em Inter`))).then(
  () => continueRender(fontsLoading),
  (err) => cancelRender(err),
);

const BIG: React.CSSProperties = { fontSize: 64, fontWeight: 800, letterSpacing: "-0.03em", color: "#f4f5f7" };
const SCENE: React.CSSProperties = { alignItems: "center", justifyContent: "center", gap: 8, fontFamily: "Inter, sans-serif" };

const Title: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const settle = interpolate(frame, [0, 9], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.19, 1, 0.22, 1) });
  return (
    <AbsoluteFill style={SCENE}>
      <div style={{ ...BIG, transform: `translateY(${(1 - settle) * 12}px)`, filter: `blur(${(1 - settle) * 4}px)` }}>{title}</div>
    </AbsoluteFill>
  );
};

const Stat: React.FC = () => {
  const frame = useCurrentFrame();
  const value = interpolate(frame, [0, 21], [0, 12480], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.quad) });
  return (
    <AbsoluteFill style={SCENE}>
      <div style={BIG}>{Math.round(value).toLocaleString("en-US")}</div>
      <div style={{ fontSize: 28, fontWeight: 500, color: "#8b93a3" }}>frames</div>
    </AbsoluteFill>
  );
};

export const Smoke: React.FC<{ title: string }> = ({ title }) => (
  <AbsoluteFill style={{ background: "#10131a" }}>
    <Sequence from={0} durationInFrames={45} name="title">
      <Title title={title} />
    </Sequence>
    <Sequence from={45} durationInFrames={45} name="stat">
      <Stat />
    </Sequence>
  </AbsoluteFill>
);
