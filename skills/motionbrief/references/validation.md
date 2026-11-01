# What "passed validation" means

A render that passes says something narrow: **each requirement below was measured
and matched, or a person accepted by name that it could not be.** It does not say
the video looks good. Palette, easing, transitions, layout and taste are not
guaranteed by matching timings and strings. They need the frame review in
`SKILL.md`.

---

## The statuses

Every mandatory requirement ends in one state:

| State | Meaning |
| - | - |
| `verified` | Measured, and it matched |
| `failed` | Measured, and it did not match |
| `unverified` | Could not be measured. Never counts as a pass |

The run as a whole gets one status:

| Status | Meaning | `check-contract` exits |
| - | - | - |
| `verified` | Every mandatory requirement was measured and matched | 0 |
| `unverified-accepted` | No failures. The remainder was accepted with `--allow-unverified` | 0 |
| `unverified` | No failures, but some requirements could not be measured | 3 |
| `failed` | A requirement failed, or the composition contract is broken | 1 |
| `contract-only` | `--no-brief`: the engine contract only, no brief comparison | 0 |

Exit 2 is bad usage. `--preflight` keeps exit 0 for `unverified` so a check can run
before an install, but the status still says `unverified`.

`motion-render.mjs` exits 0 for a finished render, 1 for a failed step, 2 for bad
usage, and 3 when mandatory requirements stay unverified. It runs the full check
in front of any render time, and writes a report on success and on failure.

Advisories (`level: "warn"`) are style and craft notes. They never change a status
or an exit code.

---

## What is checked, and how

| Brief field | How it is checked | Requirement |
| - | - | - |
| `format.width`, `height`, `fps`, `duration` | Static when the value is literal, else runtime. Measured again on the finished file | `format.*`, `output.width`, `output.height`, `output.fps`, `output.duration` |
| `format.container` | Measured on the finished file | `output.container` |
| `beats[].id` | Static: a scene must declare it | `beat.<id>.scene` |
| `beats[].start`, `duration` | Static when resolvable, else runtime, within a frame | `beat.<id>.timing` |
| `beats[].copy` | Static in the scene's own source, then in the rendered DOM | `beat.<id>.copy[n]` |
| `beats[].copy` is readable | Runtime only | `beat.<id>.copy[n].visible` |
| `beats[].hold` | Runtime: the line must stay readable and settled this long. With no `hold`, 0.4 s | `beat.<id>.copy[n].visible` |
| `beats[].visibleAtStart` | Runtime: copy is painted on the beat's first frame. Frame 0 must not be empty, and a deliberate blur or a partial fade still counts as painted. With only a graphic on that frame it stays unverified: look at the frame, then accept it by name | `beat.<id>.first-frame` |
| `audio.policy` | Stream present or absent as promised, and a generated bed is not silent | `output.audio`, `output.audio-level` |
| `audio.bpm` and beat positions | `brief.mjs`: `off_beat_grid` | n/a |
| Timing tiles, kinds, motions, schema | `brief.mjs` | n/a |
| Output file exists | Measured | `output.exists` |
| `brand.palette`, `brand.type`, `feel.*`, `motion`, `kind`, `notes` | **Not checked.** Frame review | none |
| Layout, overflow, contrast | Advisories from `--runtime` and the engine's own `check`. Frame review | none |
| Fonts | Advisory: `font_fallback` names a line drawn in anything but the brief's family | none |

Runtime means a pinned engine's page in a headless browser. Nothing else is
executed to understand source: the static checker parses, and evaluates only
arithmetic over literals and named constants. `Number("120")` is not evaluated. It
is unverified until the runtime route measures it.

---

## Scene identity

A beat maps to a scene by an explicit id. Position is never identity, so swapping
two scenes fails.

| Engine | A scene declares a beat with |
| - | - |
| HyperFrames | `data-brief-beat="<id>"` on the host, else a host whose `data-composition-id` or `id` is `<id>` or `scene-<id>` |
| Remotion | `<Sequence name="<id>">`, compared without case |

A Remotion `<Sequence>` whose `from` or `durationInFrames` cannot be read statically
needs one more thing to be measurable: `data-brief-beat="<id>"` on an element inside
it. Remotion unmounts a Sequence outside its window, so the runtime check times that
marker's mount. With no marker the timing stays `unverified`, which blocks.

---

## What counts as the copy being there

**Static, in scene `s`:**

| The line is found in | Result |
| - | - |
| The markup of `s` | HyperFrames `verified`. It is rendered output of that scene, until the runtime check says otherwise |
| A script literal or constant used by `s`, or a page-level script | `unverified` (`brief_copy_dynamic`). Whether it is shown is a runtime question |
| Remotion source of `s` | `unverified` (`brief_copy_unverified`). Static checks never prove JSX renders |
| Only another scene | `failed` (`brief_copy_wrong_scene`) |
| A comment, an unused declaration, or nowhere | `failed` (`brief_copy_missing`) |

Any static failure skips the runtime check: it has already failed.

**Runtime, at the beat's settled frames:**

The line must appear in the scene's rendered text. Then it must be readable.
`copy_not_visible` names the reason: `hidden`, `transparent`, `off-screen`, `clipped`,
`blurred` or `covered`. `copy_hold_short` means it was readable, but for less than
the required hold. Count-ups and reveals are judged at the frames they settle on, so
a number is compared with its final value.

**Normalization.** Matching is not byte-for-byte. It ignores case and whitespace,
folds curly quotes and `…`, and decodes HTML entities. Other punctuation is
significant. A line may be part of a longer string.

**Numbers.** A number-only line is compared as whole numbers, ignoring digit
grouping: `12,480` matches `12480` and `12 480`, but not `412,480` or `12,481`.
Decimal points, currency signs and units are significant. Digits split across inline
spans of one block join into one number.

---

## Overrides

```bash
node scripts/check-contract.mjs --dir ./my-video --runtime --allow-unverified "beat.lines.copy[0].visible"
node scripts/motion-render.mjs --brief ./my-video/brief.json --allow-unverified "beat.*.copy[*].visible,output.audio-level"
```

- Takes an id or a `*` pattern, repeated or comma-separated.
- Accepts `unverified` requirements only. A failure is never accepted, and other
  failures keep blocking.
- A pattern with no letters (`*`, `**`, `*.*`) is refused, exit 2.
- Everything accepted is printed and recorded: the status becomes
  `unverified-accepted`, and the render report's `overrides` and `notVerified` list it.
- A pattern matching nothing is an advisory, `override_unused`, because it usually
  means a typo.

`--no-checks` skips validation entirely. The report records that as
`validation: { skipped: true }`, with a warning at the time. It exists for
re-rendering a build you have just checked.

---

## Limits of the runtime check

- It drives pinned engine internals: the HyperFrames bundler and `__player.renderSeek`,
  and Remotion's page hooks. On another version it may stop working, and it fails
  closed. The route is reported `unavailable`, the requirements stay `unverified`,
  and nothing passes by accident.
- It needs Node 22+ and a Chrome. Without either, the same thing happens.
- It reads the DOM, not pixels. Canvas, WebGL and image text cannot be read, so copy
  drawn that way stays failed or unverified. Accept it by name, and check it in the
  frames.
- Readability is judged on the element and its ancestors (opacity, visibility, clip,
  blur, viewport) and on what is stacked above it. A low-contrast line that is still
  drawn passes this check. Contrast belongs to `hyperframes check` and to you.
- `text_overlap` and `text_small_on_phone` are advisories, sampled at settled frames.
  Motion in between is not inspected.
- It inspects the composition, not the encoded file. Encoded pictures get ffprobe
  measurements and frame review, not OCR.

---

## Audio and formats

| Output | Generated bed | `--no-audio` |
| - | - | - |
| mp4 | AAC muxed on, on both lanes | no audio stream |
| webm | Opus muxed on | no audio stream |
| mov | PCM muxed on | no audio stream |
| gif | **Refused** (exit 2): GIF cannot carry audio | silent gif |
| `--batch` | **Refused** (exit 2): batch is video-only | silent outputs |

Refusals happen before any render time is spent. Remotion batch outputs are each
measured. HyperFrames batch outputs are written by the engine and recorded as not
measured, so report that as such.

The picture comes from the engine and the bed from `music.mjs`, which uses the same
validated brief and its beat grid. One `ffmpeg` call joins them. ffmpeg is therefore
needed on both lanes for a generated bed, and ffprobe for every output check. If
either is missing the render stops before it starts, and says what to install. The
`output.*` measurements can be accepted as unverified with
`--allow-unverified "output.*"`.

---

## Network and offline

`scripts/doctor.mjs` reports what is ready, without using the network. "Ready offline"
means it found nothing that would need it.

| Needs network | When | Offline alternative |
| - | - | - |
| Engine install, `hyperframes@0.8.226` | First HyperFrames use | Already installed in `MOTIONBRIEF_ENGINE_DIR` or the default cache |
| `npm ci` for Remotion | First Remotion use in a project | Already installed |
| Chrome headless shell | First render, if none is found | `MOTIONBRIEF_CHROME` |
| Google Fonts requested by a HyperFrames composition | First use of a family; cached in `~/.cache/hyperframes/fonts` | The cache, or local `@font-face` files |
| GSAP from `cdn.jsdelivr.net`, in the HyperFrames templates | Every render and inspection | Vendor `gsap.min.js` beside the composition |
| Any other external URL in your composition | Every render | Vendor it |

The Remotion template loads Inter from `@fontsource/inter`, so its fonts are local
files after install. A source scan cannot see a URL built at runtime.

HyperFrames also sends anonymous usage telemetry when the network is there, and a render
does not depend on it. Set `HYPERFRAMES_NO_TELEMETRY=1` or `DO_NOT_TRACK=1` to stop it.
Each command ends by sending it from a detached process that works in the project, so on
Windows the folder can refuse deletion for about a second after a render exits.
Its update check and self-install are always off here, because the version is pinned.

---

## Repeatability

These are different claims. Only the first has been demonstrated across machines by
a comparison job, and only once CI has run it.

| Claim | Status |
| - | - |
| **Deterministic music**: one brief gives a byte-identical WAV | Tested by repeat runs on each platform. CI compares the hash between platforms |
| **Same-machine repeatability of the contract**: one build gives the same status | Tested |
| **Same-machine video**: same pinned engine, browser and FFmpeg | Same frames expected. Byte equality is measured and recorded by the smoke test, not promised |
| **Cross-platform visual equivalence**: same layout and timing across OSes | Not promised. Font rasterization and browser builds differ. Review frames per platform |
| **Byte-identical video across machines** | Not promised, and not demonstrated |

Render reports record what produced a file: engine, Node, browser, encoder, lockfile
hash, brief hash, music hash, fonts actually drawn, external assets and output hash.
The report is `<out>.report.json`, or `<slug>.batch.report.json` for a batch.
