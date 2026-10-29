# Changelog

## 0.4.0 — 2026-10-29

The brief is now enforced, not just written: a build that drifts from it fails
before it renders. First public release.

**The build is held to the brief**
- `check-contract.mjs` now compares the project with `brief.json` (found in the
  project, or passed with `--brief`; `--no-brief` skips it). New errors:
  `brief_format_mismatch` (size, fps, length), `brief_scene_count` and
  `brief_timing_mismatch` (each scene's start and duration, within a frame), and
  `brief_copy_missing` (copy not verbatim in the source). A timing it cannot
  resolve is `brief_timing_unverified`, a warning.
- Remotion timings written as constants (`from={BEATS.lines}`) are resolved from
  the project's own `const` declarations.
- `motion-render.mjs` runs `brief.mjs` and `check-contract.mjs` before lint and
  render, so a drifted build fails in milliseconds. `--no-checks` skips them.
- The Remotion template is now checked against the same brief as HyperFrames,
  which proves the two templates still match.

**Tests**
- `npm test`: 22 tests in `tests/`. Each copies a template, breaks one
  thing, and asserts the exact code reported. Runs in `npm run verify` and CI.

**Validator**
- `off_beat_grid` is now an error (exit 1), not a warning. The docs already told
  the agent to fix it before building; now the exit code agrees.
- The schema example in `references/brief.md` sat off its own 120 BPM grid
  (a cut at 2.6 s). It now cuts at 2.5 s, matching the template.
- `references/brief.md` lists every validator code with its level.

**CI**
- Dropped two steps that pointed at `examples/skills-in-motion/`, an empty folder
  that would have failed every run.
- The HyperFrames lint job runs on Node 22, which HyperFrames requires.

**Docs**
- The Remotion template's entry is `src/index.tsx`; SKILL.md and
  `check-contract.mjs` said `src/index.ts`.
- Prerequisites now say Node 22+ for HyperFrames; the skill's scripts still run
  on Node 18+.

**Licence**
- `LICENSE` is plain MIT, so GitHub detects it. The engines' own licences moved
  to `THIRD_PARTY_NOTICES.md`. The copyright line names the current project.

## 0.3.0

Named, badged, and re-themed around its own brand.

**Renamed to `motionbrief`**
- `motion-graphics` collided with an existing 900-star repo in the same space. The
  new name puts the differentiator in the title: the brief is the product.
- Skill directory, frontmatter `name`, installers, CI paths and `package.json` all
  follow. The command stays `/motion`.

**The demo is now the product**
- The bundled example was a fictional note-taking app; it is now a **Motions**
  launch card, so the repo's own film argues the product instead of a stand-in.
- Four beats, twelve seconds, one brief: `MOTIONS` wordmark, `Brief in. / Cut on
  beat. / Same every time.`, a `renders` count-up, then the lockup.
- Both templates carry the new copy — HTML and React stay frame-for-frame twins.
- Accent moved to ice blue (`#7dd3fc`) so the badges, the film and the README
  share a palette.
- `docs/preview.mp4`, `docs/preview.gif` and `assets/preview.jpg` are re-rendered
  from the committed brief.

**Badges and identity**
- CI status, licence, Node version, platform matrix and a Claude Code skill badge.
- All URLs point at `github.com/YahyaLendani/motionbrief`.

**Validator**
- `npm run verify` runs the brief and both engine contracts on every push, on
  Ubuntu, macOS and Windows.

---

## 0.2.0

The release that made it shippable: real media, real music, and the install path
everyone else uses.

**Music, synthesized from the brief**
- `scripts/music.mjs` — a dependency-free additive synthesizer (kick, clap, hat,
  bass, pad) driven by the brief's `bpm`, `preset`, `key` and `mode`. Writes
  16-bit PCM WAV. Deterministic: the same brief always produces a byte-identical
  file, asserted in CI.
- Beats and cuts share one grid. `brief.mjs` now reports `off_beat_grid` with the
  drift in milliseconds when a cut falls between beats.
- `motion-render.mjs` synthesizes the bed, renders the picture video-only, and
  muxes the two with a single `ffmpeg` call. The composition never depends on an
  engine's audio mixer, and `--no-audio` skips the bed.

**Distribution**
- Moved to `skills/motionbrief/` so `npx skills add <repo>` finds it, which is
  how the rest of the ecosystem installs.
- `install.sh` and `install.ps1` now read from `skills/` and still work for a
  project-local install.

**Real media**
- The bundled example is retimed to a 120 BPM grid so every cut lands on a beat.
- Rendered `docs/preview.mp4` (h264 + AAC, 12.0 s, 1920×1080, 30 fps) and
  `docs/preview.gif` from the committed brief. The README shows the GIF.
- `npm run render` reproduces both; `npm run gif` rebuilds the GIF.

**Fixes**
- Windows spawn quoting: the executable is quoted alongside its arguments, so
  `C:\Program Files\nodejs\node.exe` no longer splits. The picture/mux split also
  removed a temp-directory write failure in the renderer.
- `brief.mjs` validates the `audio` block and prints the music line in its
  summary.
- CI gains a music-determinism assertion and a docs/media policy.

---

## 0.1.0

First cut.

**The skill**
- `SKILL.md` routes between two engines and runs a five-step loop: compile brief
  → scaffold → build → verify → render.
- `references/brief.md` defines the brief schema, the closed `kind`/`motion`
  grammar, the defaults table, and the iteration lever table.
- `references/hyperframes.md` and `references/remotion.md` carry each engine's
  contract, CLI surface and pitfall list.
- `references/motion-craft.md` holds the seven motion rules and the easing
  tables shared by both engines.
- `references/prompting.md` covers longer multi-scene work.

**The tooling**
- `scripts/brief.mjs` validates a brief in milliseconds — timeline tiling, empty
  first frame, short closing hold, unknown kinds — and emits render commands.
- `scripts/check-contract.mjs` is a dependency-free pre-flight for both engines.
- `scripts/motion-render.mjs` detects the engine, runs lint and check, and
  renders; `--batch` turns one brief into many videos.

**The templates**
- `assets/hyperframes/` — a 12 second, four-beat launch card built as a root plus
  four sub-compositions.
- `assets/remotion/` — the same piece in React, one file per beat.

**Distribution**
- `/motion` slash command for the one-line path.
- `install.sh` / `install.ps1` for a global install.
- CI validates the brief and both contracts, and runs the real HyperFrames linter.

**Verified**
- HyperFrames: lint clean, check clean including 10/10 WCAG AA contrast, beat and
  seam frames rendered and inspected.
- Remotion: bundle-verified through the full import graph.
