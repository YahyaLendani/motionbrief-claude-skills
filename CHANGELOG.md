# Changelog

## Unreleased

- Fixed: the runtime check could look through a different browser from the one that
  renders: a system Chrome on a fresh machine, or HyperFrames' Chrome on the Remotion lane.
  The render now fetches the engine's browser first, and the check uses it. Another Chrome
  is only the fallback when that cannot be fetched, and the render says so.
- The runtime check runs an engine's browser with the sandbox off, as both engines do when
  they render. Remotion's Chrome 157 crashed at launch with it on. A full Chrome keeps it.
- Fixed: a system Chrome with a long `TMPDIR` stopped the runtime check on Linux and macOS.
  The engine's browser does not keep that socket, and a full Chrome now names the cause.
- Fixed: Remotion output decoded differently from HyperFrames, and on Windows came out full
  range (`yuvj420p`). MP4, WebM and MOV are now tagged limited-range BT.709 on both lanes.
- Reports record the rendering browser's version and the video's colour range and space.
- `test:smoke` with `MOTIONBRIEF_FULL_SIZE=1` renders the templates and the intro at full
  size. CI does this on Ubuntu, macOS and Windows.
- Corrected the 0.5.0 README: it named Chrome 156 as the CI browser. That was the runtime
  check's fallback. Renders used Chrome 152 on HyperFrames and Chrome 157 on Remotion.

## 0.5.0 — 2026-11-01

**"Passed" now means something exact.** See `references/validation.md`.

- **Breaking:** `check-contract.mjs` reports each requirement as `verified`, `failed`
  or `unverified`, and exits 3 when mandatory ones stay unverified. `--preflight` keeps
  the old exit 0 for those, but the status still says so. `motion-render.mjs` stops on
  them before rendering.
- **Breaking:** beats map to scenes by explicit id, not position: `data-brief-beat` or a
  matching id in HyperFrames, `<Sequence name>` in Remotion. Projects relying on start
  order now report `brief_scene_count` or `brief_scene_unmapped`.
- `--allow-unverified <id|pattern>` accepts named unverified requirements, and records
  them. It cannot accept a failure, and blanket patterns are refused.
- Fixed: copy kept in a comment or an unused variable satisfied the check, as did copy in
  another scene. Now `brief_copy_missing` and `brief_copy_wrong_scene`.
- Fixed: a computed Remotion timing (`Number("120")`) warned and passed. Now it stays
  unverified, or is measured at runtime and reported as a mismatch. Source is never
  executed to understand it.
- Fixed: missing `data-fps` passed quietly. Now unverified.
- New `--runtime`: inspects the composition in a headless browser at settled frames. Flags
  hidden, transparent, off-screen, clipped, blurred or covered copy, and short holds, and
  advises on overlap, phone-size text and fallback fonts. If it cannot run, requirements
  stay unverified.
- Copy normalization is defined and documented. It is not byte equality, and the docs no
  longer call it verbatim. Number-only lines compare as whole numbers, so `412,480` no
  longer satisfies `12,480`.

**Rendering**
- Fixed: Remotion ignored `audio.policy: "generated"` and produced a silent video. Both
  lanes now synthesize the bed, mux it on, and measure that it is there and not silent.
- Fixed: on Windows, an argument could run as a command (`--out "a&echo,x>f.txt&b.mp4"`
  did). Nothing goes through a shell any more. Node CLIs run as `node <script>`, native
  tools run directly, and `.cmd` and `.bat` wrappers are refused.
- Things that cannot be delivered are refused before rendering, exit 2: GIF or `--batch`
  with a generated bed (unless `--no-audio`), an `--out` that contradicts the format, an
  `--fps` that contradicts the brief, unknown flags.
- A missing ffmpeg or ffprobe, or a missing local asset, fails first with what to do.
  External assets are named before rendering.
- Output is measured with ffprobe against the brief, and every run writes
  `<out>.report.json`: validation, overrides, engine, Node, browser, encoder, lockfile,
  fonts drawn and hashes.
- Fixed: `hyperframes check` left a detached server and browser working in the project
  for five minutes after a render, which on Windows stopped the folder being deleted.
- Fixed: "clipped" was measured against the font's line box, so a reveal mask that only
  trimmed empty space failed readable text, and masked text counted as painted on the
  first frame. Both now use the glyphs' ink. A first frame with only a graphic on it is
  `first_frame_unverified`: this check cannot see what a graphic draws.
- Fixed: the pinned HyperFrames could check for a newer version of itself and schedule
  an install from a terminal. Every engine call now turns that off.
- Fixed: a GIF was measured by the shortest delay in the file, so every 30 fps GIF failed
  at 33.3. Its frame rate is now frames over time, within 0.5 fps rather than 1.5.
- Fixed: `<Sequence from={window.name === "x" ? 0 : 45} name="stat">` read `name` from
  inside the expression and lost the scene. Attributes are matched only at the tag's top
  level.
- Fixed: a marked scene ending on the composition's last frame was reported as a timing
  mismatch, because a seek past the end lands on the last frame.

**Reproducibility**
- HyperFrames is pinned to `0.8.226` and installed from a committed lockfile, instead of
  whatever an unversioned `npx` resolved. `scripts/hf.mjs` runs it. Remotion is pinned
  exactly to `4.0.539` with a lockfile.
- The Remotion template loads Inter from `@fontsource/inter`, so its fonts need no network
  at render time.
- New `scripts/doctor.mjs` reports readiness, and what would need network, without using
  it. "HyperFrames works offline" was never true of a fresh install, and is gone.
- CI compares the music hash between platforms, rather than only two runs on each.

**Tests**
- New `npm run test:smoke`: real short renders on both engines, measured with ffprobe,
  with negative fixtures for each runtime failure. CI runs it on Ubuntu, macOS and Windows.
- New fast tests for docs and code agreeing, argument passing, and every reproduced gap.

**Product claims**
- "A brief your agent can't drift from" is now "Catch timing and copy drift before
  rendering." The docs state what is checked automatically, at runtime, in a frame review,
  and not at all.

**README**
- The header is now a 17 s, 60 fps intro built from its own brief,
  `examples/motionbrief-intro/brief.json`. The README shows it as a 25 fps GIF
  that links to the MP4. It replaces `docs/preview.gif`, `docs/preview.mp4` and
  `docs/poster.jpg`.
- The repo moved to `YahyaLendani/motionbrief-claude-skills`. The install
  command, CI badge and clone steps follow.
- "The brief" now shows the intro's own brief. The Quick start summary is real
  `brief.mjs` output: the old one cut off its own 128 BPM grid, which the
  validator rejects.
- `npm run verify` and CI also validate the intro's brief and build, and lint it.
  `npm run render:intro` renders it; `npm run gif` rebuilds `docs/intro.gif`.

Both templates were rendered and reviewed frame by frame. Every automated check
passed, yet the film had faults only the frames showed. Those are now fixed, and
the skill now reviews frames itself.

**Templates (both engines)**
- Cuts no longer land on black. Every beat cleared 0.1–0.35 s before its cut and
  the next faded in from nothing: a dip at every cut, breaking the skill's own
  rule. Exits now finish on the cut as the brief's `cinematic-zoom`, and the
  next beat arrives from just behind it. In Remotion this lives in one
  `ZoomThrough` wrapper.
- The count-up's final number now holds. It used to start its exit on the frame
  it reached 12,480, so the true value was never on screen still. It now lands
  at 1.1 s and holds for a full beat.
- Small text reads at phone width: stat label 30→40 px, closing title 96→128 px,
  tagline 40→56 px.

**Remotion template**
- It rendered in the machine's fallback font (Segoe UI on Windows), not Inter.
  Inter now loads through `@remotion/google-fonts`, so both engines match.
- Every `npm run` script pointed at `src/index.ts`, but the entry is
  `src/index.tsx`, so `dev`, `still`, `render` and the rest all failed.
- First real render: 12 s at 1080p in about 17 s, contract clean.

**Skill**
- Step 4 now has a frame review: capture beat and seam frames (`--snapshot`, or
  `--stills` for Remotion), then check for black at cuts, a payoff that never
  holds, text too small for a phone, a fallback font, and the wrong transition.

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
