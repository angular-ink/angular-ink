# angular-ink

The command for angular-ink, terminal apps built with Angular components. It compiles an app ahead
of time and bundles it into one executable file, without `@angular/compiler`.

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

## About

Not an official Angular project.

MIT
