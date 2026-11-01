#!/usr/bin/env node
/**
 * check-contract — validate a motionbrief project against the framework contract
 * and against its brief.
 *
 *   node check-contract.mjs --dir ./my-video
 *   node check-contract.mjs --dir ./my-video --lane remotion
 *   node check-contract.mjs --dir ./my-video --brief ./brief.json --json
 *   node check-contract.mjs --dir ./my-video --runtime --report report.json
 *
 * Every mandatory requirement ends in one of three states:
 *
 *   verified    checked, and it matches the brief
 *   failed      checked, and it does not
 *   unverified  could not be checked, so nothing is known about it
 *
 * Unverified is not success. It blocks a render exactly as a failure does, unless
 * that requirement is named with --allow-unverified, which is then recorded.
 *
 * The default run is static: no install, no browser, no network, and no source is
 * ever executed. It proves size, fps, length and scene timings where those are
 * statically resolvable, and that each line of copy is in its own scene's markup.
 * It cannot prove a line is readable; --runtime inspects the composition in a
 * headless browser for that. Neither proves visual quality: palette, easing and
 * layout still need looking at. See "What is checked" in the README.
 *
 * Exit codes: 0 no failures and nothing blocking, 1 failed requirements or contract
 * errors, 2 bad usage, 3 mandatory requirements remain unverified.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, relative, extname } from "node:path";
import { digitsOf, isNumericCopy, textContainsCopy } from "./copy-rules.mjs";

const args = process.argv.slice(2);
const jsonOut = args.includes("--json");
const dirArg = args.indexOf("--dir");
const laneArg = args.indexOf("--lane");
const briefArg = args.indexOf("--brief");
const compositionArg = args.indexOf("--composition");
const reportArg = args.indexOf("--report");
const noBrief = args.includes("--no-brief");
const wantRuntime = args.includes("--runtime");
const preflight = args.includes("--preflight");

if (args.includes("--help") || args.includes("-h")) {
  console.log(`check-contract — contract and brief validation

  --dir <path>          project directory (default: cwd)
  --lane <hf|remotion>  force a lane (default: auto-detect)
  --brief <brief.json>  compare the build with this brief (default: <dir>/brief.json)
  --no-brief            skip the brief comparison; the status says contract-only
  --composition <id>    remotion composition to compare (default: the brief's, else the first)
  --runtime             also inspect the composition in a headless browser: copy
                        visibility and holds, plus anything statics left unverified
  --allow-unverified <id[,id]>
                        accept these unverified requirements, by id or a pattern with
                        * such as "beat.*.copy[*].visible". Failures are never
                        accepted. Everything accepted is printed and recorded.
  --preflight           report unverified requirements but do not exit 3 for them.
                        The status still says unverified; use before an install.
  --report <file>       also write the JSON result to this file
  --json                machine-readable output

Requirements (with a brief):
  format.width|height|fps|duration   the composition matches format.*
  beat.<id>.scene                    a scene explicitly declares this beat
  beat.<id>.timing                   that scene starts and lasts what the brief says
  beat.<id>.copy[n]                  the line is in that scene's own source
  beat.<id>.copy[n].visible          (--runtime) readable in its window, long enough
  beat.<id>.first-frame              (--runtime) visibleAtStart: copy is painted on it

Scene identity:
  hyperframes  data-brief-beat="<id>" on the scene host, else a host whose
               data-composition-id or id is <id> or scene-<id>
  remotion     <Sequence name="<id>">, compared without case

Copy matching ignores case and whitespace, folds curly quotes, decodes entities, and
ignores digit grouping on number-only lines. Other punctuation is significant.

Contract checks (hyperframes):
  * root has data-composition-id, data-width, data-height, data-duration
  * every timed element has id + data-start + data-duration
  * a GSAP timeline is created paused
  * window.__timelines is keyed by the composition id
  * no Math.random / Date.now in composition scripts

Contract checks (remotion):
  * registerRoot present in the entry
  * every <Composition> / <Still> has id, component, durationInFrames, fps,
    width, height
  * no Math.random / Date.now in composition source
  * interpolate calls clamp both ends (advisory)

Exit codes: 0 nothing blocking, 1 failed, 2 bad usage, 3 unverified.`);
  process.exit(0);
}

function readOverrides() {
  const patterns = [];
  args.forEach((a, i) => {
    if (a !== "--allow-unverified") return;
    const value = args[i + 1];
    if (!value || value.startsWith("--")) usage("--allow-unverified needs a requirement id or pattern");
    patterns.push(...value.split(",").map((p) => p.trim()).filter(Boolean));
  });
  for (const p of patterns) {
    // Accepting everything is what the flag exists to prevent.
    if (!/[A-Za-z]/.test(p)) usage(`--allow-unverified "${p}" is too broad — name the requirements`);
  }
  return patterns;
}

function usage(message) {
  console.error(`check-contract: ${message}`);
  process.exit(2);
}

const overridePatterns = readOverrides();

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
    if (["node_modules", ".git", "renders", "out", ".hyperframes"].includes(entry)) continue;
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
      out.push({ name, body: src.slice(m.index, i + 1), start: m.index, end: i + 1 });
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
/* Requirements                                                        */
/* ------------------------------------------------------------------ */

const requirements = [];

function requirement(id, status, { code, file, message, expected, actual, source = "static" } = {}) {
  const entry = { id, status, source };
  if (expected !== undefined) entry.expected = expected;
  if (actual !== undefined) entry.actual = actual;
  if (code) entry.code = code;
  if (file) entry.file = relative(dir, file);
  if (message) entry.message = message;
  requirements.push(entry);
  return entry;
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const fmtS = (s) => `${Number(s.toFixed(3))}s`;
const beatKey = (beat, i) => (beat.id ? String(beat.id) : String(i));

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
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (compositionArg !== -1) data.composition = args[compositionArg + 1];
    return { path, data };
  } catch (e) {
    add("error", "brief_unreadable", path, `brief is not valid JSON — ${e.message}`);
    return null;
  }
}

/** Drop comments so copy that only survives in a comment does not count. */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");
}

/* ------------------------------------------------------------------ */
/* A small HTML tree                                                   */
/* ------------------------------------------------------------------ */

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW_TAGS = new Set(["script", "style"]);
const NON_TEXT_TAGS = new Set(["script", "style", "noscript", "head", "title"]);

function parseHtml(src) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  const open = /<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/y;
  const close = /<\/([a-zA-Z][\w-]*)\s*>/y;
  let i = 0;

  while (i < src.length) {
    if (src[i] !== "<") {
      const next = src.indexOf("<", i);
      const end = next === -1 ? src.length : next;
      stack.at(-1).children.push({ text: src.slice(i, end) });
      i = end;
      continue;
    }
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src[i + 1] === "!") {
      const end = src.indexOf(">", i);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    close.lastIndex = i;
    const closed = close.exec(src);
    if (closed) {
      const tag = closed[1].toLowerCase();
      const at = stack.findLastIndex((n) => n.tag === tag);
      if (at > 0) stack.length = at;
      i = close.lastIndex;
      continue;
    }
    open.lastIndex = i;
    const opened = open.exec(src);
    if (!opened) {
      stack.at(-1).children.push({ text: "<" });
      i++;
      continue;
    }
    i = open.lastIndex;
    const tag = opened[1].toLowerCase();
    const attrs = {};
    for (const a of opened[2].matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      attrs[a[1]] = a[2] ?? a[3] ?? a[4] ?? "";
    }
    const node = { tag, attrs, children: [] };
    stack.at(-1).children.push(node);
    if (RAW_TAGS.has(tag)) {
      const endRe = new RegExp(`</${tag}\\s*>`, "gi");
      endRe.lastIndex = i;
      const end = endRe.exec(src);
      node.children.push({ text: src.slice(i, end ? end.index : src.length) });
      i = end ? endRe.lastIndex : src.length;
    } else if (!VOID_TAGS.has(tag) && !opened[3]) {
      stack.push(node);
    }
  }
  return root;
}

function elementsOf(node, out = []) {
  for (const child of node.children ?? []) {
    if (child.tag) {
      out.push(child);
      elementsOf(child, out);
    }
  }
  return out;
}

/** The text an element's markup would show: never comments, scripts or styles. */
function markupText(node) {
  if (node.text !== undefined) return node.text;
  if (NON_TEXT_TAGS.has(node.tag)) return "";
  return node.children.map(markupText).join("");
}

const scriptsOf = (node) =>
  elementsOf(node)
    .filter((n) => n.tag === "script" && !("src" in n.attrs))
    .map((n) => n.children[0]?.text ?? "");

/* ------------------------------------------------------------------ */
/* JavaScript literals                                                 */
/* ------------------------------------------------------------------ */

/**
 * Tokenize only as far as finding literals and identifiers. This never decides
 * that a literal is rendered, only that it could be: a literal can leave a line
 * unverified for the runtime check, it can never verify one. The one judgement
 * made is that a declaration nothing references cannot display anything.
 */
function tokenizeJs(src) {
  const tokens = [];
  let i = 0;
  let nl = false;
  const push = (type, value) => {
    tokens.push({ type, value, nl });
    nl = false;
  };
  const regexMayStart = () => {
    const prev = tokens.at(-1);
    if (!prev) return true;
    if (prev.type === "punct") return /[(,=:[!&|?{};]/.test(prev.value);
    return prev.value === "return";
  };

  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      nl = true;
      i++;
    } else if (/\s/.test(c)) {
      i++;
    } else if (c === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      i = end === -1 ? src.length : end;
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let value = "";
      while (j < src.length && src[j] !== c && src[j] !== "\n") {
        if (src[j] === "\\") value += src[++j] ?? "";
        else value += src[j];
        j++;
      }
      // An unterminated quote is JSX text such as can't, not a string.
      if (src[j] === c) {
        push("string", value);
        i = j + 1;
      } else {
        i++;
      }
    } else if (c === "`") {
      let j = i + 1;
      let value = "";
      while (j < src.length && src[j] !== "`") {
        if (src[j] === "\\") {
          value += src[++j] ?? "";
          j++;
        } else if (src[j] === "$" && src[j + 1] === "{") {
          let depth = 1;
          j += 2;
          while (j < src.length && depth > 0) {
            if (src[j] === "{") depth++;
            else if (src[j] === "}") depth--;
            j++;
          }
        } else {
          value += src[j++];
        }
      }
      push("string", value);
      i = j + 1;
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[\w$]/.test(src[j])) j++;
      push("ident", src.slice(i, j));
      i = j;
    } else if (/\d/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[\d_.eE]/.test(src[j])) j++;
      push("number", src.slice(i, j).replace(/_/g, ""));
      i = j;
    } else if (c === "/" && regexMayStart()) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== "\n" && (src[j] !== "/" || inClass)) {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        j++;
      }
      i = src[j] === "/" ? j + 1 : i + 1;
    } else {
      push("punct", c);
      i++;
    }
  }
  return tokens;
}

/** The token range of each `const NAME = ...` whose NAME is never used again. */
function deadDeclarations(tokens) {
  const refs = new Map();
  for (const t of tokens) if (t.type === "ident") refs.set(t.value, (refs.get(t.value) ?? 0) + 1);

  const dead = new Set();
  tokens.forEach((t, k) => {
    if (t.type !== "ident" || !["var", "let", "const"].includes(t.value)) return;
    const name = tokens[k + 1];
    if (name?.type !== "ident" || refs.get(name.value) !== 1) return;
    if (tokens[k - 1]?.value === "export") return;

    let depth = 0;
    let j = k + 2;
    for (; j < tokens.length; j++) {
      const v = tokens[j];
      if (v.type === "punct" && "([{".includes(v.value)) depth++;
      else if (v.type === "punct" && ")]}".includes(v.value)) {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && v.type === "punct" && (v.value === ";" || v.value === ",")) break;
      else if (depth === 0 && v.nl && v.type === "ident") break;
      dead.add(j);
    }
  });
  return dead;
}

function literalsOf(src) {
  const tokens = tokenizeJs(src);
  const dead = deadDeclarations(tokens);
  const strings = [];
  const numbers = [];
  tokens.forEach((t, k) => {
    if (dead.has(k)) return;
    if (t.type === "string") strings.push(t.value);
    else if (t.type === "number") numbers.push(t.value);
  });
  return { strings, numbers };
}

/** A body of source that a required line might be rendered from. */
function emptyCandidates() {
  return { strings: [], numbers: [] };
}

function addSource(candidates, src) {
  const { strings, numbers } = literalsOf(src);
  candidates.strings.push(...strings);
  candidates.numbers.push(...numbers);
  // JSX text: between a closing and an opening angle bracket, in live code only.
  for (const m of stripComments(src).matchAll(/>([^<>{}]+)</g)) candidates.strings.push(m[1]);
}

function candidatesContain(candidates, line) {
  if (candidates.strings.some((s) => textContainsCopy(s, line))) return true;
  if (!isNumericCopy(line)) return false;
  const digits = digitsOf(line);
  return candidates.numbers.some((n) => n === digits || (Number(n) === Number(digits) && n !== ""));
}

/* ------------------------------------------------------------------ */
/* Brief ↔ build, shared                                               */
/* ------------------------------------------------------------------ */

const briefBeats = (brief) => (Array.isArray(brief.beats) ? brief.beats : []);

function sceneCountMismatch(beats, scenes, where) {
  add(
    "error",
    "brief_scene_count",
    null,
    `the brief has ${beats.length} beats (${beats.map((b) => b.id).join(", ")}) but ${where} has ${scenes.length} scenes (${scenes.map((s) => s.name).join(", ") || "none"})`,
  );
}

/** Timing is unknown for a beat with no scene: position in the file is not identity. */
function requireScene(beat, i, scene, file, hint) {
  const key = beatKey(beat, i);
  if (scene) {
    requirement(`beat.${key}.scene`, "verified", { actual: scene.name });
    return true;
  }
  requirement(`beat.${key}.scene`, "unverified", {
    code: "brief_scene_unmapped",
    file,
    message: `no scene declares beat "${key}" — ${hint}`,
  });
  requirement(`beat.${key}.timing`, "unverified", {
    code: "brief_timing_unverified",
    file,
    message: `beat "${key}" has no scene to compare with`,
  });
  return false;
}

function requireBeatNumbers(beat, i) {
  const key = beatKey(beat, i);
  if (isNum(beat.start) && isNum(beat.duration)) return true;
  requirement(`beat.${key}.timing`, "unverified", {
    code: "brief_timing_unverified",
    message: `the brief gives beat "${key}" no numeric start and duration`,
  });
  return false;
}

function copyLines(beat, i) {
  const key = beatKey(beat, i);
  if (!Array.isArray(beat.copy)) {
    requirement(`beat.${key}.copy`, "unverified", { code: "brief_copy_unverified", message: `the brief gives beat "${key}" no copy array` });
    return [];
  }
  return beat.copy
    .map((line, n) => ({ id: `beat.${key}.copy[${n}]`, line, n, key }))
    .filter(({ line }) => typeof line === "string" && line.trim() !== "");
}

/* ------------------------------------------------------------------ */
/* Brief ↔ HyperFrames                                                 */
/* ------------------------------------------------------------------ */

function checkBriefHyperFrames(brief) {
  const f = brief.format ?? {};
  const fps = isNum(f.fps) ? f.fps : 30;
  const tol = Math.max(0.011, 0.5 / fps);
  const indexPath = join(dir, "index.html");
  const beats = briefBeats(brief);
  const FORMAT = [
    ["data-width", "width", 0],
    ["data-height", "height", 0],
    ["data-fps", "fps", 0],
    ["data-duration", "duration", tol],
  ];

  if (!existsSync(indexPath)) {
    for (const [, key] of FORMAT) {
      requirement(`format.${key}`, "unverified", { code: "brief_format_unverified", message: "no index.html to compare with the brief" });
    }
    beats.forEach((beat, i) => {
      requireScene(beat, i, null, null, "there is no index.html");
      for (const { id } of copyLines(beat, i)) {
        requirement(id, "unverified", { code: "brief_copy_unverified", message: "there is no index.html, so no scene to look in" });
      }
    });
    return;
  }

  const tree = parseHtml(readFileSync(indexPath, "utf8"));
  const elements = elementsOf(tree);
  const isScene = (el) => "data-composition-src" in el.attrs || "data-brief-beat" in el.attrs;
  const root = elements.find((el) => "data-composition-id" in el.attrs && !isScene(el));

  for (const [attr, key, eps] of FORMAT) {
    const id = `format.${key}`;
    if (!isNum(f[key])) {
      requirement(id, "unverified", { code: "brief_format_unverified", message: `the brief has no numeric format.${key}` });
    } else if (!root || !(attr in root.attrs)) {
      requirement(id, "unverified", {
        code: "brief_format_unverified",
        file: indexPath,
        expected: f[key],
        message: `the composition root has no ${attr} — format.${key} was not compared with the brief`,
      });
    } else {
      const v = Number(root.attrs[attr]);
      if (!Number.isFinite(v) || Math.abs(v - f[key]) > eps) {
        requirement(id, "failed", {
          code: "brief_format_mismatch",
          file: indexPath,
          expected: f[key],
          actual: root.attrs[attr],
          message: `root ${attr}="${root.attrs[attr]}" but the brief's format.${key} is ${f[key]}`,
        });
      } else {
        requirement(id, "verified", { expected: f[key], actual: v });
      }
    }
  }

  const scenes = elements.filter(isScene).map((el) => {
    const srcAttr = el.attrs["data-composition-src"];
    const srcPath = srcAttr ? resolve(dir, srcAttr) : null;
    const missing = srcPath !== null && !existsSync(srcPath);
    const body = srcPath && !missing ? parseHtml(readFileSync(srcPath, "utf8")) : el;
    return {
      name: el.attrs.id ? `#${el.attrs.id}` : el.attrs["data-composition-id"] ?? srcAttr,
      el,
      file: srcPath ?? indexPath,
      missing,
      start: Number(el.attrs["data-start"]),
      duration: Number(el.attrs["data-duration"]),
      markup: missing ? "" : markupText(body),
      scripts: missing ? [] : scriptsOf(body),
    };
  });

  // Text in the root that belongs to no scene, such as a persistent caption.
  const inScene = new Set(scenes.flatMap((s) => [s.el, ...elementsOf(s.el)]));
  const looseMarkup = root
    ? root.children.filter((c) => !inScene.has(c)).map(markupText).join(" ")
    : "";
  // A page-level script drives every scene, so it cannot be pinned to one statically.
  const looseScripts = elements.filter((n) => n.tag === "script" && !("src" in n.attrs) && !inScene.has(n)).map((n) => n.children[0]?.text ?? "");

  const claims = (scene, key) => {
    const { attrs } = scene.el;
    return attrs["data-brief-beat"] !== undefined
      ? attrs["data-brief-beat"] === key
      : attrs["data-composition-id"] === key || attrs.id === key || attrs.id === `scene-${key}`;
  };

  for (const s of scenes) {
    const declared = s.el.attrs["data-brief-beat"];
    if (declared !== undefined && !beats.some((b, i) => beatKey(b, i) === declared)) {
      add("error", "brief_scene_unknown", indexPath, `scene ${s.name} declares data-brief-beat="${declared}", which is not a beat in the brief`);
    }
    if (s.missing) {
      add("error", "brief_scene_source_missing", indexPath, `scene ${s.name} points at ${s.el.attrs["data-composition-src"]}, which does not exist`);
    }
  }
  if (scenes.length > 0 && scenes.length !== beats.length) sceneCountMismatch(beats, scenes, "index.html");

  beats.forEach((beat, i) => {
    const key = beatKey(beat, i);
    const matches = scenes.filter((s) => claims(s, key));
    if (matches.length > 1) {
      add("error", "brief_scene_duplicate", indexPath, `${matches.length} scenes declare beat "${key}": ${matches.map((s) => s.name).join(", ")}`);
    }
    const scene = matches[0] ?? null;
    const lines = copyLines(beat, i);

    const hasScene = requireScene(beat, i, scene, indexPath, `add data-brief-beat="${key}" to its scene host`);
    if (hasScene && requireBeatNumbers(beat, i)) {
      const id = `beat.${key}.timing`;
      if (!Number.isFinite(scene.start) || !Number.isFinite(scene.duration)) {
        requirement(id, "unverified", {
          code: "brief_timing_unverified",
          file: indexPath,
          message: `scene ${scene.name} has no numeric data-start and data-duration — not compared with the brief`,
        });
      } else if (Math.abs(scene.start - beat.start) > tol || Math.abs(scene.duration - beat.duration) > tol) {
        requirement(id, "failed", {
          code: "brief_timing_mismatch",
          file: indexPath,
          expected: { start: beat.start, duration: beat.duration },
          actual: { start: scene.start, duration: scene.duration },
          message: `beat "${key}" is ${fmtS(beat.start)}–${fmtS(beat.start + beat.duration)} in the brief but scene ${scene.name} is ${fmtS(scene.start)}–${fmtS(scene.start + scene.duration)}`,
        });
      } else {
        requirement(id, "verified", { expected: { start: beat.start, duration: beat.duration } });
      }
    }

    for (const { id, line } of lines) {
      if (!scene) {
        requirement(id, "unverified", { code: "brief_copy_unverified", file: indexPath, message: `no scene declares beat "${key}", so ${JSON.stringify(line)} has nowhere to be checked` });
        continue;
      }
      if (textContainsCopy(scene.markup, line)) {
        requirement(id, "verified", { file: scene.file, actual: "in the scene's markup" });
        continue;
      }
      const candidates = emptyCandidates();
      for (const src of scene.scripts) addSource(candidates, src);
      if (candidatesContain(candidates, line)) {
        requirement(id, "unverified", {
          code: "brief_copy_dynamic",
          file: scene.file,
          message: `beat "${key}" copy ${JSON.stringify(line)} is only in the scene's script — whether it is ever displayed needs --runtime`,
        });
        continue;
      }
      if (textContainsCopy(looseMarkup, line)) {
        requirement(id, "unverified", {
          code: "brief_copy_dynamic",
          file: indexPath,
          message: `beat "${key}" copy ${JSON.stringify(line)} is in the root, outside every scene — whether it shows during this beat needs --runtime`,
        });
        continue;
      }
      const elsewhere = scenes.find((s) => s !== scene && textContainsCopy(s.markup, line));
      const pageCandidates = emptyCandidates();
      for (const src of looseScripts) addSource(pageCandidates, src);
      if (!elsewhere && candidatesContain(pageCandidates, line)) {
        requirement(id, "unverified", {
          code: "brief_copy_dynamic",
          file: indexPath,
          message: `beat "${key}" copy ${JSON.stringify(line)} is only in a page-level script — whether it shows during this beat needs --runtime`,
        });
      } else if (elsewhere) {
        requirement(id, "failed", {
          code: "brief_copy_wrong_scene",
          file: scene.file,
          message: `beat "${key}" copy ${JSON.stringify(line)} is not in its scene ${scene.name}; it appears only in ${elsewhere.name}`,
        });
      } else {
        requirement(id, "failed", {
          code: "brief_copy_missing",
          file: scene.file,
          message: `beat "${key}" copy ${JSON.stringify(line)} is not in its scene ${scene.name}. Text in comments, styles and unused variables does not count`,
        });
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Brief ↔ Remotion                                                    */
/* ------------------------------------------------------------------ */

/**
 * Evaluate a timing expression without executing anything: a small parser for
 * numbers, `const` and object-member lookups, arithmetic, Math.round/floor/ceil/
 * min/max/abs and Number()/parseInt()/parseFloat() of a literal. Anything else is
 * null, which makes the requirement unverified rather than guessed.
 */
function evalExpression(expr, lookup) {
  const src = expr.replace(/\bas\s+(?:const|number)\b/g, "").replace(/(\d)_(?=\d)/g, "$1");
  const tokens = src.match(/\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|"[^"]*"|'[^']*'|\S/gi) ?? [];
  let at = 0;
  const peek = () => tokens[at];
  const fail = () => {
    throw new Error("unsupported");
  };
  const MATH = { "Math.round": Math.round, "Math.floor": Math.floor, "Math.ceil": Math.ceil, "Math.min": Math.min, "Math.max": Math.max, "Math.abs": Math.abs };
  const CONVERT = { Number, parseInt: (v) => parseInt(v, 10), parseFloat };

  const sum = () => {
    let v = product();
    while (peek() === "+" || peek() === "-") v = tokens[at++] === "+" ? v + product() : v - product();
    return v;
  };
  const product = () => {
    let v = unary();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = tokens[at++];
      const r = unary();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  };
  const unary = () => {
    if (peek() === "-") {
      at++;
      return -unary();
    }
    if (peek() === "+") {
      at++;
      return unary();
    }
    return atom();
  };
  const callArgs = (allowStrings) => {
    const out = [];
    at++;
    while (peek() !== ")") {
      if (peek() === undefined) fail();
      if (allowStrings && /^["']/.test(peek())) out.push(tokens[at++].slice(1, -1));
      else out.push(sum());
      if (peek() === ",") at++;
    }
    at++;
    return out;
  };
  const atom = () => {
    const t = tokens[at++];
    if (t === undefined) fail();
    if (t === "(") {
      const v = sum();
      if (tokens[at++] !== ")") fail();
      return v;
    }
    if (/^[\d.]/.test(t)) return Number(t);
    if (!/^[A-Za-z_$]/.test(t)) fail();
    if (peek() === "(") {
      if (MATH[t]) return MATH[t](...callArgs(false));
      if (CONVERT[t]) return CONVERT[t](...callArgs(true));
      fail();
    }
    const v = lookup(t);
    if (v === null) fail();
    return v;
  };

  try {
    const v = sum();
    return at === tokens.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

const AMBIGUOUS = Symbol("ambiguous");

function constantTable(src) {
  const scalars = {};
  const objects = {};
  const clean = stripComments(src);
  const set = (table, name, value) => {
    table[name] = name in table && JSON.stringify(table[name]) !== JSON.stringify(value) ? AMBIGUOUS : value;
  };

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
      set(objects, name, objectEntries(clean.slice(at + 1, i)));
    } else {
      const end = clean.slice(at).search(/[;\n]/);
      set(scalars, name, clean.slice(at, end === -1 ? undefined : at + end).trim());
    }
  }
  return { scalars, objects };
}

/** Top-level `key: value` pairs of comment-free object source. Commas in strings are not separators. */
function objectEntries(body) {
  const pieces = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      pieces.push(body.slice(start, i));
      start = i + 1;
    }
  }
  pieces.push(body.slice(start));

  const entries = {};
  for (const piece of pieces) {
    const m = /^\s*["']?([A-Za-z_$][\w$]*)["']?\s*:\s*([\s\S]+?)\s*$/.exec(piece);
    if (m) entries[m[1]] = m[2];
  }
  return entries;
}

/** Same name in the file's own table first; two other files disagreeing is unknown. */
function makeResolver(own, others) {
  const inTable = (t, name, depth) => {
    const [head, key, extra] = name.split(".");
    if (extra !== undefined) return null;
    if (key !== undefined) {
      if (!(head in t.objects)) return undefined;
      const obj = t.objects[head];
      if (obj === AMBIGUOUS || !(key in obj)) return null;
      return evaluate(obj[key], depth + 1);
    }
    if (!(head in t.scalars)) return undefined;
    return t.scalars[head] === AMBIGUOUS ? null : evaluate(t.scalars[head], depth + 1);
  };

  const lookup = (name, depth) => {
    const mine = inTable(own, name, depth);
    if (mine !== undefined) return mine;
    const values = new Set(others.map((t) => inTable(t, name, depth)).filter((v) => v !== undefined));
    return values.size === 1 ? [...values][0] : null;
  };

  const evaluate = (expr, depth = 0) => {
    if (depth > 10 || typeof expr !== "string") return null;
    return evalExpression(expr, (name) => lookup(name, depth));
  };
  return evaluate;
}

/**
 * Where the value of the tag's own attribute starts, or -1. Anything inside another
 * attribute's value is skipped: `from={window.name === "x" ? 0 : 45}` has no `name`.
 */
function jsxAttrValueAt(tagBody, name) {
  let depth = 0;
  let inString = null;
  for (let i = 0; i < tagBody.length; i++) {
    const c = tagBody[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === inString) inString = null;
    } else if (c === '"' || c === "'" || c === "`") {
      inString = c;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
    } else if (depth === 0 && tagBody.startsWith(name, i) && !/[\w$.:-]/.test(tagBody[i - 1] ?? "")) {
      const eq = /^\s*=\s*/.exec(tagBody.slice(i + name.length));
      if (eq) return i + name.length + eq[0].length;
    }
  }
  return -1;
}

/** The expression of a JSX attribute: `name={expr}` or `name="literal"`. */
function jsxAttr(tagBody, name) {
  const at = jsxAttrValueAt(tagBody, name);
  if (at === -1) return undefined;
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

/** A tag plus everything up to its matching close, or just the tag if self-closing. */
function jsxRegion(src, tag) {
  if (tag.body.endsWith("/>")) return src.slice(tag.start, tag.end);
  const name = tag.name.replace("\\", "");
  const re = new RegExp(`<${name.replace(".", "\\.")}\\b|</${name.replace(".", "\\.")}\\s*>`, "g");
  re.lastIndex = tag.end;
  let depth = 1;
  let m;
  while ((m = re.exec(src)) !== null) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return src.slice(tag.start, re.lastIndex);
  }
  return src.slice(tag.start);
}

const SOURCE_EXTS = [".tsx", ".ts", ".jsx", ".js"];

function resolveModule(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [base, ...SOURCE_EXTS.map((e) => base + e), ...SOURCE_EXTS.map((e) => join(base, `index${e}`))];
  return candidates.find((p) => existsSync(p) && statSync(p).isFile()) ?? null;
}

function importsOf(file) {
  const map = new Map();
  const src = stripComments(readFileSync(file, "utf8"));
  for (const m of src.matchAll(/import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["'](\.[^"']+)["']/g)) {
    const target = resolveModule(file, m[2]);
    if (!target) continue;
    for (const part of m[1].replace(/[{}]/g, ",").split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) map.set(name, target);
    }
  }
  return map;
}

/** Every local module a piece of JSX can reach through its component tags. */
function sceneClosure(region, ownerFile) {
  const imports = importsOf(ownerFile);
  const ownerSrc = readFileSync(ownerFile, "utf8");
  const seen = new Set();
  const queue = [];
  for (const m of region.matchAll(/<([A-Z][\w$]*)/g)) {
    const name = m[1];
    if (imports.has(name)) queue.push(imports.get(name));
    else if (new RegExp(`(?:const|function|class)\\s+${escapeRe(name)}\\b`).test(ownerSrc)) queue.push(ownerFile);
  }
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (extname(file) === ".json") continue;
    for (const target of importsOf(file).values()) queue.push(target);
  }
  return [...seen];
}

function checkBriefRemotion(brief) {
  const f = brief.format ?? {};
  const beats = briefBeats(brief);
  const files = walk(dir, (p) => SOURCE_EXTS.includes(extname(p)) && !/remotion\.config/.test(p));
  const tables = new Map(files.map((p) => [p, constantTable(readFileSync(p, "utf8"))]));
  const resolverFor = (file) => makeResolver(tables.get(file), files.filter((p) => p !== file).map((p) => tables.get(p)));
  const FORMAT_KEYS = ["width", "height", "fps", "duration"];

  const allCopyUnverified = (reason) => {
    beats.forEach((beat, i) => {
      for (const { id } of copyLines(beat, i)) requirement(id, "unverified", { code: "brief_copy_unverified", message: reason });
    });
  };

  // --- the composition ---
  let comp = null;
  for (const file of files) {
    for (const tag of extractJsxTags(stripComments(readFileSync(file, "utf8")), ["Composition"])) {
      const id = jsxAttr(tag.body, "id");
      if ((!comp && !brief.composition) || (brief.composition && id === brief.composition)) comp = { file, tag, id };
    }
  }

  if (!comp) {
    const message = brief.composition
      ? `no <Composition id="${brief.composition}"> found — the brief's composition cannot be compared`
      : "no <Composition> found — size and timings were not compared with the brief";
    for (const key of FORMAT_KEYS) requirement(`format.${key}`, "unverified", { code: "brief_format_unverified", message });
    beats.forEach((beat, i) => requireScene(beat, i, null, null, message));
    allCopyUnverified(message);
    return;
  }

  const evalComp = resolverFor(comp.file);
  const value = (attr) => {
    const expr = jsxAttr(comp.tag.body, attr);
    return expr === undefined ? null : evalComp(expr);
  };
  const dynamicMetadata = jsxAttr(comp.tag.body, "calculateMetadata") !== undefined;

  const fps = value("fps") ?? (isNum(f.fps) ? f.fps : 30);
  const expectFrames = isNum(f.duration) && isNum(f.fps) ? Math.round(f.duration * f.fps) : null;
  const checks = [
    ["width", "width", f.width],
    ["height", "height", f.height],
    ["fps", "fps", f.fps],
    ["duration", "durationInFrames", expectFrames],
  ];
  for (const [key, attr, expected] of checks) {
    const id = `format.${key}`;
    if (!isNum(expected)) {
      requirement(id, "unverified", { code: "brief_format_unverified", message: `the brief has no numeric format.${key === "duration" ? "duration and format.fps" : key}` });
      continue;
    }
    const v = dynamicMetadata ? null : value(attr);
    if (v === null) {
      requirement(id, "unverified", {
        code: "brief_format_unverified",
        file: comp.file,
        expected,
        message: dynamicMetadata
          ? `<Composition> uses calculateMetadata, so ${attr} is only known at runtime`
          : `<Composition ${attr}> could not be resolved to a number — not compared with the brief`,
      });
    } else if (Math.abs(v - expected) > (attr === "durationInFrames" ? 1 : 0)) {
      requirement(id, "failed", {
        code: "brief_format_mismatch",
        file: comp.file,
        expected,
        actual: v,
        message: `<Composition id="${comp.id}"> ${attr} is ${v} but the brief implies ${expected}`,
      });
    } else {
      requirement(id, "verified", { expected, actual: v });
    }
  }

  const defaultProps = objectEntries((jsxAttr(comp.tag.body, "defaultProps") ?? "").replace(/^\{|\}$/g, ""));

  // --- the scenes: top-level sequences in the composition's component ---
  const componentName = jsxAttr(comp.tag.body, "component");
  const componentFile = componentName
    ? files.find((p) => new RegExp(`(?:const|function|class)\\s+${escapeRe(componentName)}\\b`).test(readFileSync(p, "utf8")))
    : null;

  if (!componentFile) {
    const message = `could not find the component "${componentName ?? "?"}"`;
    beats.forEach((beat, i) => requireScene(beat, i, null, comp.file, message));
    allCopyUnverified(`${message}, so there are no scenes to look in`);
    return;
  }

  const src = stripComments(readFileSync(componentFile, "utf8"));
  const evalScene = resolverFor(componentFile);
  const total = value("durationInFrames");
  const transitions = /<TransitionSeries\b/.test(src);

  const tags = extractJsxTags(src, ["Sequence", "Series\\.Sequence"]);
  let seriesCursor = 0;
  let seriesKnown = true;
  const scenes = tags
    .sort((a, b) => a.start - b.start)
    .map((tag) => {
      const fromExpr = jsxAttr(tag.body, "from");
      const durExpr = jsxAttr(tag.body, "durationInFrames");
      const isSeries = tag.name.startsWith("Series");
      const opaque = /\{\s*\.\.\./.test(tag.body.split(">")[0]) || (isSeries && jsxAttr(tag.body, "offset") !== undefined);
      let from = opaque ? null : isSeries ? (seriesKnown ? seriesCursor : null) : fromExpr === undefined ? 0 : evalScene(fromExpr);
      const dur = opaque ? null : durExpr === undefined ? (total !== null && from !== null ? total - from : null) : evalScene(durExpr);
      if (isSeries) {
        if (dur === null) seriesKnown = false;
        else seriesCursor += dur;
      }
      const region = jsxRegion(src, tag);
      return { name: jsxAttr(tag.body, "name") ?? `<${tag.name.replace("\\", "")}>`, start: from, duration: dur, region, at: tag.start, end: tag.start + region.length };
    });
  const topLevel = scenes.filter((s) => !scenes.some((o) => o !== s && o.at < s.at && s.end <= o.end));

  if (topLevel.length > 0 && topLevel.length !== beats.length && !transitions) {
    sceneCountMismatch(beats, topLevel, relative(dir, componentFile));
  }

  const claiming = (key) => scenes.filter((s) => s.name.toLowerCase() === key.toLowerCase());
  const candidateFor = (scene) => {
    const candidates = emptyCandidates();
    addSource(candidates, scene.region);
    for (const file of sceneClosure(scene.region, componentFile)) {
      const body = readFileSync(file, "utf8");
      if (extname(file) === ".json") candidates.strings.push(body);
      else addSource(candidates, body);
    }
    for (const [prop, raw] of Object.entries(defaultProps)) {
      if (!new RegExp(`\\b${escapeRe(prop)}\\b`).test(scene.region)) continue;
      addSource(candidates, raw);
    }
    return candidates;
  };

  beats.forEach((beat, i) => {
    const key = beatKey(beat, i);
    const matches = claiming(key);
    if (matches.length > 1) {
      add("error", "brief_scene_duplicate", componentFile, `${matches.length} sequences are named "${key}"`);
    }
    const scene = matches[0] ?? null;
    const lines = copyLines(beat, i);
    const hasScene = requireScene(beat, i, scene, componentFile, `name its sequence <Sequence name="${key}">`);

    if (hasScene && requireBeatNumbers(beat, i)) {
      const id = `beat.${key}.timing`;
      const start = Math.round(beat.start * fps);
      const dur = Math.round(beat.duration * fps);
      if (transitions) {
        requirement(id, "unverified", { code: "brief_timing_unverified", file: componentFile, message: "<TransitionSeries> overlaps scenes — timings were not compared with the brief" });
      } else if (scene.start === null || scene.duration === null) {
        requirement(id, "unverified", {
          code: "brief_timing_unverified",
          file: componentFile,
          expected: { start, duration: dur },
          message: `the timing of <Sequence name="${scene.name}"> could not be resolved to numbers — needs --runtime, with data-brief-beat="${key}" on an element inside the sequence`,
        });
      } else if (Math.abs(scene.start - start) > 1 || Math.abs(scene.duration - dur) > 1) {
        requirement(id, "failed", {
          code: "brief_timing_mismatch",
          file: componentFile,
          expected: { start, duration: dur },
          actual: { start: scene.start, duration: scene.duration },
          message: `beat "${key}" is frames ${start}–${start + dur} in the brief but scene "${scene.name}" is ${scene.start}–${scene.start + scene.duration} (at ${fps} fps)`,
        });
      } else {
        requirement(id, "verified", { expected: { start, duration: dur } });
      }
    }

    const candidates = scene ? candidateFor(scene) : null;
    for (const { id, line } of lines) {
      if (candidates && candidatesContain(candidates, line)) {
        requirement(id, "unverified", {
          code: "brief_copy_dynamic",
          file: componentFile,
          message: `beat "${key}" copy ${JSON.stringify(line)} is in this scene's source, but JSX decides what displays — needs --runtime`,
        });
        continue;
      }
      const other = scenes.find((s) => s !== scene && candidatesContain(candidateFor(s), line));
      if (!scene && (other || files.some((p) => candidatesContain(sourceCandidates(p), line)))) {
        requirement(id, "unverified", { code: "brief_copy_unverified", file: componentFile, message: `no scene declares beat "${key}", so ${JSON.stringify(line)} cannot be placed` });
      } else if (other) {
        requirement(id, "failed", {
          code: "brief_copy_wrong_scene",
          file: componentFile,
          message: `beat "${key}" copy ${JSON.stringify(line)} is not reachable from its scene "${scene.name}"; it appears only under "${other.name}"`,
        });
      } else {
        requirement(id, "failed", {
          code: "brief_copy_missing",
          file: componentFile,
          message: `beat "${key}" copy ${JSON.stringify(line)} is not in the source of its scene. Text in comments and unused variables does not count`,
        });
      }
    }
  });
}

function sourceCandidates(file) {
  const candidates = emptyCandidates();
  addSource(candidates, readFileSync(file, "utf8"));
  return candidates;
}

/* ------------------------------------------------------------------ */
/* Runtime evidence                                                    */
/* ------------------------------------------------------------------ */

const REVIEW_HINT = "Review the frames yourself, then accept it with --allow-unverified";

/**
 * Add what the browser saw. A runtime result can settle what statics left
 * unverified and can contradict what statics verified; it never turns a failure
 * back into a pass, because the runtime check only runs when nothing has failed.
 */
function applyRuntime(result, brief) {
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const settle = (id, status, fields) => {
    const r = byId.get(id);
    if (!r) return;
    delete r.code;
    delete r.message;
    Object.assign(r, { status, source: "runtime" }, fields);
  };

  if (result.status !== "ok") {
    briefBeats(brief).forEach((beat, i) => {
      for (const { id } of copyLines(beat, i)) {
        requirement(`${id}.visible`, "unverified", {
          source: "runtime",
          code: "brief_visibility_unverified",
          message: `the runtime check did not run: ${result.reason}. ${REVIEW_HINT}`,
        });
      }
    });
    return;
  }

  // --- format, when the engine reports its own metadata ---
  if (result.format) {
    const f = brief.format ?? {};
    const rows = [
      ["width", result.format.width, f.width],
      ["height", result.format.height, f.height],
      ["fps", result.format.fps, f.fps],
      ["duration", result.format.durationInFrames, isNum(f.duration) && isNum(f.fps) ? Math.round(f.duration * f.fps) : null],
    ];
    for (const [key, actual, expected] of rows) {
      if (!isNum(expected) || !isNum(actual)) continue;
      const allowed = key === "duration" ? 1 : 0;
      if (Math.abs(actual - expected) > allowed) {
        settle(`format.${key}`, "failed", {
          code: "brief_format_mismatch",
          expected,
          actual,
          message: `the composition reports ${key === "duration" ? "durationInFrames" : key} ${actual} at runtime but the brief implies ${expected}`,
        });
      } else {
        settle(`format.${key}`, "verified", { expected, actual });
      }
    }
  }

  // --- each beat ---
  briefBeats(brief).forEach((beat, i) => {
    const key = beatKey(beat, i);
    const seen = result.beats[key];
    if (!seen) return;

    // Timing statics could not resolve, from which frames the scene is mounted on.
    if (seen.mount && byId.get(`beat.${key}.timing`)?.status === "unverified") {
      const { expected, actualStart, actualEnd, boundaryOk } = seen.mount;
      if (boundaryOk) {
        settle(`beat.${key}.timing`, "verified", { expected });
      } else {
        settle(`beat.${key}.timing`, "failed", {
          code: "brief_timing_mismatch",
          expected,
          actual: { start: actualStart, end: actualEnd },
          message: `beat "${key}" is frames ${expected.start}–${expected.start + expected.duration} in the brief but its scene is mounted on frames ${actualStart ?? "?"}–${actualEnd ?? "?"} at runtime`,
        });
      }
    }

    for (const { id, line, n } of copyLines(beat, i)) {
      const r = seen.copy[n];
      if (!r) continue;
      if (r.present) {
        if (byId.get(id)?.status === "unverified") settle(id, "verified", { actual: "in the DOM during its scene" });
      } else if (byId.get(id)?.status === "unverified") {
        settle(id, "failed", {
          code: "brief_copy_missing",
          message: `beat "${key}" copy ${JSON.stringify(line)} is never in the DOM during its scene (${fmtS(beat.start)}–${fmtS(beat.start + beat.duration)})`,
        });
      }

      const hold = isNum(beat.hold) ? beat.hold : result.defaultHold;
      const visibleId = `${id}.visible`;
      if (!r.present) {
        requirement(visibleId, "failed", { source: "runtime", code: "copy_not_visible", message: `beat "${key}" copy ${JSON.stringify(line)} is never displayed during its scene` });
      } else if (r.visibleSeconds === 0) {
        requirement(visibleId, "failed", {
          source: "runtime",
          code: "copy_not_visible",
          actual: { reasons: r.reasons },
          message: `beat "${key}" copy ${JSON.stringify(line)} is in the DOM but never readable during its scene: ${r.reasons.join(", ") || "unknown"}`,
        });
      } else if (r.longestRun + result.step / 2 < hold) {
        requirement(visibleId, "failed", {
          source: "runtime",
          code: "copy_hold_short",
          expected: { hold },
          actual: { longestRun: r.longestRun, from: r.firstVisibleAt },
          message: `beat "${key}" copy ${JSON.stringify(line)} is readable for ${fmtS(r.longestRun)} but needs ${fmtS(hold)}${isNum(beat.hold) ? " (the brief's hold)" : " (the default minimum)"}`,
        });
      } else {
        requirement(visibleId, "verified", { source: "runtime", actual: { longestRun: r.longestRun, from: r.firstVisibleAt } });
      }
    }

    if (beat.visibleAtStart) {
      const id = `beat.${key}.first-frame`;
      if (seen.firstFrameVisible === undefined) {
        requirement(id, "unverified", { source: "runtime", code: "first_frame_unverified", message: `beat "${key}" sets visibleAtStart but has no copy to look for on its first frame. ${REVIEW_HINT}` });
      } else if (seen.firstFrameVisible) {
        requirement(id, "verified", { source: "runtime" });
      } else if (seen.firstFrameGraphic) {
        requirement(id, "unverified", { source: "runtime", code: "first_frame_unverified", message: `beat "${key}" sets visibleAtStart: none of its copy is on its first frame, but a graphic is, and this check cannot see what it draws. ${REVIEW_HINT}` });
      } else {
        requirement(id, "failed", { source: "runtime", code: "first_frame_empty", message: `beat "${key}" sets visibleAtStart but none of its copy is painted on its first frame` });
      }
    }
  });

  for (const a of result.advisories ?? []) add("warn", a.code, null, a.message);
}

/* ------------------------------------------------------------------ */

if (lane === "hyperframes") checkHyperFrames();
else checkRemotion();

const briefInfo = loadBrief();
if (briefInfo) {
  if (lane === "hyperframes") checkBriefHyperFrames(briefInfo.data);
  else checkBriefRemotion(briefInfo.data);
}

const anyFailure = () => findings.some((f) => f.level === "error") || requirements.some((r) => r.status === "failed");

// Failures stop here: they cost milliseconds to report and a browser adds nothing.
let runtime = null;
if (wantRuntime && briefInfo) {
  if (anyFailure()) {
    runtime = { status: "skipped", reason: "static requirements already failed" };
  } else {
    const { inspectRuntime } = await import("./runtime-check.mjs");
    runtime = await inspectRuntime({ dir, lane, brief: briefInfo.data, composition: briefInfo.data.composition ?? null });
    applyRuntime(runtime, briefInfo.data);
  }
}

/* --- overrides -------------------------------------------------------- */

const globToRe = (p) => new RegExp(`^${p.split("*").map(escapeRe).join(".*")}$`);
const overrides = overridePatterns.map((pattern) => {
  const re = globToRe(pattern);
  const matched = requirements.filter((r) => r.status === "unverified" && re.test(r.id));
  for (const r of matched) r.accepted = true;
  if (matched.length === 0) {
    const failedToo = requirements.some((r) => r.status === "failed" && re.test(r.id));
    add("warn", "override_unused", null, `--allow-unverified ${pattern} matched nothing unverified${failedToo ? " — a failed requirement cannot be accepted" : ""}`);
  }
  return { pattern, accepted: matched.map((r) => r.id) };
});

/* --- result ----------------------------------------------------------- */

for (const r of requirements) {
  if (r.status === "failed") findings.push({ level: "error", code: r.code ?? "requirement_failed", file: r.file ?? null, requirement: r.id, message: r.message ?? r.id });
}

const errors = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");
const unverified = requirements.filter((r) => r.status === "unverified");
const blocking = unverified.filter((r) => !r.accepted);
const accepted = unverified.filter((r) => r.accepted);

const status =
  errors.length > 0
    ? "failed"
    : blocking.length > 0
      ? "unverified"
      : accepted.length > 0
        ? "unverified-accepted"
        : briefInfo
          ? "verified"
          : "contract-only";

const result = {
  schema: 2,
  status,
  ok: errors.length === 0 && blocking.length === 0,
  scope: runtime?.status === "ok" ? "runtime" : "static",
  lane,
  dir,
  brief: briefInfo ? briefInfo.path : null,
  counts: {
    verified: requirements.filter((r) => r.status === "verified").length,
    failed: requirements.filter((r) => r.status === "failed").length,
    unverified: blocking.length,
    accepted: accepted.length,
  },
  errors: errors.length,
  warnings: warns.length,
  findings,
  unverified: unverified.map((r) => ({ id: r.id, code: r.code, file: r.file ?? null, accepted: Boolean(r.accepted), message: r.message })),
  overrides,
  // Not requirements at this scope, so they are named instead of implied.
  notChecked:
    briefInfo && runtime?.status !== "ok"
      ? ["copy visibility and holds: run with --runtime", "palette, easing, transitions and layout: review the frames"]
      : ["palette, easing, transitions and layout: review the frames"],
  runtime: runtime && {
    status: runtime.status,
    reason: runtime.reason ?? null,
    browser: runtime.browser ?? null,
    engine: runtime.engine ?? null,
    step: runtime.step ?? null,
    fonts: runtime.fonts ?? [],
  },
  requirements,
};

if (reportArg !== -1) {
  const reportPath = resolve(args[reportArg + 1] ?? "");
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);
}

if (jsonOut) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const briefLabel = briefInfo ? ` · brief=${relative(process.cwd(), briefInfo.path)}` : " · no brief";
  const scopeLabel = wantRuntime ? ` · runtime=${runtime?.status ?? "none"}` : " · static";
  console.log(`check-contract · lane=${lane} · ${relative(process.cwd(), dir) || "."}${briefLabel}${scopeLabel}\n`);

  for (const f of errors) {
    const where = f.file ? ` ${f.file}` : "";
    console.log(`  ERROR [${f.code}]${where}\n         ${f.message}`);
  }
  for (const r of blocking) {
    console.log(`  UNVERIFIED ${r.id} [${r.code}]\n         ${r.message}`);
  }
  for (const r of accepted) {
    console.log(`  ACCEPTED UNVERIFIED ${r.id} [${r.code}]\n         ${r.message}`);
  }
  for (const f of warns) {
    const where = f.file ? ` ${f.file}` : "";
    console.log(`  advisory [${f.code}]${where}\n         ${f.message}`);
  }

  const { counts } = result;
  console.log(`\n  ${status} — ${counts.verified} verified, ${counts.failed} failed, ${counts.unverified} unverified, ${counts.accepted} accepted; ${errors.length} error(s), ${warns.length} advisory`);
  if (!briefInfo) console.log("  no brief: only the framework contract was checked, nothing was compared");
  for (const line of result.notChecked) {
    if (briefInfo) console.log(`  not checked: ${line}`);
  }
  if (blocking.length > 0 && !preflight) {
    console.log("\n  unverified is not a pass. Resolve these, run with --runtime, or review them and pass --allow-unverified <id>.");
  }
}

process.exit(errors.length > 0 ? 1 : blocking.length > 0 && !preflight ? 3 : 0);
