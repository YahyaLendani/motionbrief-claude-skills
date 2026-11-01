#!/usr/bin/env node
/**
 * motion-render — validate and render a motion graphic from either lane, from a
 * brief, or in batch.
 *
 *   node motion-render.mjs --dir ./video --out out.mp4
 *   node motion-render.mjs --brief ./video/brief.json
 *   node motion-render.mjs --brief ./video/brief.json --batch ./video/rows.json --no-audio
 *   node motion-render.mjs --dir ./video --stills 0,45,90
 *
 * The render is gated: a mandatory requirement that fails, or that could not be
 * verified, stops it before any picture is rendered. The finished file is then
 * measured with ffprobe against the brief, and everything used and everything
 * found goes in a report next to the output.
 *
 * No command here passes through a shell. See toolchain.mjs.
 *
 * Exit codes: 0 ok, 1 a step failed, 2 bad usage, 3 mandatory requirements unverified.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HF_CHECK_ENV,
  HF_ENV,
  PINS,
  capture,
  displayCommand,
  engineBrowser,
  ensureHyperframes,
  findBrowser,
  hyperframesEntry,
  installedHyperframesVersion,
  installedRemotionVersion,
  missingLocalAssets,
  nativeTool,
  remotionEntry,
  runInherited,
  scanExternalAssets,
  sha256File,
} from "./toolchain.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const USAGE = `motion-render — validate and render motion graphics

  --dir <path>           project directory (default: cwd, or the brief's folder)
  --brief <brief.json>   read lane, format, fps and slug from a brief
  --batch <rows.json>    render one output per row
  --out-dir <path>       batch output directory (default: <dir>/renders)
  --lane <hf|remotion>   force a lane (default: auto-detect)
  --composition <id>     remotion composition id (default: first in the root)
  --out <path>           output file (default: renders/<slug>.<ext>)
  --format <fmt>         mp4 | webm | mov | gif
  --fps <n>              frame rate (must agree with the brief, if there is one)
  --quality <q>          draft | looks | high   (hyperframes only)
  --stills <frames>      comma-separated frames to render as PNGs (remotion)
  --snapshot             hyperframes: capture beat + seam frames first
  --no-audio             render silent, on either lane: no music bed, no audio stream
  --allow-unverified <id[,id]>
                         accept these requirements as unverified, by id or a pattern
                         with *. Failures are never accepted. Everything accepted is
                         printed and recorded in the report. See check-contract --help;
                         output.* covers the checks on the finished file.
  --no-checks            skip validation entirely and record that in the report
  --no-render            stop after validation
  --dry-run              print the commands, run nothing
  --help                 this text

Audio:
  audio.policy "generated"  the bed is synthesized from the brief and muxed on, on both
                            lanes, for mp4, webm and mov. It needs ffmpeg.
  GIF                       has no audio stream. Refused for a brief with audio unless
                            --no-audio says silence is what you want.
  --batch                   video-only. Refused for a generated bed unless --no-audio.

Checks on the finished file, which need ffprobe:
  output.width|height|fps|duration|container   measured against the brief
  output.audio                                 stream present or absent, as promised
  output.audio-level                           a generated bed is not silent

Lane auto-detection:
  package.json with a remotion dependency            -> remotion
  hyperframes.json, or index.html with a composition -> hyperframes

HyperFrames ${PINS.hyperframes} installs itself once from a committed lockfile, which needs
network. Remotion needs "npm ci" in the project once. doctor.mjs reports what is
ready and what would need network, without using any.

Exit codes: 0 ok, 1 a step failed, 2 bad usage, 3 mandatory requirements unverified.`;

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

function fail(message, code = 2) {
  console.error(`motion-render: ${message}`);
  if (code === 2) console.error("run with --help for usage");
  process.exit(code);
}

const VALUE_FLAGS = new Set(["--dir", "--brief", "--batch", "--out-dir", "--lane", "--composition", "--out", "--format", "--fps", "--quality", "--stills", "--allow-unverified"]);
const SWITCHES = new Set(["--snapshot", "--no-audio", "--no-checks", "--no-render", "--dry-run"]);

for (let i = 0; i < argv.length; i++) {
  if (VALUE_FLAGS.has(argv[i])) i++;
  else if (!SWITCHES.has(argv[i])) fail(`unknown argument "${argv[i]}"`);
}

function readFlag(name, fallback = null) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const value = argv[i + 1];
  if (!value || value.startsWith("--")) fail(`flag ${name} needs a value`);
  return value;
}

const has = (name) => argv.includes(name);

/* ------------------------------------------------------------------ */
/* inputs                                                              */
/* ------------------------------------------------------------------ */

const briefFlag = readFlag("--brief");
const briefPath = briefFlag ? resolve(briefFlag) : null;

const dir = resolve(readFlag("--dir", briefPath ? dirname(briefPath) : process.cwd()));
if (!existsSync(dir)) fail(`directory not found: ${dir}`, 1);

let brief = null;
if (briefPath) {
  if (!existsSync(briefPath)) fail(`brief not found: ${briefPath}`, 1);
  try {
    brief = JSON.parse(readFileSync(briefPath, "utf8"));
  } catch (err) {
    fail(`invalid brief JSON — ${err.message}`, 1);
  }
}

const format = readFlag("--format", brief?.format?.container ?? "mp4");
const fpsFlag = readFlag("--fps");
const fps = fpsFlag ?? (brief?.format?.fps ? String(brief.format.fps) : null);
const quality = readFlag("--quality", "high");
const stillsArg = readFlag("--stills");
const compositionFlag = readFlag("--composition", brief?.composition ?? null);
const batchFlag = readFlag("--batch");
const batchPath = batchFlag ? resolve(batchFlag) : null;
const outDir = resolve(readFlag("--out-dir", batchPath ? join(dir, "renders") : dir));

const noRender = has("--no-render");
const doSnapshot = has("--snapshot");
const dryRun = has("--dry-run");
const noAudio = has("--no-audio");
const noChecks = has("--no-checks");

const allowPatterns = argv.flatMap((a, i) => (a === "--allow-unverified" && i + 1 < argv.length ? argv[i + 1].split(",") : [])).map((p) => p.trim()).filter(Boolean);
if (has("--allow-unverified")) readFlag("--allow-unverified");
for (const p of allowPatterns) {
  if (!/[A-Za-z]/.test(p)) fail(`--allow-unverified "${p}" is too broad — name the requirements`);
}
const isOutputPattern = (p) => p.startsWith("output.");
const allowsOutput = (id) =>
  allowPatterns.filter(isOutputPattern).some((p) => new RegExp(`^${p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(id));

const FORMATS = ["mp4", "webm", "mov", "gif"];
if (!FORMATS.includes(format)) {
  fail(`unknown format "${format}" — expected ${FORMATS.join(", ")}`);
}

const slug = brief?.slug ?? (dir.split(/[\\/]/).filter(Boolean).pop() || "video");
const outPath = resolve(readFlag("--out", join(dir, "renders", `${slug}.${format}`)));

if (extname(outPath).toLowerCase() !== `.${format}` && !batchPath) {
  fail(`--out ${basename(outPath)} does not end in .${format} — the extension must match the format`);
}
if (fpsFlag && brief?.format?.fps && Number(fpsFlag) !== brief.format.fps) {
  fail(`--fps ${fpsFlag} contradicts the brief's format.fps ${brief.format.fps} — change the brief`);
}
if (batchPath && !existsSync(batchPath)) fail(`rows file not found: ${batchPath}`, 1);

/* --- what the audio is supposed to end up as -------------------------- */

const audioPolicy = brief?.audio?.policy ?? "none";

if (!noAudio && audioPolicy !== "none" && format === "gif") {
  fail(`the brief's audio.policy is "${audioPolicy}", but a GIF cannot carry audio. Render mp4, webm or mov for sound, or pass --no-audio for a silent GIF.`);
}
if (!noAudio && audioPolicy === "generated" && batchPath) {
  fail(`the brief's audio.policy is "generated", but --batch is video-only: no bed would be attached to any row. Pass --no-audio to render the rows silent, or render each one on its own to get the music.`);
}

/** "bed" is muxed on by this script, "own" is the composition's, "none" is silence. */
const audioPlan = noAudio ? "none" : audioPolicy === "generated" ? "bed" : audioPolicy === "provided" ? "own" : "none";
const bedPath = join(dir, "audio", "music.wav");
const AUDIO_CODECS = {
  webm: { args: ["-c:a", "libopus", "-b:a", "128k"], encoder: "libopus" },
  mov: { args: ["-c:a", "pcm_s16le"], encoder: "pcm_s16le" },
  mp4: { args: ["-c:a", "aac", "-b:a", "192k"], encoder: "aac" },
};

/* ------------------------------------------------------------------ */
/* lane                                                                */
/* ------------------------------------------------------------------ */

function detectLane(projectDir) {
  const pkgPath = join(projectDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.remotion) return "remotion";
    } catch {
      fail(`unreadable package.json in ${projectDir}`, 1);
    }
  }
  if (existsSync(join(projectDir, "hyperframes.json"))) return "hyperframes";

  const indexPath = join(projectDir, "index.html");
  if (existsSync(indexPath) && readFileSync(indexPath, "utf8").includes("data-composition-id")) {
    return "hyperframes";
  }
  return null;
}

const laneFlag = readFlag("--lane");
const detectedLane = detectLane(dir);
const laneRaw = laneFlag ?? brief?.lane ?? detectedLane;
if (!laneRaw) fail(`no hyperframes or remotion project found in ${dir}`, 1);

const lane = String(laneRaw).toLowerCase();
if (!["hyperframes", "remotion", "hf"].includes(lane)) {
  fail(`unknown lane "${laneRaw}" — expected hyperframes or remotion`);
}
const isHF = lane !== "remotion";
const laneName = isHF ? "hyperframes" : "remotion";
if (!laneFlag && brief?.lane && detectedLane && brief.lane !== detectedLane) {
  fail(`brief says lane "${brief.lane}" but the project looks like ${detectedLane}`);
}

/* ------------------------------------------------------------------ */
/* process helper                                                      */
/* ------------------------------------------------------------------ */

class StepFailed extends Error {
  constructor(step, message, code = 1) {
    super(message);
    this.step = step;
    this.exitCode = code;
  }
}

/** Run one step with inherited stdio, so progress streams as a human wants to read it. */
async function run(label, command, commandArgs, options = {}) {
  console.log(`\n== ${label}\n   ${displayCommand(command, commandArgs)}\n`);
  if (dryRun) return 0;
  let code;
  try {
    code = await runInherited(command, commandArgs, { cwd: options.cwd ?? dir, env: { ...HF_ENV, ...options.env } });
  } catch (err) {
    throw new StepFailed(label, `${label}: ${err.message}`);
  }
  if (code !== 0 && !options.allowExit?.includes(code)) {
    throw new StepFailed(label, `${label} exited with code ${code}`, options.exitCode ?? 1);
  }
  return code;
}

const hf = (sub, ...rest) => [process.execPath, [hyperframesEntry(), sub, ".", ...rest]];
const rm = (sub, ...rest) => [process.execPath, [remotionEntry(dir) ?? join(dir, "node_modules", "@remotion", "cli", "remotion-cli.js"), sub, ...rest]];

/* ------------------------------------------------------------------ */
/* remotion inspection                                                 */
/* ------------------------------------------------------------------ */

function findRemotionEntry() {
  for (const candidate of ["src/index.ts", "src/index.tsx", "src/index.js", "src/index.jsx"]) {
    if (existsSync(join(dir, candidate))) return candidate;
  }
  fail(`no src/index.ts(x) entry point in ${dir}`, 1);
}

function findCompositionId() {
  if (compositionFlag) return compositionFlag;

  const roots = ["src/Root.tsx", "src/Root.ts", "src/Root.jsx", "src/Root.js"]
    .map((p) => join(dir, p))
    .filter((p) => existsSync(p));

  for (const file of roots.length > 0 ? roots : listSource(join(dir, "src"))) {
    const m = readFileSync(file, "utf8").match(/<Composition\b[^>]*?\bid="([^"]+)"/s);
    if (m) return m[1];
  }
  fail(`could not find a <Composition id="..."> — pass --composition <id>`, 1);
}

function listSource(root, out = []) {
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root)) {
    if (entry === "node_modules") continue;
    const full = join(root, entry);
    if (statSync(full).isDirectory()) listSource(full, out);
    else if ([".tsx", ".ts", ".jsx", ".js"].includes(extname(full))) out.push(full);
  }
  return out;
}

function readRows() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(batchPath, "utf8"));
  } catch (err) {
    fail(`invalid rows JSON — ${err.message}`, 1);
  }
  const rows = Array.isArray(parsed) ? parsed : parsed.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    fail(`rows must be a non-empty array, or an object with a "rows" array`, 1);
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* tools that must exist before anything slow starts                   */
/* ------------------------------------------------------------------ */

const tools = { ffmpeg: null, ffprobe: null };

function requireTool(name, why, alternative) {
  const found = nativeTool(name);
  if (!found) {
    const envName = `MOTIONBRIEF_${name.toUpperCase()}`;
    throw new StepFailed("tools", `${name} is needed ${why}, but it is not on PATH. Install FFmpeg (https://ffmpeg.org/download.html), or set ${envName} to it${alternative ? `, ${alternative}` : ""}.`);
  }
  if (found.batch) {
    throw new StepFailed("tools", `${name} resolves to a batch wrapper (${found.path}), which cannot run without a shell. Point MOTIONBRIEF_${name.toUpperCase()} at the real executable.`);
  }
  return found.path;
}

/** The strip route: a provided soundtrack that --no-audio has to remove. */
const needsStrip = () => isHF && noAudio && audioPolicy === "provided" && format !== "gif";

function checkTools() {
  if (noRender) return;

  if (audioPlan === "bed" || needsStrip()) {
    tools.ffmpeg = requireTool("ffmpeg", audioPlan === "bed" ? `to attach the music bed the brief asks for (audio.policy "generated")` : "to remove the provided soundtrack", "or pass --no-audio for a silent render");
    if (audioPlan === "bed") {
      const { encoder } = AUDIO_CODECS[format];
      const listed = capture(tools.ffmpeg, ["-hide_banner", "-encoders"]).stdout;
      if (!new RegExp(`\\b${encoder}\\b`).test(listed)) {
        throw new StepFailed("tools", `this ffmpeg has no ${encoder} encoder, which ${format} audio needs. Use a fuller FFmpeg build, another format, or --no-audio.`);
      }
    }
  }

  const probeCovered = ["output.width", "output.height", "output.fps", "output.duration", "output.container", "output.audio"].every(allowsOutput);
  if (probeCovered) {
    const found = nativeTool("ffprobe");
    tools.ffprobe = found && !found.batch ? found.path : null;
  } else {
    tools.ffprobe = requireTool("ffprobe", "to measure the finished file against the brief", `or accept that with --allow-unverified "output.*"`);
  }
  if (!tools.ffmpeg) {
    const found = nativeTool("ffmpeg");
    tools.ffmpeg = found && !found.batch ? found.path : null;
  }
}

/* ------------------------------------------------------------------ */
/* the finished file                                                   */
/* ------------------------------------------------------------------ */

const ratio = (s) => {
  const [a, b] = String(s ?? "").split("/").map(Number);
  return b ? a / b : a;
};

/** Measure a finished file against the brief. Returns the requirements it found. */
function verifyOutput(file, { expectDuration = true } = {}) {
  const checks = [];
  const add = (id, status, fields = {}) => {
    const accepted = status === "unverified" && allowsOutput(id);
    checks.push({ id, status, ...fields, ...(accepted ? { accepted } : {}) });
  };

  if (!existsSync(file)) {
    add("output.exists", "failed", { message: `the render finished but ${file} does not exist` });
    return { file, checks };
  }
  const notMeasured = (message) => {
    for (const key of ["width", "height", "fps", "duration", "container", "audio"]) add(`output.${key}`, "unverified", { message });
    return { file, checks };
  };
  if (!tools.ffprobe) return notMeasured("ffprobe is not available, so the file was not measured");

  const raw = capture(tools.ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", ...(format === "gif" ? ["-count_frames"] : []), file]);
  let probe;
  try {
    probe = JSON.parse(raw.stdout);
  } catch {
    return notMeasured(`ffprobe could not read the file: ${raw.stderr.slice(0, 200)}`);
  }

  const video = probe.streams.find((s) => s.codec_type === "video");
  const audio = probe.streams.find((s) => s.codec_type === "audio");
  const f = brief?.format ?? {};
  const isGif = format === "gif";
  const measuredDuration = Number(probe.format?.duration);
  // A GIF stores delays in hundredths of a second, so 30 fps alternates 3 and 4 and
  // ffprobe's average reads 33.3. Frames over time is the pace it really plays at.
  const measuredFps = isGif ? Number(video?.nb_read_frames) / measuredDuration : ratio(video?.r_frame_rate);
  const slack = Math.max(2 / (f.fps || 30), 0.1);

  const compare = (id, actual, expected, ok, unit = "") => {
    if (expected === undefined || expected === null) return add(id, "unverified", { actual, message: `the brief states no ${id.slice(7)} to compare with` });
    if (ok) add(id, "verified", { expected, actual });
    else add(id, "failed", { expected, actual, message: `${id} is ${actual}${unit} but the brief says ${expected}${unit}` });
  };

  if (brief) {
    compare("output.width", video?.width, f.width, video?.width === f.width);
    compare("output.height", video?.height, f.height, video?.height === f.height);
    compare("output.fps", Math.round(measuredFps * 1000) / 1000, f.fps, Math.abs(measuredFps - f.fps) < (isGif ? 0.5 : 0.01));
    if (expectDuration) compare("output.duration", measuredDuration, f.duration, Math.abs(measuredDuration - f.duration) <= slack, " s");
  }

  // mov and mp4 share a demuxer name, so the major brand tells them apart.
  const names = String(probe.format?.format_name ?? "").split(",");
  const brand = String(probe.format?.tags?.major_brand ?? "").trim();
  const containerOk = { mp4: names.includes("mp4") && brand !== "qt", mov: names.includes("mov") && brand === "qt", webm: names.includes("webm"), gif: names.includes("gif") }[format];
  if (containerOk) add("output.container", "verified", { expected: format, actual: probe.format.format_name, brand });
  else add("output.container", "failed", { expected: format, actual: probe.format?.format_name, brand, message: `the file is ${probe.format?.format_name} (${brand || "no brand"}), not ${format}` });

  if (audioPlan === "none") {
    if (audio) add("output.audio", "failed", { expected: "no audio stream", actual: audio.codec_name, message: `the file has a ${audio.codec_name} audio stream, but this render should be silent` });
    else add("output.audio", "verified", { expected: "no audio stream", actual: "no audio stream" });
  } else if (!audio) {
    add("output.audio", "failed", { expected: "an audio stream", actual: "no audio stream", message: `the brief's audio.policy is "${audioPolicy}" but the file has no audio stream` });
  } else {
    add("output.audio", "verified", { expected: "an audio stream", actual: audio.codec_name, durationSeconds: Number(audio.duration ?? measuredDuration) });

    if (!tools.ffmpeg) {
      add("output.audio-level", "unverified", { message: "ffmpeg is not available to measure the audio level" });
    } else {
      const level = capture(tools.ffmpeg, ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"]).stderr;
      const peak = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(level)?.[1];
      const mean = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(level)?.[1];
      if (peak === undefined) add("output.audio-level", "unverified", { message: "ffmpeg did not report an audio level" });
      else if (peak === "-inf" || Number(peak) < -60) add("output.audio-level", "failed", { actual: { peak, mean }, message: `the audio stream is silent (peak ${peak} dB)` });
      else add("output.audio-level", "verified", { actual: { peak: Number(peak), mean: Number(mean) } });
    }
  }

  return {
    file,
    sizeBytes: statSync(file).size,
    sha256: sha256File(file),
    video: video && { codec: video.codec_name, pixelFormat: video.pix_fmt, width: video.width, height: video.height, frameRate: video.r_frame_rate, averageFrameRate: video.avg_frame_rate, frames: video.nb_frames },
    audio: audio ? { codec: audio.codec_name, sampleRate: audio.sample_rate, channels: audio.channels, duration: audio.duration ?? null } : null,
    container: { name: probe.format?.format_name, brand: brand || null, duration: measuredDuration, encoder: probe.format?.tags?.encoder ?? null },
    checks,
  };
}

/* ------------------------------------------------------------------ */
/* the report                                                          */
/* ------------------------------------------------------------------ */

const report = {
  schema: 1,
  status: "running",
  failedStep: null,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  command: { script: "motion-render.mjs", args: argv },
  lane: laneName,
  brief: briefPath && existsSync(briefPath) ? { path: briefPath, sha256: sha256File(briefPath) } : null,
  validation: null,
  overrides: allowPatterns,
  environment: { node: process.versions.node, platform: process.platform, arch: process.arch },
  engine: null,
  browser: null,
  encoder: null,
  lockfile: null,
  audio: { policy: audioPolicy, noAudio, plan: audioPlan, bed: null },
  externalAssets: [],
  fonts: [],
  outputs: [],
  notVerified: [],
};

const reportPath = batchPath ? join(outDir, `${slug}.batch.report.json`) : `${outPath}.report.json`;

function finishReport(status, failedStep = null) {
  if (dryRun) return;
  report.status = status;
  report.failedStep = failedStep;
  report.finishedAt = new Date().toISOString();
  try {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`   report: ${reportPath}`);
  } catch (err) {
    console.error(`motion-render: could not write the report: ${err.message}`);
  }
}

function recordEngine() {
  if (isHF) {
    const lock = join(SCRIPT_DIR, "..", "engines", "hyperframes", "package-lock.json");
    report.engine = { name: "hyperframes", version: installedHyperframesVersion(), pinned: PINS.hyperframes };
    if (existsSync(lock)) report.lockfile = { file: lock, sha256: sha256File(lock) };
  } else {
    const lock = join(dir, "package-lock.json");
    report.engine = { name: "remotion", version: installedRemotionVersion(dir), pinned: PINS.remotion };
    report.lockfile = existsSync(lock) ? { file: lock, sha256: sha256File(lock) } : { file: null, note: "this project has no package-lock.json: its versions are not pinned" };
    if (report.engine.version !== PINS.remotion) {
      console.log(`\n   note: this project uses remotion ${report.engine.version}; this skill was tested with ${PINS.remotion}. The runtime check relies on its page hooks.`);
    }
  }
}

function recordEncoder() {
  if (!tools.ffmpeg) return;
  const version = /ffmpeg version (\S+)/.exec(capture(tools.ffmpeg, ["-version"]).stdout)?.[1] ?? null;
  report.encoder = { ffmpeg: { path: tools.ffmpeg, version }, audio: audioPlan === "bed" ? AUDIO_CODECS[format].encoder : null };
}

/* ------------------------------------------------------------------ */
/* steps                                                               */
/* ------------------------------------------------------------------ */

const contractArgs = () => [
  join(SCRIPT_DIR, "check-contract.mjs"),
  "--dir",
  dir,
  "--lane",
  isHF ? "hf" : "remotion",
  ...(briefPath ? ["--brief", briefPath] : []),
  ...(compositionFlag ? ["--composition", compositionFlag] : []),
];

/** Fast and offline, with no engine installed yet: only what fails here stops the run. */
async function staticChecks() {
  if (briefPath) await run("brief — validate", process.execPath, [join(SCRIPT_DIR, "brief.mjs"), briefPath]);
  await run("contract — static (offline, no browser)", process.execPath, [...contractArgs(), "--preflight"]);
}

function checkAssets() {
  const named = (brief?.assets?.files ?? []).map((f) => (typeof f === "string" ? f : f?.path ?? f?.file)).filter(Boolean);
  const missing = [
    ...named.filter((f) => !/^https?:/.test(f) && !existsSync(resolve(dir, f))).map((ref) => ({ ref, file: "brief.json" })),
    ...missingLocalAssets(dir),
  ];
  report.externalAssets = scanExternalAssets(dir);
  if (report.externalAssets.length > 0) {
    console.log("\n   fetched over the network when this renders:");
    for (const a of report.externalAssets) console.log(`     ${a.url}   (${a.file})`);
  }
  if (missing.length > 0) {
    throw new StepFailed("assets", `missing files this project refers to:\n${missing.map((m) => `     ${m.ref}   (referenced by ${m.file})`).join("\n")}`);
  }
}

async function prepareEngine() {
  if (dryRun) return;
  if (isHF) {
    const [major] = process.versions.node.split(".").map(Number);
    if (major < 22) throw new StepFailed("engine", `HyperFrames ${PINS.hyperframes} needs Node 22 or newer; this is ${process.versions.node}.`);
    try {
      await ensureHyperframes();
    } catch (err) {
      throw new StepFailed("engine", err.message);
    }
  } else if (!remotionEntry(dir)) {
    throw new StepFailed("engine", `the remotion lane needs dependencies, and none are installed — run "npm ci" in ${dir}`);
  }
  recordEngine();
  if (!findBrowser(dir)) {
    await run("browser — none found, the engine fetches its own (needs network)", ...(isHF ? [process.execPath, [hyperframesEntry(), "browser", "ensure"]] : rm("browser", "ensure")));
  }
}

/** The gate: every mandatory requirement verified, or explicitly accepted. */
async function runtimeGate() {
  const validationFile = join(dir, "renders", ".video", `${slug}.validation.json`);
  const accepted = allowPatterns.filter((p) => !isOutputPattern(p));
  if (!dryRun) mkdirSync(dirname(validationFile), { recursive: true });

  const code = await run(
    "contract — runtime gate",
    process.execPath,
    [...contractArgs(), "--runtime", "--report", validationFile, ...(accepted.length > 0 ? ["--allow-unverified", accepted.join(",")] : [])],
    { allowExit: [1, 3] },
  );
  if (dryRun) return;

  try {
    const result = JSON.parse(readFileSync(validationFile, "utf8"));
    report.validation = result;
    report.browser = { inspection: result.runtime?.browser ?? null };
    report.fonts = result.runtime?.fonts ?? [];
    report.notVerified.push(...result.unverified.map((u) => u.id));
  } catch {
    if (code === 0) throw new StepFailed("contract", "the validation report could not be read, so nothing is known about this build");
  }
  if (code === 1) throw new StepFailed("contract", "validation failed: the build does not match its brief");
  if (code === 3) {
    throw new StepFailed("contract", `mandatory requirements could not be verified, so this will not render. Fix them, or review them yourself and name them with --allow-unverified <id>`, 3);
  }
}

const REMOTION_CODECS = {
  webm: ["--codec=vp9"],
  mov: ["--codec=prores", "--prores-profile=4444", "--pixel-format=yuva444p10le", "--image-format=png"],
  gif: ["--codec=gif"],
  mp4: [],
};

function muxBed(video, final) {
  return run("mux — music bed", tools.ffmpeg ?? "ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    video,
    "-i",
    bedPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    ...AUDIO_CODECS[format].args,
    "-shortest",
    final,
  ]);
}

function stripAudio(video, final) {
  return run("strip — remove the soundtrack", tools.ffmpeg ?? "ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", video, "-map", "0:v:0", "-c:v", "copy", "-an", final]);
}

function recordOutput(result) {
  report.outputs.push(result);
  for (const c of result.checks) {
    const tag = { verified: "ok", failed: "FAILED", unverified: c.accepted ? "accepted unverified" : "UNVERIFIED" }[c.status];
    console.log(`   ${tag.padEnd(10)} ${c.id}${c.message ? ` — ${c.message}` : c.actual !== undefined ? ` — ${typeof c.actual === "object" ? JSON.stringify(c.actual) : c.actual}` : ""}`);
    if (c.status === "unverified") report.notVerified.push(c.id);
  }
}

function concludeOutputs() {
  const checks = report.outputs.flatMap((o) => o.checks);
  const failed = checks.filter((c) => c.status === "failed");
  if (failed.length > 0) throw new StepFailed("verify", `the finished file does not match the brief: ${failed.map((c) => c.id).join(", ")}`);
  const open = checks.filter((c) => c.status === "unverified" && !c.accepted);
  if (open.length > 0) throw new StepFailed("verify", `the finished file could not be fully measured: ${open.map((c) => c.id).join(", ")}. Accept with --allow-unverified <id>`, 3);
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function renderHyperFrames() {
  await run("lint — static contract", ...hf("lint"));
  await run("check — layout, motion, contrast", ...hf("check"), { env: HF_CHECK_ENV });

  if (doSnapshot) await run("snapshot — beat and seam frames", ...hf("snapshot", "--review"));
  if (noRender) return;

  const flags = ["--format", format, "--quality", quality];
  if (fps) flags.push("--fps", fps);

  if (batchPath) {
    // HyperFrames renders one output per row natively, and chooses their paths.
    await run("render — batch", ...hf("render", "--batch", batchPath, ...flags));
    if (!dryRun) {
      report.outputs.push({ file: null, note: "HyperFrames chooses batch output paths, so these rows were not measured", checks: [] });
      report.notVerified.push("output.* (hyperframes batch rows)");
    }
    return;
  }

  // Everything that is muxed is rendered to a staging file first, so the picture
  // is the same with or without an audio toolchain, and the mux is one ffmpeg call.
  if (audioPlan === "bed" || needsStrip()) {
    const staging = join(dir, "renders", ".video", `${slug}.${format}`);
    if (!dryRun) mkdirSync(dirname(staging), { recursive: true });
    await run("render — picture", ...hf("render", "--output", staging, ...flags));
    await (audioPlan === "bed" ? muxBed(staging, outPath) : stripAudio(staging, outPath));
  } else {
    await run("render", ...hf("render", "--output", outPath, ...flags));
  }
}

async function renderRemotion() {
  const entry = findRemotionEntry();
  const compositionId = findCompositionId();
  console.log(`   entry=${entry} composition=${compositionId}`);

  if (stillsArg) {
    for (const frame of stillsArg.split(",").map((f) => f.trim()).filter(Boolean)) {
      if (!/^\d+$/.test(frame)) fail(`--stills expects whole frame numbers, got "${frame}"`);
      await run(`still @ frame ${frame}`, ...rm("still", entry, compositionId, join(dir, "out", `frame-${frame}.png`), "--frame", frame));
    }
  }
  if (noRender) return;

  const fpsFlags = fps ? ["--fps", fps] : [];
  const codecFlags = REMOTION_CODECS[format];
  // The composition's own sound stays only when that is what the brief asks for.
  const audioFlags = audioPlan === "own" ? [] : ["--muted"];

  if (batchPath) {
    const rows = readRows();
    const propsDir = join(dir, "renders", ".props");
    if (!dryRun) {
      mkdirSync(outDir, { recursive: true });
      mkdirSync(propsDir, { recursive: true });
    }
    for (const [i, row] of rows.entries()) {
      const propsFile = join(propsDir, `row-${String(i).padStart(3, "0")}.json`);
      if (!dryRun) writeFileSync(propsFile, JSON.stringify(row, null, 2));

      const label = row.slug ?? row.id ?? row.title ?? `${slug}-${String(i + 1).padStart(3, "0")}`;
      const file = join(outDir, `${String(label).replace(/[^\w.-]+/g, "-")}.${format}`);

      await run(`render — row ${i + 1}/${rows.length}`, ...rm("render", entry, compositionId, file, `--props=${propsFile}`, ...codecFlags, ...audioFlags, ...fpsFlags));
      if (!dryRun) recordOutput(verifyOutput(file));
    }
    return;
  }

  if (audioPlan === "bed") {
    const staging = join(dir, "renders", ".video", `${slug}.${format}`);
    if (!dryRun) mkdirSync(dirname(staging), { recursive: true });
    await run("render — picture", ...rm("render", entry, compositionId, staging, ...codecFlags, ...audioFlags, ...fpsFlags));
    await muxBed(staging, outPath);
  } else {
    await run("render", ...rm("render", entry, compositionId, outPath, ...codecFlags, ...audioFlags, ...fpsFlags));
  }
}

async function main() {
  const started = Date.now();
  console.log(`motion-render · lane=${laneName} · dir=${dir}${brief ? ` · brief=${basename(briefPath)}` : ""}`);

  if (noChecks) {
    console.log("\n   ! --no-checks: nothing is validated. Whatever renders has not been compared with its brief.");
    report.validation = { skipped: true, reason: "--no-checks" };
  } else {
    await staticChecks();
  }

  // Everything that can refuse this run does so before an install or a render.
  checkAssets();
  if (!dryRun) checkTools();
  if (!dryRun) recordEncoder();

  if (!dryRun && !noRender) mkdirSync(batchPath ? outDir : dirname(outPath), { recursive: true });

  await prepareEngine();
  if (!noChecks) await runtimeGate();

  // The bed comes from the brief that just passed, so picture and music share one beat grid.
  if (audioPlan === "bed" && !noRender) {
    await run("music — synthesize bed", process.execPath, [join(SCRIPT_DIR, "music.mjs"), "--brief", briefPath, "--out", bedPath]);
    if (!dryRun) report.audio.bed = { file: bedPath, sha256: sha256File(bedPath), sizeBytes: statSync(bedPath).size };
  }

  if (isHF) await renderHyperFrames();
  else await renderRemotion();

  if (!dryRun && !noRender) {
    const usedBrowser = engineBrowser(laneName, dir);
    report.browser = { ...(report.browser ?? {}), render: usedBrowser ?? "chosen by the engine" };

    if (!batchPath) {
      console.log(`\n== verify — measure the finished file\n   ${relative(process.cwd(), outPath) || outPath}\n`);
      recordOutput(verifyOutput(outPath));
    }
    concludeOutputs();
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n== done in ${seconds}s`);
  if (!noRender) console.log(batchPath ? `   ${outDir}` : `   ${outPath}`);
  finishReport(noRender ? "validated" : "rendered");
  if (report.notVerified.length > 0) console.log(`   accepted without verification: ${report.notVerified.join(", ")}`);
  if (!dryRun && !noRender) console.log("   not checked by any of this: palette, easing, transitions, layout. Review the frames.");
}

main().catch((err) => {
  console.error(`\nmotion-render: ${err.message}`);
  finishReport("failed", err.step ?? "unknown");
  process.exit(err.exitCode ?? 1);
});
