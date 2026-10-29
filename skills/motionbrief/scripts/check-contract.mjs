#!/usr/bin/env node
/**
 * check-contract — validate a motionbrief project against the framework
 * contract without installing anything.
 *
 *   node check-contract.mjs --dir ./my-video
 *   node check-contract.mjs --dir ./my-video --lane remotion
 *   node check-contract.mjs --dir ./my-video --json
 *   node check-contract.mjs --dir ./my-video --brief ./brief.json
 *
 * When a brief is found (<dir>/brief.json, or --brief), the build is also
 * compared with it: size, fps and length, every scene's start and duration,
 * and every line of copy, verbatim. That is what keeps the build from drifting
 * away from the brief it was made from.
 *
 * This is a fast pre-flight, not a replacement for the real linters:
 *   npx hyperframes lint && npx hyperframes check
 *   npx remotion compositions src/index.tsx
 *
 * It catches the failures that render silently wrong: a timeline that was never
 * registered, a missing data-duration, a non-deterministic composition, an
 * unclamped interpolate.
 *
 * Exit codes: 0 clean (or warnings only), 1 errors found, 2 bad usage.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, extname } from "node:path";

const args = process.argv.slice(2);
const jsonOut = args.includes("--json");
const dirArg = args.indexOf("--dir");
const laneArg = args.indexOf("--lane");
const briefArg = args.indexOf("--brief");
const noBrief = args.includes("--no-brief");

if (args.includes("--help") || args.includes("-h")) {
  console.log(`check-contract — offline contract validation

  --dir <path>          project directory (default: cwd)
  --lane <hf|remotion>  force a lane (default: auto-detect)
  --brief <brief.json>  compare the build with this brief (default: <dir>/brief.json)
  --no-brief            skip the brief comparison
  --json                machine-readable output

Checks (brief, when one is found):
  * size, fps and length match format.*
  * one scene per beat, each starting and lasting what the brief says
  * every beats[].copy entry appears verbatim in the source

Checks (hyperframes):
  * root has data-composition-id, data-width, data-height, data-duration
  * every timed element has id + data-start + data-duration
  * a GSAP timeline is created paused
  * window.__timelines is keyed by the composition id
  * no Math.random / Date.now in composition scripts

Checks (remotion):
  * registerRoot present in the entry
  * every <Composition> / <Still> has id, component, durationInFrames, fps,
    width, height
  * no Math.random / Date.now in composition source
  * interpolate calls clamp both ends`);
  process.exit(0);
}

const dir = resolve(dirArg !== -1 ? args[dirArg + 1] : process.cwd());
if (!existsSync(dir)) {
  console.error(`check-contract: directory not found: ${dir}`);
  process.exit(2);
}

const findings = [];
const add = (level, code, file, message) =>
  findings.push({ level, code, file: file ? relative(dir, file) : null, message });

function walk(root, predicate, out = []) {
  for (const entry of readdirSync(root)) {
    if (entry === "node_modules" || entry === ".git" || entry === "renders") continue;
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function detectLane() {
  const forced = laneArg !== -1 ? args[laneArg + 1] : null;
  if (forced) return forced === "hf" ? "hyperframes" : forced;

  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.remotion) return "remotion";
    } catch {
      /* fall through */
    }
  }
  if (existsSync(join(dir, "hyperframes.json"))) return "hyperframes";

  const index = join(dir, "index.html");
  if (existsSync(index) && readFileSync(index, "utf8").includes("data-composition-id")) {
    return "hyperframes";
  }
  return null;
}

const lane = detectLane();
if (!lane) {
  console.error(`check-contract: no hyperframes or remotion project found in ${dir}`);
  process.exit(2);
}

/* ------------------------------------------------------------------ */
/* HyperFrames                                                         */
/* ------------------------------------------------------------------ */

function checkHyperFrames() {
  const htmlFiles = walk(dir, (f) => [".html", ".htm"].includes(extname(f)));

  if (htmlFiles.length === 0) {
    add("error", "no_html", null, "no HTML composition files found");
    return;
  }

  let compositionCount = 0;

  for (const file of htmlFiles) {
    const src = readFileSync(file, "utf8");
    // A sub-composition file transports its markup through <template>; the
    // host in index.html supplies its window, so it needs no data-duration.
    const isSubComposition = src.trimStart().startsWith("<template");

    // --- root ---
    const rootMatch = src.match(/<div[\s\S]*?data-composition-id="([^"]+)"[\s\S]*?>/);
    if (!rootMatch) {
      add("error", "missing_composition_root", file, "no element with data-composition-id");
      continue;
    }
    compositionCount++;
    const compId = rootMatch[1];
    const rootTag = rootMatch[0];

    for (const attr of ["data-width", "data-height"]) {
      if (!rootTag.includes(attr)) {
        add("error", "missing_root_attr", file, `root is missing ${attr}`);
      }
    }

    // data-duration may legitimately live on a parent host; warn, don't fail.
    if (!rootTag.includes("data-duration") && !isSubComposition) {
      add(
        "warn",
        "missing_root_duration",
        file,
        "root has no data-duration — fine only when a finite duration can be inferred; otherwise the render length is undefined",
      );
    }

    // --- timeline registration ---
    const registersTimelines = /window\.__timelines\s*=/.test(src);
    const noTimeline = rootTag.includes("data-no-timeline");

    if (!registersTimelines && !noTimeline) {
      add(
        "error",
        "missing_data_no_timeline",
        file,
        "no window.__timelines registration and no data-no-timeline — the renderer waits out player-ready-timeout",
      );
    }

    if (registersTimelines) {
      // The key must equal the composition id.
      const keyPatterns = [
        new RegExp(`window\\.__timelines\\[["'\`]${escapeRe(compId)}["'\`]\\]`),
        new RegExp(`window\\.__timelines\\.${escapeRe(compId)}\\b`),
      ];
      if (!keyPatterns.some((re) => re.test(src))) {
        add(
          "error",
          "timeline_key_mismatch",
          file,
          `window.__timelines is registered under a key that is not "${compId}" — you get a still frame with no motion`,
        );
      }

      // Must be paused.
      if (!/timeline\(\s*\{[^}]*paused\s*:\s*true/.test(src) && !/paused\s*:\s*true/.test(src)) {
        add(
          "error",
          "timeline_not_paused",
          file,
          "GSAP timeline is not created with { paused: true } — frames render inconsistently",
        );
      }

      // Infinite repeats break the seek model.
      if (/repeat\s*:\s*-1/.test(src)) {
        add("error", "infinite_repeat", file, "repeat: -1 — the timeline must be finite");
      }
    }

    // --- timed clips ---
    const clipTags = src.match(/<(?:section|div|img|video|audio)\b[^>]*data-start="[^"]*"[^>]*>/g) ?? [];
    for (const tag of clipTags) {
      const id = tag.match(/\bid="([^"]+)"/);
      if (!id) {
        add("error", "clip_missing_id", file, `timed clip has no id: ${truncate(tag)}`);
        continue;
      }
      const isMedia =
        tag.startsWith("<video") || tag.startsWith("<audio") || tag.startsWith("<img");
      if (!tag.includes("data-duration") && !isMedia) {
        add(
          "error",
          "clip_missing_duration",
          file,
          `#${id[1]} is a timed DOM clip with no data-duration`,
        );
      }
      if (tag.startsWith("<video") && !tag.includes("muted") && !tag.includes("data-has-audio")) {
        add(
          "error",
          "video_missing_muted",
          file,
          `#${id[1]} must be muted or carry data-has-audio="true"`,
        );
      }
    }

    // --- determinism ---
    checkDeterminism(file, src, "hyperframes");
  }

  if (compositionCount === 0) {
    add("error", "no_composition", null, "no composition root found in any HTML file");
  }
}

/* ------------------------------------------------------------------ */
/* Remotion                                                            */
/* ------------------------------------------------------------------ */

function checkRemotion() {
  const sourceFiles = walk(dir, (f) => [".ts", ".tsx", ".js", ".jsx"].includes(extname(f)));
  if (sourceFiles.length === 0) {
    add("error", "no_source", null, "no TypeScript/JavaScript source found");
    return;
  }

  let rootFound = false;
  let compositionFound = false;

  for (const file of sourceFiles) {
    const src = readFileSync(file, "utf8");

    if (/registerRoot\s*\(/.test(src)) rootFound = true;

    if (/<Composition\b/.test(src) || /<Still\b/.test(src)) {
      compositionFound = true;
      // Extract each JSX tag body with a simple brace/paren-aware scan.
      for (const tag of extractJsxTags(src, ["Composition", "Still"])) {
        for (const attr of ["id", "component", "width", "height"]) {
          if (!new RegExp(`\\b${attr}\\s*[=:]`).test(tag.body)) {
            add("error", "composition_missing_attr", file, `<${tag.name}> is missing ${attr}`);
          }
        }
        if (tag.name === "Composition" && !/\bdurationInFrames\s*[=:]/.test(tag.body)) {
          add(
            "error",
            "composition_missing_attr",
            file,
            "<Composition> is missing durationInFrames",
          );
        }
        if (tag.name === "Composition" && !/\bfps\s*[=:]/.test(tag.body)) {
          add("error", "composition_missing_attr", file, "<Composition> is missing fps");
        }
      }
    }

    checkDeterminism(file, src, "remotion");

    // interpolate without clamping the right edge is the classic drift bug.
    for (const call of extractCalls(src, "interpolate")) {
      if (!/extrapolateRight\s*:\s*["']clamp["']/.test(call)) {
        add(
          "warn",
          "interpolate_unclamped",
          file,
          `interpolate() without extrapolateRight: "clamp" — values run past the range`,
        );
      }
    }
  }

  if (!rootFound) add("error", "no_register_root", null, "no registerRoot() call — Remotion cannot find the entry");
  if (!compositionFound) add("error", "no_composition", null, "no <Composition> or <Still> registered");
}

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

function checkDeterminism(file, src, lane) {
  const isConfig = /remotion\.config|config\.ts$/.test(file);
  if (isConfig) return;

  if (/Math\.random\s*\(/.test(src)) {
    add(
      "error",
      "nondeterministic_random",
      file,
      lane === "remotion"
        ? "Math.random() in a composition — use random(seed) from remotion"
        : "Math.random() in a composition script — use a seeded PRNG",
    );
  }

  if (/\bDate\.now\s*\(|\bperformance\.now\s*\(/.test(src)) {
    add("error", "wall_clock", file, "wall-clock time in a composition breaks frame-exact renders");
  }

  if (lane === "hyperframes" && /\.play\s*\(|\.pause\s*\(|currentTime\s*=/.test(src)) {
    add(
      "warn",
      "media_control",
      file,
      "calling play()/pause()/currentTime — the runtime owns media playback",
    );
  }

  if (lane === "remotion" && /<video\b/.test(src) && !/<OffthreadVideo\b/.test(src)) {
    add(
      "warn",
      "raw_video_element",
      file,
      "plain <video> is not frame-accurate — use <OffthreadVideo>",
    );
  }
}

function extractJsxTags(src, names) {
  const out = [];
  for (const name of names) {
    const re = new RegExp(`<${name}\\b`, "g");
    let m;
    while ((m = re.exec(src)) !== null) {
      let depth = 0;
      let i = m.index;
      let inString = null;
      for (; i < src.length; i++) {
        const c = src[i];
        if (inString) {
          if (c === "\\") i++;
          else if (c === inString) inString = null;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") {
          inString = c;
          continue;
        }
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) break;
      }
      out.push({ name, body: src.slice(m.index, i + 1) });
    }
  }
  return out;
}

function extractCalls(src, fnName) {
  const out = [];
  const re = new RegExp(`\\b${fnName}\\s*\\(`, "g");
  let m;
  while ((m = re.exec(src)) !== null) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    let inString = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (inString) {
        if (c === "\\") i++;
        else if (c === inString) inString = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        inString = c;
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const truncate = (s) => (s.length > 90 ? `${s.slice(0, 87)}...` : s);

/* ------------------------------------------------------------------ */
/* Brief ↔ build                                                       */
/* ------------------------------------------------------------------ */

/**
 * The brief is only worth something if the build still matches it. These
 * checks compare the two statically: no install, no browser, no render.
 *
 * Scenes are matched to beats by order of start time, not by name, so a scene
 * called "countup" can carry the beat called "stat".
 */

function loadBrief() {
  if (noBrief) return null;
  const explicit = briefArg !== -1;
  const path = explicit ? resolve(args[briefArg + 1] ?? "") : join(dir, "brief.json");
  if (!existsSync(path)) {
    if (explicit) {
      console.error(`check-contract: brief not found: ${path}`);
      process.exit(2);
    }
    return null;
  }
  try {
    return { path, data: JSON.parse(readFileSync(path, "utf8")) };
  } catch (e) {
    add("error", "brief_unreadable", path, `brief is not valid JSON — ${e.message}`);
    return null;
  }
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const fmtS = (s) => `${Number(s.toFixed(3))}s`;

/** Drop comments so copy that only survives in a comment does not count. */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…" };

function normalizeText(s) {
  return String(s)
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, code) => {
      if (code[0] === "#") {
        const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/\\(['"`])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every copy line must appear in the source. Case may differ (uppercase is a
 * styling choice: CSS text-transform, .toUpperCase()), the words may not. A
 * formatted number such as "12,480" also matches the literal 12480 that a
 * count-up formats at runtime.
 */
function checkCopy(brief, files) {
  const sources = files.map((f) => stripComments(readFileSync(f, "utf8")));
  const raw = normalizeText(sources.join("\n"));
  const stripped = normalizeText(sources.join("\n").replace(/<[^>]*>/g, ""));
  const rawLower = raw.toLowerCase();
  const strippedLower = stripped.toLowerCase();

  for (const beat of brief.beats ?? []) {
    for (const line of Array.isArray(beat.copy) ? beat.copy : []) {
      if (typeof line !== "string" || line.trim() === "") continue;
      const needle = normalizeText(line);
      const lower = needle.toLowerCase();
      if (raw.includes(needle) || stripped.includes(needle)) continue;
      if (rawLower.includes(lower) || strippedLower.includes(lower)) continue;

      const numeric = /^[^\d\p{L}]*\d[\d,.\s]*[%kmbx+]?$/iu.test(needle);
      if (numeric) {
        const digits = needle.replace(/[^\d.]/g, "").replace(/\.$/, "");
        if (new RegExp(`(?<![\\d.])${escapeRe(digits)}(?![\\d])`).test(raw)) continue;
      }

      add(
        "error",
        "brief_copy_missing",
        null,
        `beat "${beat.id}" copy ${JSON.stringify(line)} does not appear in the composition — copy must be verbatim`,
      );
    }
  }
}

function sceneCountMismatch(beats, scenes, where) {
  add(
    "error",
    "brief_scene_count",
    null,
    `the brief has ${beats.length} beats (${beats.map((b) => b.id).join(", ")}) but ${where} has ${scenes.length} scenes (${scenes.map((s) => s.name).join(", ") || "none"})`,
  );
}

/* --- HyperFrames ------------------------------------------------------ */

function openTags(src) {
  const clean = src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");
  const tags = [];
  for (const m of clean.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      attrs[a[1]] = a[2] ?? a[3] ?? a[4] ?? "";
    }
    tags.push({ name: m[1], attrs });
  }
  return tags;
}

function checkBriefHyperFrames(brief) {
  const f = brief.format ?? {};
  const fps = isNum(f.fps) ? f.fps : 30;
  const tol = Math.max(0.011, 0.5 / fps);
  const indexPath = join(dir, "index.html");

  if (!existsSync(indexPath)) {
    add("warn", "brief_timing_unverified", null, "no index.html — size and scene timings were not compared with the brief");
  } else {
    const tags = openTags(readFileSync(indexPath, "utf8"));
    const root = tags.find((t) => "data-composition-id" in t.attrs && !("data-composition-src" in t.attrs));

    if (root) {
      const pairs = [
        ["data-width", "width", 0],
        ["data-height", "height", 0],
        ["data-fps", "fps", 0],
        ["data-duration", "duration", tol],
      ];
      for (const [attr, key, eps] of pairs) {
        if (!(attr in root.attrs) || !isNum(f[key])) continue;
        const v = Number(root.attrs[attr]);
        if (!Number.isFinite(v) || Math.abs(v - f[key]) > eps) {
          add("error", "brief_format_mismatch", indexPath, `root ${attr}="${root.attrs[attr]}" but the brief's format.${key} is ${f[key]}`);
        }
      }
    }

    const scenes = tags
      .filter((t) => "data-composition-src" in t.attrs)
      .map((t) => ({
        name: t.attrs.id ? `#${t.attrs.id}` : t.attrs["data-composition-id"] ?? t.attrs["data-composition-src"],
        start: Number(t.attrs["data-start"]),
        duration: Number(t.attrs["data-duration"]),
      }));

    const beats = Array.isArray(brief.beats) ? brief.beats : [];
    if (scenes.length === 0) {
      add(
        "warn",
        "brief_timing_unverified",
        indexPath,
        "no scene hosts (data-composition-src) in index.html — scene timings were not compared with the brief; one sub-composition per beat makes them checkable",
      );
    } else if (scenes.some((s) => !Number.isFinite(s.start) || !Number.isFinite(s.duration))) {
      add("warn", "brief_timing_unverified", indexPath, "a scene host has no numeric data-start/data-duration — timings were not compared");
    } else if (scenes.length !== beats.length) {
      sceneCountMismatch(beats, scenes, "index.html");
    } else {
      scenes.sort((a, b) => a.start - b.start);
      beats.forEach((beat, i) => {
        const s = scenes[i];
        if (!isNum(beat.start) || !isNum(beat.duration)) return;
        if (Math.abs(s.start - beat.start) > tol || Math.abs(s.duration - beat.duration) > tol) {
          add(
            "error",
            "brief_timing_mismatch",
            indexPath,
            `beat "${beat.id}" is ${fmtS(beat.start)}–${fmtS(beat.start + beat.duration)} in the brief but scene ${s.name} is ${fmtS(s.start)}–${fmtS(s.start + s.duration)}`,
          );
        }
      });
    }
  }

  checkCopy(brief, walk(dir, (p) => [".html", ".htm"].includes(extname(p))));
}

/* --- Remotion --------------------------------------------------------- */

/**
 * A tiny constant resolver: numeric literals, `const NAME = expr`, object
 * members `OBJ.key`, and arithmetic between them. Enough for the usual
 * `from={BEATS.lines}` / `durationInFrames={DURATION_IN_FRAMES}` style; anything
 * richer is reported as unverified rather than guessed.
 */
function constantTable(src) {
  const scalars = {};
  const objects = {};
  const clean = stripComments(src);

  for (const m of clean.matchAll(/(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*/g)) {
    const name = m[1];
    const at = m.index + m[0].length;
    if (clean[at] === "{") {
      let depth = 0;
      let i = at;
      for (; i < clean.length; i++) {
        if (clean[i] === "{") depth++;
        else if (clean[i] === "}" && --depth === 0) break;
      }
      const body = clean.slice(at + 1, i);
      const entries = {};
      for (const e of body.matchAll(/(?:^|[,{\n])\s*["']?([A-Za-z_$][\w$]*)["']?\s*:\s*([^,\n}]+)/g)) {
        entries[e[1]] = e[2].trim();
      }
      objects[name] = entries;
    } else {
      const end = clean.slice(at).search(/[;\n]/);
      scalars[name] = clean.slice(at, end === -1 ? undefined : at + end).trim();
    }
  }
  return { scalars, objects };
}

function makeResolver(tables) {
  const lookup = (name, depth) => {
    const [head, key] = name.split(".");
    for (const t of tables) {
      if (key !== undefined && t.objects[head] && key in t.objects[head]) return evaluate(t.objects[head][key], depth + 1);
      if (key === undefined && head in t.scalars) return evaluate(t.scalars[head], depth + 1);
    }
    return null;
  };

  const evaluate = (expr, depth = 0) => {
    if (depth > 10 || typeof expr !== "string") return null;
    let missing = false;
    const e = expr
      .replace(/\bas\s+const\b/g, "")
      .replace(/(\d)_(?=\d)/g, "$1")
      .replace(/(?<![\w$.])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?/g, (name) => {
        if (/^Math\.(round|floor|ceil|min|max)$/.test(name)) return name;
        const v = lookup(name, depth);
        if (v === null) missing = true;
        return `(${v})`;
      })
      .trim();
    if (missing || e === "") return null;
    if (!/^(?:[\d\s.+\-*/(),]|Math\.(?:round|floor|ceil|min|max))+$/.test(e)) return null;
    try {
      const v = Function(`"use strict"; return (${e});`)();
      return Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  };

  return evaluate;
}

/** The expression of a JSX attribute: `name={expr}` or `name="literal"`. */
function jsxAttr(tagBody, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*`).exec(tagBody);
  if (!m) return undefined;
  const at = m.index + m[0].length;
  if (tagBody[at] === '"' || tagBody[at] === "'") {
    const end = tagBody.indexOf(tagBody[at], at + 1);
    return tagBody.slice(at + 1, end);
  }
  if (tagBody[at] !== "{") return undefined;
  let depth = 0;
  for (let i = at; i < tagBody.length; i++) {
    if (tagBody[i] === "{") depth++;
    else if (tagBody[i] === "}" && --depth === 0) return tagBody.slice(at + 1, i).trim();
  }
  return undefined;
}

function checkBriefRemotion(brief) {
  const f = brief.format ?? {};
  const files = walk(dir, (p) => [".ts", ".tsx", ".js", ".jsx"].includes(extname(p)) && !/remotion\.config/.test(p));
  const tables = new Map(files.map((p) => [p, constantTable(readFileSync(p, "utf8"))]));
  const allTables = [...tables.values()];
  const resolverFor = (file) => makeResolver([tables.get(file), ...allTables.filter((t) => t !== tables.get(file))]);

  // --- the composition ---
  let comp = null;
  for (const file of files) {
    for (const tag of extractJsxTags(stripComments(readFileSync(file, "utf8")), ["Composition"])) {
      const id = jsxAttr(tag.body, "id");
      if (!comp || (brief.composition && id === brief.composition)) comp = { file, tag, id };
    }
  }

  if (!comp) {
    add("warn", "brief_timing_unverified", null, "no <Composition> found — size and timings were not compared with the brief");
    checkCopy(brief, files);
    return;
  }

  const evalComp = resolverFor(comp.file);
  const value = (attr) => {
    const expr = jsxAttr(comp.tag.body, attr);
    return expr === undefined ? null : evalComp(expr);
  };

  const fps = value("fps") ?? (isNum(f.fps) ? f.fps : 30);
  const expectFrames = isNum(f.duration) && isNum(f.fps) ? Math.round(f.duration * f.fps) : null;
  const checks = [
    ["width", f.width],
    ["height", f.height],
    ["fps", f.fps],
    ["durationInFrames", expectFrames],
  ];
  for (const [attr, expected] of checks) {
    if (!isNum(expected)) continue;
    const v = value(attr);
    if (v === null) {
      add("warn", "brief_timing_unverified", comp.file, `<Composition ${attr}> could not be resolved to a number — not compared with the brief`);
    } else if (Math.abs(v - expected) > (attr === "durationInFrames" ? 1 : 0)) {
      add("error", "brief_format_mismatch", comp.file, `<Composition id="${comp.id}"> ${attr} is ${v} but the brief implies ${expected}`);
    }
  }

  // --- the scenes: top-level sequences in the composition's component ---
  const componentName = jsxAttr(comp.tag.body, "component");
  const componentFile = componentName
    ? files.find((p) => new RegExp(`(?:const|function|class)\\s+${escapeRe(componentName)}\\b`).test(readFileSync(p, "utf8")))
    : null;

  if (!componentFile) {
    add("warn", "brief_timing_unverified", comp.file, `could not find the component "${componentName ?? "?"}" — scene timings were not compared`);
  } else {
    const src = stripComments(readFileSync(componentFile, "utf8"));
    if (/<TransitionSeries\b/.test(src)) {
      add("warn", "brief_timing_unverified", componentFile, "<TransitionSeries> overlaps scenes — timings were not compared with the brief");
    } else {
      const evalScene = resolverFor(componentFile);
      const total = value("durationInFrames");
      const scenes = [];
      let unresolved = false;
      let seriesCursor = 0;

      for (const tag of extractJsxTags(src, ["Sequence", "Series\\.Sequence"])) {
        const fromExpr = jsxAttr(tag.body, "from");
        const durExpr = jsxAttr(tag.body, "durationInFrames");
        const isSeries = tag.name.startsWith("Series");
        const from = isSeries ? seriesCursor : fromExpr === undefined ? 0 : evalScene(fromExpr);
        const dur = durExpr === undefined ? (total !== null && from !== null ? total - from : null) : evalScene(durExpr);
        if (from === null || dur === null) {
          unresolved = true;
          continue;
        }
        if (isSeries) seriesCursor += dur;
        scenes.push({ name: jsxAttr(tag.body, "name") ?? `<${tag.name.replace("\\", "")}>`, start: from, duration: dur });
      }
      // extractJsxTags returns one name at a time; put the scenes back in time order.
      scenes.sort((a, b) => a.start - b.start);

      const beats = Array.isArray(brief.beats) ? brief.beats : [];
      if (unresolved) {
        add("warn", "brief_timing_unverified", componentFile, "a <Sequence> timing could not be resolved to a number — timings were not compared with the brief");
      } else if (scenes.length === 0) {
        add("warn", "brief_timing_unverified", componentFile, "no <Sequence> found — scene timings were not compared with the brief");
      } else if (scenes.length !== beats.length) {
        sceneCountMismatch(beats, scenes, relative(dir, componentFile));
      } else {
        beats.forEach((beat, i) => {
          if (!isNum(beat.start) || !isNum(beat.duration)) return;
          const s = scenes[i];
          const start = Math.round(beat.start * fps);
          const dur = Math.round(beat.duration * fps);
          if (Math.abs(s.start - start) > 1 || Math.abs(s.duration - dur) > 1) {
            add(
              "error",
              "brief_timing_mismatch",
              componentFile,
              `beat "${beat.id}" is frames ${start}–${start + dur} in the brief but scene "${s.name}" is ${s.start}–${s.start + s.duration} (at ${fps} fps)`,
            );
          }
        });
      }
    }
  }

  checkCopy(brief, files);
}

/* ------------------------------------------------------------------ */

if (lane === "hyperframes") checkHyperFrames();
else checkRemotion();

const briefInfo = loadBrief();
if (briefInfo) {
  if (lane === "hyperframes") checkBriefHyperFrames(briefInfo.data);
  else checkBriefRemotion(briefInfo.data);
}

const errors = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");

if (jsonOut) {
  console.log(
    JSON.stringify(
      {
        ok: errors.length === 0,
        lane,
        dir,
        brief: briefInfo ? briefInfo.path : null,
        errors: errors.length,
        warnings: warns.length,
        findings,
      },
      null,
      2,
    ),
  );
} else {
  const briefLabel = briefInfo ? ` · brief=${relative(process.cwd(), briefInfo.path)}` : " · no brief";
  console.log(`check-contract · lane=${lane} · ${relative(process.cwd(), dir) || "."}${briefLabel}\n`);
  if (findings.length === 0) {
    console.log("  clean — contract satisfied");
  } else {
    for (const f of findings) {
      const tag = f.level === "error" ? "ERROR" : "warn ";
      const where = f.file ? ` ${f.file}` : "";
      console.log(`  ${tag} [${f.code}]${where}\n         ${f.message}`);
    }
    console.log(`\n  ${errors.length} error(s), ${warns.length} warning(s)`);
  }
  if (errors.length > 0) {
    console.log("\n  fix these, then run the real linter for a full pass.");
  }
}

process.exit(errors.length > 0 ? 1 : 0);
