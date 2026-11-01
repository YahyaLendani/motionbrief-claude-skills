// doctor.mjs must not call a machine ready when it is not, and must keep "can start"
// apart from "can finish with the network off".

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HF, SKILL, cleanup, copyTemplate, edit } from "./helpers.mjs";

const DOCTOR = join(SKILL, "scripts", "doctor.mjs");

function doctor(args, env = {}) {
  const res = spawnSync(process.execPath, [DOCTOR, ...args, "--json"], { encoding: "utf8", env: { ...process.env, ...env } });
  return { code: res.status, json: res.stdout ? JSON.parse(res.stdout) : null, stderr: res.stderr };
}
const check = (result, id) => result.json.checks.find((c) => c.id === id);

test("an engine that is not installed means not ready offline, and says it needs network", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  const r = doctor(["--dir", dir], { MOTIONBRIEF_ENGINE_DIR: join(dir, "nothing-here") });
  assert.equal(r.json.lane, "hyperframes");
  assert.equal(check(r, "hyperframes").ok, false);
  assert.equal(check(r, "hyperframes").need, "offline");
  assert.equal(r.json.ready.offline, false);
  assert.match(check(r, "hyperframes").fix, /network/);
});

test("the template's CDN script keeps it from being ready offline", () => {
  const r = doctor(["--dir", HF]);
  assert.equal(check(r, "external-assets").ok, false);
  assert.match(check(r, "external-assets").detail, /gsap@3\.14\.2/);
  assert.equal(r.json.ready.offline, false);
});

test("missing ffmpeg is a blocking finding, and the exit code says so", () => {
  const r = doctor(["--dir", HF], { PATH: "", Path: "", MOTIONBRIEF_FFMPEG: "", MOTIONBRIEF_FFPROBE: "" });
  assert.equal(r.code, 1);
  assert.equal(check(r, "ffmpeg").ok, false);
  assert.equal(r.json.ready.render, false);
  assert.equal(r.json.ready.offline, false);
});

test("a missing local asset is a blocking finding", (t) => {
  const dir = copyTemplate("hyperframes");
  t.after(() => cleanup(dir));
  edit(join(dir, "index.html"), "<body>", '<body>\n<img src="./assets/logo.png" hidden />');
  const r = doctor(["--dir", dir]);
  assert.equal(check(r, "local-assets").ok, false);
  assert.match(check(r, "local-assets").detail, /assets\/logo\.png/);
  assert.equal(r.code, 1);
});

test("remotion reports its own install and lockfile", (t) => {
  const dir = copyTemplate("remotion");
  t.after(() => cleanup(dir));
  const r = doctor(["--dir", dir]);
  assert.equal(r.json.lane, "remotion");
  assert.equal(check(r, "remotion").ok, false);
  assert.equal(check(r, "remotion-lockfile").ok, true);
  assert.equal(r.code, 1);
});

test("a remotion version off the pin is noted, without blocking", (t) => {
  const dir = copyTemplate("remotion");
  t.after(() => cleanup(dir));
  mkdirSync(join(dir, "node_modules", "remotion"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "remotion", "package.json"), JSON.stringify({ name: "remotion", version: "4.0.1" }));
  const r = doctor(["--dir", dir]);
  assert.equal(check(r, "remotion-version").need, "advisory");
  assert.match(check(r, "remotion-version").detail, /4\.0\.1/);
});

test("a directory that does not exist is bad usage", () => {
  const res = spawnSync(process.execPath, [DOCTOR, "--dir", join(HF, "no-such-dir")], { encoding: "utf8" });
  assert.equal(res.status, 2);
});
