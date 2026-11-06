# Roadmap

What angular-ink leaves for later. Version 0.1 covers the core render, layout and inline output,
the testing library and the CLI build. The phases below follow the parity plan with Ink 8.0.0.
Items that change behavior need a design update first (`AGENTS.md`).

| Version | Phases | Parity (core and testing items) |
| ------- | ------ | ------------------------------- |
| 0.1     | 0, 1   | about 45%                       |
| 0.2     | 2      | about 65%                       |
| 0.3     | 3      | about 70%                       |
| 0.4     | 4      | about 90%                       |
| 0.5     | 5, 6   | all of the core and testing     |
| 0.6     | 7      | plus `@inkjs/ui` 2.0.0          |
| 1.0     | 8      | plus project creation and examples; API frozen |
| 1.x     | 9      | ecosystem                       |

## Phase 4: advanced terminal features (0.4)

- Incremental rendering and a render throttle (frames per second).
- Alternate screen.
- Synchronized output.
- Kitty keyboard protocol.
- Windows console support.
- Suspending the terminal: `injectApp().suspendTerminal(async () => …)`, also with `await using`.
- Cursor position and IME support, applied at the end of the render cycle.
- Animation: a shared timer service and `injectAnimation()` returning a signal.
- Window size and measurement helpers.
- Scrolling with `contentOffsetX` and `contentOffsetY`.
- `ink-transform` and hyperlinks.

Done when the `alternate-screen`, `incremental-rendering`, `render-throttle`, `scroll`,
`cursor-ime`, `suspend-terminal` and `subprocess-output` examples match Ink in the parity harness,
in kitty, WezTerm, GNOME Terminal, tmux and Windows Terminal.

## Phase 5: accessibility (0.5)

- Screen reader mode.
- `injectScreenReader()`.
- `aria-label`, `aria-hidden`, `aria-role` and `aria-state` arrive at the renderer as attributes,
  with no new inputs. Where Ink's README and code disagree, follow the code and note the
  difference in the test.

Done when the `aria` example matches Ink in screen reader mode.

## Phase 6: React items with no direct pair (0.5)

- `concurrent` is accepted and ignored, with a development warning. `@defer` and `resource()`
  cover Suspense.
- `DEV=true` starts an inspector of our own: component tree, inputs and signals over a local
  WebSocket, seen in a browser app.
- `debug` mode writes each frame on a new line.
- Angular Router with an in-memory `LocationStrategy`.

Done when the `router` and `concurrent-suspense` examples give the same screen as Ink's.

## Phase 7: `@angular-ink/ui` (0.6)

Parity with `@inkjs/ui` 2.0.0:

- Theme: `provideInkTheme(theme)`, `extendTheme` and `injectComponentTheme(name)`.
- Display: alert, badge, status message, progress bar, spinner (`injectSpinner()`), ordered and
  unordered lists.
- Input: confirm input, text input, email input, password input.
- Selection: select and multi-select.
- Inputs implement `FormValueControl` of Signal Forms, as well as the `change` and `submit`
  outputs.

Done when each component has a scenario that matches `@inkjs/ui` 2.0.0 on Ink 8 in the harness.

## Phase 8: project creation and examples (1.0)

- `npm create angular-ink@latest <dir>`, with one TypeScript template.
- `ng add @angular-ink/core` for existing workspaces.
- The 29 official Ink examples rewritten in Angular, run in CI by the harness.

## Phase 9: ecosystem (1.x)

An `@angular-ink/extras` package with the most-used community components, by real use:

- **High:** text input, select input, multi-select, progress bar, table, confirm input, task list,
  scroll view, virtual list.
- **Medium:** spinner, link, tabs, divider, markdown, syntax highlight, form, scroll list, stepper.
- **Low:** gradient, big text, picture, color pipe, ascii, quick search, spawn, titled box, chart,
  color picker, stdout dimensions.

Several overlap `@angular-ink/ui` or the core, and become migration notes instead of components.
Extras beyond parity: mouse in full-screen mode, a scroll view with a scrollbar, component CSS
through `RendererType2.styles`, and a browser playground with xterm.js.

## Keeping parity

- A weekly CI job compares the npm version of `ink` with the last one inventoried and opens an
  issue with the changelog when it is newer.
- Each Ink release adds inventory rows and harness scenarios before any code.
- The README shows "parity with Ink X.Y.Z: N/M items" from the harness report.
