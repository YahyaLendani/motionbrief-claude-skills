# Remotion reference

React components. A composition is a pure function of the frame number: you
read `useCurrentFrame()`, do the timing math, return JSX. Remotion opens headless
Chrome, renders each frame, pipes them to FFmpeg.

Docs: <https://remotion.dev/docs>. CLI is `npx remotion`.

**License:** free for individuals and companies up to three people; paid above
that. Check <https://remotion.pro/license>. HyperFrames is Apache 2.0 — that
difference is a real selection criterion when the team is bigger than three.

---

## Project shape

```
my-video/
  package.json
  remotion.config.ts
  tsconfig.json
  public/                 # staticFile() reads from here
  src/
    index.ts              # registerRoot(RemotionRoot)
    Root.tsx              # <Composition> registrations
    TitleCard.tsx
```

`src/index.ts`:

```ts
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
```

`src/Root.tsx`:

```tsx
import { Composition } from "remotion";
import { TitleCard } from "./TitleCard";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TitleCard"
        component={TitleCard}
        durationInFrames={90}
        fps={30}
        width={1280}
        height={720}
        defaultProps={{ text: "HELLO" }}
      />
    </>
  );
};
```

Every package version must match exactly. Mismatched `remotion` and
`@remotion/*` versions are the top install failure.

```bash
npx create-video@latest my-video
npx remotion studio            # live preview
npx remotion compositions      # list composition ids
npx remotion upgrade           # bump all packages in lockstep
```

---

## Core hooks

| Hook | Returns |
| - | - |
| `useCurrentFrame()` | Frame number **relative to the enclosing `<Sequence>`** |
| `useVideoConfig()` | `{ fps, durationInFrames, width, height, id, defaultProps, props }` |
| `getInputProps()` | Props passed at render time via `--props` |

`useCurrentFrame()` being sequence-relative is the single most misused thing in
Remotion. Inside a `<Sequence from={60}>`, frame 0 is absolute frame 60. Do not
subtract the offset again.

---

## `interpolate` — the workhorse

```tsx
import { interpolate } from "remotion";

const opacity = interpolate(
  frame,
  [0, 15, 75, 90],     // input stops
  [0, 1, 1, 0],        // output stops
  {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.4, 0, 0.2, 1),
  },
);
```

- The arrays must be **equal length**; input must be monotonically increasing.
- Without `extrapolateLeft/Right: "clamp"` values continue past the ends —
  opacity `1.4`, `y` flying offscreen.
- Clamp **both** ends by default. This is the fix for 90% of Remotion "why is it
  still moving" bugs.
- Multi-stop input gives you an ease table without chaining springs.

### Easing

```tsx
import { Easing } from "remotion";

Easing.bezier(0.16, 1, 0.3, 1)   // expo-out, the premium default
Easing.bezier(0.4, 0, 0.2, 1)    // material standard
Easing.in(Easing.quad)
Easing.out(Easing.cubic)
Easing.inOut(Easing.sin)
Easing.elastic(1.2)
Easing.bounce
```

---

## `spring` — physics, not clocks

```tsx
import { spring } from "remotion";

const s = spring({
  frame,
  fps,
  config: { damping: 200, mass: 1, stiffness: 100 },
  durationInFrames: 30,
  delay: 10,
});
```

`spring` returns roughly `0 → 1` but can **overshoot past 1**. If you map it
onto opacity or scale, clamp the output:

```tsx
const scale = interpolate(
  spring({ frame, fps, config: { damping: 12 } }),
  [0, 1],
  [0.8, 1],
  { extrapolateRight: "clamp" },
);
```

Or set `config: { damping: 200 }` for a critical spring that never overshoots
when you want no bounce. `overshootClamping: true` does the same.

`durationInFrames` stretches the spring to finish exactly at that frame — useful
to lock a beat.

---

## Sequencing

### `<Sequence>`

```tsx
<Sequence from={30} durationInFrames={45} layout="absolute-fill">
  <Feature />
</Sequence>
```

Children mount at absolute frame 30, unmount at 75, and their local frame resets
to 0. Default layout is `absolute-fill` — positioned absolutely, filling the
parent. Use `layout="none"` when you want the children to be normal layout flow.

### `<Series>`

```tsx
<Series>
  <Series.Sequence durationInFrames={60}>
    <Title />
  </Series.Sequence>
  <Series.Sequence durationInFrames={90} offset={-15}>
    <ThreeFeatures />
  </Series.Sequence>
</Series>
```

Durations are sequential — no arithmetic. `offset` (negative) overlaps the
neighbouring sequence.

### `<TransitionSeries>`

```tsx
import { TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { linearTiming, springTiming } from "@remotion/transitions";

<TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={90}>
    <SceneA />
  </TransitionSeries.Sequence>
  <TransitionSeries.Transition
    presentation={fade()}
    timing={linearTiming({ durationInFrames: 15 })}
  />
  <TransitionSeries.Sequence durationInFrames={90}>
    <SceneB />
  </TransitionSeries.Sequence>
</TransitionSeries>;
```

Each transition's duration **overlaps** its neighbours and shortens the total
timeline, so the composition `durationInFrames` must subtract the overlaps.

Presentations: `fade`, `slide` (with `direction`), `wipe` (with `direction`),
`flip`, `clockWipe`, `iris`, `cube`. Timings: `linearTiming`, `springTiming`.

Install once: `npx remotion add @remotion/transitions`.

---

## Determinism

```tsx
import { random } from "remotion";

random("particle-3"); // deterministic 0–1, same every render
Math.random();        // NON-DETERMINISTIC — never in a composition
```

Never read `Date.now()`, `performance.now()`, or `Math.random()` in a
composition. Those break frame-exact renders and cause visible flicker.

For loading assets that need to resolve before capture, use the gate:

```tsx
const [handle] = useState(() => delayRender("Loading data"));
useEffect(() => {
  fetchData().then((d) => {
    setData(d);
    continueRender(handle);
  });
}, [handle]);
```

`delayRender` blocks capture until `continueRender`. Use it for fonts, video
metadata, remote data. Forgetting to call `continueRender` hangs the render until
timeout.

---

## Composition types

| Type | API | Use |
| - | - | - |
| Standard | `<Composition durationInFrames fps width height>` | Fixed length |
| Calculated | `<Composition calculateMetadata={...}>` | Duration/size from props or fetched data |
| Still | `<Still id component width height>` | Single image, rendered with `npx remotion still` |
| Folder | `<Folder name>` | Group compositions in the Studio sidebar |

`calculateMetadata`:

```tsx
<Composition
  id="Dynamic"
  component={Video}
  fps={30}
  width={1920}
  height={1080}
  durationInFrames={300}
  defaultProps={{ src: "" }}
  calculateMetadata={async ({ props }) => {
    const meta = await getVideoMetadata(props.src);
    return {
      durationInFrames: Math.ceil(meta.durationInSeconds * 30),
      fps: 30,
      width: meta.width,
      height: meta.height,
    };
  }}
/>
```

---

## Media and assets

```tsx
import { Audio, Img, staticFile } from "remotion";

<Img src={staticFile("logo.png")} style={{ width: 240 }} />;
<Audio src={staticFile("music.mp3")} volume={0.6} />;
```

`staticFile()` resolves against `public/`. Remote URLs work but need
`<Img>`/`<OffthreadVideo>` (not raw `<img>`/`<video>`) for frame-accurate
capture and delayRender integration.

`<OffthreadVideo>` extracts frames via FFmpeg and is the correct choice for
frame-accurate video. Plain `<video>` can drift or show the wrong frame.

Useful extras:

| Package | Purpose |
| - | - |
| `@remotion/google-fonts` | Typed font loaders, e.g. `loadFont("Inter")` |
| `@remotion/layout-utils` | `measureText`, `fitText` — text fitting to a box |
| `@remotion/shapes` | SVG rect/circle/star/polygon with animation props |
| `@remotion/paths` | SVG path math: `getLength`, `evolvePath`, `getPointAtLength` |
| `@remotion/motion-blur` | `CameraMotionBlur`, `Trail` |
| `@remotion/three` | React Three Fiber inside a composition |
| `@remotion/lottie` | Lottie playback, frame-seeked |
| `@remotion/gif` | Frame-accurate GIF |
| `@remotion/skia` | Skia canvas |
| `@remotion/gsap` | Drive a GSAP timeline from the frame number |
| `@remotion/captions` | Caption primitives and transcription helpers |
| `@remotion/transitions` | `TransitionSeries` and presentations |
| `@remotion/media` | Newer media components |

---

## CLI

```bash
npx remotion studio src/index.ts                     # preview
npx remotion compositions src/index.ts               # list ids
npx remotion render src/index.ts TitleCard out/title.mp4
npx remotion render src/index.ts TitleCard out/t.mp4 --props=./props.json
npx remotion still src/index.ts TitleCard out/frame.png --frame=30
npx remotion bundle src/index.ts                     # static bundle
npx remotion lambda ...                              # distributed render
```

`<entry-point>` and `<composition-id>` may be omitted — Remotion prompts
interactively if so. **Never rely on a prompt in an agent run**; always pass both.

### `render` flags that matter

| Flag | Default | Note |
| - | - | - |
| `--props` | — | Serialized JSON **or a file path** |
| `--width` / `--height` / `--fps` / `--duration` | from composition | Overrides, frame counts for duration |
| `--concurrency` | cpu count | Min 1; also accepts a percentage |
| `--crf` | — | Constant quality; cannot combine with `--video-bitrate` |
| `--video-bitrate` | — | Target bitrate, e.g. `10M` |
| `--codec` | `h264` | `h264`, `h265`, `av1`, `vp8`, `vp9`, `prores`, `gif`, `wav`, `mp3`, `aac` |
| `--pixel-format` | — | `yuv420p`, `yuva420p` (alpha), `yuv444p`, 10-bit variants |
| `--image-format` | `jpeg` | `png`, `jpeg`, `none` |
| `--jpeg-quality` | — | 0–100 |
| `--scale` | `1` | Supersample, e.g. `2` for 2× detail then downscale |
| `--frames` | — | `30` (still), `0-59`, `100-`, `0,30,60` |
| `--sequence` | off | Emit image sequence instead of video |
| `--muted` | off | Drop audio |
| `--overwrite` | true | `--overwrite=false` to refuse |
| `--browser-executable` | bundled Chrome | Custom Chrome path |
| `--chrome-mode` | `headless-shell` | `chrome-for-testing` for Linux GPU |
| `--x264-preset` | `medium` | `ultrafast`…`placebo` |
| `--gop` | encoder | Keyframe interval in frames |

### Windows quoting gotcha

Inline JSON `--props='{"a":1}'` **does not work in PowerShell or cmd** — the
shell strips the double quotes. Write a file and pass the path:

```powershell
Set-Content props.json '{"text":"HELLO"}'
npx remotion render src/index.ts TitleCard out.mp4 --props=./props.json
```

This bites every Windows build exactly once.

### Transparency

For alpha output use `--codec=prores` (ProRes 4444 with `--pixel-format=yuva444p10le`)
or a PNG sequence. H.264 cannot carry alpha. The composition root must have a
transparent background — no opaque `AbsoluteFill` behind it.

---

## Motion-graphic component patterns

### Kinetic type — word by word

```tsx
const words = "YOU JUST MADE THIS".split(" ");
const perWord = 6;

return (
  <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
    <div style={{ display: "flex", gap: 24 }}>
      {words.map((w, i) => {
        const start = i * perWord;
        const p = spring({
          frame: frame - start,
          fps,
          config: { damping: 14, stiffness: 180 },
        });
        return (
          <span
            key={w}
            style={{
              fontSize: 140,
              fontWeight: 900,
              color: "#fff",
              opacity: interpolate(p, [0, 1], [0, 1], { extrapolateRight: "clamp" }),
              transform: `translateY(${interpolate(p, [0, 1], [60, 0], {
                extrapolateRight: "clamp",
              })}px) scale(${interpolate(p, [0, 1], [1.15, 1], {
                extrapolateRight: "clamp",
              })})`,
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  </AbsoluteFill>
);
```

### Count-up number

```tsx
const p = interpolate(frame, [0, 60], [0, 1], {
  extrapolateRight: "clamp",
  easing: Easing.out(Easing.cubic),
});
const value = Math.round(p * 10000);
```

Format with `Intl.NumberFormat` for currency/locale. Never derive the number
from a state update — derive it from `frame`, every frame, purely.

### Logo sting

```tsx
const inP = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 24 });
const outP = interpolate(frame, [dur - 12, dur], [1, 0], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
});
const opacity = inP * outP;
```

Entry, deliberate completion, hold, clean exit — an overlay must be fully clear
on its first and last frame.

### Lower third

Same shape, anchored bottom-left, x translate on entry, y on exit, hold long
enough to read (roughly 12 characters per second of hold).

---

## Pitfalls

| Symptom | Cause | Fix |
| - | - | - |
| Motion keeps going past the range | No `extrapolateRight: "clamp"` | Clamp both ends |
| Values snap instead of easing | `frame` used raw | Wrap in `interpolate` |
| Anything attached to `useCurrentFrame` is one frame late | Reading a state set from an effect | Derive from `frame` directly |
| Render hangs until timeout | `delayRender` never `continueRender`d | Balance the handle |
| Flicker between renders | `Math.random()` / `Date.now()` | `random(seed)`, constant times |
| `Could not find composition` | Wrong entry point or id | `npx remotion compositions src/index.ts` |
| Version mismatch error | `@remotion/*` out of lockstep | `npx remotion upgrade` |
| Wrong colours | `--image-format jpeg` | Use `png` with `--color-space bt709` |
| Sequence frame math off | Re-subtracting `from` inside a Sequence | `useCurrentFrame` is already local |
| Text jumps when fonts load | Font not awaited | `@remotion/google-fonts` loader + `delayRender` |
