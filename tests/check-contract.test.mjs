// The brief ↔ build comparison in check-contract.mjs. Each test copies a
// template, breaks one thing, and expects exactly that thing to be reported.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { HF, REMOTION, TEMPLATE_BRIEF, runScript, codes, copyTemplate, edit, briefWith, cleanup } from "./helpers.mjs";

const check = (...args) => runScript("check-contract.mjs", [...args, "--json"]);

/* --- the shipped templates match the brief ---------------------------- */

test("hyperframes template matches its brief", () => {
  const r = check("--dir", HF);
  assert.equal(r.code, 0, r.stdout);
  assert.ok(r.json.brief, "brief.json should be found automatically");
  assert.deepEqual(codes(r.json), []);
});

test("remotion template matches the same brief", () => {
  const r = check("--dir", REMOTION, "--brief", TEMPLATE_BRIEF);
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(codes(r.json), []);
});

test("--no-brief skips the comparison", () => {
  const r = check("--dir", HF, "--no-brief");
  assert.equal(r.code, 0);
  assert.equal(r.json.brief, null);
});

/* --- hyperframes drift ------------------------------------------------ */

test("hyperframes: a moved scene is a timing mismatch", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  edit(join(dir, "index.html"), 'data-start="9"\n        data-duration="3"', 'data-start="8"\n        data-duration="4"');
  const r = check("--dir", dir);
  assert.equal(r.code, 1);
  assert.deepEqual(codes(r.json), ["brief_timing_mismatch"]);
  assert.match(r.json.findings[0].message, /"lockup".*9s–12s.*8s–12s/);
});

test("hyperframes: paraphrased copy is reported", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  edit(join(dir, "compositions", "lines.html"), "Cut on beat.", "Cuts on the beat.");
  const r = check("--dir", dir);
  assert.equal(r.code, 1);
  assert.deepEqual(codes(r.json), ["brief_copy_missing"]);
  assert.match(r.json.findings[0].message, /Cut on beat\./);
});

test("hyperframes: copy that survives only in a comment does not count", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  edit(join(dir, "compositions", "lines.html"), "Cut on beat.", "Cuts on the beat.");
  edit(join(dir, "index.html"), "<body>", "<body>\n<!-- Cut on beat. -->");
  const r = check("--dir", dir);
  assert.deepEqual(codes(r.json), ["brief_copy_missing"]);
});

test("hyperframes: a wrong size or length is a format mismatch", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  briefWith(dir, (b) => {
    b.format.width = 1080;
    b.format.height = 1920;
  });
  const r = check("--dir", dir);
  assert.equal(r.code, 1);
  assert.deepEqual(codes(r.json), ["brief_format_mismatch", "brief_format_mismatch"]);
});

test("hyperframes: a missing scene is a scene-count mismatch", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  briefWith(dir, (b) => {
    b.beats.splice(2, 1);
    b.beats[2].start = 7;
    b.beats[2].duration = 5;
  });
  const r = check("--dir", dir);
  assert.equal(r.code, 1);
  assert.ok(codes(r.json).includes("brief_scene_count"), r.stdout);
});

test("hyperframes: uppercase styling and formatted numbers still match", (t) => {
  // "MOTIONS" is written MOT<em>IONS</em>; "12,480" is a count-up of 12480.
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  briefWith(dir, (b) => {
    b.beats[0].copy = ["motions"];
  });
  const r = check("--dir", dir);
  assert.deepEqual(codes(r.json), []);
});

/* --- remotion drift --------------------------------------------------- */

test("remotion: a moved beat constant is a timing mismatch", (t) => {
  const dir = copyTemplate("remotion");
  t.after(() => cleanup(dir));
  briefWith(dir, () => {});
  edit(join(dir, "src", "theme.ts"), "lockup: 270", "lockup: 240");
  const r = check("--dir", dir);
  assert.equal(r.code, 1);
  // The count-up ends where the lockup starts, so both move.
  assert.deepEqual(codes(r.json), ["brief_timing_mismatch", "brief_timing_mismatch"]);
  assert.match(r.json.findings[1].message, /"lockup" is frames 270–360 in the brief but scene "Lockup" is 240–330/);
});

test("remotion: a wrong composition size is a format mismatch", (t) => {
  const dir = copyTemplate("remotion");
  t.after(() => cleanup(dir));
  briefWith(dir, () => {});
  edit(join(dir, "src", "theme.ts"), "WIDTH = 1920", "WIDTH = 1280");
  const r = check("--dir", dir);
  assert.deepEqual(codes(r.json), ["brief_format_mismatch"]);
});

test("remotion: paraphrased copy is reported", (t) => {
  const dir = copyTemplate("remotion");
  t.after(() => cleanup(dir));
  briefWith(dir, () => {});
  edit(join(dir, "src", "beats", "KineticLines.tsx"), "Same every time.", "Identical each run.");
  const r = check("--dir", dir);
  assert.deepEqual(codes(r.json), ["brief_copy_missing"]);
});

test("remotion: a timing it cannot resolve is a warning, not a guess", (t) => {
  const dir = copyTemplate("remotion");
  t.after(() => cleanup(dir));
  briefWith(dir, () => {});
  edit(join(dir, "src", "LaunchCard.tsx"), "from={BEATS.lines}", "from={getStart('lines')}");
  const r = check("--dir", dir);
  assert.equal(r.code, 0);
  assert.deepEqual(codes(r.json), ["brief_timing_unverified"]);
});
