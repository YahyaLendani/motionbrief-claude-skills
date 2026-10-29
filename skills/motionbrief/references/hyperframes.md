# HyperFrames reference

HTML + CSS + a paused GSAP timeline. The renderer **seeks** the timeline to each
frame and screenshots it. No React, no build step, no `node_modules`.

Docs: <https://hyperframes.heygen.com>. CLI is `npx hyperframes` (no install).

---

## The one contract that matters

Every composition is an HTML file. Four things must be true or the render breaks:

1. The root has an explicit pixel box, `data-composition-id`, `data-width`,
   `data-height`, `data-duration` (seconds), and `data-start="0"`.
2. Every timed element carries `id` + `data-start` + `data-duration`.
3. The GSAP timeline is built **paused**.
4. The timeline is registered on `window.__timelines` under **the same key as
   `data-composition-id`**, after its tweens are added.

Miss #4 and you get a still frame with no motion, silently. That is the number
one failure. Miss the paused flag and frames render inconsistently.

---

## Minimal valid composition

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      body { margin: 0; }
      #root {
        position: relative;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
      }
      .clip {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="5"
      data-width="1920"
      data-height="1080"
    >
      <section id="title-card" class="clip" data-start="0" data-duration="5" data-track-index="1">
        <h1 id="title">Hello HyperFrames</h1>
      </section>
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const timeline = gsap.timeline({ paused: true });
      timeline.fromTo(
        "#title",
        { y: 48, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.6, ease: "power3.out" },
        0.2,
      );
      window.__timelines.main = timeline;
    </script>
  </body>
</html>
```

---

## Attribute reference

### Composition root

| Attribute | Required | Meaning |
| - | - | - |
| `data-composition-id` | yes | Unique id; must equal the `window.__timelines[...]` key |
| `data-start="0"` | yes (top level) | Composition start |
| `data-width` / `data-height` | yes | Authored pixel size |
| `data-duration` | usually | Total seconds. Required for Three.js, unbounded animation, timeline-free compositions |
| `data-fps` | no | Default frame rate for the render |
| `data-no-timeline` | only for static | Tells the runtime not to wait for a timeline registration |

Root `data-duration` is read **before** scripts run — you cannot change the
render length from JS.

### Timed clips

| Attribute | Required | Meaning |
| - | - | - |
| `id` | yes | Stable identifier; render-time frame injection targets it |
| `data-start` | yes | Seconds, or a relative expression (`intro + 0.5`) |
| `data-duration` | yes for DOM/nested; optional for image (3 s default), video/audio (source length) | Visible slot |
| `data-track-index` | no | Editor display lane only. Does **not** schedule or control paint order — use `z-index` |
| `class="clip"` | recommended | Supplies the full-frame box |

Relative timing supports `clip-id`, `clip-id + seconds`, `clip-id - seconds`.
Must resolve within the same composition, no cycles.

### Timed clips vs sub-compositions

Two valid structures, and the linter prefers the second:

**Single file, one master timeline.** Every beat is a `<section class="clip">`
with no timing attributes; GSAP owns visibility (elements start at `opacity: 0`
in CSS). Simplest, and fine for one continuous graphic.

**Root plus sub-compositions.** Each beat is its own file mounted with
`data-composition-src`. The host carries `data-start` / `data-duration`; the
inner file carries `data-composition-id` and registers its own paused timeline
under that id. This is what gives you one editor-timeline row per beat, working
`hyperframes timeline` edits, and per-scene `snapshot --review` frames.

If a timed clip *contains* other elements, lint emits
`nested_structure_needs_subcomposition` (a display warning, not an error) and
suggests exactly that split. Do the split when the project has more than one
beat worth editing independently.

### Media

| Attribute | Applies to | Meaning |
| - | - | - |
| `data-media-start` | `<video>`, `<audio>` | Trim offset into source. **Use this name on video/audio** |
| `data-playback-start` | nested composition host | Trim offset for a child timeline |
| `data-playback-rate` | video/audio/nested | `0.1`–`10` |
| `data-volume` | video/audio | `1` = 0 dB, `0` = silence, up to `3.98` (+12 dB) |
| `data-fade-in` / `data-fade-out` | video/audio | Clip-edge fades in seconds |
| `data-has-audio="true"` | video | Declares the video contributes audio |

Gotcha: video/audio authored with only `data-playback-start` render trimmed
picture over untrimmed audio, because the audio mixer reads `data-media-start`
only. Set `data-media-start` on `<video>` / `<audio>`.

Never call `play()`, `pause()`, or set `currentTime`. The runtime owns playback.

Every timed `<video>` must be either `muted` or `data-has-audio="true"`
(lint: `video_missing_muted`).

### Nested compositions

```html
<div
  id="pricing-scene"
  data-composition-id="pricing"
  data-composition-src="./compositions/pricing.html"
  data-start="4"
  data-duration="6"
  data-track-index="1"
  data-width="1920"
  data-height="1080"
></div>
```

The nested file transports live markup through `<template>` — styles and scripts
must be **inside** the template. Host `data-composition-id` must match the inner
id and its timeline key. Do not add child timelines to the parent timeline;
HyperFrames seeks them independently.

### Variables

```html
<html
  data-composition-variables='[
    {"id":"title","type":"string","label":"Title","default":"Hello"},
    {"id":"theme","type":"enum","label":"Theme","options":[
      {"value":"light","label":"Light"},{"value":"dark","label":"Dark"}],
     "default":"light"}
  ]'
>
```

Bind with `data-var-text`, `data-var-src`, CSS `var(--variableId)`, or
`getVariables()` when the value drives logic. Pass at render with
`--variables '{"title":"Q4"}'` or `--variables-file`.

---

## Animation rules

The timeline must be:

- **finite** — no `repeat: -1`, no infinite loops
- **paused** at construction
- free of wall-clock state (`Date.now()`, `performance.now()`)
- free of unseeded randomness — use a seeded PRNG if you need variation

Async setup (font loading before measuring text) is supported: register the
timeline at the end of the callback, after tweens are added. Never register an
empty timeline first.

```js
document.fonts.ready.then(() => {
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });
  tl.fromTo(...);
  window.__timelines.main = tl;
});
```

Every element with `data-composition-id` participates in timeline readiness. A
static nested section should use an ordinary `id`, or carry `data-no-timeline`.

### Frame adapters

GSAP is the well-trodden path. CSS animations, Web Animations API, Lottie, and
Anime.js also work — the renderer drives/seeks them. Any runtime that reads a
clock instead of exposing a seekable timeline is non-deterministic and will
flicker or drift.

---

## CLI

```bash
npx hyperframes init my-video --non-interactive          # scaffold
npx hyperframes init my-video --resolution portrait      # 1080x1920
npx hyperframes init my-video --video in.mp4             # from footage
npx hyperframes add data-chart                           # install a registry block
npx hyperframes catalog --tag text --json                # browse registry
npx hyperframes lint                                     # static contract check
npx hyperframes check                                    # browser: layout, motion, contrast
npx hyperframes snapshot --at 1.5 --at 3.0 --review      # PNGs for visual review
npx hyperframes keyframes --selector "#card" --shot m.png # onion-skin motion diagnostic
npx hyperframes preview                                  # live preview server
npx hyperframes render --output out.mp4                  # MP4
npx hyperframes render --format webm --output o.webm     # transparent overlay
npx hyperframes render --format mov  --output o.mov      # ProRes 4444 alpha
npx hyperframes render --fps 60 --quality high -o out.mp4
npx hyperframes compare ./a ./b --labels "A,B" --out cmp.png
```

Every command takes `--json` for machine-readable output. The `_meta` field
carries version info so a script can detect a stale CLI.

### `render` flags that matter

| Flag | Default | Note |
| - | - | - |
| `--output, -o` | `renders/<project>_<date>.<ext>` | Output path |
| `--composition, -c` | `index.html` | Entry composition file |
| `--format` | `mp4` | `mp4`, `webm`, `mov`, `gif`, `png-sequence`, `hls` |
| `--fps, -f` | root `data-fps`, else 30 | 1–240, or rational like `30000/1001` |
| `--quality, -q` | `looks` | `draft`, `looks` (CRF 16), `standard`, `high`/`delivery` |
| `--resolution` | composition size | Supersample preset, must be whole multiple of same aspect |
| `--workers, -w` | auto | 1–24, each ~256 MB RAM |
| `--gpu` | off | Hardware ffmpeg encoding |
| `--browser-gpu` | auto | Host GPU for Chrome/WebGL capture |
| `--docker` | off | Deterministic render |
| `--strict` | off | Fail on lint errors |

WebM and MOV carry transparency. PNG-sequence writes RGBA frames.

### Timeout budgets (all separate)

| Budget | Flag | Env | Default |
| - | - | - | - |
| Page navigation | `--browser-timeout` (seconds) | `PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS` | 60 s |
| Player ready | `--player-ready-timeout` (ms) | `PRODUCER_PLAYER_READY_TIMEOUT_MS` | 45000 |
| Single CDP call | `--protocol-timeout` (ms) | `PRODUCER_PUPPETEER_PROTOCOL_TIMEOUT_MS` | 300000 |

`Runtime.callFunctionOn timed out` / `Target closed` → raise
`--protocol-timeout`. Slow assets on load → raise `--browser-timeout`. A
composition that never registers a timeline → raise
`--player-ready-timeout` or add `data-no-timeline`.

---

## Lint findings worth knowing

| Code | Cause | Fix |
| - | - | - |
| `missing_data_no_timeline` | Composition host with no timeline registration and no opt-out | Register a timeline, or add `data-no-timeline` |
| `video_missing_muted` | Timed `<video>` with neither `muted` nor `data-has-audio` | Add one |
| `negative_z_index` | Negative z-index (warning fires even for isolated layers) | Prefer positive z-index with an explicit stacking order |

---

## Registry blocks

`npx hyperframes add <block>` installs an editable source block. Naming a block
in the request makes the build reuse-first instead of hand-rolling.

Common blocks: `data-chart`, `apple-money-count`, `code-typing`,
`code-particle-assemble`, `x-post`, `us-map`, `world-map`, `nyc-paris-flight`,
`shader-wipe`, `swirl-vortex`, `vfx-liquid-background`, `vfx-shatter`,
`captions`, `claude-code-window`.

Search by meaning:

```bash
npx hyperframes catalog --query "count up number" --json
```

---

## Motion graphics brief shape

HyperFrames' own prompting guidance, condensed — this is the shape that renders
well on the first try:

> Make an 8-second 1920x1080 video. Beat 1 (0-4s): dark macOS terminal types
> "npx skills add heygen-com/hyperframes" character by character, then holds on a
> blinking cursor. Beat 2 (4-5s): the terminal shatters into fragments. Beat 3
> (5-8s): bold white kinetic text slams in word by word: "YOU JUST MADE THIS /
> WITH HYPERFRAMES." Adapt the `code-typing` and `vfx-shatter` registry blocks;
> hand-author the kinetic text. No narration, no image or media files.

The six parts: **routed** → **spec'd** (duration, resolution, format) →
**beat-timestamped** → **copy quoted verbatim** → **technique pinned**
(registry block or hand-authored) → **gaps closed** (no narration, no assets).

### Duration ceiling

Motion graphics live under 10 seconds, up to ~30. A 2-second idea stretched to 8
reads slow no matter how it's animated. If the idea needs multiple scenes or
longer runtime, it's a multi-scene video, not a motion graphic.

### Transparency

Only for overlay elements — lower thirds, callouts, bugs meant to composite over
footage. A full-frame design with its own background has nothing to make
transparent; asking for alpha there produces an opaque or broken file. For
overlays the first and last frames must be fully clear.
