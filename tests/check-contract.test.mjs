// The brief ↔ build comparison in check-contract.mjs. Each test copies a
// template, breaks one thing, and expects exactly that thing to be reported.
//
// Exit codes under test: 0 nothing blocking, 1 failed, 2 bad usage, 3 unverified.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HF, REMOTION, TEMPLATE_BRIEF, runScript, codes, copyTemplate, edit, briefWith, cleanup } from "./helpers.mjs";

const check = (...args) => runScript("check-contract.mjs", [...args, "--json"]);
const statusOf = (json, id) => json.requirements.find((r) => r.id === id)?.status;
const unverifiedIds = (json) => json.unverified.map((u) => u.id);

/* --- the shipped templates ------------------------------------------- */

test("hyperframes template: everything resolves statically except the count-up's final number", () => {
  const r = check("--dir", HF);
  assert.equal(r.code, 3, r.stdout);
  assert.ok(r.json.brief, "brief.json should be found automatically");
  assert.equal(r.json.status, "unverified");
  assert.equal(r.json.ok, false);
  assert.deepEqual(codes(r.json), []);
  assert.deepEqual(unverifiedIds(r.json), ["beat.stat.copy[1]"]);
  assert.equal(statusOf(r.json, "beat.lines.copy[0]"), "verified");
  assert.equal(statusOf(r.json, "format.fps"), "verified");
  assert.equal(statusOf(r.json, "format.duration"), "verified");
});

test("remotion template: timing and format are verified, copy needs the runtime check", () => {
  const r = check("--dir", REMOTION, "--brief", TEMPLATE_BRIEF);
  assert.equal(r.code, 3, r.stdout);
  assert.deepEqual(codes(r.json), []);
  for (const id of ["format.width", "format.height", "format.fps", "format.duration", "beat.lines.timing", "beat.lockup.timing"]) {
    assert.equal(statusOf(r.json, id), "verified", id);
  }
  assert.ok(unverifiedIds(r.json).every((id) => /^beat\..+\.copy\[\d+\]$/.test(id)), unverifiedIds(r.json).join());
  assert.equal(r.json.requirements.find((x) => x.id === "beat.lines.copy[0]").code, "brief_copy_dynamic");
});

test("--preflight reports unverified requirements without blocking, and says so", () => {
  const r = check("--dir", HF, "--preflight");
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.status, "unverified");
  assert.equal(r.json.ok, false);
});

test("--no-brief says it compared nothing", () => {
  const r = check("--dir", HF, "--no-brief");
  assert.equal(r.code, 0);
  assert.equal(r.json.brief, null);
  assert.equal(r.json.status, "contract-only");
  assert.deepEqual(r.json.requirements, []);
});

test("the result separates failures, unverified requirements and advisories", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  edit(join(dir, "compositions", "lines.html"), "Cut on beat.", "Cuts on the beat.");
  const r = check("--dir", dir);
  assert.equal(r.json.schema, 2);
  assert.equal(r.json.status, "failed");
  assert.deepEqual(new Set(r.json.requirements.map((x) => x.status)), new Set(["verified", "failed", "unverified"]));
  assert.equal(r.json.counts.failed, 1);
  assert.ok(r.json.notChecked.some((n) => /palette/.test(n)), "must name what it did not check");
});

test("--report writes the same result to a file", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  const report = join(dir, "nested", "report.json");
  const r = check("--dir", dir, "--report", report);
  assert.deepEqual(JSON.parse(readFileSync(report, "utf8")).counts, r.json.counts);
});

/* --- reproduced gaps: fail closed ------------------------------------- */

test("hyperframes: wrong visible words with the original kept in an unused variable fail", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  const file = join(dir, "compositions", "lines.html");
  edit(file, "Brief in.", "Wrong words.");
  edit(file, "<script>", '<script>\n      const leftover = "Brief in.";');
  const r = check("--dir", dir);
  assert.equal(r.code, 1, r.stdout);
  assert.equal(statusOf(r.json, "beat.lines.copy[0]"), "failed");
  assert.deepEqual(codes(r.json), ["brief_copy_missing"]);
});

test('remotion: Number("120") is resolved and reported as a timing mismatch', (t) => {
  const dir = copyTemplate("remotion");
  t.after(() => cleanup(dir));
  briefWith(dir, () => {});
  edit(join(dir, "src", "LaunchCard.tsx"), "const COUNTUP_LEN = BEATS.lockup - BEATS.countUp; // 60", 'const COUNTUP_LEN = Number("120");');
  const r = check("--dir", dir);
  assert.equal(r.code, 1, r.stdout);
  assert.equal(statusOf(r.json, "beat.stat.timing"), "failed");
  assert.deepEqual(codes(r.json), ["brief_timing_mismatch"]);
});

test("remotion: equivalent expressions pass when their values match", (t) => {
  const dir = copyTemplate("remotion");
  t.after(() => cleanup(dir));
  briefWith(dir, () => {});
  const file = join(dir, "src", "LaunchCard.tsx");
  edit(file, "const COUNTUP_LEN = BEATS.lockup - BEATS.countUp; // 60", 'const COUNTUP_LEN = Number("60");');
  edit(file, "const LOCKUP_LEN = 90;", "const LOCKUP_LEN = Math.round(3 * 30);");
  const r = check("--dir", dir);
  assert.deepEqual(codes(r.json), []);
  assert.equal(statusOf(r.json, "beat.stat.timing"), "verified");
  assert.equal(statusOf(r.json, "beat.lockup.timing"), "verified");
});

test("remotion: a timing it cannot resolve blocks rather than passes", (t) => {
  const dir = copyTemplate("remotion");
  t.after(() => cleanup(dir));
  briefWith(dir, () => {});
  edit(join(dir, "src", "LaunchCard.tsx"), "from={BEATS.lines}", "from={getStart('lines')}");
  const r = check("--dir", dir);
  assert.equal(r.code, 3, r.stdout);
  assert.deepEqual(codes(r.json), []);
  assert.equal(statusOf(r.json, "beat.lines.timing"), "unverified");
});

test("remotion: a word inside another attribute's value is not an attribute", (t) => {
  const dir = copyTemplate("remotion");
  t.after(() => cleanup(dir));
  briefWith(dir, () => {});
  edit(join(dir, "src", "LaunchCard.tsx"), "from={BEATS.lines}", `from={window.name === "x" ? 0 : BEATS.lines}`);
  const r = check("--dir", dir);
  assert.equal(r.code, 3, r.stdout);
  assert.equal(statusOf(r.json, "beat.lines.scene"), "verified");
  assert.equal(statusOf(r.json, "beat.lines.timing"), "unverified");
});

test("remotion: an attribute that only ends in the name is not that attribute", (t) => {
  const dir = copyTemplate("remotion");
  t.after(() => cleanup(dir));
  briefWith(dir, () => {});
  const file = join(dir, "src", "LaunchCard.tsx");
  edit(file, 'from={BEATS.lines} durationInFrames={LINES_LEN} name="Lines"', 'data-name="other" from={BEATS.lines} durationInFrames={LINES_LEN} name="Lines"');
  const r = check("--dir", dir);
  assert.equal(statusOf(r.json, "beat.lines.scene"), "verified");
  assert.equal(statusOf(r.json, "beat.lines.timing"), "verified");
});

test("remotion: source is never executed to evaluate a timing", (t) => {
  const dir = copyTemplate("remotion");
  t.after(() => cleanup(dir));
  briefWith(dir, () => {});
  const sentinel = join(dir, "executed.txt").replace(/\\/g, "/");
  edit(join(dir, "src", "LaunchCard.tsx"), "from={BEATS.lines}", `from={(process.mainModule.require("fs").writeFileSync("${sentinel}", "x"), 75)}`);
  const r = check("--dir", dir);
  assert.equal(statusOf(r.json, "beat.lines.timing"), "unverified");
  assert.throws(() => readFileSync(sentinel));
});

test("hyperframes: a root with no data-fps cannot verify the frame rate", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  edit(join(dir, "index.html"), '      data-fps="30"\n', "");
  const r = check("--dir", dir);
  assert.equal(r.code, 3, r.stdout);
  assert.equal(statusOf(r.json, "format.fps"), "unverified");
});

test("missing metadata in the brief cannot produce a fully verified result", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  briefWith(dir, (b) => {
    delete b.format.fps;
  });
  const r = check("--dir", dir, "--allow-unverified", "beat.stat.copy[1]");
  assert.notEqual(r.json.status, "verified");
  assert.notEqual(r.code, 0);
});

test("a hyperframes scene whose timing is not a number is unverified, not skipped", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  edit(join(dir, "index.html"), 'data-start="9"', 'data-start="soon"');
  const r = check("--dir", dir);
  assert.notEqual(r.code, 0, r.stdout);
  assert.notEqual(statusOf(r.json, "beat.lockup.timing"), "verified");
});

/* --- overrides -------------------------------------------------------- */

test("--allow-unverified accepts only what it names, and records it", () => {
  const r = check("--dir", REMOTION, "--brief", TEMPLATE_BRIEF, "--allow-unverified", "beat.lines.copy[*]");
  assert.equal(r.code, 3, "the other beats' copy must still block");
  assert.deepEqual(r.json.overrides.map((o) => o.pattern), ["beat.lines.copy[*]"]);
  assert.equal(r.json.overrides[0].accepted.length, 3);
  assert.ok(unverifiedIds(r.json).includes("beat.stat.copy[0]"));
  assert.equal(r.json.counts.accepted, 3);
  assert.ok(r.json.unverified.some((u) => u.id === "beat.stat.copy[0]" && !u.accepted));
});

test("accepting everything that is unverified is reported as accepted, never as verified", () => {
  const r = check("--dir", HF, "--allow-unverified", "beat.stat.copy[1]");
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.status, "unverified-accepted");
  assert.equal(statusOf(r.json, "beat.stat.copy[1]"), "unverified");
});

test("a targeted override leaves other failures blocking", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  edit(join(dir, "compositions", "lines.html"), "Cut on beat.", "Cuts on the beat.");
  const r = check("--dir", dir, "--allow-unverified", "beat.stat.copy[1]");
  assert.equal(r.code, 1, r.stdout);
  assert.equal(r.json.status, "failed");
  assert.deepEqual(codes(r.json), ["brief_copy_missing"]);
});

test("a failed requirement cannot be overridden", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  edit(join(dir, "compositions", "lines.html"), "Cut on beat.", "Cuts on the beat.");
  const r = check("--dir", dir, "--allow-unverified", "beat.lines.copy[*]");
  assert.equal(r.code, 1, r.stdout);
  assert.ok(codes(r.json).includes("override_unused"));
  assert.match(r.json.findings.find((f) => f.code === "override_unused").message, /cannot be accepted/);
});

for (const pattern of ["*", "**", "*.*"]) {
  test(`--allow-unverified refuses the blanket pattern ${pattern}`, () => {
    const r = check("--dir", HF, "--allow-unverified", pattern);
    assert.equal(r.code, 2, r.stdout);
  });
}

test("an advisory style warning is not a failure", (t) => {
  const dir = copyTemplate("remotion");
  t.after(() => cleanup(dir));
  briefWith(dir, () => {});
  const clean = check("--dir", dir, "--allow-unverified", "beat.*.copy[*]");
  assert.equal(clean.code, 0, clean.stdout);
  const file = join(dir, "src", "beats", "Lockup.tsx");
  writeFileSync(file, `${readFileSync(file, "utf8")}\nexport const unclamped = (f: number) => interpolate(f, [0, 1], [0, 1]);\n`);
  const r = check("--dir", dir, "--allow-unverified", "beat.*.copy[*]");
  assert.equal(r.code, 0, r.stdout);
  assert.ok(r.json.warnings > 0, "the style note should still be surfaced");
  assert.equal(r.json.errors, 0);
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

test("hyperframes: swapping two scene files is caught, position is not identity", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  const index = join(dir, "index.html");
  edit(index, 'data-brief-beat="lines"', 'data-brief-beat="PLACEHOLDER"');
  edit(index, 'data-brief-beat="lockup"', 'data-brief-beat="lines"');
  edit(index, 'data-brief-beat="PLACEHOLDER"', 'data-brief-beat="lockup"');
  const r = check("--dir", dir);
  assert.equal(r.code, 1, r.stdout);
  assert.ok(codes(r.json).includes("brief_timing_mismatch"), r.stdout);
});

test("hyperframes: a scene with no identity is unverified even when the timing fits", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  const index = join(dir, "index.html");
  edit(index, 'data-brief-beat="stat"', "");
  const r = check("--dir", dir);
  assert.equal(r.code, 3, r.stdout);
  assert.equal(statusOf(r.json, "beat.stat.scene"), "unverified");
  assert.equal(statusOf(r.json, "beat.stat.timing"), "unverified");
});

test("hyperframes: a host id or composition id can name the beat", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  edit(join(dir, "index.html"), '\n        data-brief-beat="lines"', "");
  const r = check("--dir", dir);
  assert.equal(statusOf(r.json, "beat.lines.scene"), "verified");
  assert.equal(statusOf(r.json, "beat.lines.timing"), "verified");
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
  const file = join(dir, "compositions", "lines.html");
  edit(file, "Cut on beat.", "Cuts on the beat.");
  edit(join(dir, "index.html"), "<body>", "<body>\n<!-- Cut on beat. -->");
  edit(file, "<script>", "<script>\n      // Cut on beat.\n      /* Cut on beat. */");
  const r = check("--dir", dir);
  assert.deepEqual(codes(r.json), ["brief_copy_missing"]);
});

test("hyperframes: copy only in another scene does not satisfy the target beat", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  edit(join(dir, "compositions", "lines.html"), "Cut on beat.", "Cuts on the beat.");
  edit(join(dir, "compositions", "wordmark.html"), "</template>", "<span>Cut on beat.</span></template>");
  const r = check("--dir", dir);
  assert.equal(r.code, 1, r.stdout);
  assert.equal(statusOf(r.json, "beat.lines.copy[1]"), "failed");
  assert.deepEqual(codes(r.json), ["brief_copy_wrong_scene"]);
});

test("hyperframes: copy only in an unrelated file does not count", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  edit(join(dir, "compositions", "lines.html"), "Cut on beat.", "Cuts on the beat.");
  writeFileSync(join(dir, "compositions", "unused.html"), "<template><p>Cut on beat.</p></template>");
  writeFileSync(join(dir, "notes.txt"), "Cut on beat.");
  const r = check("--dir", dir);
  assert.equal(statusOf(r.json, "beat.lines.copy[1]"), "failed");
  assert.ok(codes(r.json).includes("brief_copy_missing"), r.stdout);
});

test("hyperframes: text in an attribute is not displayed copy", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  const file = join(dir, "compositions", "lines.html");
  edit(file, "Cut on beat.", "Cuts on the beat.");
  edit(file, "</template>", '<div title="Cut on beat." aria-label="Cut on beat."></div></template>');
  const r = check("--dir", dir);
  assert.deepEqual(codes(r.json), ["brief_copy_missing"]);
});

test("hyperframes: a line set only from a script is unverified until runtime", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  const file = join(dir, "compositions", "lines.html");
  edit(file, "Cut on beat.", "");
  edit(file, "<script>", '<script>\n      document.body.dataset.note = "Cut on beat.";');
  const r = check("--dir", dir);
  assert.equal(statusOf(r.json, "beat.lines.copy[1]"), "unverified");
  assert.equal(r.json.requirements.find((x) => x.id === "beat.lines.copy[1]").code, "brief_copy_dynamic");
  assert.equal(r.code, 3);
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

test("hyperframes: a wrong frame rate is a format mismatch", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  edit(join(dir, "index.html"), 'data-fps="30"', 'data-fps="24"');
  const r = check("--dir", dir);
  assert.equal(statusOf(r.json, "format.fps"), "failed");
  assert.deepEqual(codes(r.json), ["brief_format_mismatch"]);
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

test("hyperframes: uppercase styling and split words still match", (t) => {
  // "MOTIONS" is written MOT<em>IONS</em>.
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  briefWith(dir, (b) => {
    b.beats[0].copy = ["motions"];
  });
  const r = check("--dir", dir);
  assert.deepEqual(codes(r.json), []);
  assert.equal(statusOf(r.json, "beat.wordmark.copy[0]"), "verified");
});

test("hyperframes: a formatted number matches under the documented rules only", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  const file = join(dir, "compositions", "lockup.html");
  edit(file, "</template>", "<span>12 480</span></template>");
  briefWith(dir, (b) => {
    b.beats.at(-1).copy = ["12,480"];
  });
  assert.equal(statusOf(check("--dir", dir).json, "beat.lockup.copy[0]"), "verified");

  edit(file, "12 480", "412 480");
  assert.equal(statusOf(check("--dir", dir).json, "beat.lockup.copy[0]"), "failed");
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

test("remotion: wrong visible words with the original kept in an unused variable fail", (t) => {
  const dir = copyTemplate("remotion");
  t.after(() => cleanup(dir));
  briefWith(dir, () => {});
  const file = join(dir, "src", "beats", "KineticLines.tsx");
  edit(file, "Same every time.", "Wrong words.");
  writeFileSync(file, `const leftover = "Same every time.";\n${readFileSync(file, "utf8")}`);
  const r = check("--dir", dir);
  assert.equal(r.code, 1, r.stdout);
  assert.deepEqual(codes(r.json), ["brief_copy_missing"]);
});

test("remotion: copy reachable only from another scene does not satisfy the beat", (t) => {
  const dir = copyTemplate("remotion");
  t.after(() => cleanup(dir));
  briefWith(dir, () => {});
  const lines = join(dir, "src", "beats", "KineticLines.tsx");
  edit(lines, "Same every time.", "Identical each run.");
  const lockup = join(dir, "src", "beats", "Lockup.tsx");
  writeFileSync(lockup, `export const NOTE = "Same every time.";\n${readFileSync(lockup, "utf8")}`);
  const r = check("--dir", dir);
  assert.equal(r.code, 1, r.stdout);
  assert.deepEqual(codes(r.json), ["brief_copy_wrong_scene"]);
});

test("remotion: a default prop with a comma in it still counts as that prop's text", () => {
  const r = check("--dir", REMOTION, "--brief", TEMPLATE_BRIEF);
  assert.equal(statusOf(r.json, "beat.lockup.copy[1]"), "unverified");
  assert.equal(r.json.requirements.find((x) => x.id === "beat.lockup.copy[1]").code, "brief_copy_dynamic");
});

test("remotion: an unnamed sequence is unverified, not matched by position", (t) => {
  const dir = copyTemplate("remotion");
  t.after(() => cleanup(dir));
  briefWith(dir, () => {});
  edit(join(dir, "src", "LaunchCard.tsx"), 'name="stat"', 'name="Stats"');
  const r = check("--dir", dir);
  assert.equal(statusOf(r.json, "beat.stat.scene"), "unverified");
  assert.equal(statusOf(r.json, "beat.stat.timing"), "unverified");
});
