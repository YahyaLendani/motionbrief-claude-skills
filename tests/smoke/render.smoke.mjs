// Real renders on both engines, measured with ffprobe. These need ffmpeg, a network
// on first run (engine installs, the gsap CDN, font and browser downloads) and a few
// minutes, so they are apart from the fast suite: npm run test:smoke.
//
// Anything the environment cannot run is reported as a skip with the reason, never
// as a pass. Output, logs and contact sheets for the visual review go in .smoke/.

import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, SKILL } from "../helpers.mjs";

const { PINS, capture, nativeTool, npmCliPath } = await import(pathToFileURL(join(SKILL, "scripts", "toolchain.mjs")).href);

const SMOKE = join(ROOT, ".smoke");
const OUT = join(SMOKE, "out");
const LOGS = join(SMOKE, "logs");
const TMP = join(SMOKE, "tmp");
const FIXTURES = join(ROOT, "tests", "smoke", "fixtures");
const RENDER = join(SKILL, "scripts", "motion-render.mjs");
const CHECK = join(SKILL, "scripts", "check-contract.mjs");
const MUSIC = join(SKILL, "scripts", "music.mjs");

const ffmpeg = nativeTool("ffmpeg");
const ffprobe = nativeTool("ffprobe");
const media = ffmpeg && ffprobe && !ffmpeg.batch && !ffprobe.batch;
const nodeOk = Number(process.versions.node.split(".")[0]) >= 22;
const SKIP = !media ? "ffmpeg and ffprobe are not available" : !nodeOk ? "needs Node 22 or newer" : false;

// Windows only: Chrome keeps a Unix socket in TMPDIR elsewhere, and a path this deep is
// over the length limit, so it exits before the runtime check can run.
const ENV = { ...process.env, MOTIONBRIEF_ENGINE_DIR: join(SMOKE, "engines"), ...(process.platform === "win32" ? { TMP, TEMP: TMP } : {}) };
const LONG = { timeout: 15 * 60 * 1000 };

const evidence = { node: process.versions.node, platform: process.platform, arch: process.arch, pins: PINS, renders: {} };

function sh(name, command, args, cwd) {
  const res = spawnSync(command, args, { cwd, env: ENV, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  mkdirSync(LOGS, { recursive: true });
  writeFileSync(join(LOGS, `${name}.log`), `${res.stdout ?? ""}\n--- stderr ---\n${res.stderr ?? ""}`);
  return { code: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}`, stdout: res.stdout ?? "" };
}

const render = (name, args, cwd) => sh(name, process.execPath, [RENDER, ...args], cwd);
const contract = (name, dir) => {
  const r = sh(name, process.execPath, [CHECK, "--dir", dir, "--runtime", "--json"], dir);
  return { ...r, json: JSON.parse(r.stdout) };
};

function probe(file) {
  const raw = capture(ffprobe.path, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  assert.equal(raw.code, 0, raw.stderr);
  const json = JSON.parse(raw.stdout);
  const video = json.streams.find((s) => s.codec_type === "video");
  const audio = json.streams.find((s) => s.codec_type === "audio");
  const [a, b] = video.r_frame_rate.split("/").map(Number);
  const [c, d] = video.avg_frame_rate.split("/").map(Number);
  return {
    width: video.width,
    height: video.height,
    fps: a / b,
    avgFps: c / d,
    videoCodec: video.codec_name,
    pixelFormat: video.pix_fmt,
    audioCodec: audio?.codec_name ?? null,
    audioDuration: audio ? Number(audio.duration ?? json.format.duration) : null,
    sampleRate: audio?.sample_rate ?? null,
    duration: Number(json.format.duration),
    formatName: json.format.format_name,
    brand: (json.format.tags?.major_brand ?? "").trim(),
    bytes: Number(json.format.size),
  };
}

function peakDb(file) {
  const err = capture(ffmpeg.path, ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"]).stderr;
  const peak = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(err)?.[1];
  assert.ok(peak !== undefined, err.slice(-300));
  return peak === "-inf" ? -Infinity : Number(peak);
}

/** Stretches where the whole frame is background: a beat with nothing on it. */
function blackGaps(file) {
  const err = capture(ffmpeg.path, ["-hide_banner", "-nostats", "-i", file, "-vf", "blackdetect=d=0.06:pic_th=0.999:pix_th=0.12", "-an", "-f", "null", "-"]).stderr;
  return [...err.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

/** First, settled, seam and final frames, tiled for a person to look at. */
function contactSheet(file, name, frames) {
  const sheet = join(OUT, `${name}-contact.png`);
  const select = frames.map((f) => `eq(n,${f})`).join("+");
  const res = capture(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-vf", `select='${select}',scale=320:-1,tile=3x2`, "-frames:v", "1", "-fps_mode", "vfr", sheet]);
  assert.equal(res.code, 0, res.stderr);
  return sheet;
}

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function assertMatchesBrief(p, { duration = 3 } = {}) {
  assert.equal(p.width, 640);
  assert.equal(p.height, 360);
  assert.ok(Math.abs(p.fps - 30) < 0.01, `fps ${p.fps}`);
  assert.ok(Math.abs(p.duration - duration) <= 0.1, `duration ${p.duration}`);
}

/* --- projects --------------------------------------------------------- */

/**
 * On Windows a process working in a directory holds it open. HyperFrames ends each
 * command with a detached telemetry flush that does, for under a second on a normal
 * network. rmSync's maxRetries does not cover this error, so wait here: long enough
 * for that, too short for a server or the engine's five-minute warm check.
 */
function removeTree(dir, { waitMs = 15_000 } = {}) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      return rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      if (!["EPERM", "EBUSY", "ENOTEMPTY"].includes(err.code) || Date.now() >= deadline) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}

function hfProject(name, parent = join(SMOKE, "projects")) {
  const dir = join(parent, name);
  removeTree(dir);
  mkdirSync(dir, { recursive: true });
  cpSync(join(FIXTURES, "hyperframes"), dir, { recursive: true });
  cpSync(join(FIXTURES, "brief.json"), join(dir, "brief.json"));
  return dir;
}

const REMOTION_BASE = join(SMOKE, "remotion");

function installRemotion() {
  const pinned = join(REMOTION_BASE, "node_modules", "remotion", "package.json");
  if (existsSync(pinned) && JSON.parse(readFileSync(pinned, "utf8")).version === PINS.remotion) return;
  mkdirSync(REMOTION_BASE, { recursive: true });
  for (const f of ["package.json", "package-lock.json"]) cpSync(join(SKILL, "assets", "remotion", f), join(REMOTION_BASE, f));
  const r = sh("remotion-npm-ci", process.execPath, [npmCliPath(), "ci", "--no-audit", "--no-fund"], REMOTION_BASE);
  assert.equal(r.code, 0, r.out.slice(-800));
}

function remotionProject(name, parent = join(SMOKE, "projects")) {
  const dir = join(parent, name);
  removeTree(dir);
  mkdirSync(dir, { recursive: true });
  cpSync(join(FIXTURES, "remotion", "src"), join(dir, "src"), { recursive: true });
  cpSync(join(SKILL, "assets", "remotion", "package.json"), join(dir, "package.json"));
  cpSync(join(SKILL, "assets", "remotion", "package-lock.json"), join(dir, "package-lock.json"));
  symlinkSync(join(REMOTION_BASE, "node_modules"), join(dir, "node_modules"), "junction");
  const brief = JSON.parse(readFileSync(join(FIXTURES, "brief.json"), "utf8"));
  brief.lane = "remotion";
  writeFileSync(join(dir, "brief.json"), JSON.stringify(brief, null, 2));
  return dir;
}

function editFile(file, from, to) {
  const src = readFileSync(file, "utf8");
  assert.ok(src.includes(from), `fixture edit: "${from}" not found in ${file}`);
  writeFileSync(file, src.replace(from, to));
}

const requirementOf = (json, id) => json.requirements.find((r) => r.id === id);

before(() => {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(TMP, { recursive: true });
});

/* --- rendered output -------------------------------------------------- */

for (const lane of ["hyperframes", "remotion"]) {
  describe(`${lane}: real renders`, { skip: SKIP, concurrency: 1 }, () => {
    let dir;
    const project = () => (lane === "hyperframes" ? hfProject(`${lane}-main`) : remotionProject(`${lane}-main`));

    before(
      () => {
        if (lane === "remotion") installRemotion();
        dir = project();
      },
      LONG,
    );

    test("generated audio: picture and music in one verified mp4", LONG, () => {
      const out = join(OUT, `${lane}-audio.mp4`);
      const r = render(`${lane}-audio`, ["--brief", join(dir, "brief.json"), "--out", out], dir);
      assert.equal(r.code, 0, r.out.slice(-1500));

      const p = probe(out);
      assertMatchesBrief(p);
      assert.ok(p.formatName.includes("mp4") && p.brand !== "qt", p.formatName);
      assert.equal(p.videoCodec, "h264");
      assert.equal(p.audioCodec, "aac");
      assert.ok(Math.abs(p.audioDuration - 3) <= 0.1, `audio duration ${p.audioDuration}`);
      const peak = peakDb(out);
      assert.ok(peak > -40, `the bed should be audible, peak ${peak} dB`);

      const report = JSON.parse(readFileSync(`${out}.report.json`, "utf8"));
      assert.equal(report.status, "rendered");
      assert.equal(report.validation.status, "verified", JSON.stringify(report.validation.unverified));
      assert.equal(report.engine.name, lane);
      assert.equal(report.engine.version, PINS[lane]);
      assert.equal(report.environment.node, process.versions.node);
      assert.ok(report.browser.inspection?.version, "must name the inspecting browser");
      assert.ok(report.browser.render, "must name the rendering browser");
      assert.ok(report.encoder.ffmpeg.version, "must name the encoder");
      assert.ok(report.lockfile.sha256, "must identify the lockfile");
      assert.match(report.audio.bed.sha256, /^[0-9a-f]{64}$/);
      assert.equal(report.outputs[0].sha256, sha256(out));
      assert.ok(report.outputs[0].checks.every((c) => c.status === "verified"), JSON.stringify(report.outputs[0].checks));
      assert.deepEqual(report.notVerified, []);
      assert.ok(report.fonts.length > 0, "must record the fonts that really drew the copy");

      evidence.renders[`${lane}-audio`] = { ...p, peakDb: peak, encoderTag: report.outputs[0].container.encoder, ffmpeg: report.encoder.ffmpeg.version, browser: report.browser.inspection.version, fonts: [...new Set(report.fonts.flatMap((f) => (f.used ?? []).map((u) => u.family)))] };
    });

    test("the frames have no black gap, and a contact sheet exists for review", LONG, () => {
      const file = join(OUT, `${lane}-audio.mp4`);
      assert.deepEqual(blackGaps(file), [], "no stretch should be background only");
      const sheet = contactSheet(file, lane, [0, 22, 44, 45, 66, 89]);
      assert.ok(existsSync(sheet));
    });

    test("the runtime gate found no overlap, fallback font or phone-size problem in the fixture", LONG, () => {
      const report = JSON.parse(readFileSync(join(OUT, `${lane}-audio.mp4.report.json`), "utf8"));
      const advisories = report.validation.findings.filter((f) => f.level === "warn").map((f) => f.code);
      for (const code of ["text_overlap", "font_fallback", "text_small_on_phone"]) {
        assert.ok(!advisories.includes(code), `${code}: ${JSON.stringify(report.validation.findings)}`);
      }
    });

    test("--no-audio: a silent file with no audio stream", LONG, () => {
      const out = join(OUT, `${lane}-silent.mp4`);
      const r = render(`${lane}-silent`, ["--brief", join(dir, "brief.json"), "--out", out, "--no-audio"], dir);
      assert.equal(r.code, 0, r.out.slice(-1500));
      const p = probe(out);
      assertMatchesBrief(p);
      assert.equal(p.audioCodec, null);
      evidence.renders[`${lane}-silent`] = p;
    });

    for (const [format, audioCodec, name] of [["webm", "opus", "webm"], ["mov", "pcm_s16le", "mov"]]) {
      test(`${format}: picture and music in the right container`, LONG, () => {
        const out = join(OUT, `${lane}-audio.${format}`);
        const r = render(`${lane}-${format}`, ["--brief", join(dir, "brief.json"), "--out", out, "--format", format], dir);
        assert.equal(r.code, 0, r.out.slice(-1500));
        const p = probe(out);
        assert.ok(p.formatName.includes(name), p.formatName);
        if (format === "mov") assert.equal(p.brand, "qt");
        assert.equal(p.audioCodec, audioCodec);
        assert.ok(peakDb(out) > -40);
        assert.equal(p.width, 640);
        assert.ok(Math.abs(p.duration - 3) <= 0.15, `duration ${p.duration}`);
        evidence.renders[`${lane}-${format}`] = p;
      });
    }

    test("gif: refused with generated audio, renders silent with --no-audio", LONG, () => {
      const out = join(OUT, `${lane}-silent.gif`);
      rmSync(out, { force: true });
      const refused = render(`${lane}-gif-refused`, ["--brief", join(dir, "brief.json"), "--out", out, "--format", "gif"], dir);
      assert.equal(refused.code, 2);
      assert.match(refused.out, /GIF cannot carry audio/);
      assert.ok(!existsSync(out));

      const r = render(`${lane}-gif`, ["--brief", join(dir, "brief.json"), "--out", out, "--format", "gif", "--no-audio"], dir);
      assert.equal(r.code, 0, r.out.slice(-1500));
      const p = probe(out);
      assert.equal(p.formatName, "gif");
      assert.equal(p.audioCodec, null);
      const fps = JSON.parse(readFileSync(`${out}.report.json`, "utf8")).outputs[0].checks.find((c) => c.id === "output.fps");
      assert.equal(fps.status, "verified", JSON.stringify(fps));
      assert.ok(Math.abs(fps.actual - 30) < 0.5, JSON.stringify(fps));
      evidence.renders[`${lane}-gif`] = p;
    });

    test("a project and output path with spaces, &, ( ) and % render literally", LONG, () => {
      const parent = join(SMOKE, "projects", "odd name & co (100%)");
      removeTree(parent);
      const odd = lane === "hyperframes" ? hfProject("a b&c", parent) : remotionProject("a b&c", parent);
      // Under cmd.exe this name would run mkdir, so the sentinel proves nothing ran.
      const out = join(OUT, `x&mkdir sentinel-${lane}.txt&y (1%).mp4`);
      const r = render(`${lane}-odd-path`, ["--brief", join(odd, "brief.json"), "--out", out], odd);
      assert.equal(r.code, 0, r.out.slice(-1500));
      assertMatchesBrief(probe(out));
      assert.equal(probe(out).audioCodec, "aac");
      assert.ok(!existsSync(join(odd, `sentinel-${lane}.txt`)));
      assert.ok(!existsSync(join(OUT, `sentinel-${lane}.txt`)));
      evidence.renders[`${lane}-odd-path`] = { out, ...probe(out) };
      removeTree(parent);
      assert.ok(!existsSync(parent));
    });
  });
}

/* --- runtime: what the static check cannot see ------------------------ */

describe("hyperframes: the runtime check flags unreadable copy", { skip: SKIP, concurrency: 1 }, () => {
  const CASES = [
    ["hidden", 'style="display: none"', /hidden/],
    ["visibility hidden", 'style="visibility: hidden"', /hidden/],
    ["transparent", 'style="opacity: 0"', /transparent/],
    ["faint", 'style="opacity: 0.2"', /transparent/],
    ["transparent colour", 'style="color: transparent"', /transparent/],
    ["off-screen", 'style="position: absolute; left: 4000px"', /off-screen/],
    ["clipped", 'style="position: absolute; width: 40px; height: 12px; overflow: hidden"', /clipped/],
    ["clip-path", 'style="clip-path: inset(0 100% 0 0)"', /clipped/],
    ["blurred", 'style="filter: blur(9px)"', /blurred/],
  ];

  for (const [name, style, reason] of CASES) {
    test(`${name} text fails, and says why`, LONG, () => {
      const dir = hfProject(`rt-${name.replace(/\W+/g, "-")}`);
      editFile(join(dir, "index.html"), '<div id="stat-label" class="small">', `<div id="stat-label" class="small" ${style}>`);
      const r = contract(`rt-${name.replace(/\W+/g, "-")}`, dir);
      assert.equal(r.code, 1, r.out.slice(-800));
      const q = requirementOf(r.json, "beat.stat.copy[0].visible");
      assert.equal(q.status, "failed", JSON.stringify(q));
      assert.equal(q.code, "copy_not_visible");
      assert.match(q.message, reason);
    });
  }

  test("a clip that cuts through the letters fails", LONG, () => {
    const dir = hfProject("rt-clipped-ink");
    editFile(join(dir, "index.html"), '<div id="stat-label" class="small">', '<div id="stat-label" class="small" style="font-size: 40px; line-height: 1; height: 16px; overflow: hidden">');
    const r = contract("rt-clipped-ink", dir);
    assert.equal(r.code, 1, r.out.slice(-800));
    assert.match(requirementOf(r.json, "beat.stat.copy[0].visible").message, /clipped/);
  });

  test("a reveal mask that only trims the line box above the letters passes", LONG, () => {
    const dir = hfProject("rt-reveal-mask");
    editFile(join(dir, "index.html"), '<div id="stat-label" class="small">frames</div>', '<div id="stat-label" class="small" style="display: flex; overflow: hidden; line-height: 1; padding: 0.06em 0.04em 0.14em"><span style="display: inline-block">frames</span></div>');
    const r = contract("rt-reveal-mask", dir);
    assert.equal(r.code, 0, r.out.slice(-800));
    assert.equal(requirementOf(r.json, "beat.stat.copy[0].visible").status, "verified");
  });

  test("text under an opaque element fails as covered", LONG, () => {
    const dir = hfProject("rt-covered");
    editFile(join(dir, "index.html"), '<div id="stat-label" class="small">frames</div>', '<div id="stat-label" class="small">frames</div><div style="position:absolute;inset:0;background:#10131a;z-index:5"></div>');
    const r = contract("rt-covered", dir);
    assert.equal(r.code, 1, r.out.slice(-800));
    assert.match(requirementOf(r.json, "beat.stat.copy[0].visible").message, /covered/);
  });

  test("text that is on screen too briefly fails its hold", LONG, () => {
    const dir = hfProject("rt-short-hold");
    editFile(join(dir, "index.html"), 'window.__timelines["smoke"] = tl;', 'tl.to("#stat-label", { opacity: 0, duration: 0.01 }, 1.65);\n      window.__timelines["smoke"] = tl;');
    const r = contract("rt-short-hold", dir);
    assert.equal(r.code, 1, r.out.slice(-800));
    const q = requirementOf(r.json, "beat.stat.copy[0].visible");
    assert.equal(q.code, "copy_hold_short", JSON.stringify(q));
  });

  test("a number that never settles on the required value fails", LONG, () => {
    const dir = hfProject("rt-wrong-number");
    editFile(join(dir, "index.html"), "value: 12480", "value: 12479");
    const r = contract("rt-wrong-number", dir);
    assert.equal(r.code, 1, r.out.slice(-800));
  });

  test("a literal the script keeps but never shows is caught at runtime", LONG, () => {
    const dir = hfProject("rt-unshown-literal");
    editFile(join(dir, "index.html"), "value: 12480", 'value: 500, note: "12,480"');
    const r = contract("rt-unshown-literal", dir);
    assert.equal(r.code, 1, r.out.slice(-800));
    assert.equal(requirementOf(r.json, "beat.stat.copy[1]").status, "failed");
  });

  test("gradient text, text-transform and a settled count-up all pass", LONG, () => {
    const dir = hfProject("rt-legit");
    editFile(join(dir, "index.html"), '<div id="title-text" class="big">Smoke test</div>', '<div id="title-text" class="big" style="text-transform: uppercase; color: transparent; background: linear-gradient(90deg, #fff, #7dd3fc); -webkit-background-clip: text; background-clip: text">smoke test</div>');
    const r = contract("rt-legit", dir);
    assert.equal(r.code, 0, r.out.slice(-800));
    assert.equal(r.json.status, "verified");
    assert.equal(requirementOf(r.json, "beat.stat.copy[1]").status, "verified");
    assert.equal(requirementOf(r.json, "beat.title.copy[0].visible").status, "verified");
  });

  test("a line of copy split across spans passes", LONG, () => {
    const dir = hfProject("rt-spans");
    editFile(join(dir, "index.html"), '<div id="title-text" class="big">Smoke test</div>', '<div id="title-text" class="big"><span>Smo</span><span>ke</span> <em>test</em></div>');
    const r = contract("rt-spans", dir);
    assert.equal(r.code, 0, r.out.slice(-800));
  });

  test("advisories: overlap, fallback font and phone-size text are reported, and do not block", LONG, () => {
    const dir = hfProject("rt-advisories");
    editFile(join(dir, "index.html"), '<div id="stat-label" class="small">', '<div id="stat-label" class="small" style="position:absolute;top:150px;font-size:60px;font-family:Georgia,serif">');
    editFile(join(dir, "index.html"), '<div id="title-text" class="big">', '<div id="title-text" class="big" style="font-size:12px">');
    const r = contract("rt-advisories", dir);
    assert.equal(r.code, 0, r.out.slice(-800));
    const codes = r.json.findings.filter((f) => f.level === "warn").map((f) => f.code);
    assert.ok(codes.includes("text_small_on_phone"), codes.join());
    assert.ok(codes.includes("font_fallback"), codes.join());
    assert.ok(codes.includes("text_overlap"), codes.join());
  });

  test("a blank first frame fails visibleAtStart", LONG, () => {
    const dir = hfProject("rt-blank-start");
    editFile(join(dir, "index.html"), 'tl.fromTo("#title-text", { y: 12, filter: "blur(4px)" }, { y: 0, filter: "blur(0px)", duration: 0.3, ease: "expo.out" }, 0);', 'tl.fromTo("#title-text", { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0);');
    const r = contract("rt-blank-start", dir);
    assert.equal(r.code, 1, r.out.slice(-800));
    assert.equal(requirementOf(r.json, "beat.title.first-frame").code, "first_frame_empty");
  });

  test("a first frame with only a graphic on it is left for review, not passed", LONG, () => {
    const dir = hfProject("rt-graphic-start");
    editFile(join(dir, "index.html"), 'tl.fromTo("#title-text", { y: 12, filter: "blur(4px)" }, { y: 0, filter: "blur(0px)", duration: 0.3, ease: "expo.out" }, 0);', 'tl.fromTo("#title-text", { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0);');
    editFile(join(dir, "index.html"), '<div id="title-text" class="big">', '<svg width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" fill="#7dd3fc"/></svg><div id="title-text" class="big">');
    const r = contract("rt-graphic-start", dir);
    assert.equal(r.code, 3, r.out.slice(-800));
    const q = requirementOf(r.json, "beat.title.first-frame");
    assert.equal(q.status, "unverified", JSON.stringify(q));
    assert.equal(q.code, "first_frame_unverified");
  });

  test("a browser that cannot be found leaves copy unverified, never passed", LONG, () => {
    const dir = hfProject("rt-no-browser");
    const res = spawnSync(process.execPath, [CHECK, "--dir", dir, "--runtime", "--json"], { encoding: "utf8", env: { ...ENV, MOTIONBRIEF_ENGINE_DIR: join(SMOKE, "no-such-engine") } });
    assert.equal(res.status, 3, res.stdout.slice(-400));
    const json = JSON.parse(res.stdout);
    assert.equal(json.runtime.status, "unavailable");
    assert.equal(requirementOf(json, "beat.stat.copy[0].visible").status, "unverified");
  });

  test("accepting an unverified line is recorded and lets the gate through", LONG, () => {
    const dir = hfProject("rt-accept");
    const res = spawnSync(process.execPath, [CHECK, "--dir", dir, "--runtime", "--json", "--allow-unverified", "beat.*.visible,beat.*.first-frame,beat.stat.copy[1],beat.*.copy[*].visible"], { encoding: "utf8", env: { ...ENV, MOTIONBRIEF_ENGINE_DIR: join(SMOKE, "no-such-engine") } });
    const json = JSON.parse(res.stdout);
    assert.equal(res.status, 0, res.stdout.slice(-500));
    assert.equal(json.status, "unverified-accepted");
    assert.ok(json.overrides.some((o) => o.accepted.length > 0));
  });
});

describe("remotion: the runtime check resolves what statics cannot", { skip: SKIP, concurrency: 1 }, () => {
  before(() => installRemotion(), LONG);

  test("a transparent line fails", LONG, () => {
    const dir = remotionProject("rm-transparent");
    editFile(join(dir, "src", "Smoke.tsx"), '<div style={{ fontSize: 28, fontWeight: 500, color: "#8b93a3" }}>frames</div>', '<div style={{ fontSize: 28, fontWeight: 500, color: "#8b93a3", opacity: 0 }}>frames</div>');
    const r = contract("rm-transparent", dir);
    assert.equal(r.code, 1, r.out.slice(-800));
    assert.equal(requirementOf(r.json, "beat.stat.copy[0].visible").code, "copy_not_visible");
  });

  test("a line JSX never displays fails, though its literal is in the scene", LONG, () => {
    const dir = remotionProject("rm-unshown");
    editFile(join(dir, "src", "Smoke.tsx"), "<div style={{ fontSize: 28, fontWeight: 500, color: \"#8b93a3\" }}>frames</div>", "{false ? <div style={{ fontSize: 28 }}>frames</div> : null}");
    const r = contract("rm-unshown", dir);
    assert.equal(r.code, 1, r.out.slice(-800));
    assert.equal(requirementOf(r.json, "beat.stat.copy[0]").status, "failed");
  });

  test("dynamic timing with a data-brief-beat marker resolves, and passes when it matches", LONG, () => {
    const dir = remotionProject("rm-marker-ok");
    const file = join(dir, "src", "Smoke.tsx");
    editFile(file, "<Sequence from={45} durationInFrames={45} name=\"stat\">\n      <Stat />", "<Sequence from={Number(window.name === 'x' ? 0 : 45)} durationInFrames={45} name=\"stat\">\n      <AbsoluteFill data-brief-beat=\"stat\"><Stat /></AbsoluteFill>");
    const r = contract("rm-marker-ok", dir);
    assert.equal(r.code, 0, r.out.slice(-800));
    assert.equal(requirementOf(r.json, "beat.stat.timing").status, "verified");
    assert.equal(requirementOf(r.json, "beat.stat.timing").source, "runtime");
  });

  test("dynamic timing with a marker reports a real mismatch", LONG, () => {
    const dir = remotionProject("rm-marker-bad");
    const file = join(dir, "src", "Smoke.tsx");
    editFile(file, "<Sequence from={45} durationInFrames={45} name=\"stat\">\n      <Stat />", "<Sequence from={Number(window.name === 'x' ? 0 : 50)} durationInFrames={40} name=\"stat\">\n      <AbsoluteFill data-brief-beat=\"stat\"><Stat /></AbsoluteFill>");
    const r = contract("rm-marker-bad", dir);
    assert.equal(r.code, 1, r.out.slice(-800));
    const q = requirementOf(r.json, "beat.stat.timing");
    assert.equal(q.status, "failed");
    assert.equal(q.code, "brief_timing_mismatch");
    assert.deepEqual(q.actual, { start: 50, end: 90 });
  });

  test("dynamic timing with no marker stays unverified, which blocks", LONG, () => {
    const dir = remotionProject("rm-no-marker");
    editFile(join(dir, "src", "Smoke.tsx"), '<Sequence from={45} durationInFrames={45} name="stat">', "<Sequence from={Number(window.name === 'x' ? 0 : 45)} durationInFrames={45} name=\"stat\">");
    const r = contract("rm-no-marker", dir);
    assert.equal(r.code, 3, r.out.slice(-800));
    assert.equal(requirementOf(r.json, "beat.stat.scene").status, "verified");
    assert.equal(requirementOf(r.json, "beat.stat.timing").status, "unverified");
  });
});

/* --- music and the detector itself ------------------------------------ */

describe("repeatability", { skip: !nodeOk ? "needs Node 22 or newer" : false }, () => {
  test("music from one brief is byte-identical across runs here, and leaves a hash to compare across platforms", () => {
    const brief = join(FIXTURES, "brief.json");
    const [a, b] = ["a", "b"].map((n) => join(OUT, `music-${n}.wav`));
    for (const out of [a, b]) {
      const r = sh("music", process.execPath, [MUSIC, "--brief", brief, "--out", out], ROOT);
      assert.equal(r.code, 0, r.out);
    }
    assert.equal(sha256(a), sha256(b));
    writeFileSync(join(OUT, `music-${process.platform}.sha256`), `${sha256(a)}\n`);
    evidence.musicSha256 = sha256(a);
  });

  test("two renders of one picture on this machine", { ...LONG, skip: SKIP }, () => {
    const dir = hfProject("repeat");
    const shas = ["one", "two"].map((n) => {
      const out = join(OUT, `repeat-${n}.mp4`);
      const r = render(`repeat-${n}`, ["--brief", join(dir, "brief.json"), "--out", out, "--no-audio", "--no-checks"], dir);
      assert.equal(r.code, 0, r.out.slice(-800));
      return sha256(out);
    });
    // Recorded, not asserted: byte-identical video is not something this project promises.
    evidence.sameMachineVideoBytesIdentical = shas[0] === shas[1];
  });
});

describe("the black-gap detector", { skip: SKIP }, () => {
  test("flags a stretch with nothing on it, so a clean result means something", () => {
    const file = join(OUT, "gap.mp4");
    const res = capture(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x10131a:s=320x180:d=1:r=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", file]);
    assert.equal(res.code, 0, res.stderr);
    assert.ok(blackGaps(file).length > 0, "a background-only clip must be detected");
  });
});

test("evidence", { skip: SKIP }, () => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
});
