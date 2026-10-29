#!/usr/bin/env node
/**
 * motion-render — validate and render a motion graphic from either lane, from a
 * brief, or in batch.
 *
 *   node motion-render.mjs --dir ./video --out out.mp4
 *   node motion-render.mjs --brief ./video/brief.json
 *   node motion-render.mjs --brief ./video/brief.json --batch ./video/rows.json
 *   node motion-render.mjs --dir ./video --stills 0,45,90
 *
 * Exit codes: 0 ok, 1 a step failed, 2 bad usage.
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, dirname, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

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
  --fps <n>              frame rate
  --quality <q>          draft | looks | high   (hyperframes only)
  --stills <frames>      comma-separated frames to render as PNGs (remotion)
  --snapshot             hyperframes: capture beat + seam frames first
  --no-audio             skip the synthesized music bed
  --no-checks            skip brief.mjs and check-contract.mjs (they run first by default)
  --no-render            stop after validation
  --dry-run              print the commands, run nothing
  --help                 this text

Lane auto-detection:
  package.json with a remotion dependency            -> remotion
  hyperframes.json, or index.html with a composition -> hyperframes

HyperFrames needs no install (npx). Remotion needs "npm install" once.`;

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

function readFlag(name, fallback = null) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const value = argv[i + 1];
  if (!value || value.startsWith("--")) fail(`flag ${name} needs a value`);
  return value;
}

const has = (name) => argv.includes(name);

function fail(message, code = 2) {
  console.error(`motion-render: ${message}`);
  if (code === 2) console.error("run with --help for usage");
  process.exit(code);
}

/* ------------------------------------------------------------------ */
/* inputs                                                              */
/* ------------------------------------------------------------------ */

const briefFlag = readFlag("--brief");
const briefPath = briefFlag ? resolve(briefFlag) : null;

const dir = resolve(
  readFlag("--dir", briefPath ? dirname(briefPath) : process.cwd()),
);
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
const fps = readFlag("--fps", brief?.format?.fps ? String(brief.format.fps) : null);
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

const FORMATS = ["mp4", "webm", "mov", "gif"];
if (!FORMATS.includes(format)) {
  fail(`unknown format "${format}" — expected ${FORMATS.join(", ")}`);
}

const slug = brief?.slug ?? (dir.split(/[\\/]/).filter(Boolean).pop() || "video");
const outPath = resolve(readFlag("--out", join(dir, "renders", `${slug}.${format}`)));

/** Path to the synthesized bed, or null when the render should stay silent. */
const audioBed =
  !noAudio && brief?.audio?.policy === "generated" ? join(dir, "audio", "music.wav") : null;

if (batchPath && !existsSync(batchPath)) fail(`rows file not found: ${batchPath}`, 1);

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

const forcedLane = readFlag("--lane", brief?.lane ?? null);
const laneRaw = forcedLane ?? detectLane(dir);
if (!laneRaw) fail(`no hyperframes or remotion project found in ${dir}`, 1);

const lane = String(laneRaw).toLowerCase();
if (!["hyperframes", "remotion", "hf"].includes(lane)) {
  fail(`unknown lane "${laneRaw}" — expected hyperframes or remotion`);
}
const isHF = lane !== "remotion";
if (brief?.lane && brief.lane !== (isHF ? "hyperframes" : "remotion") && !forcedLane) {
  fail(`brief says lane "${brief.lane}" but the project looks like ${isHF ? "hyperframes" : "remotion"}`);
}

/* ------------------------------------------------------------------ */
/* process helper                                                      */
/* ------------------------------------------------------------------ */

/**
 * Spawn a CLI with inherited stdio. Inherit (not pipe) keeps agent sandboxes
 * happy and streams progress the way a human wants to read it.
 *
 * Windows needs a shell because the npm shims are .cmd files. A shell re-parses
 * the command line, so everything — the executable included — is quoted into a
 * single string rather than passed as an args array. `C:\Program Files\nodejs`
 * is exactly the path that breaks the array form.
 */
function quoteWin(s) {
  const v = String(s);
  return /[\s"]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

function run(label, command, commandArgs, options = {}) {
  const useShell = process.platform === "win32";

  return new Promise((resolvePromise, rejectPromise) => {
    console.log(`\n== ${label}\n   ${[command, ...commandArgs].join(" ")}\n`);
    if (dryRun) return resolvePromise(0);

    const execOptions = {
      cwd: options.cwd ?? dir,
      stdio: "inherit",
      env: { ...process.env, ...(options.env ?? {}) },
    };

    const child = useShell
      ? spawn([command, ...commandArgs].map(quoteWin).join(" "), {
          ...execOptions,
          shell: true,
        })
      : spawn(command, commandArgs, execOptions);

    child.on("error", (err) => rejectPromise(new Error(`${label}: ${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) return resolvePromise(0);
      rejectPromise(new Error(`${label} exited with code ${code}`));
    });
  });
}

const hf = (sub, ...rest) => ["npx", ["--yes", "hyperframes", sub, ".", ...rest]];
const rm = (sub, ...rest) => ["npx", ["remotion", sub, ...rest]];

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

/**
 * Attach the synthesized bed to a finished picture. The composition itself
 * stays video-only, so the render never depends on an engine's audio mixer.
 */
function muxAudio(videoPath, finalPath) {
  const audioCodec =
    format === "webm"
      ? ["-c:a", "libopus", "-b:a", "128k"]
      : format === "mov"
        ? ["-c:a", "pcm_s16le"]
        : ["-c:a", "aac", "-b:a", "192k"];

  return run("mux — music bed", "ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    videoPath,
    "-i",
    audioBed,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    ...audioCodec,
    "-shortest",
    finalPath,
  ]);
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const started = Date.now();
  console.log(
    `motion-render · lane=${isHF ? "hyperframes" : "remotion"} · dir=${dir}${brief ? ` · brief=${basename(briefPath)}` : ""}`,
  );

  // Offline checks first: they take milliseconds and fail before any render
  // time is spent. The contract check also compares the build with the brief.
  if (!noChecks) {
    if (briefPath) {
      await run("brief — validate", process.execPath, [join(SCRIPT_DIR, "brief.mjs"), briefPath]);
    }
    await run("contract — offline pre-flight", process.execPath, [
      join(SCRIPT_DIR, "check-contract.mjs"),
      "--dir",
      dir,
      "--lane",
      isHF ? "hf" : "remotion",
      ...(briefPath ? ["--brief", briefPath] : []),
    ]);
  }

  if (isHF) {
    // The bed is synthesized from the brief's own beat grid, so it has to exist
    // before the mux. Deterministic: same brief, same WAV.
    if (audioBed) {
      await run("music — synthesize bed", process.execPath, [
        join(SCRIPT_DIR, "music.mjs"),
        "--brief",
        briefPath,
        "--out",
        join(dir, "audio", "music.wav"),
      ]);
    }

    await run("lint — static contract", ...hf("lint"));
    await run("check — layout, motion, contrast", ...hf("check"));

    if (doSnapshot) {
      await run("snapshot — beat and seam frames", ...hf("snapshot", "--review"));
    }

    if (!noRender) {
      const flags = ["--format", format, "--quality", quality];
      if (fps) flags.push("--fps", fps);

      if (batchPath) {
        // HyperFrames renders one output per row natively. Batch stays
        // video-only: one output path per row is the tool's to choose.
        await run("render — batch", ...hf("render", "--batch", batchPath, ...flags));
      } else if (audioBed && format !== "gif") {
        // Render picture to a staging path, then mux. The composition stays
        // video-only, so the picture is identical with or without an audio
        // toolchain and the mux is one inspectable ffmpeg call.
        const staging = join(dir, "renders", ".video", `${slug}.${format}`);
        if (!dryRun) mkdirSync(dirname(staging), { recursive: true });
        await run("render — picture", ...hf("render", "--output", staging, ...flags));
        await muxAudio(staging, outPath);
      } else {
        await run("render", ...hf("render", "--output", outPath, ...flags));
      }
    }
  } else {
    if (!dryRun && !existsSync(join(dir, "node_modules"))) {
      fail(`remotion lane needs dependencies — run "npm install" in ${dir}`, 1);
    }

    const entry = findRemotionEntry();
    const compositionId = findCompositionId();
    console.log(`   entry=${entry} composition=${compositionId}`);

    if (stillsArg) {
      for (const frame of stillsArg.split(",").map((f) => f.trim()).filter(Boolean)) {
        if (!/^\d+$/.test(frame)) fail(`--stills expects whole frame numbers, got "${frame}"`);
        await run(
          `still @ frame ${frame}`,
          ...rm("still", entry, compositionId, join(dir, "out", `frame-${frame}.png`), "--frame", frame),
        );
      }
    }

    const codecFlags =
      format === "webm"
        ? ["--codec=vp9"]
        : format === "mov"
          ? ["--codec=prores", "--pixel-format=yuva444p10le"]
          : format === "gif"
            ? ["--codec=gif"]
            : [];

    if (!noRender) {
      if (batchPath) {
        const rows = readRows();
        if (!dryRun) mkdirSync(outDir, { recursive: true });
        const propsDir = join(dir, "renders", ".props");
        if (!dryRun) mkdirSync(propsDir, { recursive: true });

        for (const [i, row] of rows.entries()) {
          const propsFile = join(propsDir, `row-${String(i).padStart(3, "0")}.json`);
          if (!dryRun) writeFileSync(propsFile, JSON.stringify(row, null, 2));

          const label =
            row.slug ?? row.id ?? row.title ?? `${slug}-${String(i + 1).padStart(3, "0")}`;
          const file = join(outDir, `${String(label).replace(/[^\w.-]+/g, "-")}.${format}`);

          await run(
            `render — row ${i + 1}/${rows.length}`,
            ...rm("render", entry, compositionId, file, `--props=${propsFile}`, ...codecFlags, ...(fps ? ["--fps", fps] : [])),
          );
        }
      } else {
        await run(
          "render",
          ...rm("render", entry, compositionId, outPath, ...codecFlags, ...(fps ? ["--fps", fps] : [])),
        );
      }
    }
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n== done in ${seconds}s`);
  if (!noRender) {
    console.log(batchPath ? `   ${outDir}` : `   ${outPath}`);
  }
}

main().catch((err) => {
  console.error(`\nmotion-render: ${err.message}`);
  process.exit(1);
});
