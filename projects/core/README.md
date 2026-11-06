# @angular-ink/core

Build terminal apps with Angular components. Own engine, Ink-inspired API; this project does not wrap Ink.

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

## More

The [repository README](https://github.com/angular-ink/angular-ink#readme) has the names from Ink and
the parity count.

Not an official Angular project.

MIT
