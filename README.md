# angular-ink

Build terminal apps with Angular components. Own engine, Ink-inspired API; this project does not wrap Ink.

[![CI](https://github.com/angular-ink/angular-ink/actions/workflows/ci.yml/badge.svg)](https://github.com/angular-ink/angular-ink/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@angular-ink/core)](https://www.npmjs.com/package/@angular-ink/core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/angular-ink/angular-ink/badge)](https://scorecard.dev/viewer/?uri=github.com/angular-ink/angular-ink)
<!-- prettier-ignore-start -->
<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
[![All Contributors](https://img.shields.io/badge/all_contributors-1-orange.svg?style=flat-square)](#contributors)
<!-- ALL-CONTRIBUTORS-BADGE:END -->
<!-- prettier-ignore-end -->

[![Parity with Ink 8.0.0](https://img.shields.io/badge/parity%20with%20Ink%208.0.0-18%2F20%20scenarios-blue)](docs/parity.md)

A terminal app is a normal Angular component whose template uses the `ink-*` elements. angular-ink
lays the tree out with Yoga, paints it into a grid of cells and writes only the cells that changed.
Keyboard and paste arrive through callbacks, and focus is a signal. There is no React and no Ink in
the runtime.

## Install

```sh
npm install @angular-ink/core
npm install --save-dev @angular-ink/testing angular-ink @angular/compiler-cli typescript @types/node
```

It needs `@angular/core` 22, zoneless, and Node 22 or newer. The published types use `NodeJS.*`, so
a TypeScript project also needs `@types/node`. The `angular-ink` command needs Node `^22.18.0` or
`>=24.11.0`, because it depends on Babel 8.

## Example

A terminal app is a component. This one lists two environments, moves with the arrow keys and exits
on Enter. It has the shape of the `deploy` app in `projects/demo/src/deploy.ts`, which adds a
spinner, steps written above the live area with `ink-static`, and an exit code.

```ts
import { Component, signal } from '@angular/core';
import { InkBox, InkText, injectApp, injectInput, renderInk } from '@angular-ink/core';

@Component({
  selector: 'demo-deploy',
  imports: [InkBox, InkText],
  template: `
    <ink-box flexDirection="column">
      <ink-text bold>Deploy to which environment?</ink-text>
      @for (name of environments; track name) {
        <ink-text [color]="$index === selected() ? 'cyan' : undefined">{{ name }}</ink-text>
      }
    </ink-box>
  `,
})
class Deploy {
  protected readonly environments = ['staging', 'prod'];
  protected readonly selected = signal(0);

  constructor() {
    const app = injectApp();
    injectInput((_text, key) => {
      if (key.upArrow) this.selected.update((index) => Math.max(index - 1, 0));
      if (key.downArrow) this.selected.update((index) => Math.min(index + 1, 1));
      if (key.return) app.exit();
    });
  }
}

const app = await renderInk(Deploy);
await app.waitUntilExit();
```

## Build

```sh
npx angular-ink build src/main.ts --out dist/cli.mjs
node dist/cli.mjs
```

The command compiles the app ahead of time and writes one `.mjs` file that does not carry
`@angular/compiler`. It needs Node `^22.18.0` or `>=24.11.0`. The project needs
`@angular/compiler-cli` and `typescript`.

```text
angular-ink build <entry> --out <file> [--tsconfig <file>] [--sourcemap] [--no-minify]
```

Without `--tsconfig`, it uses `tsconfig.json` in the current folder, and a strict internal config
when there is none.

## Names from Ink

Inputs keep the name and the values of the Ink 8.0.0 prop, so `flexDirection="column"` and
`borderStyle="round"` read the same.

| Ink                                                       | angular-ink                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `<Box>`, `<Text>`, `<Newline>`, `<Spacer>`, `<Transform>` | `<ink-box>`, `<ink-text>`, `<ink-newline>`, `<ink-spacer>`, `<ink-transform>` |
| `<Static items>`                                          | `<ink-static [items]>` with an `ng-template`                                  |
| `render`                                                  | `renderInk`                                                                   |
| `renderToString`                                          | `renderInkToString`                                                           |
| `useInput`, `usePaste`                                    | `injectInput`, `injectPaste`                                                  |
| `useApp`, `useStdin`, `useStdout`, `useStderr`            | `injectApp`, `injectStdin`, `injectStdout`, `injectStderr`                    |
| `useFocus`, `useFocusManager`                             | `injectFocus`, `injectFocusManager`, directive `inkFocus`                     |
| `useWindowSize`                                           | `injectWindowSize`                                                            |
| `DOMElement`                                              | `InkNode`                                                                     |
| `ink-testing-library`                                     | `@angular-ink/testing` (`renderForTest`)                                      |

## v0.1 limits

Not in this version: the Kitty keyboard protocol, the alternate screen, `suspendTerminal`,
`injectCursor`, `injectAnimation`, `measureElement` and `injectBoxMetrics`, `contentOffset`, OSC 8
hyperlinks reopened on each line, accessibility (`aria-*`, screen reader mode),
`incrementalRendering`, mouse input, component CSS, `@angular-ink/ui`, `ng add`,
`npm create angular-ink`, `angular-ink dev`, Node SEA, and a port of Ink's own tests (the parity
harness compares apps instead).

`[style.x]`, `class` and component CSS have no effect and warn in development. Style comes from
the inputs.

A non-interactive app (`interactive: false`, CI, or a stdout that is not a TTY) gets no keys, even
with a TTY on stdin.

Also open in 0.1:

- An `ink-static` nested inside another `ink-static` is dropped. Ink paints it.
- The string an `ink-transform` receives closes its colors with `\x1b[0m`, where Ink's has
  chalk's own close codes. A transform that matches exact close codes behaves differently.
- **No real terminal has been checked yet.** The tests run on `@xterm/headless`. The checks in
  GNOME Terminal, kitty, Alacritty, WezTerm, tmux and the VS Code terminal, and the key
  sequences from GNOME Terminal and VS Code, are still to do. Windows is untested.

## Parity with Ink

**18 of 20 scenarios give the same screen as Ink 8.0.0.** Each scenario runs the same app on Ink
and on angular-ink in a pseudo-terminal of the same size, and compares both screens and the
scrollback cell by cell, plus the cursor and the exit code. The two that differ, and why, are in
[`docs/parity.md`](docs/parity.md). The count is of scenarios, not of Ink's API items.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities as described in
[SECURITY.md](SECURITY.md). Questions and ideas go to
[Discussions](https://github.com/angular-ink/angular-ink/discussions).

## Contributors

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/GabeSilvaDev"><img src="https://avatars.githubusercontent.com/u/96894950?v=4?s=100" width="100px;" alt="Gabriel Silva"/><br /><sub><b>Gabriel Silva</b></sub></a><br /><a href="https://github.com/angular-ink/angular-ink/commits?author=GabeSilvaDev" title="Code">💻</a> <a href="https://github.com/angular-ink/angular-ink/commits?author=GabeSilvaDev" title="Documentation">📖</a> <a href="#design-GabeSilvaDev" title="Design">🎨</a> <a href="https://github.com/angular-ink/angular-ink/commits?author=GabeSilvaDev" title="Tests">⚠️</a> <a href="#infra-GabeSilvaDev" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a> <a href="#maintenance-GabeSilvaDev" title="Maintenance">🚧</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors)
specification. Contributions of any kind are welcome.

Not an official Angular project.

MIT
