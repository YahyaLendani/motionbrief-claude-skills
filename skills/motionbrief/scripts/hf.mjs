#!/usr/bin/env node
/**
 * hf — run the pinned HyperFrames CLI, shell-free, installing it first if needed.
 * Use this instead of an unversioned npx, which resolves whatever is newest today.
 *
 *   node hf.mjs lint ./my-video
 *   node hf.mjs preview ./my-video
 *
 * Exit code: the engine's own, or 1 if the pinned engine cannot be installed.
 */

import { HF_CHECK_ENV, HF_ENV, ensureHyperframes, hyperframesEntry, runInherited } from "./toolchain.mjs";

try {
  await ensureHyperframes();
} catch (err) {
  console.error(`hf: ${err.message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
process.exit(await runInherited(process.execPath, [hyperframesEntry(), ...args], { env: args[0] === "check" ? HF_CHECK_ENV : HF_ENV }));
