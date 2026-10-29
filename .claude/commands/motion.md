---
description: Make a motion graphic from a plain-language description — compiles a brief, builds it, validates, renders
argument-hint: <what you want, e.g. "6s logo sting for Inkwell" or "punch up the stat card">
---

The user wants this: **$ARGUMENTS**

Do not ask clarifying questions. Compile the request into a brief, build it, and
render it. Record every choice you made on their behalf in `assumptions`.

Load the **motionbrief** skill (`SKILL.md`). If it is project-local it lives at
`skills/motionbrief/`; if it was installed globally it is at
`~/.claude/skills/motionbrief/`. Every path below is relative to that folder.

## 1. Compile the brief

Read `references/brief.md` for the schema, the defaults table, the
`kind`/`motion` grammar and the audio block.

Write `brief.json` in the project directory. Resolve every gap with a default
from the table — size, duration, ease, palette, copy policy, bpm. Do not leave a
field undefined.

Lane: **hyperframes** unless the user named Remotion or the repo is React/TS.

Pick `audio.bpm` so the beat grid divides the cuts: at `bpm`, a beat is
`60 / bpm` seconds, and every `beats[].start` should land on one. 120 BPM gives a
beat every 0.5 s, which suits most short pieces.

## 2. Show the summary, then build in the same turn

```
node <skill>/scripts/brief.mjs brief.json
```

Print that summary to the user. Fix every ERROR before continuing — including
`off_beat_grid`, which means a cut will drift against the music. Then build
immediately; do not wait for approval.

## 3. Build

Copy the matching template, then rewrite the beats to match the brief:

```bash
cp -R <skill>/assets/hyperframes/. ./my-video/
```

One file per beat. Timings come from the brief, not from improvisation. The
composition stays video-only — audio is muxed later.

## 4. Validate and render

```
node <skill>/scripts/check-contract.mjs --dir ./my-video
node <skill>/scripts/motion-render.mjs --brief ./my-video/brief.json
```

`check-contract.mjs` reads `./my-video/brief.json` and fails if the build has
drifted from it — scene timings, size, fps, or copy that is not verbatim. Fix
the code (or change the brief on purpose), never ignore it. The render wrapper
runs the same checks first, so it stops before rendering a drifted build.

The wrapper synthesizes the music, lints, checks, renders the picture, and muxes
the bed. Then look at the frames before you call it done:

```
npx hyperframes snapshot . --review
```

## 5. Report

Three lines: what rendered, where the file is, and anything you assumed. No
preamble, no recap of the request.

If a field genuinely needs a value only the user has — an API key, a logo file —
build everything else whole and name that one value in a single line.
