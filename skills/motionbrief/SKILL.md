---
name: motionbrief
description: Make motion graphics and short videos from HTML or React — title cards, logo stings, kinetic type, count-ups, stat reveals, lower thirds, transparent overlays, feature montages. Compiles a plain-language request into a validated brief, then renders it; batches one brief into many videos. Covers HyperFrames (HTML + GSAP, pinned, installs itself once, Apache 2.0) and Remotion (React + TypeScript). Use when asked to generate, animate, build, or render a video, motion graphic, animation, or overlay; to make a launch video, sting, or card; to port a composition between Remotion and HyperFrames; or to fix motion that feels cheap, bouncy, slow, or slide-like.
---

# Motion graphics

Generate video by writing a web page that the renderer seeks frame by frame.
Both lanes below do the same thing; the difference is what you write.

- **HyperFrames** — one HTML file, CSS for looks, a paused GSAP timeline for
  motion. `node scripts/hf.mjs` runs the pinned version and installs it once from a
  committed lockfile. Apache 2.0.
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
# HyperFrames — plain HTML. The pinned engine installs itself once, which needs network
cp -R assets/hyperframes/. ./my-video/
node scripts/hf.mjs lint ./my-video

# Remotion — React project, needs its pinned deps once
cp -R assets/remotion/. ./my-video/
cd my-video && npm ci
```

```powershell
# PowerShell
Copy-Item -Recurse -Force assets\hyperframes\* .\my-video\
Copy-Item -Recurse -Force assets\remotion\* .\my-video\
```

**Done when** `node scripts/hf.mjs lint` passes, or `npx remotion compositions
src/index.tsx` lists the composition id.

### 3. Build the beats

One file per beat. Keep the timeline flat — absolute times in HyperFrames,
`<Sequence>` frames in Remotion. Update the beat sheet when the build changes
the timing, then re-check the total duration.

Name each scene after its beat, because that is how the checks find it:
`data-brief-beat="<id>"` on the HyperFrames host, `<Sequence name="<id>">` in
Remotion. If a Remotion Sequence computes its timing, also put
`data-brief-beat="<id>"` on an element inside it, so the timing can be measured.

**Done when** every beat in the sheet exists in code, the composition duration
matches the sheet, and there are no `TODO`s, stubs, or placeholder copy.

### 4. Verify the motion

Stills lie about timing. Look at frames, then look at the render.

```bash
node scripts/check-contract.mjs --dir ./my-video --preflight   # static, no install
node scripts/check-contract.mjs --dir ./my-video --runtime     # also inspects it in a browser

node scripts/hf.mjs check ./my-video                # layout, motion, contrast
node scripts/hf.mjs snapshot ./my-video --review    # beat + seam frames as PNGs
node scripts/hf.mjs keyframes ./my-video --selector "#card" --shot motion.png

npx remotion still src/index.tsx LaunchCard out/f.png --frame=45
npx remotion studio src/index.tsx              # watch it at 1x
```

`check-contract.mjs` catches the silent failures without installing anything: an
unregistered timeline, a mismatched `window.__timelines` key, an unpaused
timeline, a missing duration, `Math.random()` in a composition, an unclamped
`interpolate`. It is a pre-flight, not a replacement for the real linters.

When `brief.json` sits in the project (or `--brief` points at one), it also
compares the build with the brief. Every requirement ends up `verified`, `failed`
or `unverified`. **`unverified` is not a pass, and it blocks the render.**

| Code | Status | Means |
| - | - | - |
| `brief_format_mismatch` | failed | Width, height, fps or length differ from `format` |
| `brief_scene_count`, `brief_scene_unmapped` | failed | A beat has no scene that declares its id, or a scene has no beat. Position is not identity |
| `brief_timing_mismatch` | failed | A scene does not start or last what the brief says, within a frame |
| `brief_copy_missing` | failed | The line is not in the scene. Comments and unused variables do not count |
| `brief_copy_wrong_scene` | failed | The line is only in another scene |
| `copy_not_visible` | failed | Runtime: in the DOM but hidden, transparent, off-screen, clipped, blurred or covered |
| `copy_hold_short` | failed | Runtime: readable for less than `beats[].hold` |
| `first_frame_empty` | failed | Runtime: `visibleAtStart` is set and nothing of the beat is painted |
| `first_frame_unverified` | unverified | Runtime: only a graphic is on the first frame, or the beat has no copy. Look at the frame |
| `brief_timing_unverified`, `brief_format_unverified` | unverified | The source computes it. Runtime can settle it |
| `brief_copy_dynamic`, `brief_copy_unverified` | unverified | Whether it is shown is a runtime question. Remotion copy is always this until runtime |

Matching ignores case and whitespace and folds curly quotes. Other punctuation is
significant, and `"12,480"` matches a count-up that settles on `12480`. When
requirements stay unverified, say which, and try to make them measurable before
accepting them. Accepting one means naming it, with
`--allow-unverified "beat.lines.copy[0].visible"`, and reporting that to the user.
Never accept a blanket pattern, and failures cannot be accepted at all. Read
`references/validation.md` for the exact rules and limits.

Fix drift in the code, or change the brief on purpose and re-run `brief.mjs` —
never let the two disagree.

#### Review the frames — every check can pass on a broken film

A passing contract says timing and copy match, and that the text is readable. It
says nothing about palette, easing, transitions, or whether the film works. Lint,
layout, motion, contrast and craft checks all passed on this skill's own
template while it cut to black on every beat and exited its count-up the
instant the number landed. Only looking at frames caught it. Capture them:

```bash
# HyperFrames: beat frames, a 5-frame strip around every cut, and a phone sheet
node scripts/motion-render.mjs --brief ./my-video/brief.json --snapshot --no-render

# Remotion: for each cut c (in frames), grab c-6, c and c+6, plus each beat's middle
# (the template cuts at 75, 210 and 270)
node scripts/motion-render.mjs --dir ./my-video --no-render \
  --stills 37,69,75,81,142,204,210,216,240,264,270,276,315
```

Then read the images and answer each question. Fix the code, re-capture, look again:

- **Is the cut black?** More than one empty frame around a cut means the exit
  finishes early and the next beat fades in from nothing. Move the exit so it
  *ends on the cut* (`start = beat duration − exit duration`).
- **Does the payoff hold?** A count-up's final number, or a line's last word,
  stays still on screen for at least one beat (`60 / bpm` s) before it leaves.
  Exiting the moment it lands means it is never read.
- **Does it read on a phone?** Check `review-phone.jpg`, or picture the frame
  at 360 px wide. At 1080p, labels and taglines under ~40 px usually fail.
- **Is it the brief's font?** A fallback such as Segoe UI or Arial means the font
  never loaded, and another machine will render a different film. `--runtime` warns
  with `font_fallback`, and the report records the fonts actually drawn. Remotion
  needs `@fontsource/*` (the template's choice) or `@remotion/fonts` for a local file.
- **Is it the brief's transition?** `feel.transition` is in the frames around
  each cut, not a dip to black.

**Done when** you have read the beat frames and every seam strip, answered each
question above, and every checklist line under "Ship checklist" holds.

### 5. Render

```bash
node scripts/motion-render.mjs --brief ./my-video/brief.json
node scripts/motion-render.mjs --brief ./my-video/brief.json --batch rows.json --no-audio
```

The wrapper reads lane, format, fps and slug from the brief, and stops before any
render time is spent if the brief, the static checks, the tools, the assets or the
runtime check say so. It exits 1 on a failure and 3 on unverified requirements.
`--no-checks` skips validation and records that in the report. Then it lints, renders,
measures the file with ffprobe, and writes `<out>.report.json`.

When `audio.policy` is `generated`, on either lane, it synthesizes the bed with
`music.mjs`, renders the picture video-only, and muxes the two with one `ffmpeg`
call — so the composition never depends on an engine's audio mixer. It then
measures that the file has an audio stream and that it is not silent.

For transparency: `--format webm` or `--format mov` — H.264 cannot carry alpha.
`--no-audio` skips the bed and gives a file with no audio stream. GIF cannot carry
audio, so a brief with a bed is refused for GIF unless you pass `--no-audio`.

With `--batch`, one brief plus a rows file becomes N videos: HyperFrames renders
rows natively, Remotion gets one props file per row. Batch is video-only, and a brief
with a bed is refused unless you pass `--no-audio`.

**Done when** the file exists, the report says `rendered`, its `notVerified` list is
empty or you have told the user what is on it, and its first and last frames are
deliberate.

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
- [ ] `check-contract.mjs --runtime` says `verified`, or the unverified ids are
      accepted by name and reported to the user.
- [ ] Copy, numbers, handles, and URLs are as written — no lorem, no placeholder.
- [ ] Timeline registered under the composition id (HyperFrames), or composition
      listed by `npx remotion compositions` (Remotion).
- [ ] Lint/check clean.
- [ ] `<out>.report.json` says `rendered`, with the expected size, fps, length and audio.
- [ ] Frames inspected: every beat, every seam, phone width — no black at a cut,
      the payoff holds for a beat, small text reads, the brief's font loaded.
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
| `references/validation.md` | A check says `unverified`, or you need to know what a pass does and does not mean: statuses, requirement ids, scene identity, overrides, audio limits, network needs, repeatability |

Scripts:

| File | What it does |
| - | - |
| `scripts/brief.mjs` | Validate a brief in ~10 ms, print its summary, emit render commands |
| `scripts/music.mjs` | Synthesize a beat-locked WAV from the brief's `bpm` and beat positions |
| `scripts/check-contract.mjs` | The brief and contract gate. Static for both engines, `--runtime` inspects it in a browser |
| `scripts/motion-render.mjs` | validate → music → lint → render → mux → measure → report, single or batch |
| `scripts/hf.mjs` | Run the pinned HyperFrames CLI |
| `scripts/doctor.mjs` | What is ready on this machine, and what would need network, without using it |

Templates:

- `assets/hyperframes/` — a 12 s, four-beat launch card. `index.html` is a
  container of four nested compositions (`data-composition-src`), each beat in
  `compositions/*.html` with its own paused timeline. The structure the linter
  recommends, and what makes `--review` and the editor timeline work per scene.
  Ships with `brief.json` describing it and `rows.example.json` for batch. It loads
  GSAP from a CDN, and the engine fetches its fonts on first use.
- `assets/remotion/` — the same piece in React, one file per beat. Pinned with a
  lockfile, with fonts from `@fontsource/inter`.

Both templates were rendered on Windows on 2026-11-01 at 1920×1080, 30 fps, 12 s,
with 29/29 runtime requirements verified. The HyperFrames template lints clean (0
errors, 0 warnings across all five files) and passes `hyperframes check`, with 10/10
WCAG AA contrast. `assets/preview.jpg` is its actual output, one settled frame per
beat. On macOS and Linux only short smoke fixtures have been rendered, so render once
to confirm on your machine.

---

## Prerequisites

Check these before promising a render: `node scripts/doctor.mjs --dir ./my-video`
reports all of them and what would need network, without using it. The commands
are the same on macOS, Linux, WSL and Windows — only the FFmpeg install differs.

| Need | For | Check |
| - | - | - |
| Node 18+ | the static scripts (`brief`, `check-contract`, `music`) | `node --version` |
| Node 22+ | HyperFrames, and `--runtime` on either lane | `node --version` |
| **FFmpeg + FFprobe on PATH** | **HyperFrames `render`, the music mux and output measurement on either lane** | `ffmpeg -version` |
| Chrome | both lanes | downloaded on first run, which needs network |
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
FFmpeg — only `render` does. So validation works without it.

Remotion bundles FFmpeg for its own encode, but `motion-render.mjs` uses the
system's for the music and the measurements. Without it, a silent Remotion render
still works if the user accepts that:
`--no-audio --allow-unverified "output.*"`.

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

Remotion needs `npm ci` before it renders (about 950 MB of dependencies).
HyperFrames installs itself on first use. Both need network the first time, and
neither is offline-ready until `doctor.mjs` says so.
