---
name: motionbrief
description: Make motion graphics and short videos from HTML or React — title cards, logo stings, kinetic type, count-ups, stat reveals, lower thirds, transparent overlays, feature montages. Compiles a plain-language request into a validated brief, then renders it; batches one brief into many videos. Covers HyperFrames (HTML + GSAP, zero install, Apache 2.0) and Remotion (React + TypeScript). Use when asked to generate, animate, build, or render a video, motion graphic, animation, or overlay; to make a launch video, sting, or card; to port a composition between Remotion and HyperFrames; or to fix motion that feels cheap, bouncy, slow, or slide-like.
---

# Motion graphics

Generate video by writing a web page that the renderer seeks frame by frame.
Both lanes below do the same thing; the difference is what you write.

- **HyperFrames** — one HTML file, CSS for looks, a paused GSAP timeline for
  motion. `npx hyperframes`, no install, Apache 2.0.
- **Remotion** — React components. `useCurrentFrame()` returns the frame, you do
  the math. Mature, typed, and licensed free only up to three people.

Load the matching reference before writing composition code. The framework rules
are not guessable and most failures are silent: a HyperFrames file that never
registers its timeline renders a still frame with no error.

---

## The easy path

The user describes what they want in any words. **They never write a brief, a
spec, or a beat sheet — Claude compiles one.**

```
/motion a punchy 6 second logo sting for Inkwell
```

That's the whole input. Underneath:

1. **Compile** the request into `brief.json` — duration, size, fps, beats with
   timings, copy verbatim, ease, palette, and an `assumptions` list. Every gap
   gets a default from the table in `references/brief.md`; nothing is left
   undefined and nothing is questioned.
2. **Show** the compact summary (one table, ~12 lines) and build in the same
   turn. No approval gate.
3. **Build** from the template, **validate**, **render**, **look at frames**.

Iteration is then a field edit, not a rebuild. "Make it punchier" changes
`feel.ease` and two durations; the code does not move unless `kind` or `motion`
changes.

The brief is the artifact that makes this cheap. It lives on disk next to the
composition, so a revision is a diff, and re-rendering is one command.

---

## Route first

| Signal | Lane |
| - | - |
| Fresh build, no framework named | **HyperFrames** |
| Existing HTML/CSS/GSAP/Lottie to reuse | **HyperFrames** |
| No `node_modules`, no build step wanted | **HyperFrames** |
| Team larger than three people | **HyperFrames** (licence) |
| User names Remotion, or repo is React/TS | **Remotion** |
| Needs a design system, charting lib, or complex components | **Remotion** |
| Porting an existing Remotion project | **Remotion** (porting costs more than it saves) |

When the user names both, build in HyperFrames and say in one line that the
Remotion port is available on request. Two full builds of the same piece is
wasted work unless a comparison was asked for.

---

## The loop

### 1. Compile the brief

Turn the request into `brief.json` **before** writing code. The schema, the
`kind`/`motion` grammar, the defaults table and the iteration levers live in
`references/brief.md`.

```bash
node scripts/brief.mjs brief.json          # validate + summary table
node scripts/brief.mjs brief.json --json   # machine result
```

Print the summary to the user, fix any `ERROR`, then keep going in the same
turn. Warnings are judgement calls — a warning you accept goes in `assumptions`.

The brief also carries the score. Choose `audio.bpm` so the beat grid divides the
cuts — at `bpm`, a beat is `60 / bpm` seconds and every `beats[].start` should
land on one. 120 BPM gives a beat every 0.5 s and suits most short pieces. If
`brief.mjs` reports `off_beat_grid`, move the cut or change the tempo; do not
ignore it, because that is the difference between a piece that lands and one that
feels subtly wrong.

**Done when** `brief.mjs` exits 0, every beat has a time window, a kind, a
motion and verbatim copy, and no cut is off the beat grid.

### 2. Scaffold

Start from the templates in this skill rather than a blank file — they are
correct against both contracts and save the two failure-prone steps (timeline
registration, sequence timing).

```bash
# HyperFrames — plain HTML, nothing to install
cp -R assets/hyperframes/. ./my-video/
npx hyperframes lint ./my-video

# Remotion — React project, needs deps once
cp -R assets/remotion/. ./my-video/
cd my-video && npm install
```

```powershell
# PowerShell
Copy-Item -Recurse -Force assets\hyperframes\* .\my-video\
Copy-Item -Recurse -Force assets\remotion\* .\my-video\
```

**Done when** `npx hyperframes lint` passes, or `npx remotion compositions
src/index.tsx` lists the composition id.

### 3. Build the beats

One file per beat. Keep the timeline flat — absolute times in HyperFrames,
`<Sequence>` frames in Remotion. Update the beat sheet when the build changes
the timing, then re-check the total duration.

**Done when** every beat in the sheet exists in code, the composition duration
matches the sheet, and there are no `TODO`s, stubs, or placeholder copy.

### 4. Verify the motion

Stills lie about timing. Look at frames, then look at the render.

```bash
node scripts/check-contract.mjs --dir ./my-video   # offline pre-flight + brief comparison

npx hyperframes check                          # layout, motion, contrast
npx hyperframes snapshot . --review            # beat + seam frames as PNGs
npx hyperframes keyframes --selector "#card" --shot motion.png

npx remotion still src/index.tsx LaunchCard out/f.png --frame=45
npx remotion studio src/index.tsx              # watch it at 1x
```

`check-contract.mjs` catches the silent failures without installing anything: an
unregistered timeline, a mismatched `window.__timelines` key, an unpaused
timeline, a missing duration, `Math.random()` in a composition, an unclamped
`interpolate`. It is a pre-flight, not a replacement for the real linters.

When `brief.json` sits in the project (or `--brief` points at one), it also
compares the build with the brief and fails on drift:

- `brief_format_mismatch` — width, height, fps or length differ from `format`.
- `brief_scene_count` / `brief_timing_mismatch` — scenes are matched to beats in
  start order (HyperFrames: the `data-composition-src` hosts in `index.html`;
  Remotion: the `<Sequence>`s in the composition's component, with constants
  like `BEATS.lines` resolved). Each must start and last what the brief says,
  within a frame.
- `brief_copy_missing` — a `beats[].copy` line does not appear verbatim in the
  source. Case may differ (uppercase is styling); words and punctuation may not.
  `"12,480"` also matches a count-up of `12480`.

A timing it cannot resolve to a number is `brief_timing_unverified`, a warning.
Fix drift in the code, or change the brief on purpose and re-run `brief.mjs` —
never let the two disagree.

**Done when** every checklist line under "Ship checklist" holds and you have
looked at at least the first frame, one mid-beat frame, and the last frame.

### 5. Render

```bash
node scripts/motion-render.mjs --brief ./my-video/brief.json
node scripts/motion-render.mjs --brief ./my-video/brief.json --batch rows.json
```

The wrapper reads lane, format, fps and slug from the brief, runs `brief.mjs`
and `check-contract.mjs` first (an error stops it before any render time is
spent; `--no-checks` skips them), then lint/check, and renders. When `audio.policy` is `generated` it also synthesizes the bed with
`music.mjs`, renders the picture video-only, and muxes the two with one `ffmpeg`
call — so the composition never depends on an engine's audio mixer.

For transparency: `--format webm` (HyperFrames) or `--codec=prores
--pixel-format=yuva444p10le` (Remotion) — H.264 cannot carry alpha. `--no-audio`
skips the bed entirely.

With `--batch`, one brief plus a rows file becomes N videos: HyperFrames renders
rows natively (video-only), Remotion gets one props file per row.

**Done when** the file exists, plays at the expected duration, carries audio when
the brief asked for it, and its first and last frames are deliberate.

---

## The contract that breaks silently

**HyperFrames** — four things, all mandatory:

1. Root carries `data-composition-id`, `data-width`, `data-height`,
   `data-duration`, `data-start="0"`.
2. Every timed element carries `id` + `data-start` + `data-duration`.
3. The GSAP timeline is built with `{ paused: true }`.
4. `window.__timelines[<data-composition-id>] = tl` — **same key**. After the
   tweens are added. Miss this and you get a still frame, no error.

**Remotion** — three:

1. `registerRoot()` in the entry file, `<Composition>` in the root component.
2. `interpolate(..., { extrapolateLeft: "clamp", extrapolateRight: "clamp" })`
   — clamp both ends, every time.
3. No `Math.random()`, no `Date.now()` in a composition. Use `random(seed)`.

---

## The four rules that decide whether it reads cheap

These are the ones that go wrong most often. Full set with code in
`references/motion-craft.md`.

1. **Move only what is live.** Settled things hold still. Idle "breathing" scale
   reads as machine-generated.
2. **Overlap, don't queue.** Stagger ≈ 15–30% of the element's own duration.
   Next thing starts while the last is still settling.
3. **No bounce on type.** Overshoot is for objects with mass — cards, flaps,
   characters. Text, numbers, and UI labels use `power3.out` / `expo.out` and
   never overshoot.
4. **One idea per move.** `y + opacity` is "arriving". Add rotation and scale and
   the word is unreadable mid-flight.

Also: a transition is the *exit*, not a fade-out followed by a fade-in. That
renders as a jump cut with a dip in the middle.

---

## Ship checklist

- [ ] `brief.json` validates: timing tiles, first frame deliberate, closing hold ≥ 2 s.
- [ ] Composition duration matches the brief.
- [ ] Copy, numbers, handles, and URLs are verbatim — no lorem, no placeholder.
- [ ] Timeline registered under the composition id (HyperFrames), or composition
      listed by `npx remotion compositions` (Remotion).
- [ ] Lint/check clean.
- [ ] Frames inspected: first, mid-beat, last.
- [ ] Nothing keeps moving after it settles.
- [ ] First and last frames deliberate; overlays fully clear.
- [ ] Output format matches the brief — alpha only if it composites over footage.
- [ ] One build command that works from the project directory.

---

## References

| File | Read it when |
| - | - |
| `references/brief.md` | **Start here.** Brief schema, `kind`/`motion` grammar, defaults table, iteration levers, batch rows |
| `references/hyperframes.md` | Building or debugging the HTML lane: schema, attributes, CLI, lint codes, registry blocks |
| `references/remotion.md` | Building or debugging the React lane: hooks, sequencing, transitions, CLI flags, pitfalls |
| `references/motion-craft.md` | Choosing eases, staggering, transitions, pacing, or fixing motion that feels wrong |
| `references/prompting.md` | Longer multi-scene pieces where a beat sheet is not enough |

Scripts:

| File | What it does |
| - | - |
| `scripts/brief.mjs` | Validate a brief in ~10 ms, print its summary, emit render commands |
| `scripts/music.mjs` | Synthesize a beat-locked WAV from the brief's `bpm` and beat positions |
| `scripts/check-contract.mjs` | Offline pre-flight for both engines — catches the silent failures |
| `scripts/motion-render.mjs` | music → lint → check → render → mux, single or batch |

Templates:

- `assets/hyperframes/` — a 12 s, four-beat launch card. `index.html` is a
  container of four nested compositions (`data-composition-src`), each beat in
  `compositions/*.html` with its own paused timeline. The structure the linter
  recommends, and what makes `--review` and the editor timeline work per scene.
  Ships with `brief.json` describing it and `rows.example.json` for batch.
  Zero dependencies beyond the GSAP CDN.
- `assets/remotion/` — the same piece in React, one file per beat.

The HyperFrames template lints clean (0 errors, 0 warnings across all five
files), passes `hyperframes check` — layout, runtime, motion, 10/10 WCAG AA
contrast, craft — and has been rendered frame by frame. `assets/preview.jpg` is
its actual output, one settled frame per beat. The Remotion template is
bundle-verified and carries identical timing; render it once after `npm install`
to confirm on your machine.

---

## Prerequisites

Check these before promising a render. Everything here is identical on macOS,
Linux, WSL and Windows — only the FFmpeg install differs.

| Need | For | Check |
| - | - | - |
| Node 18+ | everything (`npx`) | `node --version` |
| **FFmpeg + FFprobe on PATH** | **HyperFrames `render`** | `ffmpeg -version` |
| Chrome | both lanes | downloaded on first run |
| `node_modules` | Remotion only | `ls node_modules` |

FFmpeg per platform:

```bash
# macOS (Intel or Apple Silicon)
brew install ffmpeg

# Debian / Ubuntu
sudo apt install ffmpeg

# Fedora
sudo dnf install ffmpeg

# Arch
sudo pacman -S ffmpeg

# Windows
winget install --id Gyan.FFmpeg -e
```

HyperFrames' `lint`, `check`, `snapshot`, and `keyframes` do **not** need
FFmpeg — only `render` does. So validation works on a bare machine and the
render is the one step that can stop for a missing dependency.

Remotion bundles its own FFmpeg binaries, so the Remotion lane renders without
a system FFmpeg. If FFmpeg is unavailable and the work has to ship today,
Remotion is the lane that still works.

### Linux containers

Chrome needs shared libraries that slim images omit, and it refuses to run as
root. On a bare Debian/Ubuntu-based CI image:

```bash
sudo apt install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
  libpango-1.0-0 libcairo2 libasound2
```

Then run the render as a non-root user.

If the browser still cannot launch, that is an environment problem, not a
composition problem — say so plainly instead of rewriting the beats.

---

## Held values

If a step needs something only the user has — an API key for generated assets, a
brand font file, a logo SVG, a target output path — build everything else whole
and name the one missing value in a single line. Do not stall the build on it,
and do not invent a placeholder URL.

Remotion needs `npm install` before it renders (about 950 MB of dependencies).
HyperFrames does not. If the environment is offline or locked down, HyperFrames
is the lane that still works.
