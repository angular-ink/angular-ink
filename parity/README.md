# Parity with Ink 8.0.0

Each scenario runs one app written for Ink and its equivalent written with angular-ink, in the same
kind of pty: same size, `TERM`, `COLORTERM` and environment, with `CI` removed as in `e2e/pty-screen.mjs`.
It compares the screens cell by cell, with the scrollback, the cursor and the exit code. Escapes may
come in another order as long as the terminal ends up the same.

```sh
./scripts/dev node parity/run.mjs             # exit 1 on a difference that is not listed below
./scripts/dev node parity/run.mjs --only chat # one scenario, leaves the report alone
```

A full run writes [`docs/parity.md`](../docs/parity.md), with the count of identical scenarios. A
difference that has an entry below also fails the run once it goes away, so the list stays true.

## Layout

- `ink-apps/*.mjs`: the apps for Ink, with `React.createElement`, no JSX.
- `ng-apps/*.ts`: the same apps for angular-ink, built as a user builds them, on the packed core.
- `scenarios.mjs`: the keys each app gets and the moments whose screens are compared.
- `compare-screens.mjs`: reads a headless xterm's buffer and finds the first different cell.
- `width-probe.mjs`: asks a real terminal how wide it draws emoji and CJK.
- `LICENSE-ink`: the MIT notice of Ink. These examples are the only Ink code in this repository.

`ink` and `react` are devDependencies that only this folder may import, which lint enforces.

## The examples and what changed in them

The first eleven come from `examples/` of `vadimdemedes/ink` at the tag `v8.0.0`.

- `table` has fixed names in place of `faker`, so both apps show the same data.
- `counter` stops at 10, so both end on the same frame.
- `select-input` drops `useIsScreenReaderEnabled` and the `aria-*` props, which have no effect with
  the screen reader off, and `box-backgrounds` has its `render` call in the same file.

## The edges no example reaches

`tall-frame` draws a frame of the height it gets in `argv`, with keys to redraw it: as tall as the
screen, one row shorter, taller, and on a screen that shrinks to it. `static-tall` writes permanent
output above a frame that overflows. `value-edges` has the values that can be read in more than one
way. `error-excerpt` shows the error overview with a made-up stack, so both show the same one, over
`fixtures/long-lines.txt`.

## What an equivalent app has to know

- The Angular compiler collapses whitespace in templates, also inside the string literal of an
  interpolation. The two spaces of `{{ '  ' + item }}` become one, so leading spaces come from code.
- A static attribute is always a string, so `width="10"` has to mean the `width={10}` of Ink. Ink
  would read its own `width="10"` as 10%. Any other string reads as in Ink: `width="50x"` is 50%.

## Expected divergences

Each entry is a difference that is not fixed. **These two wait for the maintainer's decision**: only
the maintainer can accept an exception.

- `screen-narrows-with-a-short-frame`: Ink erases the rows of the old frame without counting what the terminal reflowed, so narrowing leaves ghost lines above the new frame. AGENTS.md requires that no ghost lines remain, so angular-ink counts the reflow and erases them.
- `static-above-a-frame-taller-than-the-screen`: the scrollback differs, the screen does not. A frame that overflows is drawn again in full on each commit, and `<Static>` makes React commit twice per update, so Ink leaves more copies of the frame there. angular-ink draws once per change of the frame and writes permanent output over the frame it has.

## Not compared

- Bytes: the roadmap's byte-for-byte level for the items it calls identical. These runs compare cells.
- A commit that changes nothing: Ink redraws a frame that overflows on any React commit, and
  angular-ink only when the frame changed, the terminal resized or the app ends.
- Real terminals: everything here runs on `@xterm/headless`. See "Terminals checked" in
  `docs/ENGINEERING.md`.
