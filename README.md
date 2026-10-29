# motionbrief

**A brief your agent can't drift from.**

[![CI](https://github.com/YahyaLendani/motionbrief-claude-skills/actions/workflows/verify.yml/badge.svg)](https://github.com/YahyaLendani/motionbrief-claude-skills/actions/workflows/verify.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-7dd3fc?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-7dd3fc?style=flat-square)](package.json)
[![Platforms](https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-7dd3fc?style=flat-square)](#platforms)
[![Claude Code skill](https://img.shields.io/badge/Claude%20Code-skill-7dd3fc?style=flat-square)](skills/motionbrief/SKILL.md)

Describe the video in one sentence. Claude compiles it into a `brief.json` — every
cut, every hold, every word — validates it in ten milliseconds, builds it, and
renders an MP4 with music synthesized from the same beat grid.

Same brief, same cuts, same words, byte-identical music. And if the build drifts
from the brief, it fails before it renders.

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
 validation          ← build compared with the brief, offline contract
      │               check, then the engine's own linter
      │
      ▼
 picture.mp4  +  music.wav  →  renders/*.mp4
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
change the size, or paraphrase a line, and it fails:

```
ERROR [brief_timing_mismatch] beat "lockup" is 9s–12s in the brief but scene #scene-lockup is 8s–12s
ERROR [brief_copy_missing]    beat "lines" copy "Cut on beat." does not appear in the composition
```

It checks size, fps and length, every scene's start and duration (within a
frame), and every line of copy, verbatim, in both engines. `motion-render.mjs`
runs it before it renders, so a drifted build fails in milliseconds instead of
after a render. No install, no browser, no network.

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
| Install | none — `npx hyperframes` (Node 22+) | `npm install` (~950 MB) |
| Licence | Apache 2.0 | free to 3 people, paid above |
| Best when | reusing HTML/CSS, or no build step | your team already writes React |

Both templates in this repo are the same 12 seconds, so you can read them side by
side. CI checks both against the same brief, so they cannot drift apart.

### 5. Music that is the same every time

`music.mjs` synthesizes a bed from the brief's own `bpm` and beat positions —
additive synthesis, seeded noise, written as 16-bit PCM WAV. No samples, no API
keys, no downloads. The same brief gives a byte-identical WAV; CI checks it.

A 120 BPM brief puts a downbeat every 0.5 s, so every cut lands on one. Change
the tempo and the validator tells you which cuts no longer line up.

It is a simple bed, not a produced track. If you want real music with cuts on
its beat, other skills do that well (see below).

Batch rendering is a pass-through: `--batch rows.json` uses HyperFrames' own
batch mode, and gives Remotion one props file per row.

### When to use something else

motionbrief makes short, repeatable pieces from one template. It does not:

- **look at the finished render.** It checks the code, not the pixels, so text
  overflow, overlaps and contrast are left to `npx hyperframes check` and to you.
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
cd motionbrief
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
  1 lines           2.0–6.0s     kinetic      word-stagger    "Roasted Tuesday." +1
  2 lockup          6.0–8.0s     lockup       settle-in       "Ember" +1

  feel    energy=high ease=snappy overshoot=objects-only transition=cinematic-zoom
  music   high · 128 BPM · C minor · beat every 0.469s

  assumptions
    · No tagline supplied — copy derived from your description.
    · Single warm accent on near-black, since no brand colours were given.
```

### Without Claude

The scripts are dependency-free Node:

```bash
node skills/motionbrief/scripts/brief.mjs brief.json --commands
node skills/motionbrief/scripts/music.mjs --brief brief.json
node skills/motionbrief/scripts/motion-render.mjs --brief brief.json
```

Or through the repo's own example:

```bash
npm run verify     # validate the brief and both templates
npm run render     # music + picture + mux → renders/inkwell-launch.mp4
```

---

## The brief

```json
{
  "slug": "inkwell-launch",
  "lane": "hyperframes",
  "format": { "width": 1920, "height": 1080, "fps": 30, "duration": 12, "container": "mp4" },
  "feel": { "energy": "medium", "ease": "snappy", "overshoot": "objects-only" },
  "audio": { "policy": "generated", "bpm": 120, "preset": "medium", "key": "A", "mode": "minor" },
  "beats": [
    { "id": "wordmark", "start": 0,   "duration": 2.5, "kind": "logo",    "motion": "settle-in",    "visibleAtStart": true, "copy": ["INKWELL"] },
    { "id": "lines",    "start": 2.5, "duration": 4.5, "kind": "kinetic", "motion": "word-stagger", "copy": ["Write it down.", "Find it later."] },
    { "id": "stat",     "start": 7.0, "duration": 2.0, "kind": "stat",    "motion": "count",        "copy": ["notes captured", "12,480"] },
    { "id": "lockup",   "start": 9.0, "duration": 3.0, "kind": "lockup",  "motion": "settle-in",    "hold": 2.1, "copy": ["Inkwell"] }
  ],
  "assumptions": ["No tagline was supplied, so copy is derived from the description."]
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
| **Node 18+** | the skill's scripts (validate, check, music) | `node --version` |
| **Node 22+** | the HyperFrames engine (`npx hyperframes`) | `node --version` |
| **Claude Code** | the `/motion` path (optional) | `claude --version` |
| **FFmpeg + FFprobe** | rendering, and muxing the music | `ffmpeg -version` |
| `node_modules` | Remotion only | `npm install` |

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
need no FFmpeg — only rendering does. Remotion bundles its own FFmpeg binaries.

### Platforms

macOS, Linux, WSL and Windows are all first-class; CI runs the validators on all
three and each installer on its own platform. Music and picture are generated
identically everywhere — the only platform-specific code chooses a shell and
prints the right FFmpeg hint.

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
  scripts/
    brief.mjs           validate · summarize · emit render commands
    music.mjs           beat-locked WAV synthesis from the brief
    check-contract.mjs  offline pre-flight for both engines
    motion-render.mjs   music → lint → check → render → mux, single or batch
  assets/
    hyperframes/        the 12 s book in the GIF above (root + 4 sub-compositions)
    remotion/           the same piece in React
    preview.jpg         one settled frame per beat
docs/                   README media
.claude/commands/motion.md
.github/workflows/verify.yml
install.sh · install.ps1
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `✗ FFmpeg not found` | no system FFmpeg | install per [Requirements](#requirements), reopen the shell |
| `mux — music bed` fails | FFmpeg missing from PATH | same — the mux is a plain `ffmpeg` call |
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

Everything below was run, not assumed.

- `hyperframes lint` — **0 errors, 0 warnings** across all five template files,
  and clean on the 9 s promo example too
- `hyperframes check` — runtime, layout (0 issues over 9 samples), motion and craft
  all clean; **10/10 text passes WCAG AA**. Its `audio_none` line is expected: the
  composition is deliberately video-only and the bed is muxed afterwards.
- **The MP4 behind this README is real** — rendered from the committed brief,
  h264 + AAC, 9.0 s, 1920×1080, 30 fps, 546 KB
- `music.mjs` — deterministic: the same brief produces a byte-identical WAV
  (asserted in CI)
- `brief.mjs` — passes both committed briefs and returns every expected error and
  warning on deliberately broken ones
- `install.sh` and `install.ps1` — both executed; every file installed, no cache
  leakage
- CI runs the validators on Ubuntu, macOS and Windows, and each installer on its
  own platform

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
