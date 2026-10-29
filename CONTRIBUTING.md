# Contributing

Thanks for looking. This repo is a Claude Code skill plus the scripts it leans
on; both halves are worth improving.

## Before you open a PR

```bash
npm run verify
```

That runs the brief validator against the example, the offline contract
checker against both templates (each compared with the same brief), and the
tests in `tests/` (`npm test` on its own). CI runs the same plus the real
HyperFrames linter.

A new validator or contract rule gets a test: copy a template, break one thing,
and assert that exactly that code is reported. `tests/helpers.mjs` has the
copy-and-edit helpers.

If you touched a composition, also look at frames — stills are not enough but
they catch the obvious breakage:

```bash
npx hyperframes snapshot skills/motionbrief/assets/hyperframes --review
```

## What is easy to contribute

| Change | Where |
| - | - |
| A new beat `kind` or `motion` | `references/brief.md` (grammar) + both templates |
| Better easing defaults | `references/motion-craft.md` and the `feel` table in `brief.md` |
| A new engine | `references/<engine>.md`, a template under `assets/`, a branch in `check-contract.mjs` |
| Validator rules | `scripts/brief.mjs` |
| Music: new presets, instruments, keys | `scripts/music.mjs` |
| Docs and examples | `README.md`, `references/` |

## House rules

- **The brief is the source of truth.** If a template and a brief disagree, the
  template is wrong.
- **No silent failures.** If a thing can render wrong without an error, the
  contract checker or the validator should catch it.
- **Templates must stay runnable.** A PR that breaks `npx hyperframes lint` or
  the Remotion bundle will not merge.
- **Everything is deterministic.** No `Math.random()`, no `Date.now()`, no
  wall-clock state — not in a composition and not in the music. The same brief
  must produce the same pixels and the same samples.
- **Claims get evidence.** If the README says something renders, it has been
  rendered.

## Adding a `kind`

1. Add it to `KINDS` in `scripts/brief.mjs` with its allowed motions.
2. Document it in the grammar table in `references/brief.md`.
3. Add a working example beat to `assets/hyperframes/brief.json`.
4. Implement it in both templates, or note the gap explicitly.

## Changing the music

`scripts/music.mjs` is a small additive synthesizer: kick, clap, hat, bass, pad,
mixed on a beat grid derived from the brief. It has no dependencies and no
samples, which is the point — a contributor can change the sound in one file.

Rules that keep it usable:

- **Stay deterministic.** Randomness comes from the seeded PRNG, never
  `Math.random()`. CI asserts two runs are byte-identical.
- **Stay within the grid.** Scheduled events are placed in beats, not seconds.
- **Keep the headroom.** Peak lands near −3 dBFS after a soft clip, so the bed
  never fights narration added later.

## Commit style

Short imperative subject, one idea per commit. `brief: reject zero-length
beats`, not `fixed some stuff`.
