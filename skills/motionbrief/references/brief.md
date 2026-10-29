# The brief

The brief is the contract between what the user said and what gets rendered. It
is a JSON file on disk, not a paragraph in the agent's head.

```
request (anything)  →  brief.json  →  build  →  render
                          ↑
                   the only thing the
                   user ever reviews
```

Why it exists: every failure of "make me a video" is a failure of the brief.
Duration unstated, copy paraphrased, easing unpinned, closing line too short to
read. Those become coin-flips in the build. A brief turns them into fields.

The user never writes JSON. Claude compiles the request into a brief, prints the
summary, and builds. The brief is what makes the second attempt cheap.

---

## Schema

```json
{
  "version": 1,
  "slug": "inkwell-launch",
  "lane": "hyperframes",
  "format": {
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "duration": 12,
    "container": "mp4"
  },
  "brand": {
    "name": "Inkwell",
    "tagline": "Write it down. Find it later.",
    "palette": {
      "bg": "#08090c",
      "fg": "#f4f5f7",
      "dim": "#6b7280",
      "accent": "#4ade80"
    },
    "type": { "family": "Inter", "displayWeight": 800, "bodyWeight": 500 }
  },
  "feel": {
    "energy": "medium",
    "ease": "snappy",
    "overshoot": "objects-only",
    "transition": "cinematic-zoom"
  },
  "beats": [
    {
      "id": "wordmark",
      "start": 0,
      "duration": 2.5,
      "kind": "logo",
      "motion": "settle-in",
      "visibleAtStart": true,
      "copy": ["INKWELL"]
    },
    {
      "id": "lines",
      "start": 2.5,
      "duration": 4.5,
      "kind": "kinetic",
      "motion": "word-stagger",
      "copy": ["Write it down.", "Find it later.", "Everything, searchable."]
    },
    {
      "id": "stat",
      "start": 7,
      "duration": 2,
      "kind": "stat",
      "motion": "count",
      "copy": ["notes captured", "12,480"],
      "data": { "value": 12480 }
    },
    {
      "id": "lockup",
      "start": 9,
      "duration": 3,
      "kind": "lockup",
      "motion": "settle-in",
      "hold": 2.1,
      "copy": ["Inkwell", "Write it down. Find it later."]
    }
  ],
  "assets": { "policy": "none", "files": [] },
  "audio": {
    "policy": "generated",
    "bpm": 120,
    "preset": "medium",
    "key": "A",
    "mode": "minor",
    "gain": 0.7
  },
  "assumptions": []
}
```

### Fields that carry weight

| Field | Why it is not optional |
| - | - |
| `format.duration` | The render length. Beat durations must sum to it exactly. |
| `beats[].start` / `duration` | Contiguous, first at 0. The validator enforces it. |
| `beats[].copy` | Verbatim, in order. Never paraphrase copy the user gave you. |
| `beats[0].visibleAtStart` | Frame 0 is the thumbnail on every social player. It must not be empty. |
| `beats[last].hold` | Seconds the closing line is fully visible. Below 2.0 it cannot be read. |
| `feel.ease` | One word maps to a specific curve in both lanes. Unpinned means drift. |
| `assumptions` | Everything you decided on the user's behalf, in their words. Printed in the summary. |

### `kind` — the grammar

A finite vocabulary is what makes generation reliable instead of improvised.
Each kind has a known code pattern in both lanes.

| `kind` | Renders | Motions that fit |
| - | - | - |
| `logo` | wordmark, mark, or logo asset | `settle-in`, `assemble`, `draw-in`, `wipe-in` |
| `kinetic` | one or more type lines | `word-stagger`, `rise`, `slide`, `type-on`, `scale-in` |
| `stat` | number plus label | `count`, `odometer`, `stamp` |
| `chart` | bars, line, comparison | `grow`, `draw`, `sort` |
| `lockup` | closing brand plus tagline | `settle-in`, `rise` |
| `lower-third` | name/title overlay | `slide-in`, `wipe-in` |
| `callout` | annotation over footage | `pop`, `draw-line` |
| `media` | image or video beat | `ken-burns`, `parallax` |

Unknown `kind` is a hard error: it means the build has no pattern to follow.

### `feel` — the dials

| `energy` | Beat length | Transitions | Stagger |
| - | - | - | - |
| `calm` | 4–8 s | light leak, cross-warp, blur | 0.12–0.20 s |
| `medium` | 2–4 s | whip-pan, cinematic zoom, push | 0.08–0.15 s |
| `high` | 0.8–2 s | glitch, ridged burn, scale | 0.04–0.08 s |

| `ease` | GSAP | Remotion bezier |
| - | - | - |
| `smooth` | `power2.out` | `0.215, 0.61, 0.355, 1` |
| `snappy` | `power4.out` | `0.23, 1, 0.32, 1` |
| `dramatic` | `expo.out` | `0.19, 1, 0.22, 1` |
| `bouncy` | `back.out(1.7)` | `0.34, 1.56, 0.64, 1` |
| `dreamy` | `sine.inOut` | `0.445, 0.05, 0.55, 0.95` |

`overshoot`: `none` (always safe), `objects-only` (default — physical things
overshoot, type never does), or `loose`.

---

## Compiling a request into a brief

Claude does this. The user says anything; the brief is the expansion.

### Defaults, not questions

Resolve every gap with a default and record it in `assumptions`. Only ask the
user something when two readings are different *products* — never for a field a
default can carry.

| Signal in the request | Resolve to |
| - | - |
| "reel", "tiktok", "story", "shorts" | 1080×1920, 30 fps |
| "square", "post", "feed" | 1080×1080 |
| nothing about size | 1920×1080 |
| "logo sting" | 4–6 s, `logo` → `lockup`, no narration |
| "title card" | 3–5 s, single `kinetic` beat |
| "count up", "stat" | 5–8 s, `stat` beat with a 1.2–1.5 s count |
| "lower third" | 3–5 s, `lower-third`, transparent WebM |
| "launch video" | 12–18 s, logo → features → lockup |
| "explainer" | 30–90 s, multi-scene, storyboard first |
| "punchy", "snappy", "high energy" | `energy: high`, `ease: snappy` |
| "premium", "luxury", "brand" | `energy: calm`, `ease: dramatic`, longer holds |
| "clean", "corporate" | `overshoot: none`, one accent, generous whitespace |
| no brand colours | one near-black bg, one near-white fg, one accent |
| no tagline | derive one from the user's own words; mark it in `assumptions` |

### Copy

- Quote the user's words **exactly**. Punctuation included.
- Derive copy only when none was given — and say so in `assumptions`.
- Never invent a statistic. If a number is needed and unknown, use a real one
  from the request or make the beat not need a number.
- Fit type to the copy, not the reverse: a 40-character headline is a smaller
  display size than a 14-character one.

### Timing

Beats are contiguous and sum to `format.duration`. Work backwards from the
closing hold: the last beat needs `hold ≥ 2.0`, so it starts no later than
`duration − hold − entry settle (~0.9 s)`.

### Music

`audio` carries the score. The bed is synthesized by `scripts/music.mjs` from
these fields, then muxed onto the finished picture.

| Field | Meaning |
| - | - |
| `policy` | `generated` (synthesize), `provided` (you supply the file), `none` |
| `bpm` | Tempo. A beat is `60 / bpm` seconds |
| `preset` | `calm`, `medium`, `high` — drum density and pad level; defaults from `feel.energy` |
| `key` / `mode` | Root note A–G and `minor` / `major` |
| `gain` | Master gain, 0–1 (default 0.7) |

**The one rule: every `beats[].start` lands on a beat.** At 120 BPM a beat is
0.5 s, so cut points must be multiples of 0.5. `brief.mjs` reports
`off_beat_grid` with the drift in milliseconds when they are not.

Choosing a tempo is therefore choosing a grid. Two approaches:

1. Pick the tempo first, then place cuts on it. 120 BPM (0.5 s), 100 BPM (0.6 s)
   and 90 BPM (0.667 s) are comfortable for short pieces.
2. Keep the cuts and solve for the tempo — a cut at 7.0 s lands on a beat at
   120 BPM (14 beats), 102.86 BPM (12 beats) and 85.71 BPM (10 beats).

The synthesis is deterministic — same brief, byte-identical WAV — which is what
makes a re-render a re-render and not a new take.

---

## The iteration lever table

This is the point of the brief. "Make it punchier" is not a rebuild — it is two
field edits.

| User says | Edit |
| - | - |
| punchier / snappier | `feel.ease: snappy`, `energy: high`, durations −20% |
| slower / calmer | `feel.ease: smooth`, `energy: calm`, durations +25% |
| more premium | `ease: dramatic`, holds +30%, add vignette, one accent only |
| more chaotic | `energy: high`, `overshoot: loose`, glitch transitions |
| cleaner / corporate | `overshoot: none`, `energy: medium`, widen whitespace |
| bigger type | display size +20%, tighten tracking |
| warmer / darker | `brand.palette` accent or bg |
| add music | `audio.policy: "generated"` or `"provided"` |
| different length | stretch `format.duration`, redistribute beats, keep holds |
| make it a series | keep the brief, vary `copy` per row — see batch below |

After any edit: re-run `brief.mjs`, which re-validates timing, then re-render.
The code changes only when `kind` or `motion` changes.

---

## Batch: one brief, N videos

The brief is a template when `copy` comes from rows. Same composition, one
render per row — twenty stat cards, ten name lower-thirds, a week of posts.

`rows.json`:

```json
{
  "rows": [
    { "title": "Q1 launch", "statValue": 12480 },
    { "title": "Q2 launch", "statValue": 18210 }
  ]
}
```

HyperFrames renders this natively:

```bash
npx hyperframes render . --batch rows.json --output renders/
```

Remotion loops it, one `--props` file per row:

```bash
node scripts/motion-render.mjs --dir . --batch rows.json --out-dir renders/
```

Bind the row fields in the composition: HyperFrames
`data-composition-variables` plus `getVariables()`; Remotion props through
`defaultProps` and `calculateMetadata`.

---

## Validating

```bash
node scripts/brief.mjs brief.json              # validate + human summary
node scripts/brief.mjs brief.json --json       # machine result
node scripts/brief.mjs brief.json --commands   # exact render commands
node scripts/brief.mjs brief.json --rows rows.json   # batch commands
```

The validator catches, in ten milliseconds, what a render takes minutes to
reveal:

Errors stop the build (exit 1). Warnings are judgement calls (exit 0) — one you
accept goes in `assumptions`.

| Code | Level | Meaning |
| - | - | - |
| `timing_gap` / `timing_overlap` | error | Beats do not tile the timeline |
| `duration_mismatch` | error | Beat durations do not sum to `format.duration` |
| `first_beat_late` | error | Beat 0 does not start at 0 |
| `unknown_kind` / `unknown_motion` | error | No code pattern exists for it |
| `missing_copy` / `empty_copy` | error | No copy array, an empty entry, or a text beat with nothing to say |
| `missing_beat_id` / `missing_beat_start` / `missing_beat_duration` | error | A beat without an id, a numeric start, or a positive duration |
| `off_beat_grid` | error | A beat starts more than 20 ms off the music's beat grid — the cut drifts against the bed |
| `bad_audio_policy` | error | `audio.policy` is not `generated`, `provided` or `none` |
| `bad_lane` / `missing_slug` / `missing_format` / `bad_container` | error | Top-level fields missing or outside their allowed values |
| `bad_ease` / `bad_energy` / `bad_overshoot` | error | A `feel` dial outside its allowed values |
| `no_beats` | error | `beats` is missing or empty |
| `missing_rows` | error | `--rows` points at a file that does not exist |
| `empty_first_frame` | warn | `beats[0].visibleAtStart` is not set |
| `closing_hold_short` | warn | The last beat holds under 2.0 s |
| `duration_out_of_range` | warn | Under 3 s or over 90 s |
| `audio_no_bpm` | warn | Audio is on but `audio.bpm` is unset — the bed falls back to 96 BPM and the grid is not checked |
