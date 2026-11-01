#!/usr/bin/env node
/**
 * doctor — what is ready to render on this machine, and what would still need the
 * network. It looks at the disk only and never fetches anything, so its answer is
 * a statement about this machine as it stands, including with the network off.
 *
 *   node doctor.mjs --dir ./my-video
 *   node doctor.mjs --dir ./my-video --lane remotion --json
 *
 * Exit codes: 0 ready to render, 1 something a render needs is missing, 2 bad usage.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  PINS,
  capture,
  findBrowser,
  hyperframesHome,
  installedHyperframesVersion,
  installedRemotionVersion,
  missingLocalAssets,
  nativeTool,
  npmCliPath,
  remotionEntry,
  scanExternalAssets,
} from "./toolchain.mjs";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`doctor — render readiness, with no network use

  --dir <path>          project directory (default: cwd)
  --lane <hf|remotion>  which engine to report on (default: detect, else both)
  --json                machine-readable output

"ready" means a render can start. "offline" means it can also finish with the network
off: engine installed, browser present, fonts cached, no external assets.

Exit codes: 0 ready, 1 something a render needs is missing, 2 bad usage.`);
  process.exit(0);
}

const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const dir = resolve(flag("--dir") ?? process.cwd());
if (!existsSync(dir)) {
  console.error(`doctor: directory not found: ${dir}`);
  process.exit(2);
}

function detectLane() {
  const forced = flag("--lane");
  if (forced) return forced === "remotion" ? "remotion" : "hyperframes";
  if (existsSync(join(dir, "package.json")) && /"remotion"\s*:/.test(readFileSync(join(dir, "package.json"), "utf8"))) return "remotion";
  return existsSync(join(dir, "index.html")) ? "hyperframes" : null;
}

const lane = detectLane();
const checks = [];
const check = (id, ok, detail, { need = "render", fix = null } = {}) => checks.push({ id, ok, detail, need, fix });

/* --- runtime ---------------------------------------------------------- */

const nodeMajor = Number(process.versions.node.split(".")[0]);
check("node", nodeMajor >= 22, `Node ${process.versions.node}`, { fix: "HyperFrames and the runtime check need Node 22 or newer" });

/* --- media tools ------------------------------------------------------ */

for (const name of ["ffmpeg", "ffprobe"]) {
  const found = nativeTool(name);
  check(name, Boolean(found && !found.batch), found ? `${found.path}${found.batch ? " (a batch wrapper, which cannot run without a shell)" : ""}` : "not found", {
    fix: `install FFmpeg, or set MOTIONBRIEF_${name.toUpperCase()} to the executable. ${name === "ffmpeg" ? "Music needs it" : "Measuring the finished file needs it"}.`,
  });
}

// Some machines deny new executables write access to the temp folder, which the
// engines encode into. It only shows up as "Permission denied" late in a render.
const ffmpeg = nativeTool("ffmpeg");
if (ffmpeg && !ffmpeg.batch) {
  const probeDir = mkdtempSync(join(tmpdir(), "motionbrief-doctor-"));
  const test = capture(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=16x16:d=0.1", "-c:v", "mpeg4", join(probeDir, "probe.mp4")], { timeout: 20000 });
  check("temp-writable", test.code === 0, test.code === 0 ? tmpdir() : `ffmpeg cannot write to ${tmpdir()}: ${test.stderr.trim().split("\n").pop()}`, {
    fix: "point TMP and TEMP at a folder ffmpeg may write to, before rendering",
  });
  rmSync(probeDir, { recursive: true, force: true });
}

/* --- engine ----------------------------------------------------------- */

if (lane !== "remotion") {
  const version = installedHyperframesVersion();
  check("hyperframes", version === PINS.hyperframes, version ? `${version} in ${hyperframesHome()}` : `${PINS.hyperframes} not installed`, {
    need: "offline",
    fix: `motion-render installs it from the committed lockfile on first use, which needs the network${npmCliPath() ? "" : " and npm"}`,
  });
  const fontCache = join(homedir(), ".cache", "hyperframes", "fonts");
  check("hyperframes-fonts", existsSync(fontCache) && readdirSync(fontCache).length > 0, existsSync(fontCache) ? fontCache : "no font cache", {
    need: "offline",
    fix: "HyperFrames fetches requested Google Fonts on first use and caches them, which needs the network",
  });
}
if (lane === "remotion") {
  const version = installedRemotionVersion(dir);
  check("remotion", Boolean(remotionEntry(dir)), version ? `${version} in ${dir}` : "not installed in this project", { fix: `run "npm ci" in ${dir}` });
  if (version && version !== PINS.remotion) {
    check("remotion-version", false, `${version}, tested with ${PINS.remotion}`, { need: "advisory", fix: "pin it: the runtime check relies on page hooks internal to Remotion" });
  }
  check("remotion-lockfile", existsSync(join(dir, "package-lock.json")), existsSync(join(dir, "package-lock.json")) ? "package-lock.json" : "no lockfile, so versions are not pinned", { need: "advisory", fix: "commit a package-lock.json" });
}

/* --- browser ---------------------------------------------------------- */

const browser = findBrowser(dir);
check("browser", Boolean(browser), browser ?? "no Chrome found", {
  need: "offline",
  fix: "the engine fetches its own on first render, which needs the network. Or set MOTIONBRIEF_CHROME",
});

/* --- the project's own assets ----------------------------------------- */

const external = lane ? scanExternalAssets(dir) : [];
check("external-assets", external.length === 0, external.length === 0 ? "none found in the source" : external.map((a) => a.url).join(", "), {
  need: "offline",
  fix: "fetched at render time. Vendor them to render with no network",
});
const missing = lane ? missingLocalAssets(dir) : [];
check("local-assets", missing.length === 0, missing.length === 0 ? "every literal reference exists" : missing.map((m) => `${m.ref} (in ${m.file})`).join(", "), { fix: "add the missing files" });

/* --- result ----------------------------------------------------------- */

const blocking = checks.filter((c) => !c.ok && c.need === "render");
const offline = checks.filter((c) => !c.ok && c.need === "offline");
const result = {
  lane,
  dir,
  pins: PINS,
  ready: { render: blocking.length === 0, offline: blocking.length === 0 && offline.length === 0 },
  checks,
};

if (args.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`doctor · lane=${lane ?? "unknown"} · ${dir}\n`);
  for (const c of checks) {
    const tag = c.ok ? "ok" : c.need === "render" ? "MISSING" : c.need === "offline" ? "needs net" : "note";
    console.log(`  ${tag.padEnd(10)} ${c.id.padEnd(18)} ${c.detail}`);
    if (!c.ok && c.fix) console.log(`  ${"".padEnd(10)} ${"".padEnd(18)} ${c.fix}`);
  }
  console.log(`\n  ready to render: ${result.ready.render ? "yes" : "no"}`);
  console.log(`  ready to render offline: ${result.ready.offline ? "yes" : "no"}`);
  console.log("  (this reads the disk only. A source scan cannot see a URL built at runtime.)");
}

process.exit(blocking.length > 0 ? 1 : 0);
