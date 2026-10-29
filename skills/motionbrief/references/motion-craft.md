# Motion craft

The rules that separate a motion graphic from a slideshow. Framework-agnostic:
every rule below has a GSAP form (HyperFrames) and a Remotion form.

---

## The seven rules

### 1. Move only what is live

Once something lands, it holds still. What keeps moving is what is actually
changing: a live number, a feed, a progress bar, a cursor.

```js
// HyperFrames: land the panel, then only the reading animates
tl.fromTo("#panel", { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, 0);
// ticker restamps every 0.3 s after 1.9 s — that one element keeps moving
```

```tsx
// Remotion: derive the ticker from frame, everything else from a settled boolean
const reading = Math.floor(Math.max(0, frame - 57) / 9);
```

Do **not** add "subtle breathing" breathing-scale idles to make a still scene feel
alive. It reads as machine-generated. If a scene is dead, give it real work to
do.

### 2. Move the camera to get somewhere

A camera move earns its place by travelling between things, so the viewer learns
they share one space. A slow push-in for its own sake does not.

```js
// HyperFrames: five stages laid out wider than the frame
tl.to("#world", { x: -640 * 4, duration: 4, ease: "none" }, 1.0);
```

```tsx
// Remotion: same thing as a transform on a wide container
const x = interpolate(frame, [30, 150], [0, -2560], { extrapolateRight: "clamp" });
```

### 3. Overlap, don't queue

The next element starts while the last is still settling. Stagger anything that
happens in sequence; things that already existed appear together.

```js
// 0.08 s stagger — each ignite still running when the next three begin
items.forEach((id, i) => tl.to(id, { opacity: 1, duration: 0.5, ease: "power2.out" }, 0.5 + i * 0.08));
```

```tsx
const p = spring({ frame: frame - i * 3, fps, config: { damping: 200 } });
```

Rule of thumb: stagger ≈ 15–30% of the element's own duration. A 0.5 s entrance
staggers at 0.08–0.15 s. Equal to the duration means queued, not overlapped.

### 4. One idea per move

Combine properties only when they say the same thing. Rising **and** fading in
says "arriving". Adding rotation and scale makes text unreadable mid-flight.

Good pairs: `y + opacity` (arriving), `scale + opacity` (focusing), `x + blur`
(whip-panning past).

Bad: `rotation + scale + y + blur` on a headline. The viewer reads a smear, not
a word.

### 5. Weight for physical objects only

Overshoot says "this has mass". Use it on flaps, cards, characters, UI panels
that slam. Never on text, UI labels, or numbers — a counter that flies past 42
and falls back displays a number that was never true.

```js
gsap.to("#flap", { y: 0, ease: "back.out(1.7)", duration: 0.45 });   // physical
gsap.to("#counter", { innerText: 42, ease: "power3.out", duration: 0.9 }); // no overshoot
```

### 6. Depth: near things move faster

Far layers move slower than the camera, near ones faster. One blurred foreground
object passing in front of the content is the strongest depth cue available. A
second one is clutter.

```js
tl.to("#bg",  { x: -60,  duration: 4, ease: "none" }, 0);  // 0.2×
tl.to("#mid", { x: -300, duration: 4, ease: "none" }, 0);  // 1×
tl.to("#fg",  { x: -360, duration: 4, ease: "none" }, 0);  // 6×, filter: blur(18px)
```

### 7. Pace to the format

| Format | Per idea | Total |
| - | - | - |
| Showreel / promo | 1.0–1.5 s | 3–8 s |
| Product demo | one framing held 7–10 s while the UI works | 15–30 s |
| Explainer scene | 3–5 s | 30–90 s |
| Lower third / bug | enter 0.3, hold 2–4, exit 0.3 | 3–5 s |

A 2-second idea stretched to 8 feels slow no matter how well it moves. Stretch
the runtime only by adding beats, never by slowing the beats you have.

---

## Easing vocabulary

Say the word, get the ease. Same mapping in both lanes.

| Say | GSAP (HyperFrames) | Remotion `Easing.bezier(...)` | Feels like |
| - | - | - | - |
| smooth | `power2.out` | `0.215, 0.61, 0.355, 1` | Natural deceleration |
| snappy | `power4.out` | `0.23, 1, 0.32, 1` | Quick, decisive |
| dramatic | `expo.out` | `0.19, 1, 0.22, 1` | Fast start, long glide |
| bouncy | `back.out(1.7)` | `0.34, 1.56, 0.64, 1` | Overshoots, settles |
| springy | `elastic.out(1, 0.4)` | `spring({ damping: 8 })` | Oscillates into place |
| dreamy | `sine.inOut` | `0.445, 0.05, 0.55, 0.95` | Slow, symmetrical |
| linear | `none` | `Easing.linear` | Camera travel, counters |
| hard stop | `power4.in` | `0.7, 0, 0.84, 0` | Snaps out of frame |

`elastic` cannot be expressed as a cubic-bezier — it oscillates. In Remotion use
a low-damping spring, or overshoot the interpolate range deliberately.

### Duration shorthand

| Say | Seconds | Use |
| - | - | - |
| fast | 0.2 | micro-feedback, hover, tick |
| medium | 0.4 | professional default, most entrances |
| slow | 0.6 | luxury, brand, deliberate reveals |
| very slow | 1.0–2.0 | cinematic push, big weight |

Entrance and exit durations should usually match. An element that enters in
0.6 s and exits in 0.2 s reads as yanked.

---

## Transitions between scenes

A good transition is **caused by something on screen**: the camera zooms through
a button into the next screen, a card grows until it becomes the next scene, the
background floods a colour while the subject holds.

Use 3–5 kinds in a piece, each where it fits. Never a dissolve between two
unrelated scenes.

| Energy | Effect | Duration |
| - | - | - |
| Calm | cross-warp morph, light leak, blur | 0.5–0.8 s |
| Medium | whip-pan, cinematic zoom, push, cover | 0.3–0.5 s |
| High | ridged burn, glitch, chromatic split, scale, light | 0.15–0.3 s |

**Do not fade one scene out and then the next one in.** That renders as a jump
cut with a dip in the middle. The transition *is* the exit — overlap them.

```tsx
// Remotion: overlap is built into TransitionSeries
<TransitionSeries.Transition
  presentation={slide({ direction: "from-right" })}
  timing={linearTiming({ durationInFrames: 12 })}
/>
```

```js
// HyperFrames: overlap two full-frame clips in the same time window
tl.to("#scene-a", { xPercent: -100, duration: 0.4, ease: "power3.inOut" }, 2.6);
tl.fromTo("#scene-b", { xPercent: 100 }, { xPercent: 0, duration: 0.4, ease: "power3.inOut" }, 2.6);
```

---

## Handmade / stop-motion look

Ask for movement that steps between **held positions**, with irregularity from a
seeded PRNG. Every render must produce the same frame at the same time, so
unseeded randomness is banned in both lanes.

```js
// HyperFrames: quantize to two-frame holds, seed per element
const held = Math.floor(t * fps / 2) * 2 / fps;
```

```tsx
// Remotion: same, with deterministic random
import { random } from "remotion";
const jitter = random(`elem-${i}`) * 6;
const heldFrame = Math.floor(frame / 2) * 2;
```

Say "two frames", never "0.067 seconds" — a hold measured in seconds drifts into
uneven one- and three-frame steps.

---

## Checking the motion

Look at it in motion before calling it done. Stills lie about timing.

| Lane | Command |
| - | - |
| HyperFrames | `npx hyperframes snapshot --review` (beat/seam frames), `npx hyperframes keyframes --selector "#card" --shot m.png` (onion skin) |
| Remotion | `npx remotion still ... --frame=N` for key moments; watch in `npx remotion studio` |
| Both | render the full file and watch it at 1× |

Review checklist:

- The words, numbers, source, and logo are exact — no lorem, no placeholder.
- The full message is readable at play speed, not just on a paused frame.
- The main movement supports the meaning instead of decorating it.
- First and last frames are deliberate (an overlay must be fully clear).
- Every cut is motivated by something on screen.
- Nothing keeps moving after it has settled.
