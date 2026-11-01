# motionbrief

**Catch timing and copy drift before rendering.**

[![CI](https://github.com/YahyaLendani/motionbrief-claude-skills/actions/workflows/verify.yml/badge.svg)](https://github.com/YahyaLendani/motionbrief-claude-skills/actions/workflows/verify.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-7dd3fc?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-7dd3fc?style=flat-square)](package.json)
[![Platforms](https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-7dd3fc?style=flat-square)](#platforms)
[![Claude Code skill](https://img.shields.io/badge/Claude%20Code-skill-7dd3fc?style=flat-square)](skills/motionbrief/SKILL.md)

Describe the video in one sentence. Claude compiles it into a `brief.json` — every
cut, every hold, every word — validates it in ten milliseconds, builds it, and
renders an MP4 with music synthesized from the same beat grid.

Same brief, same cuts, same words, byte-identical music. If the build's timing or
copy drifts from the brief, it fails before it renders, and anything that could
not be measured is named rather than assumed. It does not judge how the video
looks: that stays a review of the frames.

[![The MotionBrief intro — logo morph, one sentence, the beat grid, same brief same cuts, install lockup](docs/intro.gif)](docs/intro.mp4)

<sub>17 s · 1920×1080 · 60 fps · built from [`examples/motionbrief-intro/brief.json`](examples/motionbrief-intro/brief.json) — every cut on a 120 BPM grid, score synthesized from the same beat</sub>

```bash
npx skills add YahyaLendani/motionbrief-claude-skills
```

Then, in Claude Code:

```
/motion a 12 second launch video for a coffee subscription called Ember
```

---

## Why a brief

Most "make me a video" tools go *prompt → code → render*. Every run re-decides
duration, easing, copy, palette, and how long the closing line stays on screen.
That is why the second attempt never matches the first, and why "make it
punchier" means another roll of the dice.

This skill puts the decisions in a file first:

```
your sentence
      │
      ▼
 brief.json          ← beats, timings, copy, feel, palette, bpm
      │               validated in ~10 ms by scripts/brief.mjs
      ▼
 composition         ← built from a template that already renders
      │
      ▼
 validation          ← build compared with the brief: statically, then in a
      │               headless browser at the settled frames. Then the
      │               engine's own linter
      ▼
 picture.mp4  +  music.wav  →  renders/*.mp4 + a report of what was measured
```

The brief takes about ten seconds to compile and it buys back the entire rebuild.

---

## What sets it apart

There are [hundreds of video skills](https://github.com/zhuyansen/awesome-claude-video-skills),
and most do more than this one: the official HyperFrames and Remotion skills,
toolkits with voiceover and AI footage, kits whose critics review the finished
render. motionbrief does something narrower that we could not find elsewhere:
it holds the build to a brief that a script has already checked.

### 1. The build is held to the brief

`check-contract.mjs` compares the project with `brief.json`. Move a scene,
change the size, or paraphrase a line, and it fails. Hide a line, and the runtime
check says how:

```
ERROR [brief_timing_mismatch] beat "lockup" is 9s–12s in the brief but scene #scene-lockup is 8s–12s
ERROR [brief_copy_missing]    beat "lines" copy "Cut on beat." does not appear in the composition
ERROR [copy_not_visible]      beat "stat" copy "frames" is never readable: transparent at 2.5s
```

Every requirement ends up `verified`, `failed` or `unverified`, and `unverified`
is not a pass: it blocks the render until the requirement is measured, or a person
accepts that one requirement by name. Nothing is accepted silently.

| Checked | How |
|---|---|
| Size, fps, length | Static or runtime, then measured on the finished file |
| Each beat maps to a scene, by explicit id | Static |
| Each scene's start and duration, within a frame | Static, or runtime when the source computes them |
| Each line of copy is in that beat's scene | Static, then in the rendered DOM |
| Each line is readable, long enough, at its settled frames | Runtime |
| First frame is not empty, when the brief says so | Runtime |
| Container, audio stream, the bed is not silent | ffprobe on the finished file |
| **Not checked:** palette, easing, transitions, layout, taste | Frame review. A build can pass everything and still look wrong |

Comments, unused variables and other scenes do not count as the copy being there.
Matching ignores case and whitespace and folds curly quotes, so it is not byte
equality. `12,480` matches a count-up that settles on `12480`.
[`references/validation.md`](skills/motionbrief/references/validation.md) has the
exact rules, statuses, requirement ids, overrides and limits.

`motion-render.mjs` runs all this before spending render time. The static part
needs no install, no browser and no network. The runtime part needs the pinned
engine, a Chrome and Node 22+, and if it cannot run, the requirements it would have
measured stay `unverified`.

### 2. A brief a script can reject

Other skills write briefs too, as prose. This one is JSON with a fixed schema,
and `brief.mjs` rejects the mistakes that otherwise only show up at render time:

```
ERROR [timing_gap]         beats[1] "b" starts 0.50s after "a" ends — blank frame
ERROR [duration_mismatch]  beats cover 9.50s but format.duration is 10s
ERROR [unknown_kind]       beats[2] "c" has kind "wobble"
ERROR [off_beat_grid]      "stat" starts 7.0s, 125ms off the nearest beat — the cut drifts
warn  [empty_first_frame]  "a" does not set visibleAtStart — frame 0 is the thumbnail
warn  [closing_hold_short] "d" holds 1.2s — under the 2s a closing line needs
```

The last three are the exact failures the real renderer caught the first time
this project was built. Now they cost ten milliseconds and never come back.

Errors exit 1, and the render wrapper stops on them.

### 3. A pre-flight for silent failures

The same script also fails on the things that render *wrong but silently*: an
unregistered timeline, a `window.__timelines` key that doesn't match
`data-composition-id`, an unpaused GSAP timeline, `Math.random()` in a
composition, an unclamped `interpolate`, a raw `<video>` where
`<OffthreadVideo>` belongs. It runs in milliseconds before the engines' own
linters, which still run after it.

### 4. One brief, two engines

| | [HyperFrames](https://hyperframes.heygen.com) | [Remotion](https://remotion.dev) |
|---|---|---|
| You write | HTML + a paused GSAP timeline | React components |
| Install | automatic, once: `hyperframes@0.8.226` from a committed lockfile (Node 22+) | `npm ci` (~950 MB), `remotion@4.0.539` from a committed lockfile |
| Licence | Apache 2.0 | free to 3 people, paid above |
| Best when | reusing HTML/CSS, or no build step | your team already writes React |
| Static copy check | Scene markup is `verified` statically | Always settled at runtime: statics can't prove JSX renders |
| Computed timing | Runtime reads the scene hosts | Needs `data-brief-beat` on an element inside the `<Sequence>` |

Both templates in this repo are the same 12 seconds, so you can read them side by
side. CI checks both against the same brief. That compares timing and copy, not how
each one looks.

### 5. Music that is the same every time

`music.mjs` synthesizes a bed from the brief's own `bpm` and beat positions —
additive synthesis, seeded noise, written as 16-bit PCM WAV. No samples, no API
keys, no downloads. The same brief gives a byte-identical WAV. CI checks that on
each platform, and compares the hash between platforms.

A 120 BPM brief puts a downbeat every 0.5 s, so every cut lands on one. Change
the tempo and the validator tells you which cuts no longer line up.

It is a simple bed, not a produced track. If you want real music with cuts on
its beat, other skills do that well (see below).

`motion-render.mjs` adds the bed to mp4, webm and mov on both engines, and measures
that the result has an audio stream that is not silent. GIF cannot carry audio, so
a brief with audio is refused for GIF unless you pass `--no-audio`.

Batch rendering is video-only: `--batch rows.json` uses HyperFrames' own batch mode,
and gives Remotion one props file per row. A brief with a generated bed is refused
for batch unless you pass `--no-audio`, rather than quietly dropping the music.

### 6. A report on every render

Each render writes `<out>.report.json`, pass or fail: the validation result, every
override, the engine, Node, browser and encoder versions, the lockfile and brief
hashes, the fonts actually drawn, external assets, and ffprobe's measurements of the
file. `doctor.mjs` says what is ready on this machine and what would need the
network, without using it.

Repeatability is several separate claims, and only some are made here. See
[Repeatability](skills/motionbrief/references/validation.md#repeatability): music is
byte-identical, video across machines is not promised.

### When to use something else

motionbrief makes short, repeatable pieces from one template. It does not:

- **judge the finished render.** It measures the DOM and the file, not how the
  pixels look. It flags hidden, clipped and covered copy, overlap and small text, but
  contrast, composition and taste are left to `hf.mjs check` and to you. Text in a
  canvas or an image cannot be read at all.
  [motion-video-kit](https://github.com/echris6/motion-video-kit) has fresh
  critics review the actual render.
- **do voiceover, captions, footage or AI media.** See the official
  [HyperFrames](https://github.com/heygen-com/hyperframes) and
  [Remotion](https://github.com/remotion-dev/skills) skills, or
  [claude-code-video-toolkit](https://github.com/digitalsamba/claude-code-video-toolkit).
- **ship a large library.** One template today, and most of the animation names
  in the brief's vocabulary have no worked example yet. HyperFrames' registry
  has hundreds of blocks.
- **produce real music.** [claude-motion-design](https://github.com/howseen-ai/claude-motion-design)
  aligns cuts to a real track's drop.

They combine well: motionbrief's checks are plain Node scripts, so they can run
in front of any HyperFrames or Remotion project.

---

## Quick start

### With Claude Code

```bash
npx skills add YahyaLendani/motionbrief-claude-skills
```

Or clone and run the installer:

```bash
git clone https://github.com/YahyaLendani/motionbrief-claude-skills.git
cd motionbrief-claude-skills
bash install.sh          # macOS / Linux / WSL / git-bash
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1   # Windows
```

Then restart Claude Code and:

```
/motion a punchy 8 second logo sting for a coffee subscription called Ember
```

The agent compiles the brief, prints a summary like this, and builds — same turn,
no approval gate:

```
brief · ember-sting · hyperframes · 8s 1920x1080 @30 · mp4

  BEAT              TIME         KIND         MOTION          COPY
  0 mark            0.0–2.0s     logo         settle-in       "EMBER"
  1 lines           2.0–5.5s     kinetic      word-stagger    "Roasted Tuesday." +1
  2 lockup          5.5–8.0s     lockup       settle-in       "Ember" +1

  feel    energy=high ease=snappy overshoot=objects-only transition=cinematic-zoom
  brand   Ember
  palette bg=#0b0907 fg=#f6f1ea accent=#f59e0b
  assets  none   audio generated
  music   high · 120 BPM · C minor · beat every 0.500s

  assumptions
    · No tagline supplied — copy derived from your description.
    · Single warm accent on near-black, since no brand colours were given.

  clean — timing tiles, first frame deliberate, closing line readable
```

### Without Claude

The scripts are dependency-free Node. The engines they drive are pinned:

```bash
node skills/motionbrief/scripts/brief.mjs brief.json --commands
node skills/motionbrief/scripts/doctor.mjs --dir .
node skills/motionbrief/scripts/motion-render.mjs --brief brief.json
```

Or through the repo's own example:

```bash
npm run verify     # validate the briefs and both templates, statically, and run the fast tests
npm run render     # validate, music, picture, mux → renders/motions-launch.mp4
npm run test:smoke # real short renders on both engines, measured with ffprobe
```

If a requirement stays `unverified` and you accept that, name it. Never all of them:

```bash
node skills/motionbrief/scripts/motion-render.mjs --brief brief.json --allow-unverified "beat.lines.copy[0].visible"
```

---

## The brief

This is the brief behind the video at the top, trimmed: the per-beat `notes`,
the type settings and the `assumptions` are left out. The full file is
[`examples/motionbrief-intro/brief.json`](examples/motionbrief-intro/brief.json).

```json
{
  "slug": "motionbrief-intro",
  "lane": "hyperframes",
  "format": { "width": 1920, "height": 1080, "fps": 60, "duration": 17, "container": "mp4" },
  "brand": { "name": "MotionBrief", "tagline": "Catch timing and copy drift before rendering.", "palette": { "bg": "#08090c", "fg": "#f4f5f7", "accent": "#7dd3fc" } },
  "feel": { "energy": "medium", "ease": "snappy", "overshoot": "objects-only", "transition": "cinematic-zoom" },
  "audio": { "policy": "generated", "bpm": 120, "preset": "medium", "key": "A", "mode": "minor" },
  "beats": [
    { "id": "logo",     "start": 0,    "duration": 4,   "kind": "logo",    "motion": "assemble",     "visibleAtStart": true, "copy": ["MotionBrief"] },
    { "id": "sentence", "start": 4,    "duration": 3,   "kind": "kinetic", "motion": "word-stagger", "copy": ["Describe the video in one sentence."] },
    { "id": "grid",     "start": 7,    "duration": 3.5, "kind": "chart",   "motion": "grow",         "copy": ["brief.json", "Every cut, every hold, every word."] },
    { "id": "same",     "start": 10.5, "duration": 2.5, "kind": "kinetic", "motion": "scale-in",     "copy": ["Same brief,", "same cuts,", "same words,", "byte-identical music."] },
    { "id": "lockup",   "start": 13,   "duration": 4,   "kind": "lockup",  "motion": "settle-in",    "hold": 2.35, "copy": ["MotionBrief", "Catch timing and copy drift before rendering.", "npx skills add YahyaLendani/motionbrief-claude-skills"] }
  ]
}
```

`kind` and `motion` are a closed vocabulary — 8 beat kinds, 3–5 motions each.
That finite grammar is what makes generation reliable instead of improvised:
every pair maps to a known code pattern in both engines.

Full schema, defaults table and the iteration levers:
[`references/brief.md`](skills/motionbrief/references/brief.md).

### Iteration is a field edit

| You say | The agent edits |
|---|---|
| punchier / snappier | `feel.ease: snappy`, `energy: high`, durations −20% |
| slower / more premium | `ease: dramatic`, holds +30%, one accent |
| cleaner / corporate | `overshoot: none`, `energy: medium` |
| different length | stretch `format.duration`, redistribute beats, keep holds |

The composition changes only when `kind` or `motion` changes.

---

## Requirements

| Need | For | Check |
|---|---|---|
| **Node 18+** | the static scripts (brief, static contract check, music) | `node --version` |
| **Node 22+** | the HyperFrames engine, and the runtime check on either engine | `node --version` |
| **Claude Code** | the `/motion` path (optional) | `claude --version` |
| **FFmpeg + FFprobe** | HyperFrames rendering, muxing the music, and measuring the output, on both engines | `ffmpeg -version` |
| **Chrome** | the runtime check and rendering. The engine fetches its own if none is found | `doctor.mjs` |
| `node_modules` | Remotion only | `npm ci` |
| **Network** | first-time engine and browser installs, Google Fonts on first use, the templates' GSAP CDN | `doctor.mjs` |

`doctor.mjs` reports all of this without using the network, including whether a
render would finish offline. The details are in
[Network and offline](skills/motionbrief/references/validation.md#network-and-offline).

HyperFrames sends its own anonymous usage telemetry unless you turn it off. Set
`HYPERFRAMES_NO_TELEMETRY=1` or `DO_NOT_TRACK=1` to stop it. MotionBrief does not
change that setting for you.

```bash
# macOS
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

Reopen your shell afterwards. `brief.mjs`, `music.mjs` and `check-contract.mjs`
need no FFmpeg. Remotion bundles FFmpeg for its own encode, but the music mux and the
output measurements use the system's.

### Platforms

The scripts run on macOS, Linux, WSL and Windows, and never go through a shell:
paths and ids reach each tool as literal arguments, whatever characters they contain.
`.cmd` and `.bat` wrappers are refused, since they would need one. The Windows
behaviour has been run on Windows. CI is configured to run the validators and the
render smoke tests on all three, and each installer on its own platform. Music is
byte-identical everywhere. Video is not promised to be: font rasterization and browser
builds differ between systems.

---

## Repository layout

```
skills/motionbrief/
  SKILL.md              what Claude reads
  references/
    brief.md            schema, kind/motion grammar, defaults, iteration levers
    hyperframes.md      HTML engine: contract, attributes, CLI, lint codes
    remotion.md         React engine: hooks, sequencing, CLI, pitfalls
    motion-craft.md     seven motion rules, easing tables, transitions
    prompting.md        longer multi-scene pieces
    validation.md       what "passed" means: statuses, requirements, overrides, limits
  scripts/
    brief.mjs           validate · summarize · emit render commands
    music.mjs           beat-locked WAV synthesis from the brief
    check-contract.mjs  the brief and contract gate, static, plus --runtime
    runtime-check.mjs   the headless inspection behind --runtime
    copy-rules.mjs      how copy is normalized and matched
    motion-render.mjs   validate → music → lint → render → mux → measure → report
    toolchain.mjs       pinned engines and shell-free process execution
    hf.mjs              run the pinned HyperFrames CLI
    doctor.mjs          what is ready here, without using the network
  engines/              pinned engine versions and the HyperFrames lockfile
  assets/
    hyperframes/        the 12 s Motions launch card (root + 4 sub-compositions)
    remotion/           the same piece in React, with its lockfile
    preview.jpg         one settled frame per beat
examples/
  motionbrief-intro/    the 17 s intro at the top of this README (root + 5 scenes)
tests/                  npm test: each test breaks a template and checks the error
tests/smoke/            npm run test:smoke: real renders, measured with ffprobe
docs/                   README media (intro.mp4, intro.gif, intro.jpg)
.claude/commands/motion.md
.github/workflows/verify.yml
install.sh · install.ps1
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ffmpeg is needed...` / `ffprobe is needed...` | not on PATH | install per [Requirements](#requirements), reopen the shell. Or set `MOTIONBRIEF_FFMPEG` / `MOTIONBRIEF_FFPROBE` |
| `exit 3`, `brief_copy_dynamic` or `brief_timing_unverified` | static checks cannot settle it, and the runtime check could not run | run `doctor.mjs`. Otherwise accept that one id with `--allow-unverified` |
| `copy_not_visible` | the line is in the DOM but never readable | the message says why: hidden, transparent, off-screen, clipped, blurred or covered |
| `copy_hold_short` | readable, but not for long enough | hold the line for `beats[].hold`, or change the brief on purpose |
| `... is a batch wrapper` | a `.cmd` or `.bat` on PATH instead of the executable | point `MOTIONBRIEF_FFMPEG` at the real `.exe` |
| `Permission denied` from ffmpeg during a render | the machine stops ffmpeg writing in the temp folder | `doctor.mjs` shows `temp-writable`. Point `TMP` and `TEMP` at a folder it may use |
| `/motion` unknown | commands load at session start | restart Claude Code |
| `timing_gap` / `duration_mismatch` | beats don't tile the timeline | fix the brief, not the code |
| `off_beat_grid` | a cut falls between beats | move the cut, or change `audio.bpm` |
| `timeline_key_mismatch` | registry key ≠ `data-composition-id` | they must match exactly |
| `missing_data_no_timeline` | composition with no timeline and no opt-out | register one, or add `data-no-timeline` |
| Motion runs past its range | `interpolate` not clamped | `extrapolateRight: "clamp"` |
| `permission denied: ./install.sh` | exec bit lost in transfer | `bash install.sh` |
| `AuthorizationManager check failed` | PowerShell script policy | `powershell -ExecutionPolicy Bypass -File .\install.ps1` |
| `libnss3.so` missing (Linux) | slim image without Chrome deps | see [Linux containers](skills/motionbrief/SKILL.md#linux-containers) |

---

## Status

Run on 2026-11-01 with HyperFrames 0.8.226 (which renders in Chrome 152) and Remotion
4.0.539 (Chrome 157): on Windows 11 with Node 24.16.0, and in CI on Ubuntu, macOS and
Windows with Node 22. What these results do and do not prove is in
[validation.md](skills/motionbrief/references/validation.md).

**On all four**

- `npm run verify` — the brief and contract checks pass, and **128/128** fast tests
  pass on Windows, **127/127** on Ubuntu and macOS, which lack one Windows-only test. CI
  runs the same checks and tests as separate steps.
- `npm run test:smoke` with `MOTIONBRIEF_FULL_SIZE=1` — **52/52** on Ubuntu and macOS.
  On Windows 50 pass and 2 skip, because the long `TMPDIR` case does not apply there.
  Short real renders on both engines, measured with ffprobe: MP4, WebM and MOV with a
  non-silent bed, a silent MP4 with `--no-audio`, GIF silent or refused, and a project
  path with spaces, `&`, `( )` and `%`. Negative fixtures fail for hidden, transparent,
  off-screen, clipped, covered and briefly shown copy.
- Both templates (1920×1080, 30 fps, 12 s) and the intro (1920×1080, 60 fps, 17 s)
  rendered at full size in h264 + AAC, and measured against their briefs.
- `music.mjs` — the same brief gives a byte-identical WAV, with the same hash on every
  platform.
- Two renders of one picture matched byte for byte on each machine.

**In CI on all three**

- `install.sh` or `install.ps1`, each on its own platform.

**On the Windows 11 machine only**

- `hyperframes lint` — **0 errors, 0 warnings** across the five template files and the
  six files of the intro. CI also runs the linter on Ubuntu.
- `check-contract --runtime` on the templates — **29/29** requirements verified on both
  engines. One advisory on each: "renders" is about 8 px at phone width.
- `hyperframes check` on the HyperFrames template: **10/10 text passes WCAG AA**.
- **The MP4 behind this README is real** — rendered from
  `examples/motionbrief-intro/brief.json`, h264 + AAC, 17.0 s, 1920×1080, 60 fps,
  3.3 MB. The GIF is the same film at 25 fps and 880 px wide. **97/97 text passes WCAG
  AA.** At runtime 36 requirements verified and 1 was accepted with `--allow-unverified`:
  frame 0 shows only a graphic, so a person checked it.

**Not shown**

- That video matches between machines. The same render differs in bytes across
  platforms, and FFmpeg versions and font rasterization differ too.
- That WebM and MOV carry the same colour tags on every platform. The smoke test asserts
  colour on MP4 only. On Windows, Remotion WebM and MOV and HyperFrames MOV are tagged
  BT.709. HyperFrames WebM has no colour-space tag.

---

## Contributing

```bash
npm run verify
```

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). The house rule is
simple: if it can render wrong without an error, the contract checker should
catch it.

## Licence

MIT — see [LICENSE](LICENSE). This covers the skill's own files. HyperFrames is
Apache 2.0, Remotion has its own seat-limited licence, and GSAP has its own
terms; using those engines means following theirs. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
