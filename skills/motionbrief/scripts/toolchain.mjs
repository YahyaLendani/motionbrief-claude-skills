/**
 * toolchain — finds and runs the tools a render needs, without a shell.
 *
 * Nothing here ever goes through cmd.exe or /bin/sh, so a path, composition id or
 * output name cannot be read as a command, and `%`, `&`, `(`, `^` and quotes reach
 * the tool literally. npm's .cmd shims are never run: every Node-based CLI (npm,
 * HyperFrames, Remotion) is started as `node <its own script>`, and a native tool
 * must resolve to a real executable. A .cmd/.bat wrapper is refused rather than
 * escaped, because no escaping survives cmd.exe's second parse reliably.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ENGINES_DIR = join(SCRIPT_DIR, "..", "engines");

/** The engine versions this release was tested with. */
export const PINS = JSON.parse(readFileSync(join(ENGINES_DIR, "versions.json"), "utf8"));

const IS_WIN = process.platform === "win32";

/* ------------------------------------------------------------------ */
/* running                                                             */
/* ------------------------------------------------------------------ */

/** Readable form of a command, for logs only. It is never executed. */
export function displayCommand(command, args) {
  return [command, ...args].map((a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a}"`)).join(" ");
}

/** Spawn with inherited stdio and no shell. Resolves with the exit code. */
export function runInherited(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: options.stdio ?? "inherit",
      env: { ...process.env, ...(options.env ?? {}) },
      shell: false,
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise(code));
  });
}

/** Run to completion and capture the output. Never throws. */
export function capture(command, args, options = {}) {
  const res = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) },
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout,
    shell: false,
  });
  return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "", error: res.error ?? null };
}

/* ------------------------------------------------------------------ */
/* finding tools                                                       */
/* ------------------------------------------------------------------ */

/** Walk PATH the way the OS would. Returns the first match or null. */
export function findOnPath(name, env = process.env) {
  const path = env.PATH ?? env.Path ?? "";
  const exts = IS_WIN ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  for (const entry of path.split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(entry, `${name}${ext.toLowerCase()}`);
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

/**
 * A native tool usable without a shell. `{ path }` when it can be run,
 * `{ path, batch: true }` when PATH only offers a batch wrapper, or null.
 */
export function nativeTool(name, env = process.env) {
  const envPath = env[`MOTIONBRIEF_${name.toUpperCase()}`];
  if (envPath && existsSync(envPath)) return { path: envPath };
  const path = findOnPath(name, env);
  if (!path) return null;
  return [".cmd", ".bat"].includes(extname(path).toLowerCase()) ? { path, batch: true } : { path };
}

/** npm's own script, so npm can run under `node` with no .cmd shim in the way. */
export function npmCliPath() {
  const nodeDir = dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((p) => p && /npm-cli\.[cm]?js$/.test(p) && existsSync(p)) ?? null;
}

export const sha256File = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/* --- HyperFrames ------------------------------------------------------ */

/**
 * HyperFrames is installed once per pinned version from the committed lockfile,
 * into a private directory: never globally, and never from a floating `npx`.
 */
export function hyperframesHome() {
  const base = process.env.MOTIONBRIEF_ENGINE_DIR ?? join(homedir(), ".cache", "motionbrief", "engines");
  return join(base, `hyperframes-${PINS.hyperframes}`);
}

export const hyperframesPackageDir = () => join(hyperframesHome(), "node_modules", "hyperframes");
export const hyperframesEntry = () => join(hyperframesPackageDir(), "bin", "hyperframes.mjs");

/** A pinned engine must not look for, or install, a newer version of itself. */
export const HF_ENV = { HYPERFRAMES_NO_UPDATE_CHECK: "1", HYPERFRAMES_NO_AUTO_INSTALL: "1" };

/**
 * For `hyperframes check`. Without a terminal it otherwise leaves a detached server and
 * a browser running for five minutes, working in the project, which on Windows stops
 * the folder being moved or deleted. CI is the engine's only switch for that.
 */
export const HF_CHECK_ENV = { ...HF_ENV, CI: "1" };

export function installedHyperframesVersion() {
  const manifest = join(hyperframesPackageDir(), "package.json");
  if (!existsSync(manifest) || !existsSync(hyperframesEntry())) return null;
  try {
    return JSON.parse(readFileSync(manifest, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

/** Install the pinned engine if it is missing. Throws with the reason. */
export async function ensureHyperframes() {
  if (installedHyperframesVersion() === PINS.hyperframes) return;
  const npm = npmCliPath();
  if (!npm) throw new Error("cannot find npm-cli.js next to this Node — install npm, or set npm_execpath");
  const home = hyperframesHome();
  mkdirSync(home, { recursive: true });
  for (const file of ["package.json", "package-lock.json"]) {
    copyFileSync(join(ENGINES_DIR, "hyperframes", file), join(home, file));
  }
  console.log(`\n== engine — installing hyperframes@${PINS.hyperframes} from the lockfile (needs network, about 100 MB)\n   ${home}\n`);
  const code = await runInherited(process.execPath, [npm, "ci", "--no-audit", "--no-fund"], { cwd: home });
  if (code !== 0 || installedHyperframesVersion() !== PINS.hyperframes) {
    throw new Error(`could not install hyperframes@${PINS.hyperframes} into ${home} (npm exited with ${code}) — check the network, or run doctor.mjs`);
  }
}

/* --- Remotion --------------------------------------------------------- */

/** The Remotion CLI's own script inside a project's node_modules, or null. */
export function remotionEntry(projectDir) {
  const pkgDir = join(projectDir, "node_modules", "@remotion", "cli");
  try {
    const bin = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).bin;
    const rel = typeof bin === "string" ? bin : bin?.remotion;
    if (rel && existsSync(join(pkgDir, rel))) return join(pkgDir, rel);
  } catch {
    /* not installed */
  }
  return null;
}

export function installedRemotionVersion(projectDir) {
  try {
    return JSON.parse(readFileSync(join(projectDir, "node_modules", "remotion", "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

/* --- browser ---------------------------------------------------------- */

function findFileNamed(root, names, depth = 5) {
  if (depth < 0 || !existsSync(root)) return null;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isFile() && names.includes(e.name)) return join(root, e.name);
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const found = findFileNamed(join(root, e.name), names, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

/** A Chrome the runtime check can drive, or null. Engine-managed builds first. */
export function findBrowser(projectDir) {
  for (const key of ["MOTIONBRIEF_CHROME", "CHROME_PATH"]) {
    if (process.env[key] && existsSync(process.env[key])) return process.env[key];
  }
  const shell = ["chrome-headless-shell", "chrome-headless-shell.exe"];
  const managed = [
    join(homedir(), ".cache", "hyperframes", "chrome"),
    projectDir ? join(projectDir, "node_modules", ".remotion", "chrome-headless-shell") : null,
    join(homedir(), ".cache", "puppeteer", "chrome-headless-shell"),
  ];
  for (const root of managed) {
    const found = root && findFileNamed(root, shell);
    if (found) return found;
  }
  const system = IS_WIN
    ? [
        join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
        join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
      ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : [];
  for (const p of system) if (existsSync(p)) return p;
  for (const name of ["google-chrome", "chromium", "chromium-browser"]) {
    const p = findOnPath(name);
    if (p) return p;
  }
  return null;
}

/** The browser an engine renders with, once it has one. It may differ from findBrowser's. */
export function engineBrowser(lane, projectDir) {
  const root = lane === "remotion"
    ? join(projectDir, "node_modules", ".remotion", "chrome-headless-shell")
    : join(homedir(), ".cache", "hyperframes", "chrome");
  return findFileNamed(root, ["chrome-headless-shell", "chrome-headless-shell.exe"]);
}

/* --- external assets -------------------------------------------------- */

const ASSET_EXTS = new Set([".html", ".htm", ".css", ".ts", ".tsx", ".js", ".jsx"]);

/**
 * What a project loads over the network when it renders. A source scan, so a URL
 * assembled at runtime is not seen: an empty list does not prove none exists.
 */
export function scanExternalAssets(projectDir) {
  const found = new Map();
  const visit = (root) => {
    for (const entry of readdirSync(root)) {
      if (["node_modules", ".git", "renders", "out", ".hyperframes"].includes(entry)) continue;
      const full = join(root, entry);
      if (statSync(full).isDirectory()) {
        visit(full);
      } else if (ASSET_EXTS.has(extname(full))) {
        const src = readFileSync(full, "utf8");
        const rel = full.slice(resolve(projectDir).length + 1).replace(/\\/g, "/");
        for (const m of src.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)|url\(\s*["']?(https?:\/\/[^"')]+)|@import\s+["'](https?:\/\/[^"']+)/g)) {
          found.set(m[1] ?? m[2] ?? m[3], rel);
        }
        if (/from\s+["']@remotion\/google-fonts/.test(src)) found.set("fonts.googleapis.com (@remotion/google-fonts)", rel);
      }
    }
  };
  if (existsSync(projectDir)) visit(resolve(projectDir));
  return [...found].map(([url, file]) => ({ url, file }));
}

/**
 * Local files a project refers to that do not exist. Literal references only, so a
 * path assembled at runtime is not seen: an empty list does not prove none is missing.
 */
export function missingLocalAssets(projectDir) {
  const base = resolve(projectDir);
  const missing = [];
  const visit = (root) => {
    for (const entry of readdirSync(root)) {
      if (["node_modules", ".git", "renders", "out", ".hyperframes"].includes(entry)) continue;
      const full = join(root, entry);
      if (statSync(full).isDirectory()) {
        visit(full);
        continue;
      }
      const ext = extname(full);
      const rel = full.slice(base.length + 1).replace(/\\/g, "/");
      if ([".html", ".htm", ".css"].includes(ext)) {
        const src = readFileSync(full, "utf8").replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
        for (const m of src.matchAll(/(?:src|href)\s*=\s*["']([^"'#?]*)|url\(\s*["']?([^"')#?]*)/g)) {
          const ref = m[1] ?? m[2] ?? "";
          if (ref === "" || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(ref) || /[{}$<>]/.test(ref)) continue;
          const target = ref.startsWith("/") ? join(base, ref) : resolve(dirname(full), ref);
          if (!existsSync(target)) missing.push({ ref, file: rel });
        }
      } else if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
        for (const m of readFileSync(full, "utf8").matchAll(/\bstaticFile\(\s*["']([^"']+)["']\s*\)/g)) {
          if (!existsSync(join(base, "public", m[1]))) missing.push({ ref: `public/${m[1]}`, file: rel });
        }
      }
    }
  };
  if (existsSync(base)) visit(base);
  return missing;
}
