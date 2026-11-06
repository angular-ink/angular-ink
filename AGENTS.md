# AGENTS.md

angular-ink renders Angular components to the terminal. A terminal app is a normal Angular
component whose template uses the `ink-*` elements; a custom `RendererFactory2` turns it into a
tree of nodes, and the project's own engine lays that tree out with Yoga in cells, paints it into
a cell grid and writes only the cells that changed. The API is inspired by Ink, but nothing wraps
Ink or React. Packages `@angular-ink/core`, `@angular-ink/testing` and `angular-ink` (the CLI),
npm scope `@angular-ink`, GitHub `angular-ink/angular-ink`, MIT.

The structure and its patterns are in `docs/ARCHITECTURE.md`, tests, lint, CI, security and
releases are in `docs/ENGINEERING.md`, and what comes next is in `docs/roadmap.md`. Working
design notes and implementation plans live in `docs/superpowers/` and `.superpowers/`, which are
gitignored and stay on the maintainer's machine. Read the files your change touches before
starting. A change that would break a rule below needs a different approach or an explicit
decision from the maintainer, not an exception.

## Before writing any code

- **Load the Angular skills every time.** Load `angular-developer` before any task that touches
  Angular code: components, inputs, DI, injectors, change detection, tests, the CLI. Load
  `angular-new-app` before creating an app or a workspace.
- **Use the `angular-cli` MCP.**
  - Call `list_projects` to find the workspace.
  - Call `get_best_practices` with its path before writing Angular code.
  - Call `search_documentation` for any API whose Angular 22 form you are not sure of.
  - Do not write Angular APIs from memory when the MCP can confirm them.
- **Write the test first** and watch it fail. A test that passes without the change it covers
  guards nothing: revert the change and check that it fails.
- **Run the gate before saying a change is done:** `prettier --check .`, `eslint .`, the typecheck,
  `npm test -- --coverage` (coverage gates in `docs/ENGINEERING.md`) and, once they exist,
  `scripts/startup-budget.mjs` and `scripts/e2e.mjs`.

## Commands

All toolchains run in Docker. Nothing is installed on the host except nvm.

```sh
./scripts/dev npm ci
./scripts/dev npm test                 # Vitest, all specs
./scripts/dev npm test -- <pattern>    # one area, e.g. smoke
./scripts/dev npm run build:core       # ng-packagr build of @angular-ink/core into dist/core
./scripts/dev npm run build:testing    # the same for @angular-ink/testing
./scripts/dev npm run typecheck
./scripts/dev npm run lint
```

`scripts/dev` runs a command in `node:24-bookworm-slim` with the repo at `/w`, uid 1000 and a
6 GB memory cap. `NGINK_APT="<packages>" ./scripts/dev …` installs Debian packages as root first,
then runs the command as uid 1000.

- Never stop, kill or remove Docker containers you did not start. Name your own containers
  (`--name`) and stop only those.

## Architecture rules

- **The pipeline is fixed:** component → `InkNode` → `LayoutBox` → `CellGrid` → diff →
  `AnsiWriter` → `TerminalPort`. Each stage is plain TypeScript tested on its own output. Do not
  paint during layout and do not lay out during the write.
- **Data between stages is readonly.** A stage returns new data and never mutates its input. The
  previous grid is the only state kept between frames.
- **No platform, no DOM.** The app runs in an `EnvironmentInjector` without a platform. The only
  private Angular symbol is `ɵINJECTOR_SCOPE`, read in
  `projects/core/src/lib/platform/angular-private.ts` and nowhere else.
- **No React and no Ink code or packages in the libraries.** `ink` and `react` are
  devDependencies used only by the parity tests in `parity/`.
- **Elements are components.** Each `ink-*` element is a component with typed inputs named like
  the props of Ink 8.0.0. It registers itself as its node's owner, and the engine reads its
  props. Users never need `NO_ERRORS_SCHEMA`.
- **Every render is isolated.** An app gets its own injector, tree, grid and terminal port. Two
  apps at once must not share state.
- **Patterns in use, and why, are in `docs/ARCHITECTURE.md`:** an Adapter for Angular's renderer,
  pipes and filters with a functional core, Port/Adapter on the output (`TerminalPort`) and a
  state machine in the `KeyParser`. Do not add a pattern without a pressure that calls for it and
  an entry in that file.
- **Bounded work.** Parsers are linear (no super-linear regex). These limits throw an
  `angular-ink:` error:
  - text of more than 1 MiB (`MAX_TEXT_BYTES = 1_048_576`);
  - nesting deeper than 256 (`MAX_DEPTH`).

  Input comes from outside the app, so its limits drop the excess and recover, and never throw:
  - an incomplete input sequence longer than 256 bytes (`MAX_SEQUENCE_BYTES`);
  - a paste of more than 10 MiB (`MAX_PASTE_BYTES = 10_485_760`), with a warning in development.
- **The terminal always comes back.** On `SIGINT`, `SIGTERM`, `SIGHUP`, an uncaught exception or
  an unhandled rejection, the terminal returns to normal: cursor visible, raw mode and bracketed
  paste off. A closed stdout (`cli | head -1`, `EPIPE`) exits without a stack trace.
- **User data cannot drive the terminal.** Control sequences, OSC, `\r` and zero-width characters
  in data never move the cursor, and a wide character is never split at a clip edge.

## Product rules

- **Packages:** `@angular-ink/core`, `@angular-ink/testing`, `angular-ink`. All three share one
  version (`fixed` in the changesets).
- **Selectors:** `ink-*`. Inputs use the names and values of the Ink 8.0.0 props.
- **Peers and runtime:** peer `@angular/core ^22.0.0`, Node `>=22`, ESM, zoneless.
- **Errors** start with `angular-ink:`. Warnings appear in development only (`isDevMode()`), once
  per render.
- **Without a TTY** (`echo x | cli`, CI, closed stdin), `injectInput` does not throw. It stays
  inactive with a warning, and the app never waits for a key.
- **When the terminal shrinks or a frame is taller than the screen,** no ghost lines remain and the
  scrollback is kept.

## Code and repository rules

- **Angular 22:** zoneless, signals, `input()`/`output()`, `inject()`, and built-in control flow.
  Follow the `angular-developer` skill. Never set `standalone: true` or
  `ChangeDetectionStrategy.OnPush` explicitly.
- **Strict TypeScript.** Prefer `unknown` over `any`.
- **Files:** kebab-case file names, one concept per file, and specs next to the code (`*.spec.ts`).
- **Comments:** short and specific to the code, written as a person on the team would write them.
  No filler and no restating the line below.
- **Language:** code, comments, docs, commits and PRs are in English.
- **Naming:** docs say "for Angular". The project never presents itself as an official Angular
  project.
- **No company code or data.** Fixtures and examples use made-up data.
- **Dependencies:** runtime dependencies of the core stay at `yoga-layout ~3.2.1`,
  `wrap-ansi ^10.0.2`, `cli-truncate ^6.0.0`, `string-width ^8.3.0`, `cli-boxes ^4.0.1` and
  `tslib`. A new one needs a reason in the PR and must pass `npm audit` and OSV-Scanner.
- **Commits:** Conventional Commits (`feat(core): …`, `fix(core): …`, `chore: …`), with no AI
  attribution or co-author lines.
- **Pull requests:** describe what changed and why, and how it was tested. The maintainer reviews
  the text before anything is pushed or published.
