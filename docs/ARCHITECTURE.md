# Architecture

How angular-ink is built, and why. The product rules and the scope are in `AGENTS.md`. This file
covers the structure and the patterns. Each pattern below is used because a concrete pressure in
this project calls for it. Where the simplest correct answer is no pattern, this file says so.

## The shape: a pipeline over immutable data

```
 app component (Angular)
   │  InkRendererFactory2        Adapter: Angular's Renderer2 calls → InkNode tree
   ▼
 InkNode tree                    plain data, styles resolved
   │  layout (Yoga, unit = cell)
   ▼
 LayoutBox tree                  positions and sizes in cells
   │  paint
   ▼
 CellGrid                        char, width, fg, bg and attributes per cell
   │  diff against the previous grid
   ▼
 changes
   │  AnsiWriter                 cursor moves, SGR only when it changes, changed cells only
   ▼
 TerminalPort                    write, columns, rows, onResize
```

```
 stdin (raw mode)
   │  KeyParser                  state machine: keys, arrows, F-keys, modifiers, paste, mouse
   ▼
 InputBus
   │  FocusManager               who receives the key
   ▼
 injectInput handlers and component outputs
```

The root width is the terminal's columns. Each frame paints the layout into a new grid, compares it
with the previous one and writes one string. `end()` of the renderer factory schedules at most one
frame per tick, so several change-detection cycles in a tick become one redraw.

## Pattern decisions

### Adapter: `InkRendererFactory2` (Angular → InkNode)

A `RendererFactory2` of our own runs in an `EnvironmentInjector` with no platform. Its
`Renderer2` creates `InkNode`s for `ink-*` elements and text, moves them on `appendChild`,
`insertBefore` and `removeChild`. Its `listen` does nothing, because Angular also calls it for
component outputs, and those reach their handlers without the renderer. Elements
are components that register as the owner of their node, so the engine reads typed props instead of
parsing attributes.

### Pipes and filters with a functional core

Each stage after the tree is a function from readonly data to readonly data: layout, paint, diff
and the ANSI writer. A stage is tested on its own output. The previous grid is the only state
carried between frames, and the scheduler owns it.

### Port/Adapter on the output: `TerminalPort`

`TerminalPort` (`write`, `columns`, `rows`, `onResize`) has one adapter for `process.stdout` and one
for the virtual terminal in `@angular-ink/testing`. The virtual terminal is the same `CellGrid` as
the engine's, so a test sees exactly what a user would.

### State machine: `KeyParser`

Input arrives in arbitrary chunks, so the parser keeps its state between them. It is linear, with
no regex that can backtrack, and an incomplete sequence is bounded by `MAX_SEQUENCE_BYTES`. `key.ts`
says what the bytes of one sequence mean; the state machine only says where a sequence ends.

`InputBus` hands the events out one at a time and waits for the app to settle after each, so every
key sees the state the previous one left. That is the pressure for a queue: a parser emits a whole
chunk at once, and change detection is asynchronous.

### Trees: plain data with explicit traversal

`InkNode` and `LayoutBox` are plain data walked by recursive functions. There are no Composite
classes. Recursion stops at `MAX_DEPTH`.

## Cross-cutting rules

- **Data between stages is readonly.** Use `readonly` fields and `ReadonlyMap` in the types. A stage
  returns new data.
- **No module-level mutable state in the engine**, apart from the memoised Yoga loader. Every app
  is isolated.
- **Errors.** Invalid input in a template, such as text outside `ink-text`, throws an `Error` whose
  message starts `angular-ink:` and names the element and the value. What can be drawn anyway is
  drawn, and gets one development-mode warning per render.
- **Limits against hostile or broken data.** Text, nesting, input sequences and pastes are
  bounded; the values are in `AGENTS.md`.
- **Determinism.** The same tree, size and color level give the same frame.

## Repository layout

```
projects/core/src/lib/
  platform/   angular-private.ts, mount.ts          app without a platform
  tree/       node.ts, renderer-factory.ts, flatten.ts
  elements/   box, text, newline, spacer, static, transform
  engine/     color, ansi, text-layout, yoga-map, layout, grid, paint, borders, diff, writer,
              color-level
  runtime/    terminal-port, frame-scheduler, log, ink-app, render-ink, render-to-string,
              error-overview, console-patch, exit-hooks, inject
  input/      key-parser, key, input-bus, raw-mode, focus-manager, inject-input, inject-focus,
              focus.directive
projects/testing/   renderForTest, fake streams, key helpers
projects/cli/       the angular-ink command (build)
projects/demo/      the example apps
e2e/  parity/       end-to-end scenarios and the comparison with Ink
scripts/            dev (Docker) and the checks
docs/               this file, ENGINEERING.md, roadmap
```
