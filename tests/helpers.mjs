import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SKILL = join(ROOT, "skills", "motionbrief");
export const HF = join(SKILL, "assets", "hyperframes");
export const REMOTION = join(SKILL, "assets", "remotion");
export const TEMPLATE_BRIEF = join(HF, "brief.json");

/** Run one of the skill's scripts with node; returns { code, stdout, json }. */
export function runScript(script, args) {
  const res = spawnSync(process.execPath, [join(SKILL, "scripts", script), ...args], {
    encoding: "utf8",
  });
  let json = null;
  if (args.includes("--json")) {
    try {
      json = JSON.parse(res.stdout);
    } catch {
      /* leave null; the test will say so */
    }
  }
  return { code: res.status, stdout: res.stdout + res.stderr, json };
}

export const codes = (json) => (json?.findings ?? []).map((f) => f.code);

/** A throwaway copy of a template, so a test can break it. */
export function copyTemplate(which) {
  const dir = mkdtempSync(join(tmpdir(), `motionbrief-${which}-`));
  if (which === "hyperframes") {
    for (const p of ["index.html", "compositions", "brief.json"]) cpSync(join(HF, p), join(dir, p), { recursive: true });
  } else {
    for (const p of ["src", "package.json"]) cpSync(join(REMOTION, p), join(dir, p), { recursive: true });
  }
  return dir;
}

export function edit(file, from, to) {
  const src = readFileSync(file, "utf8");
  if (!src.includes(from)) throw new Error(`fixture edit: "${from}" not found in ${file}`);
  writeFileSync(file, src.replace(from, to));
}

/** Write a mutated copy of the template brief and return its path. */
export function briefWith(dir, mutate) {
  const brief = JSON.parse(readFileSync(TEMPLATE_BRIEF, "utf8"));
  mutate(brief);
  const path = join(dir, "brief.json");
  writeFileSync(path, JSON.stringify(brief, null, 2));
  return path;
}

export const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });
