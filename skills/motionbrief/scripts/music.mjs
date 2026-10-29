#!/usr/bin/env node
/**
 * music — synthesize a beat-locked music bed from a brief.
 *
 *   node music.mjs --brief brief.json
 *   node music.mjs --brief brief.json --out audio/music.wav
 *   node music.mjs --brief brief.json --bpm 120 --preset high
 *
 * The bed is generated from the brief's own beat grid, so the downbeats land on
 * the scene cuts instead of near them. No samples, no API keys, no downloads:
 * everything is synthesized in-process and written as 16-bit PCM WAV.
 *
 * Deterministic — the same brief always produces byte-identical audio.
 *
 * Exit codes: 0 ok, 1 failed, 2 bad usage.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const SR = 44100;

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`music — synthesize a beat-locked bed from a brief

  --brief <brief.json>   read duration, bpm and feel from the brief
  --out <file.wav>       output path (default: <brief dir>/audio/music.wav)
  --bpm <n>              override the brief's bpm
  --preset <name>        calm | medium | high  (default: from brief feel.energy)
  --key <note>           A..G  (default: brief audio.key, else A)
  --mode <name>          minor | major        (default: minor)
  --gain <0..1>          master gain          (default: 0.7)
  --json                 machine-readable result

Twelve-tone equal temperament, additive synthesis, seeded noise.`);
  process.exit(0);
}

function flag(name, fallback = null) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) die(`flag ${name} needs a value`);
  return v;
}

function die(msg, code = 2) {
  console.error(`music: ${msg}`);
  process.exit(code);
}

const briefPath = resolve(flag("--brief", "brief.json"));
if (!existsSync(briefPath)) die(`brief not found: ${briefPath}`, 1);

let brief;
try {
  brief = JSON.parse(readFileSync(briefPath, "utf8"));
} catch (err) {
  die(`invalid brief JSON — ${err.message}`, 1);
}

const audioCfg = brief.audio ?? {};
const duration = Number(brief.format?.duration);
if (!Number.isFinite(duration) || duration <= 0) {
  die("brief has no usable format.duration", 1);
}

const bpm = Number(flag("--bpm", audioCfg.bpm ?? 96));
if (!Number.isFinite(bpm) || bpm < 30 || bpm > 240) die(`bpm out of range: ${bpm}`, 2);

const PRESETS = ["calm", "medium", "high"];
const preset = flag("--preset", audioCfg.preset ?? brief.feel?.energy ?? "medium");
if (!PRESETS.includes(preset)) die(`unknown preset "${preset}" — ${PRESETS.join(", ")}`, 2);

const keyName = String(flag("--key", audioCfg.key ?? "A")).toUpperCase();
const mode = flag("--mode", audioCfg.mode ?? "minor");
if (!["minor", "major"].includes(mode)) die(`mode must be minor or major`, 2);

const gain = Number(flag("--gain", audioCfg.gain ?? 0.7));
const outPath = resolve(
  flag("--out", join(dirname(briefPath), "audio", "music.wav")),
);

/* ------------------------------------------------------------------ */
/* pitch                                                               */
/* ------------------------------------------------------------------ */

const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
if (!(keyName in SEMITONES)) die(`unknown key "${keyName}" — A..G`, 2);

/** Equal-temperament frequency, A4 = 440 Hz. */
function hz(semitoneFromA4) {
  return 440 * Math.pow(2, semitoneFromA4 / 12);
}

// Root two octaves below A4 as a bass note, then build the chord from it.
const rootSemitone = SEMITONES[keyName] - 9; // relative to A
const rootBass = hz(rootSemitone - 24 + 12); // ~A1..A2 region
const third = mode === "minor" ? 3 : 4;

/* ------------------------------------------------------------------ */
/* deterministic noise                                                 */
/* ------------------------------------------------------------------ */

let seed = 0x9e3779b9;
function rnd() {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 0xffffffff;
}

/* ------------------------------------------------------------------ */
/* buffers                                                             */
/* ------------------------------------------------------------------ */

const total = Math.ceil(duration * SR);
const left = new Float32Array(total);
const right = new Float32Array(total);

function add(i, v, pan = 0) {
  if (i < 0 || i >= total) return;
  const l = Math.cos(((pan + 1) * Math.PI) / 4);
  const r = Math.sin(((pan + 1) * Math.PI) / 4);
  left[i] += v * l;
  right[i] += v * r;
}

/** Exponential decay envelope, evaluated per sample. */
function decay(t, tau) {
  return Math.exp(-t / tau);
}

/* ------------------------------------------------------------------ */
/* voices                                                              */
/* ------------------------------------------------------------------ */

/** Kick: pitch-swept sine with a fast attack. */
function kick(at, level = 1) {
  const start = Math.round(at * SR);
  const len = Math.round(0.28 * SR);
  for (let n = 0; n < len; n++) {
    const t = n / SR;
    const f = 118 * Math.exp(-t / 0.035) + 44;
    const env = decay(t, 0.085) * (1 - Math.exp(-t / 0.002));
    const v = Math.sin(2 * Math.PI * f * t) * env * 0.9 * level;
    add(start + n, v);
  }
}

/** Clap/snare: filtered noise burst plus a short body tone. */
function clap(at, level = 1) {
  const start = Math.round(at * SR);
  const len = Math.round(0.19 * SR);
  let prev = 0;
  for (let n = 0; n < len; n++) {
    const t = n / SR;
    const white = rnd() * 2 - 1;
    const hp = white - prev; // first-difference high-pass
    prev = white;
    const env = decay(t, 0.045) * (1 - Math.exp(-t / 0.001));
    const body = Math.sin(2 * Math.PI * 185 * t) * decay(t, 0.05) * 0.35;
    add(start + n, (hp * 0.5 + body) * env * 0.55 * level, 0.1);
  }
}

/** Hi-hat: very short high-passed noise. */
function hat(at, level = 1, pan = -0.25) {
  const start = Math.round(at * SR);
  const len = Math.round(0.05 * SR);
  let prev = 0;
  for (let n = 0; n < len; n++) {
    const t = n / SR;
    const white = rnd() * 2 - 1;
    const hp = white - prev * 0.82;
    prev = white;
    add(start + n, hp * decay(t, 0.012) * 0.3 * level, pan);
  }
}

/** Bass: sine plus a touch of second harmonic, shaped per note. */
function bass(at, freq, dur, level = 1) {
  const start = Math.round(at * SR);
  const len = Math.round(dur * SR);
  for (let n = 0; n < len; n++) {
    const t = n / SR;
    const env =
      (1 - Math.exp(-t / 0.008)) * decay(t, dur * 0.55) * Math.min(1, (len - n) / (0.02 * SR));
    const v =
      (Math.sin(2 * Math.PI * freq * t) * 0.8 +
        Math.sin(4 * Math.PI * freq * t) * 0.16) *
      env *
      0.5 *
      level;
    add(start + n, v);
  }
}

/** Pad: detuned additive chord, slow attack, sits under everything. */
function pad(at, freqs, dur, level = 1) {
  const start = Math.round(at * SR);
  const len = Math.round(dur * SR);
  for (const [k, f] of freqs.entries()) {
    const detune = 1 + (k % 2 === 0 ? 0.0016 : -0.0016);
    for (let n = 0; n < len; n++) {
      const t = n / SR;
      const attack = 1 - Math.exp(-t / 0.35);
      const release = Math.min(1, (len - n) / (0.5 * SR));
      const env = attack * release;
      const v =
        (Math.sin(2 * Math.PI * f * detune * t) * 0.5 +
          Math.sin(2 * Math.PI * f * 2 * detune * t) * 0.12 +
          Math.sin(2 * Math.PI * f * 3 * t) * 0.05) *
        env *
        0.13 *
        level;
      add(start + n, v, (k - (freqs.length - 1) / 2) * 0.35);
    }
  }
}

/* ------------------------------------------------------------------ */
/* arrangement                                                         */
/* ------------------------------------------------------------------ */

const beat = 60 / bpm;
const bar = beat * 4;

const PATTERN = {
  calm: { kick: [0], clap: [], hat: 2, bass: 2, pad: 0.9, kickLevel: 0.8 },
  medium: { kick: [0, 2], clap: [1, 3], hat: 2, bass: 4, pad: 0.55, kickLevel: 1 },
  high: { kick: [0, 1, 2, 3], clap: [1, 3], hat: 4, bass: 8, pad: 0.4, kickLevel: 1 },
}[preset];

const chordPad = [
  hz(rootSemitone + 12),
  hz(rootSemitone + 12 + third),
  hz(rootSemitone + 12 + 7),
];
const chordOpen = [
  hz(rootSemitone + 12 + 7),
  hz(rootSemitone + 24),
  hz(rootSemitone + 24 + third),
];

const bars = Math.ceil(duration / bar);

for (let b = 0; b < bars; b++) {
  const t0 = b * bar;
  if (t0 >= duration) break;

  // kick
  for (const q of PATTERN.kick) kick(t0 + q * beat, PATTERN.kickLevel);

  // clap
  for (const q of PATTERN.clap) clap(t0 + q * beat);

  // hats
  const hatStep = beat / PATTERN.hat;
  for (let h = 0; h < PATTERN.hat * 4; h++) {
    const at = t0 + h * hatStep;
    if (at < duration) hat(at, h % 2 === 0 ? 1 : 0.55, h % 2 === 0 ? -0.25 : 0.25);
  }

  // bass: two-note movement, root then fifth
  const bassStep = beat * (4 / PATTERN.bass);
  for (let s = 0; s < PATTERN.bass; s++) {
    const at = t0 + s * bassStep;
    if (at >= duration) break;
    const f = s % PATTERN.bass === PATTERN.bass - 1 ? rootBass * 1.5 : rootBass;
    bass(at, f, bassStep * 0.9, s % 2 === 0 ? 1 : 0.8);
  }

  // pad: chord alternates every bar
  const chord = b % 2 === 0 ? chordPad : chordOpen;
  pad(t0, chord, Math.min(bar * 1.05, duration - t0), PATTERN.pad);
}

/* ------------------------------------------------------------------ */
/* mixdown                                                             */
/* ------------------------------------------------------------------ */

// Soft clip, then normalize so the bed never fights the picture's audio.
let peak = 0;
for (let i = 0; i < total; i++) {
  left[i] = Math.tanh(left[i] * 1.15);
  right[i] = Math.tanh(right[i] * 1.15);
  peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
}

const target = 0.72; // ~ -3 dBFS
const norm = peak > 0 ? target / peak : 1;

function pcm16(x) {
  const v = Math.max(-1, Math.min(1, x * norm * gain));
  return v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
}

/* ------------------------------------------------------------------ */
/* WAV writer                                                          */
/* ------------------------------------------------------------------ */

const dataBytes = total * 2 * 2; // stereo, 16-bit
const buffer = Buffer.alloc(44 + dataBytes);

buffer.write("RIFF", 0, "ascii");
buffer.writeUInt32LE(36 + dataBytes, 4);
buffer.write("WAVE", 8, "ascii");
buffer.write("fmt ", 12, "ascii");
buffer.writeUInt32LE(16, 16); // PCM chunk size
buffer.writeUInt16LE(1, 20); // format = PCM
buffer.writeUInt16LE(2, 22); // channels
buffer.writeUInt32LE(SR, 24);
buffer.writeUInt32LE(SR * 2 * 2, 28); // byte rate
buffer.writeUInt16LE(4, 32); // block align
buffer.writeUInt16LE(16, 34); // bits per sample
buffer.write("data", 36, "ascii");
buffer.writeUInt32LE(dataBytes, 40);

let offset = 44;
for (let i = 0; i < total; i++) {
  buffer.writeInt16LE(pcm16(left[i]), offset);
  buffer.writeInt16LE(pcm16(right[i]), offset + 2);
  offset += 4;
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, buffer);

const seconds = (total / SR).toFixed(2);
if (argv.includes("--json")) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        out: outPath,
        seconds: Number(seconds),
        bpm,
        preset,
        key: keyName,
        mode,
        bytes: buffer.length,
      },
      null,
      2,
    ),
  );
} else {
  console.log(
    `music · ${seconds}s @ ${bpm} BPM · ${keyName} ${mode} · ${preset} · ${(buffer.length / 1024).toFixed(0)} KB`,
  );
  console.log(`  ${outPath}`);
}
