// motion-render.mjs runs the offline checks before anything slow, stops on a build
// that has drifted from its brief, refuses what it cannot deliver before rendering,
// and hands every argument to its tools literally. None of this renders: a recording
// stand-in plays the Remotion CLI. Real renders are in tests/smoke.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HF, REMOTION, SKILL, TEMPLATE_BRIEF, cleanup, copyTemplate, edit, runScript } from "./helpers.mjs";

const SCRIPT = join(SKILL, "scripts", "motion-render.mjs");
const steps = (stdout) => [...stdout.matchAll(/^== (.+)$/gm)].map((m) => m[1].split(" — ")[0]);

/** Run the renderer with control over the environment. */
function render(args, { env = {}, cwd } = {}) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", cwd, env: { ...process.env, ...env } });
  return { code: res.status, stdout: res.stdout + res.stderr };
}

/** A Remotion project whose CLI records each argv it is given. */
function fakeRemotion(t, briefPolicy = "none") {
  const dir = copyTemplate("remotion");
  t.after(() => cleanup(dir));
  const brief = JSON.parse(readFileSync(TEMPLATE_BRIEF, "utf8"));
  brief.lane = "remotion";
  brief.audio.policy = briefPolicy;
  writeFileSync(join(dir, "brief.json"), JSON.stringify(brief, null, 2));

  const cli = join(dir, "node_modules", "@remotion", "cli");
  mkdirSync(cli, { recursive: true });
  writeFileSync(join(cli, "package.json"), JSON.stringify({ name: "@remotion/cli", bin: { remotion: "fake.cjs" } }));
  writeFileSync(
    join(cli, "fake.cjs"),
    `const fs = require("fs"), path = require("path");
     const args = process.argv.slice(2);
     fs.appendFileSync(${JSON.stringify(join(dir, "argv.jsonl"))}, JSON.stringify(args) + "\\n");
     if (args[0] === "render") { fs.mkdirSync(path.dirname(args[3]), { recursive: true }); fs.writeFileSync(args[3], "not really a video"); }`,
  );
  const recorded = () => readFileSync(join(dir, "argv.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { dir, recorded, renders: () => recorded().filter((a) => a[0] === "render") };
}

const UNMEASURED = ["--allow-unverified", "output.*"];

/* --- background processes --------------------------------------------- */

test("hf.mjs stops the pinned engine updating itself, and the server `hyperframes check` would leave in the project", (t) => {
  const { hyperframes } = JSON.parse(readFileSync(join(SKILL, "engines", "versions.json"), "utf8"));
  const engines = mkdtempSync(join(tmpdir(), "motionbrief-engines-"));
  t.after(() => cleanup(engines));
  const pkg = join(engines, `hyperframes-${hyperframes}`, "node_modules", "hyperframes");
  mkdirSync(join(pkg, "bin"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "hyperframes", version: hyperframes }));
  writeFileSync(join(pkg, "bin", "hyperframes.mjs"), "console.log(`${process.argv[2]} CI=${process.env.CI} check=${process.env.HYPERFRAMES_NO_UPDATE_CHECK} install=${process.env.HYPERFRAMES_NO_AUTO_INSTALL}`);");

  const ci = (sub) => spawnSync(process.execPath, [join(SKILL, "scripts", "hf.mjs"), sub, "."], { encoding: "utf8", env: { ...process.env, CI: "", MOTIONBRIEF_ENGINE_DIR: engines } }).stdout.trim();
  assert.equal(ci("check"), "check CI=1 check=1 install=1");
  assert.equal(ci("lint"), "lint CI= check=1 install=1");
});

/* --- order ------------------------------------------------------------ */

test("dry run: brief and contract checks come before lint and render", () => {
  const r = runScript("motion-render.mjs", ["--brief", TEMPLATE_BRIEF, "--dry-run"]);
  assert.equal(r.code, 0, r.stdout);
  const order = steps(r.stdout);
  assert.deepEqual(order.slice(0, 2), ["brief", "contract"]);
  assert.ok(order.indexOf("contract") < order.indexOf("lint"));
});

test("dry run: the runtime gate comes before any render", () => {
  const r = runScript("motion-render.mjs", ["--brief", TEMPLATE_BRIEF, "--dry-run"]);
  assert.match(r.stdout, /== contract — runtime gate\n.*--runtime/);
  const at = (label) => r.stdout.indexOf(`== ${label}`);
  assert.ok(at("contract — runtime gate") < at("render"));
});

test("--no-checks skips them, and says so", () => {
  const r = runScript("motion-render.mjs", ["--brief", TEMPLATE_BRIEF, "--dry-run", "--no-checks"]);
  assert.equal(r.code, 0);
  assert.ok(!steps(r.stdout).includes("contract"));
  assert.match(r.stdout, /--no-checks: nothing is validated/);
});

test("a drifted build stops at the contract check, before lint or render", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  edit(join(dir, "compositions", "lines.html"), "Brief in.", "Briefs in.");
  const r = runScript("motion-render.mjs", ["--brief", join(dir, "brief.json"), "--no-audio"]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /brief_copy_missing/);
  assert.ok(!steps(r.stdout).includes("lint"), "lint should not have started");
  const report = JSON.parse(readFileSync(join(dir, "renders", "motions-launch.mp4.report.json"), "utf8"));
  assert.equal(report.status, "failed");
  assert.match(report.failedStep, /^contract/);
});

/* --- generated audio on the remotion lane ----------------------------- */

test("remotion dry run: a generated bed adds music and mux, and the picture renders muted", (t) => {
  const { dir } = fakeRemotion(t, "generated");
  const r = render(["--brief", join(dir, "brief.json"), "--dry-run"]);
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(steps(r.stdout), ["brief", "contract", "contract", "music", "render", "mux", "done in 0.0s"]);
  assert.match(r.stdout, /== render — picture\n.*--muted/);
  assert.match(r.stdout, /== mux — music bed\n.*ffmpeg/);
});

test("remotion dry run: --no-audio drops music and mux", (t) => {
  const { dir } = fakeRemotion(t, "generated");
  const r = render(["--brief", join(dir, "brief.json"), "--dry-run", "--no-audio"]);
  assert.equal(r.code, 0, r.stdout);
  assert.ok(!steps(r.stdout).includes("music"));
  assert.ok(!steps(r.stdout).includes("mux"));
  assert.match(r.stdout, /== render\n.*--muted/);
});

test("hyperframes dry run: --no-audio drops music and mux too", () => {
  const r = runScript("motion-render.mjs", ["--brief", TEMPLATE_BRIEF, "--dry-run", "--no-audio"]);
  assert.ok(!steps(r.stdout).includes("music"));
  assert.ok(!steps(r.stdout).includes("mux"));
});

/* --- what it refuses before rendering --------------------------------- */

for (const [lane, brief] of [["hyperframes", TEMPLATE_BRIEF]]) {
  test(`${lane}: a GIF cannot promise audio`, () => {
    const r = runScript("motion-render.mjs", ["--brief", brief, "--format", "gif", "--dry-run"]);
    assert.equal(r.code, 2, r.stdout);
    assert.match(r.stdout, /GIF cannot carry audio/);
    assert.ok(!steps(r.stdout).includes("render"));
  });

  test(`${lane}: --batch with a generated bed is refused, not silently muted`, () => {
    const r = runScript("motion-render.mjs", ["--brief", brief, "--batch", join(HF, "rows.example.json"), "--dry-run"]);
    assert.equal(r.code, 2, r.stdout);
    assert.match(r.stdout, /--batch is video-only/);
  });
}

test("--no-audio makes both of those explicit choices", () => {
  assert.equal(runScript("motion-render.mjs", ["--brief", TEMPLATE_BRIEF, "--format", "gif", "--no-audio", "--dry-run"]).code, 0);
  assert.equal(runScript("motion-render.mjs", ["--brief", TEMPLATE_BRIEF, "--batch", join(HF, "rows.example.json"), "--no-audio", "--dry-run"]).code, 0);
});

test("a missing ffmpeg fails before anything is installed or rendered, and names the way out", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  const r = render(["--brief", join(dir, "brief.json")], { env: { PATH: "", Path: "", MOTIONBRIEF_FFMPEG: "", MOTIONBRIEF_ENGINE_DIR: join(dir, "engines") } });
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /ffmpeg is needed to attach the music bed/);
  assert.match(r.stdout, /--no-audio/);
  assert.ok(!existsSync(join(dir, "engines")), "no engine install should have started");
  assert.ok(!steps(r.stdout).includes("render"));
});

test("a missing ffprobe fails early unless that is accepted", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  const r = render(["--brief", join(dir, "brief.json"), "--no-audio"], { env: { PATH: "", Path: "", MOTIONBRIEF_ENGINE_DIR: join(dir, "engines") } });
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /ffprobe is needed to measure the finished file/);
  assert.match(r.stdout, /--allow-unverified "output\.\*"/);
});

test("a missing local asset is reported before any render", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  edit(join(dir, "index.html"), "<body>", '<body>\n<img src="./assets/logo.png" hidden />');
  const r = render(["--brief", join(dir, "brief.json"), "--no-audio", "--no-render"]);
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /assets\/logo\.png/);
});

test("an external asset is named before any render", () => {
  const r = runScript("motion-render.mjs", ["--brief", TEMPLATE_BRIEF, "--dry-run"]);
  assert.match(r.stdout, /fetched over the network when this renders:\n.*gsap@3\.14\.2/);
});

test("--fps cannot contradict the brief", () => {
  const r = runScript("motion-render.mjs", ["--brief", TEMPLATE_BRIEF, "--fps", "24", "--dry-run"]);
  assert.equal(r.code, 2);
  assert.match(r.stdout, /contradicts the brief/);
});

test("an output name must match its format", () => {
  const r = runScript("motion-render.mjs", ["--brief", TEMPLATE_BRIEF, "--out", "x.mov", "--dry-run"]);
  assert.equal(r.code, 2);
});

test("a mistyped flag is refused rather than ignored", () => {
  const r = runScript("motion-render.mjs", ["--brief", TEMPLATE_BRIEF, "--no-audo", "--dry-run"]);
  assert.equal(r.code, 2);
});

test("a blanket override is refused", () => {
  const r = runScript("motion-render.mjs", ["--brief", TEMPLATE_BRIEF, "--allow-unverified", "*", "--dry-run"]);
  assert.equal(r.code, 2);
});

/* --- arguments reach the tools literally ------------------------------ */

const TRICKY = [
  ["spaces", "my out file.mp4"],
  ["ampersand", "a&b.mp4"],
  ["parentheses", "a (1) b.mp4"],
  ["percent", "%PATHEXT% 100%.mp4"],
  ["caret and quote-free cmd syntax", "a^b;c.mp4"],
  // No ">" here, which Windows forbids in a file name. Under cmd.exe this would make the sentinel.
  ["a command separator", "x&mkdir sentinel.txt&y.mp4"],
];

for (const [name, file] of TRICKY) {
  test(`an output path with ${name} is passed literally and runs nothing extra`, (t) => {
    const { dir, renders } = fakeRemotion(t);
    const out = join(dir, "out dir (1)", file);
    const r = render(["--dir", dir, "--brief", join(dir, "brief.json"), "--out", out, "--no-checks", ...UNMEASURED], { cwd: dir });
    assert.equal(r.code, 0, r.stdout);
    assert.equal(renders().length, 1);
    assert.equal(renders()[0][3], out, "the tool must see exactly the path that was asked for");
    assert.ok(existsSync(out));
    assert.ok(!existsSync(join(dir, "sentinel.txt")), "nothing may have executed");
  });
}

for (const id of ['a&echo,INJECTED>sentinel.txt&b', "%PATHEXT%", 'x" & echo,QUOTE>sentinel.txt & "', "a b"]) {
  test(`a composition id of ${JSON.stringify(id)} is one literal argument`, (t) => {
    const { dir, renders } = fakeRemotion(t);
    const r = render(["--dir", dir, "--brief", join(dir, "brief.json"), "--composition", id, "--out", join(dir, "o.mp4"), "--no-checks", ...UNMEASURED], { cwd: dir });
    assert.equal(r.code, 0, r.stdout);
    assert.equal(renders()[0][2], id);
    assert.ok(!existsSync(join(dir, "sentinel.txt")));
  });
}

test("a project path with special characters reaches the tool literally", (t) => {
  const { dir, renders } = fakeRemotion(t);
  const out = join(dir, "o.mp4");
  const r = render(["--dir", dir, "--brief", join(dir, "brief.json"), "--out", out, "--no-checks", ...UNMEASURED]);
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(renders()[0].slice(0, 4), ["render", "src/index.tsx", "LaunchCard", out].map((v, i) => (i === 1 ? renders()[0][1] : v)));
  assert.match(renders()[0][1], /^src\/index\.tsx?$/);
});

test("the remotion CLI runs under node directly, with no npx or shell", (t) => {
  const { dir } = fakeRemotion(t);
  const r = render(["--brief", join(dir, "brief.json"), "--dry-run"]);
  assert.ok(!/\bnpx\b/.test(r.stdout), r.stdout);
  assert.match(r.stdout, /fake\.cjs" render|fake\.cjs render/);
});

test("the hyperframes engine runs from its pinned install, with no npx", () => {
  const r = runScript("motion-render.mjs", ["--brief", TEMPLATE_BRIEF, "--dry-run"]);
  assert.ok(!/\bnpx\b/.test(r.stdout), r.stdout);
  assert.match(r.stdout, /hyperframes-0\.8\.226/);
});

test("--no-audio on the remotion lane renders muted and records it", (t) => {
  const { dir, renders } = fakeRemotion(t, "generated");
  const out = join(dir, "silent.mp4");
  const r = render(["--brief", join(dir, "brief.json"), "--out", out, "--no-checks", "--no-audio", ...UNMEASURED]);
  assert.equal(r.code, 0, r.stdout);
  assert.ok(renders()[0].includes("--muted"));
  const report = JSON.parse(readFileSync(`${out}.report.json`, "utf8"));
  assert.equal(report.audio.noAudio, true);
  assert.equal(report.audio.plan, "none");
  assert.deepEqual(report.validation, { skipped: true, reason: "--no-checks" });
});

test("an accepted unverified output is recorded in the report", (t) => {
  const { dir } = fakeRemotion(t);
  const out = join(dir, "o.mp4");
  render(["--brief", join(dir, "brief.json"), "--out", out, "--no-checks", ...UNMEASURED], { env: { PATH: "", Path: "" } });
  const report = JSON.parse(readFileSync(`${out}.report.json`, "utf8"));
  assert.ok(report.notVerified.includes("output.width"), JSON.stringify(report.notVerified));
  assert.ok(report.overrides.includes("output.*"));
  assert.equal(report.environment.node, process.versions.node);
});

test("output directories are created", (t) => {
  const { dir } = fakeRemotion(t);
  const out = join(dir, "a", "b", "c", "o.mp4");
  const r = render(["--brief", join(dir, "brief.json"), "--out", out, "--no-checks", ...UNMEASURED]);
  assert.equal(r.code, 0, r.stdout);
  assert.ok(existsSync(out));
});

test("--batch is refused for HyperFrames rows the report cannot measure only by being recorded", () => {
  const r = runScript("motion-render.mjs", ["--brief", TEMPLATE_BRIEF, "--batch", join(HF, "rows.example.json"), "--no-audio", "--dry-run"]);
  assert.match(r.stdout, /== render — batch\n.*--batch/);
});

test("remotion --batch renders each row and probes it", (t) => {
  const { dir, renders } = fakeRemotion(t, "none");
  const rows = join(dir, "rows.json");
  writeFileSync(rows, JSON.stringify([{ slug: "one & only", brand: "A" }, { slug: "two", brand: "B" }]));
  const r = render(["--brief", join(dir, "brief.json"), "--batch", rows, "--out-dir", join(dir, "o"), "--no-checks", ...UNMEASURED]);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(renders().length, 2);
  const report = JSON.parse(readFileSync(join(dir, "o", "motions-launch.batch.report.json"), "utf8"));
  assert.equal(report.outputs.length, 2);
});

if (process.platform === "win32") {
  test("windows: a .cmd wrapper for ffmpeg is refused and never run", (t) => {
    const dir = copyTemplate("hyperframes");
    t.after(() => cleanup(dir));
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const sentinel = join(dir, "ran.txt");
    writeFileSync(join(bin, "ffmpeg.cmd"), `@echo ran> "${sentinel}"\r\n`);
    const r = render(["--brief", join(dir, "brief.json")], { env: { PATH: bin, Path: bin, MOTIONBRIEF_ENGINE_DIR: join(dir, "engines") } });
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /batch wrapper/);
    assert.ok(!existsSync(sentinel), "the wrapper must not have run");
  });
}

/* --- the remotion template is what the docs promise ------------------- */

test("the remotion template is pinned exactly and has a lockfile", () => {
  const pkg = JSON.parse(readFileSync(join(REMOTION, "package.json"), "utf8"));
  const versions = JSON.parse(readFileSync(join(SKILL, "engines", "versions.json"), "utf8"));
  assert.ok(existsSync(join(REMOTION, "package-lock.json")));
  for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.match(version, /^\d/, `${name} must be an exact version, not ${version}`);
  }
  assert.equal(pkg.dependencies.remotion, versions.remotion);
  assert.equal(pkg.dependencies["@remotion/cli"], versions.remotion);
  assert.ok(!pkg.dependencies["@remotion/google-fonts"], "fonts must not need the network at render time");
});
