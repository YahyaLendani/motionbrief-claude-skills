// The documented copy-matching rules. Both the static and the runtime check use
// these functions, so this is where "what counts as the same words" is pinned down.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SKILL } from "./helpers.mjs";

const { matchFragments, normalizeCopy, textContainsCopy } = await import(pathToFileURL(join(SKILL, "scripts", "copy-rules.mjs")).href);

const readable = (...texts) => texts.map((text) => ({ text, reasons: [] }));

test("capitalization and whitespace are ignored", () => {
  assert.ok(textContainsCopy("CUT   ON\nBEAT.", "Cut on beat."));
  assert.ok(textContainsCopy("MOT IONS", "motions"));
});

test("curly quotes and an ellipsis character fold, entities decode", () => {
  assert.equal(normalizeCopy("It’s “on”…"), normalizeCopy(`It's "on"...`));
  assert.ok(textContainsCopy("Fast &amp; exact", "Fast & exact"));
  assert.ok(textContainsCopy("Fast &#38; exact", "Fast & exact"));
  assert.ok(textContainsCopy("Fast&nbsp;exact", "Fast exact"));
});

test("other punctuation is significant", () => {
  assert.ok(!textContainsCopy("Cut on beat", "Cut on beat."));
  assert.ok(!textContainsCopy("Cut, on beat.", "Cut on beat."));
});

test("a line may be part of a longer string, a documented limit", () => {
  assert.ok(textContainsCopy("Now: Cut on beat. Always.", "Cut on beat."));
});

test("number-only lines ignore digit grouping", () => {
  for (const shown of ["12480", "12,480", "12 480"]) assert.ok(textContainsCopy(shown, "12,480"), shown);
  assert.ok(textContainsCopy("12,480", "12480"));
});

test("a digit may not touch a number's match", () => {
  assert.ok(!textContainsCopy("412,480", "12,480"));
  assert.ok(!textContainsCopy("12,4801", "12,480"));
  assert.ok(!textContainsCopy("1.12,480", "12,480"));
});

test("a decimal point and a unit suffix stay significant", () => {
  assert.ok(!textContainsCopy("12.48", "1248"));
  assert.ok(!textContainsCopy("98", "98%"));
});

test("runtime: a line split across spans is still one line", () => {
  assert.equal(matchFragments("Cut on beat.", readable("Cut ", "on ", "beat.")).visible, true);
});

test("runtime: a count-up matches only at its settled value", () => {
  assert.equal(matchFragments("12,480", readable("6,204")).visible, false);
  assert.equal(matchFragments("12,480", readable("12,480")).visible, true);
  assert.equal(matchFragments("12,480", readable("12", ",480")).visible, true);
});

test("runtime: a number beside other words is not joined to them", () => {
  assert.equal(matchFragments("480", readable("12,", "480")).visible, false);
  assert.equal(matchFragments("12", readable("12", "renders")).visible, true);
});

test("runtime: words in the DOM but unreadable are present, with the reason", () => {
  const m = matchFragments("Brief in.", [{ text: "Brief in.", reasons: ["clipped"] }]);
  assert.equal(m.visible, false);
  assert.equal(m.present, true);
  assert.deepEqual(m.reasons, ["clipped"]);
});

test("runtime: one unreadable word makes the whole line unreadable", () => {
  const m = matchFragments("Brief in.", [
    { text: "Brief ", reasons: [] },
    { text: "in.", reasons: ["transparent"] },
  ]);
  assert.equal(m.visible, false);
  assert.deepEqual(m.reasons, ["transparent"]);
});

test("runtime: a readable copy wins over a hidden duplicate", () => {
  const m = matchFragments("Brief in.", [
    { text: "Brief in.", reasons: ["hidden"] },
    { text: "Brief in.", reasons: [] },
  ]);
  assert.equal(m.visible, true);
});

test("runtime: absent words are not present", () => {
  assert.deepEqual(matchFragments("Brief in.", readable("Wrong words.")), { visible: false, present: false, reasons: [], fragments: [] });
});
