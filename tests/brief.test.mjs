// brief.mjs on the template and on briefs broken one field at a time.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEMPLATE_BRIEF, runScript, codes, briefWith, cleanup } from "./helpers.mjs";

const validate = (path) => runScript("brief.mjs", [path, "--json"]);

function broken(t, mutate) {
  const dir = mkdtempSync(join(tmpdir(), "motionbrief-brief-"));
  t.after(() => cleanup(dir));
  return validate(briefWith(dir, mutate));
}

test("the template brief is clean", () => {
  const r = validate(TEMPLATE_BRIEF);
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(codes(r.json), []);
});

test("a cut off the beat grid is an error", (t) => {
  const r = broken(t, (b) => {
    b.beats[0].duration = 2.6;
    b.beats[1].start = 2.6;
    b.beats[1].duration = 4.4;
  });
  assert.equal(r.code, 1);
  assert.deepEqual(codes(r.json), ["off_beat_grid"]);
});

test("a gap between beats is an error", (t) => {
  const r = broken(t, (b) => {
    b.beats[1].start = 3;
    b.beats[1].duration = 4;
  });
  assert.equal(r.code, 1);
  assert.ok(codes(r.json).includes("timing_gap"));
});

test("beats that do not sum to the duration are an error", (t) => {
  const r = broken(t, (b) => {
    b.format.duration = 14;
  });
  assert.equal(r.code, 1);
  assert.deepEqual(codes(r.json), ["duration_mismatch"]);
});

test("an unknown kind is an error", (t) => {
  const r = broken(t, (b) => {
    b.beats[2].kind = "wobble";
  });
  assert.equal(r.code, 1);
  assert.deepEqual(codes(r.json), ["unknown_kind"]);
});

test("a short closing hold is a warning", (t) => {
  const r = broken(t, (b) => {
    b.beats.at(-1).hold = 1.2;
  });
  assert.equal(r.code, 0);
  assert.deepEqual(codes(r.json), ["closing_hold_short"]);
});
