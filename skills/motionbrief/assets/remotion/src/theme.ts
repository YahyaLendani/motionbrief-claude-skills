import { loadFont } from "@remotion/google-fonts/Inter";

// Load the brief's typeface. Without this the render silently falls back to
// whatever the machine has installed, so two machines render different films.
// The loader holds the render until the font is ready.
const { fontFamily } = loadFont("normal", {
  weights: ["500", "600", "800"],
  subsets: ["latin"],
});

export const COLORS = {
  bg: "#08090c",
  fg: "#f4f5f7",
  dim: "#6b7280",
  accent: "#7dd3fc",
} as const;

export const FONT_STACK = `${fontFamily}, "Segoe UI", system-ui, -apple-system, sans-serif`;

export const FPS = 30;
export const DURATION_IN_FRAMES = 360; // 12 s
export const WIDTH = 1920;
export const HEIGHT = 1080;

/** Absolute frame where each beat starts, so sequences and copy stay in sync. */
export const BEATS = {
  wordmark: 0, // 0.0 s
  lines: 75, // 2.5 s
  countUp: 210, // 7.0 s
  lockup: 270, // 9.0 s
} as const;
