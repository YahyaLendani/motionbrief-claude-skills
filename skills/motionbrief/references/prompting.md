# Brief to beats

How a one-line request becomes a beat sheet the render can execute. This is the
step that decides whether the output looks designed or looks generated.

---

## The six parts of a renderable brief

1. **Routed** — which lane (HyperFrames HTML or Remotion React), and why.
2. **Spec'd** — duration in seconds, resolution, fps, output format (MP4 vs
   transparent WebM/MOV).
3. **Beat-timestamped** — every change on screen gets a time window.
4. **Copy quoted verbatim** — exact words, numbers, handles. Never paraphrase
   copy the user gave you.
5. **Technique pinned** — registry block, hand-authored, or specific effect
   named. Unpinned technique drifts.
6. **Gaps closed** — "no narration", "no image files", "no music" — whatever
   you're *not* doing, so the build doesn't invent it.

---

## The same brief, badly and well

**Bad** (vague, unrenderable):

> Make a cool launch video for my app.

**Good** (six parts, all pinned):

> Make a 12-second 1920x1080 MP4. Brand: Inkwell, tagline "Write it down. Find it
> later." Beat 1 (0–2.5s): logo assembles from 200 particles on near-black
> `#0a0a0a`, settles by 2.5s. Beat 2 (2.5–8s): three feature lines, one per
> 1.8s, kinetic type, white on black: "Write it down." / "Find it later." /
> "Everything, searchable." Beat 3 (8–12s): tagline and wordmark lock up
> centered, holds. No narration. No music. Snappy, no bounce on the type.

The bad one leaves duration, resolution, copy, timing, easing and asset policy
all unpinned. Every one of those becomes a coin-flip in the render.

---

## Beat sheet format

Write this out before writing any code. It's cheap and it prevents the rewrite.

```
Duration: 12s @ 30fps, 1920x1080, MP4
[0.0 – 2.5]  Logo assemble — 200 particles, #0a0a0a bg, settle 2.5
[2.5 – 4.3]  "Write it down." — kinetic type, word stagger 0.08s
[4.3 – 6.1]  "Find it later." — same treatment
[6.1 – 8.0]  "Everything, searchable." — same treatment
[8.0 – 12.0] Tagline + wordmark lockup, holds still
```

Then convert each row to clips (HyperFrames) or sequences (Remotion). The
timestamp arithmetic is the only real work; the animation is downstream of it.

---

## Copy rules

- **Verbatim** — quote the user's words exactly. If they wrote "Write it down.
  Find it later." with a period, the period stays.
- **Numbers exact** — `$4.2M` is not `$4.2 million` is not `4.2M`.
- **Handles and URLs exact** — `@hyperframes`, not `hyperframes`.
- **Character counts matter** — a 14-character headline and a 40-character
  headline are different layouts. Size type to the copy, never guess.

---

## Choosing a lane

Both lanes render deterministic video from a browser. Pick by what you have:

| Situation | Lane | Why |
| - | - | - |
| Existing HTML/CSS/GSAP/Lottie to reuse | HyperFrames | Drops in near as-is |
| Team already writes React + TS | Remotion | Component reuse, typed props |
| No `node_modules` wanted, no build step | HyperFrames | Zero install, `npx` only |
| Company larger than 3 people | HyperFrames | Apache 2.0; Remotion needs a paid licence |
| Complex interactive UI, design system, charts lib | Remotion | Real React ecosystem |
| Transparent overlay composited over footage | Either | HyperFrames WebM/MOV; Remotion ProRes/PNG-seq |
| Agent-authored, human tweaks in browser devtools | HyperFrames | One openable HTML file |
| Existing Remotion project to port | Keep Remotion | Porting costs more than it saves |

Default for a fresh motion graphic built by an agent: **HyperFrames** — one file,
no install, no license ceiling, editable in a browser.

Default when the user names Remotion or has a React project: **Remotion**.

If the user says "Remotion *and* HyperFrames", build the piece in HyperFrames and
provide the Remotion port when the project is React — or pick one and say which
in one line. Two full builds of the same thing is wasted work unless a comparison
was asked for.

---

## Duration discipline

| Request says | Build |
| - | - |
| "logo sting" | 4–6 s |
| "title card" | 3–5 s |
| "stat / count-up" | 5–8 s |
| "kinetic type piece" | 6–10 s |
| "lower third" | 3–5 s |
| "feature montage" | 10–20 s |
| "launch video" | 12–20 s |
| "explainer" | 30–90 s, multi-scene |

Over ~30 s a single motion beat runs out of things to do. Promote it to a
multi-scene video with a storyboard, not a stretched graphic.

---

## Asset policy

Decide and write it down:

- **No assets** — pure CSS/SVG/type. Fastest, fully deterministic, no licensing
  question.
- **Registry blocks** — `npx hyperframes add <block>`; editable source, real
  motion already tuned.
- **Local media** — `public/` for Remotion via `staticFile()`, relative paths for
  HyperFrames. Always wrap video in `<OffthreadVideo>` (Remotion) and let
  HyperFrames own playback.
- **Generated** — images or audio from an API. Note the key requirement as the
  one held value; ship everything else.

Never invent a stock URL, a placeholder image service, or a "coming soon" asset
reference. If an asset isn't available, design the piece to not need it.

---

## Colour and type defaults that don't look cheap

- Background: one near-black (`#0a0a0a`, `#0d1117`) or one near-white (`#fafafa`).
  Not pure `#000` or `#fff` unless the brief demands it.
- One accent, used once per beat. Two accents is a palette decision, not a
  default.
- Type: one family, two weights. Heavy weight for display, regular for labels.
  `Inter`, `Geist`, `Söhne`, or a system stack. Letter-spacing `-0.02em` to
  `-0.04em` on display sizes — untracked large type looks amateur.
- Optical size: 140–200 px for hero type at 1080p. Anything under 60 px is body
  copy, not a title.
- Contrast: WCAG AA minimum (4.5:1) for anything that must read. `npx hyperframes
  check` reports contrast failures.

---

## Anti-patterns

| Anti-pattern | Why it reads cheap | Do instead |
| - | - | - |
| Everything fades in from opacity 0 | No spatial information | Slide + fade, or scale + fade |
| Every element enters at once | No sequence, no emphasis | Stagger 0.08–0.15 s |
| Bouncy ease on text | Text oscillates, unreadable mid-flight | `power3.out`, no overshoot |
| Slow push-in with nothing happening | Dead scene | Real action, or cut it |
| Dissolve between unrelated scenes | Jump cut with a dip | Motivated transition |
| Breathing idle on a settled panel | Reads generated | Hold still |
| 8 s for a 2 s idea | Feels slow | Cut the duration |
| Lorem ipsum / placeholder copy | Unshippable | Ask for the copy or write real copy |
| Three fonts | Visual noise | One family, two weights |
| Centered everything | No hierarchy | Asymmetric layouts, anchored edges |

---

## If the request is one word

"logo sting", "count up", "lower third" — the shape is known. Assume:

- 1920×1080, 30 fps, MP4, unless the word implies vertical (`tiktok`, `reel`,
  `story` → 1080×1920).
- The duration from the table above.
- Near-black background, white type, one accent.
- No narration, no external assets.

Then build. Two lines of assumption in the bench notes, not a question.
