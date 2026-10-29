#!/usr/bin/env node
/**
 * brief — validate a motionbrief brief, print its summary, and emit the
 * exact render commands. No dependencies, no network, no install.
 *
 *   node brief.mjs brief.json
 *   node brief.mjs brief.json --json
 *   node brief.mjs brief.json --commands
 *   node brief.mjs brief.json --rows rows.json --commands
 *
 * The validator catches in milliseconds what a render reveals in minutes:
 * beats that do not tile the timeline, an empty first frame, a closing line
 * too short to read.
 *
 * Exit codes: 0 clean or warnings only, 1 errors, 2 bad usage.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

const KINDS = {
  logo: ["settle-in", "assemble", "draw-in", "wipe-in"],
  kinetic: ["word-stagger", "rise", "slide", "type-on", "scale-in"],
  stat: ["count", "odometer", "stamp"],
  chart: ["grow", "draw", "sort"],
  lockup: ["settle-in", "rise"],
  "lower-third": ["slide-in", "wipe-in"],
  callout: ["pop", "draw-line"],
  media: ["ken-burns", "parallax"],
};

const TEXT_KINDS = new Set(["kinetic", "lockup", "stat", "lower-third", "callout"]);

const EASES = new Set(["smooth", "snappy", "dramatic", "bouncy", "dreamy", "linear"]);
const ENERGIES = new Set(["calm", "medium", "high"]);
const OVERSHOOT = new Set(["none", "objects-only", "loose"]);
const LANES = new Set(["hyperframes", "remotion"]);
const CONTAINERS = new Set(["mp4", "webm", "mov", "gif"]);

const TOL = 0.011;
const MIN_CLOSING_HOLD = 2.0;
const DURATION_RANGE = [3, 90];

const args = process.argv.slice(2);
const jsonOut = args.includes("--json");
const wantCommands = args.includes("--commands");
const rowsIdx = args.indexOf("--rows");
const briefPath = args.find((a) => !a.startsWith("--") && a !== (rowsIdx === -1 ? null : args[rowsIdx + 1]));

if (args.includes("--help") || args.includes("-h") || !briefPath) {
  console.log(`brief — validate and summarize a motionbrief brief

  node brief.mjs <brief.json>              validate + human summary
  node brief.mjs <brief.json> --json       machine-readable result
  node brief.mjs <brief.json> --commands   exact render commands
  node brief.mjs <brief.json> --rows rows.json --commands

Exit codes: 0 clean or warnings only, 1 errors, 2 bad usage.`);
  process.exit(args.includes("--help") || args.includes("-h") ? 0 : 2);
}

const briefFile = resolve(briefPath);
if (!existsSync(briefFile)) {
  console.error(`brief: file not found: ${briefFile}`);
  process.exit(2);
}

let brief;
try {
  brief = JSON.parse(readFileSync(briefFile, "utf8"));
} catch (err) {
  console.error(`brief: invalid JSON — ${err.message}`);
  process.exit(2);
}

const findings = [];
const err = (code, message) => findings.push({ level: "error", code, message });
const warn = (code, message) => findings.push({ level: "warn", code, message });

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

function num(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function validate() {
  const f = brief.format ?? {};
  const beats = Array.isArray(brief.beats) ? brief.beats : null;

  if (!LANES.has(brief.lane)) err("bad_lane", `lane must be one of ${[...LANES].join(", ")}`);
  if (!brief.slug || typeof brief.slug !== "string") err("missing_slug", "slug is required");

  for (const key of ["width", "height", "fps", "duration"]) {
    if (!num(f[key])) err("missing_format", `format.${key} must be a number`);
  }
  if (f.container && !CONTAINERS.has(f.container)) {
    err("bad_container", `format.container must be one of ${[...CONTAINERS].join(", ")}`);
  }

  if (num(f.duration)) {
    const [lo, hi] = DURATION_RANGE;
    if (f.duration < lo || f.duration > hi) {
      warn(
        "duration_out_of_range",
        `${f.duration}s is outside the ${lo}–${hi}s range for a single motion graphic — split it into scenes`,
      );
    }
  }

  const feel = brief.feel ?? {};
  if (feel.ease && !EASES.has(feel.ease)) {
    err("bad_ease", `feel.ease must be one of ${[...EASES].join(", ")}`);
  }
  if (feel.energy && !ENERGIES.has(feel.energy)) {
    err("bad_energy", `feel.energy must be one of ${[...ENERGIES].join(", ")}`);
  }
  if (feel.overshoot && !OVERSHOOT.has(feel.overshoot)) {
    err("bad_overshoot", `feel.overshoot must be one of ${[...OVERSHOOT].join(", ")}`);
  }

  if (!beats || beats.length === 0) {
    err("no_beats", "beats must be a non-empty array");
    return;
  }

  beats.forEach((beat, i) => {
    const where = `beats[${i}]${beat.id ? ` "${beat.id}"` : ""}`;

    if (!beat.id) err("missing_beat_id", `${where} has no id`);
    if (!num(beat.start)) err("missing_beat_start", `${where} has no numeric start`);
    if (!num(beat.duration) || beat.duration <= 0) {
      err("missing_beat_duration", `${where} has no positive duration`);
    }

    if (!KINDS[beat.kind]) {
      err(
        "unknown_kind",
        `${where} has kind "${beat.kind}" — known kinds: ${Object.keys(KINDS).join(", ")}`,
      );
    } else if (beat.motion && !KINDS[beat.kind].includes(beat.motion)) {
      err(
        "unknown_motion",
        `${where} has motion "${beat.motion}" — ${beat.kind} supports ${KINDS[beat.kind].join(", ")}`,
      );
    }

    if (!Array.isArray(beat.copy)) {
      err("missing_copy", `${where} has no copy array`);
    } else if (TEXT_KINDS.has(beat.kind) && beat.copy.length === 0) {
      err("empty_copy", `${where} is a ${beat.kind} beat with no copy`);
    } else if (beat.copy.some((c) => typeof c !== "string" || c.trim() === "")) {
      err("empty_copy", `${where} has an empty copy entry`);
    }
  });

  if (errorsIn(findings)) return;

  const first = beats[0];
  if (Math.abs(first.start) > TOL) {
    err("first_beat_late", `the first beat starts at ${first.start}s — it must start at 0`);
  }

  for (let i = 1; i < beats.length; i++) {
    const prev = beats[i - 1];
    const expected = prev.start + prev.duration;
    const delta = beats[i].start - expected;
    if (delta > TOL) {
      err(
        "timing_gap",
        `beats[${i}] "${beats[i].id}" starts ${delta.toFixed(2)}s after "${prev.id}" ends — the frame is blank there`,
      );
    } else if (delta < -TOL) {
      err(
        "timing_overlap",
        `beats[${i}] "${beats[i].id}" starts ${Math.abs(delta).toFixed(2)}s before "${prev.id}" ends`,
      );
    }
  }

  const last = beats[beats.length - 1];
  const total = last.start + last.duration;
  if (num(brief.format?.duration) && Math.abs(total - brief.format.duration) > TOL) {
    err(
      "duration_mismatch",
      `beats cover ${total.toFixed(2)}s but format.duration is ${brief.format.duration}s`,
    );
  }

  if (!first.visibleAtStart) {
    warn(
      "empty_first_frame",
      `"${first.id}" does not set visibleAtStart — frame 0 is the thumbnail on every social player and must not be blank`,
    );
  }

  if (!num(last.hold)) {
    warn(
      "closing_hold_short",
      `"${last.id}" has no hold — the closing line cannot be read under ${MIN_CLOSING_HOLD}s`,
    );
  } else if (last.hold < MIN_CLOSING_HOLD) {
    warn(
      "closing_hold_short",
      `"${last.id}" holds ${last.hold}s — under the ${MIN_CLOSING_HOLD}s a closing line needs`,
    );
  }

  validateAudio(beats);
}

/**
 * Audio is the one part of the brief that can be silently out of sync: the bed
 * is synthesized from these numbers, so a bpm that does not divide the scenes
 * produces cuts that land between beats.
 */
function validateAudio(beats) {
  const audio = brief.audio ?? {};
  if (audio.policy === "none" || audio.policy === undefined) return;

  if (!["generated", "provided"].includes(audio.policy)) {
    err("bad_audio_policy", `audio.policy must be generated, provided or none`);
    return;
  }

  if (!num(audio.bpm)) {
    warn(
      "audio_no_bpm",
      "audio.bpm is not set — the bed falls back to 96 BPM and may not land on the cuts",
    );
    return;
  }

  const beatLen = 60 / audio.bpm;
  for (const beat of beats) {
    if (!num(beat.start)) continue;
    const nearest = Math.round(beat.start / beatLen) * beatLen;
    const drift = Math.abs(beat.start - nearest);
    if (drift > 0.02) {
      err(
        "off_beat_grid",
        `"${beat.id}" starts at ${beat.start}s, ${(drift * 1000).toFixed(0)}ms off the nearest beat at ${audio.bpm} BPM — the cut will not land on the grid`,
      );
    }
  }
}

const errorsIn = (list) => list.some((f) => f.level === "error");

validate();

/* ------------------------------------------------------------------ */
/* rendering the summary                                               */
/* ------------------------------------------------------------------ */

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

function beatRows() {
  return (brief.beats ?? []).map((b, i) => {
    const start = num(b.start) ? b.start : 0;
    const dur = num(b.duration) ? b.duration : 0;
    const copy = Array.isArray(b.copy) ? b.copy : [];
    const shown =
      copy.length > 1 ? `"${clip(copy[0], 28)}" +${copy.length - 1}` : `"${clip(copy[0] ?? "", 30)}"`;
    return {
      index: i,
      id: b.id ?? "?",
      time: `${start.toFixed(1)}–${(start + dur).toFixed(1)}s`,
      kind: b.kind ?? "?",
      motion: b.motion ?? "—",
      copy: shown,
    };
  });
}

function printSummary() {
  const f = brief.format ?? {};
  const brand = brief.brand ?? {};
  const feel = brief.feel ?? {};

  console.log(
    `brief · ${brief.slug} · ${brief.lane} · ${f.duration}s ${f.width}x${f.height} @${f.fps} · ${f.container ?? "mp4"}`,
  );
  console.log("");

  const rows = beatRows();
  const header = [pad("BEAT", 18), pad("TIME", 13), pad("KIND", 13), pad("MOTION", 16), "COPY"];
  console.log(`  ${header.join("")}`);
  for (const r of rows) {
    console.log(
      `  ${pad(`${r.index} ${r.id}`, 18)}${pad(r.time, 13)}${pad(r.kind, 13)}${pad(r.motion, 16)}${r.copy}`,
    );
  }
  console.log("");

  const palette = brand.palette ?? {};
  console.log(
    `  feel    energy=${feel.energy ?? "—"} ease=${feel.ease ?? "—"} overshoot=${feel.overshoot ?? "—"} transition=${feel.transition ?? "—"}`,
  );
  if (brand.name) {
    console.log(`  brand   ${brand.name}${brand.tagline ? ` — "${brand.tagline}"` : ""}`);
  }
  if (palette.bg || palette.accent) {
    console.log(
      `  palette bg=${palette.bg ?? "—"} fg=${palette.fg ?? "—"} accent=${palette.accent ?? "—"}`,
    );
  }
  console.log(
    `  assets  ${brief.assets?.policy ?? "none"}   audio ${brief.audio?.policy ?? "none"}`,
  );

  const audio = brief.audio ?? {};
  if (audio.policy && audio.policy !== "none") {
    const beatLen = num(audio.bpm) ? 60 / audio.bpm : null;
    console.log(
      `  music   ${audio.preset ?? "medium"} · ${audio.bpm ?? "—"} BPM · ${audio.key ?? "A"} ${audio.mode ?? "minor"}` +
        (beatLen ? ` · beat every ${beatLen.toFixed(3)}s` : ""),
    );
  }

  const assumptions = Array.isArray(brief.assumptions) ? brief.assumptions : [];
  if (assumptions.length > 0) {
    console.log("");
    console.log("  assumptions");
    for (const a of assumptions) console.log(`    · ${a}`);
  }

  if (findings.length > 0) {
    console.log("");
    for (const f2 of findings) {
      console.log(`  ${f2.level === "error" ? "ERROR" : "warn "} [${f2.code}] ${f2.message}`);
    }
  }

  const errors = findings.filter((x) => x.level === "error").length;
  const warns = findings.length - errors;
  console.log("");
  console.log(
    errors === 0 && warns === 0
      ? "  clean — timing tiles, first frame deliberate, closing line readable"
      : `  ${errors} error(s), ${warns} warning(s)`,
  );
}

/* ------------------------------------------------------------------ */
/* render commands                                                     */
/* ------------------------------------------------------------------ */

function printCommands() {
  const f = brief.format ?? {};
  const dir = dirname(briefFile);
  const ext = f.container ?? "mp4";
  const isHF = brief.lane === "hyperframes";
  const out = isHF
    ? join(dir, "renders", `${brief.slug}.${ext}`)
    : join(dir, "renders", `${brief.slug}.${ext}`);

  console.log("");
  console.log("  render");
  if (isHF) {
    console.log(`    cd ${dir}`);
    if (brief.audio?.policy === "generated") {
      console.log(`    node <skill>/scripts/music.mjs --brief brief.json --out audio/music.wav`);
    }
    console.log(`    npx hyperframes lint .`);
    console.log(`    npx hyperframes check .`);
    if (rowsPath) {
      console.log(
        `    npx hyperframes render . --batch ${rowsPath} --output renders/ --format ${ext}`,
      );
    } else {
      console.log(`    npx hyperframes render . --output ${out} --format ${ext}`);
    }
  } else {
    const comp = brief.composition ?? "LaunchCard";
    const codec =
      ext === "webm"
        ? " --codec=vp9"
        : ext === "mov"
          ? " --codec=prores --pixel-format=yuva444p10le"
          : ext === "gif"
            ? " --codec=gif"
            : "";
    console.log(`    cd ${dir}`);
    if (rowsPath) {
      console.log(
        `    node scripts/motion-render.mjs --dir . --batch ${rowsPath} --out-dir renders/`,
      );
    } else {
      console.log(
        `    npx remotion render src/index.tsx ${comp} ${out}${codec}`,
      );
    }
  }
}

const rowsPath = rowsIdx !== -1 ? args[rowsIdx + 1] : null;
if (rowsPath && !existsSync(resolve(rowsPath))) {
  err("missing_rows", `rows file not found: ${resolve(rowsPath)}`);
}

/* ------------------------------------------------------------------ */
/* output                                                              */
/* ------------------------------------------------------------------ */

if (jsonOut) {
  console.log(
    JSON.stringify(
      {
        ok: !errorsIn(findings),
        slug: brief.slug,
        lane: brief.lane,
        duration: brief.format?.duration,
        beats: beatRows(),
        findings,
      },
      null,
      2,
    ),
  );
} else {
  printSummary();
  if (wantCommands && !errorsIn(findings)) printCommands();
}

process.exit(errorsIn(findings) ? 1 : 0);
