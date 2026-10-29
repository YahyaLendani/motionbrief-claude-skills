// motion-render.mjs runs the offline checks before anything slow, and stops
// on a build that has drifted from its brief.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { TEMPLATE_BRIEF, runScript, copyTemplate, edit, cleanup } from "./helpers.mjs";

const steps = (stdout) => [...stdout.matchAll(/^== (.+)$/gm)].map((m) => m[1].split(" — ")[0]);

test("dry run: brief and contract checks come before lint and render", () => {
  const r = runScript("motion-render.mjs", ["--brief", TEMPLATE_BRIEF, "--dry-run"]);
  assert.equal(r.code, 0, r.stdout);
  const order = steps(r.stdout);
  assert.deepEqual(order.slice(0, 2), ["brief", "contract"]);
  assert.ok(order.indexOf("contract") < order.indexOf("lint"));
});

test("--no-checks skips them", () => {
  const r = runScript("motion-render.mjs", ["--brief", TEMPLATE_BRIEF, "--dry-run", "--no-checks"]);
  assert.equal(r.code, 0);
  assert.ok(!steps(r.stdout).includes("contract"));
});

test("a drifted build stops at the contract check, before lint or render", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  edit(join(dir, "compositions", "lines.html"), "Brief in.", "Briefs in.");
  const r = runScript("motion-render.mjs", ["--brief", join(dir, "brief.json"), "--no-audio"]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /brief_copy_missing/);
  assert.ok(!steps(r.stdout).includes("lint"), "lint should not have started");
});
