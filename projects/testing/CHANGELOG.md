# @angular-ink/testing

## 0.1.0

### Minor Changes

- [`9bbdadf`](https://github.com/angular-ink/angular-ink/commit/9bbdadff6dee7ff9a7cb92881d29ad70c6b449cd) Thanks [@GabeSilvaDev](https://github.com/GabeSilvaDev)! - First release. Write terminal apps as Angular components with the `ink-*` elements and an API named after Ink 8.0.0. The engine is its own: it lays the tree out with Yoga, paints it into a grid of cells and writes only the cells that changed. It takes the keyboard and pasted text through callbacks and exposes focus as a signal, falls back to plain text in a pipe or in CI, and restores the terminal on exit, on signals and on errors. `@angular-ink/testing` renders an app on fake streams and records its frames as text. The `angular-ink build` command compiles an app ahead of time into one executable `.mjs` file without `@angular/compiler`, and needs Node `^22.18.0` or `>=24.11.0`. Not in this version: the Kitty keyboard protocol, the alternate screen, accessibility modes, mouse input and `@angular-ink/ui`.

### Patch Changes

- Updated dependencies [[`9bbdadf`](https://github.com/angular-ink/angular-ink/commit/9bbdadff6dee7ff9a7cb92881d29ad70c6b449cd)]:
  - @angular-ink/core@0.1.0
