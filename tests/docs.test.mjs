// The docs, CLI help and code should say the same thing. These catch the claims that
// have gone wrong before: absolute promises, unpinned engines, codes nothing emits.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SKILL, runScript } from "./helpers.mjs";

const read = (...parts) => readFileSync(join(...parts), "utf8");
const REFERENCES = readdirSync(join(SKILL, "references")).map((f) => join("skills/motionbrief/references", f));
const DOCS = ["README.md", "CONTRIBUTING.md", "skills/motionbrief/SKILL.md", ".claude/commands/motion.md", ...REFERENCES];
const scripts = ["check-contract.mjs", "runtime-check.mjs", "motion-render.mjs"].map((s) => read(SKILL, "scripts", s)).join("\n");
const validation = read(SKILL, "references", "validation.md");

test("no doc or package text makes the old absolute claim", () => {
  const places = [...DOCS, "package.json", "examples/motionbrief-intro/brief.json", "examples/motionbrief-intro/compositions/lockup.html"];
  for (const file of places) {
    const text = read(ROOT, file);
    assert.doesNotMatch(text, /can't drift|cannot drift|can not drift/i, file);
  }
});

test("the claim that replaces it is in the places people read first", () => {
  const claim = "Catch timing and copy drift before rendering.";
  assert.ok(read(ROOT, "README.md").includes(claim));
  assert.ok(JSON.parse(read(ROOT, "package.json")).description.includes(claim));
  assert.ok(read(ROOT, "examples/motionbrief-intro/brief.json").includes(claim));
});

test("no doc, workflow or script runs an unpinned engine", () => {
  const places = [...DOCS, ".github/workflows/verify.yml", "package.json"];
  for (const file of places) {
    const text = read(ROOT, file);
    assert.doesNotMatch(text, /npx(\s+--yes)?\s+hyperframes(?!@\d)/, `${file}: unversioned npx hyperframes`);
    assert.doesNotMatch(text, /(hyperframes|remotion|create-video)@latest/, `${file}: @latest`);
  }
});

test("documented pins agree with the versions the code installs", () => {
  const pins = JSON.parse(read(SKILL, "engines", "versions.json"));
  const lock = JSON.parse(read(SKILL, "engines", "hyperframes", "package-lock.json"));
  const pkg = JSON.parse(read(SKILL, "engines", "hyperframes", "package.json"));
  assert.equal(pkg.dependencies.hyperframes, pins.hyperframes);
  assert.equal(lock.packages["node_modules/hyperframes"].version, pins.hyperframes);

  const remotionLock = JSON.parse(read(SKILL, "assets", "remotion", "package-lock.json"));
  assert.equal(remotionLock.packages["node_modules/remotion"].version, pins.remotion);

  for (const file of DOCS) {
    for (const [, version] of read(ROOT, file).matchAll(/hyperframes@(\d+\.\d+\.\d+)/g)) assert.equal(version, pins.hyperframes, file);
    for (const [, version] of read(ROOT, file).matchAll(/\b(?:remotion|create-video)@(\d+\.\d+\.\d+)/g)) assert.equal(version, pins.remotion, file);
  }
});

test("no doc promises what is not delivered", () => {
  const banned = [
    [/zero install/i, "engines install themselves"],
    [/nothing to install/i, "engines install themselves"],
    [/generated identically everywhere/i, "only music is identical across platforms"],
    [/lane that still works/i, "offline readiness comes from doctor.mjs"],
    [/\bverbatim\b.*\b(source|composition)\b/i, "copy matching is normalized, and scene-scoped"],
  ];
  for (const file of ["README.md", "skills/motionbrief/SKILL.md", ".claude/commands/motion.md"]) {
    const text = read(ROOT, file);
    for (const [pattern, why] of banned) assert.doesNotMatch(text, pattern, `${file}: ${why}`);
  }
});

test("every validation code in the docs is one the code can emit", () => {
  const code = /`((?:brief|copy|first_frame|font|text|override)_[a-z_]+)`/g;
  for (const file of DOCS) {
    for (const [, name] of read(ROOT, file).matchAll(code)) {
      assert.ok(scripts.includes(`"${name}"`) || read(SKILL, "scripts", "brief.mjs").includes(`"${name}"`), `${file} names ${name}, which nothing emits`);
    }
  }
});

test("every requirement family in the code is documented", () => {
  const ids = ["format.", "beat.<id>.scene", "beat.<id>.timing", "beat.<id>.copy[n]", "beat.<id>.copy[n].visible", "beat.<id>.first-frame", "output.width", "output.height", "output.fps", "output.duration", "output.container", "output.audio", "output.audio-level", "output.exists"];
  for (const id of ids) assert.ok(validation.includes(id), `validation.md should document ${id}`);
});

test("every status the checker can return is documented, with its exit code", () => {
  for (const status of ["verified", "failed", "unverified", "unverified-accepted", "contract-only"]) {
    assert.ok(validation.includes(`\`${status}\``), status);
    assert.ok(scripts.includes(`"${status}"`), `${status} should be in the code`);
  }
  assert.match(runScript("check-contract.mjs", ["--help"]).stdout, /3 unverified/);
  assert.match(runScript("motion-render.mjs", ["--help"]).stdout, /3 mandatory requirements unverified/);
});

test("the help text and the docs agree on the flags that change what passing means", () => {
  const contract = runScript("check-contract.mjs", ["--help"]).stdout;
  const render = runScript("motion-render.mjs", ["--help"]).stdout;
  for (const flag of ["--runtime", "--allow-unverified", "--preflight"]) {
    assert.ok(contract.includes(flag), `check-contract --help: ${flag}`);
    assert.ok(validation.includes(flag), `validation.md: ${flag}`);
  }
  for (const flag of ["--no-audio", "--allow-unverified", "--no-checks"]) {
    assert.ok(render.includes(flag), `motion-render --help: ${flag}`);
    assert.ok(validation.includes(flag), `validation.md: ${flag}`);
  }
});

test("the audio limits are stated in every place that describes rendering", () => {
  for (const file of ["README.md", "skills/motionbrief/SKILL.md", "skills/motionbrief/references/validation.md"]) {
    const text = read(ROOT, file);
    assert.match(text, /GIF cannot carry\s+audio/i, file);
    assert.match(text, /--no-audio/, file);
    assert.match(text, /batch/i, file);
  }
});

test("repeatability claims stay separated, and byte-identical video is not promised", () => {
  const section = validation.slice(validation.indexOf("## Repeatability"));
  for (const claim of ["Deterministic music", "Same-machine", "Cross-platform visual", "Byte-identical video"]) {
    assert.ok(section.includes(claim), claim);
  }
  assert.match(section, /Byte-identical video across machines\*\* \| Not promised/);
});

test("the docs say what is not checked", () => {
  const readme = read(ROOT, "README.md");
  for (const field of ["palette", "easing", "transitions", "layout"]) assert.match(readme, new RegExp(`Not checked:.*${field}`), field);
  assert.match(validation, /`brand\.palette`.*\*\*Not checked\.\*\*/);
});

test("the render commands printed by brief.mjs use the gated wrapper", () => {
  const out = runScript("brief.mjs", [join(SKILL, "assets", "hyperframes", "brief.json"), "--commands"]).stdout;
  assert.match(out, /motion-render\.mjs --brief/);
  assert.doesNotMatch(out, /npx/);
});
