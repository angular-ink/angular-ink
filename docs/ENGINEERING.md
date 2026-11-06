# Engineering practices

How angular-ink is tested, checked, secured and released. Every rule here is enforced by a tool in
CI, by a git hook, or by a repository setting or a maintainer step that this file names as such. A
rule that nothing enforces is a wish, and does not belong in this file.

## Tests

Tests are written first and must fail without the change they cover (see `AGENTS.md`).

| Level       | What it proves                                                                  | Tool                                       | Where                  |
| ----------- | ------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------- |
| Unit        | One stage, from its input data to its output data                               | Vitest (node)                              | `lib/**/*.spec.ts`     |
| Component   | Real templates (control flow, DI) build the right tree and frame                | Vitest + Angular compiler                  | `elements/*.spec.ts`   |
| Integration | A whole app renders on fake streams                                             | Vitest + `@angular-ink/testing`            | `runtime/*.spec.ts`    |
| End to end  | The built CLI in a pseudo-terminal, compared with expected screens              | `scripts/e2e.mjs`                          | `e2e/`                 |
| Parity      | The same app on Ink and on angular-ink gives the same frames                    | `parity/run.mjs`                           | `parity/`              |

`./scripts/dev node parity/run.mjs` exits 1 on a difference that `parity/README.md` does not list,
and writes the count to [`parity.md`](parity.md).

### Test isolation

Nothing a test sets up outlives it:

- `restoreMocks` and `unstubGlobals` are on in `vitest.config.ts`: spies and stubbed globals are
  undone after each test.
- A spec builds its own app, tree and terminal port, and destroys the app in `finally` or
  `afterEach`. Specs never share a terminal port.
- No spec writes to the real `process.stdout` or reads the real `process.stdin`.

### Coverage gates (Vitest `v8` provider)

`npm test -- --coverage` enforces, per folder under `projects/core/src/lib`:

| Folder      | Lines | Branches |
| ----------- | ----- | -------- |
| `engine/`   | 95    | 90       |
| `tree/`     | 90    |          |
| `elements/` | 90    |          |
| `input/`    | 90    |          |

### Key sequences

`e2e/fixtures/keys/` holds the sequences terminals send, one file per terminal and key, and
`input/key-parser.spec.ts` parses every file. `node scripts/capture-key-fixtures.mjs` writes the
ones for `xterm`, `kitty` (without its protocol) and `tmux`: the sequences each one documents,
passed through a real pty.

The maintainer adds the rest by hand, as `gnome-<key>.bin` and `vscode-<key>.bin` with the key names the spec lists,
from a real session of **GNOME Terminal** and of the **VS Code terminal**. Run
`sh -c 'stty raw -echo; dd bs=16 count=1 of=gnome-up.bin; stty sane'`, press the key once,
and go through:

- arrows, also in application mode (`app-up`, `app-down`: first run `printf '\033[?1h'`);
- Home, End, Page Up, Page Down, Insert, Delete;
- F1, F5, F12;
- Return, Tab, Shift+Tab, Backspace;
- Ctrl+A, Ctrl+C (`stty raw` lets it through), Ctrl+Up, Shift+Up, Alt+Up, Alt+A, Alt+Return.

The spec checks that `xterm`, `kitty` and `tmux` have every key. Add a terminal to that list once
its files are in.

### Terminals checked

The tests run on `@xterm/headless`, which is not any terminal a user has. This table is filled in by
hand by the maintainer, in each of GNOME Terminal, kitty, Alacritty, WezTerm, tmux and the VS Code
terminal. Any row marks what was seen there, and no row means not checked yet.

From the repository, in that terminal, with Node from nvm as these need the terminal itself:

```sh
node parity/width-probe.mjs        # a line per case; any DIFFERS is a note in parity/README.md

./scripts/dev npm run build:core && ./scripts/dev npm run build:cli
./scripts/dev node dist/cli/cli.js build projects/demo/src/status.ts --tsconfig projects/demo/tsconfig.json --out out-tsc/status.mjs
./scripts/dev node dist/cli/cli.js build projects/demo/src/deploy.ts --tsconfig projects/demo/tsconfig.json --out out-tsc/deploy.mjs
node out-tsc/status.mjs            # resize the window both ways, then q
node out-tsc/deploy.mjs            # arrows and Enter
```

Look for flicker, and for misaligned borders or columns.

| Terminal | Version | Width probe | `status` | `deploy` | Date | Notes |
| -------- | ------- | ----------- | -------- | -------- | ---- | ----- |

## Formatting and lint

### Prettier 3

- **Settings:** `printWidth: 100`, `singleQuote: true`, `trailingComma: 'all'`.
- **CI** runs `prettier --check .`. Prettier skips `docs/`, `AGENTS.md` and `CLAUDE.md`.

### ESLint (flat config)

| Rule set                   | Settings                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `typescript-eslint`        | `strictTypeChecked` and `stylisticTypeChecked`                                            |
| `angular-eslint`           | `tsRecommended` and `templateRecommended`, selector prefix `ink`                          |
| `no-restricted-imports`    | the libraries do not import `@angular/common`; only `parity/` imports `ink` or `react`    |
| `no-restricted-syntax`     | private `ɵ` Angular imports only in `platform/angular-private.ts`                         |
| `regexp`                   | `recommended`, and `no-super-linear-backtracking` as an error (ReDoS)                     |
| `eslint-config-prettier`   | last, so formatting never fights lint                                                     |

### TypeScript

- **Compiler options:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride` and `noPropertyAccessFromIndexSignature`.
- **Angular compiler:** `strictTemplates`, `strictInjectionParameters` and
  `strictInputAccessModifiers`.
- **Paths:** `@angular-ink/core` points at `projects/core/src/public-api.ts` in the tsconfigs and in
  Vitest. The testing library builds against `dist/core` when it exists.

### Git hooks

- **pre-commit (`husky` + `lint-staged`):** Prettier and ESLint `--fix` on staged files.
- **commit-msg (`commitlint`):** checks the message follows Conventional Commits.
- `npm install` runs `husky` through the `prepare` script, which sets `core.hooksPath` to
  `.husky/_`. `prepare` ends in `|| true`, so an install without Git (a container with no `git`,
  or `--ignore-scripts` in CI) does not fail, and then no hook is active. After a fresh clone,
  check with `git config core.hooksPath`; if it prints nothing, run `npx husky` once.
- The hooks call `npx --no-install`, so they need `node_modules` and a Node on the `PATH` of
  the shell that runs `git commit`.
- CI runs the same checks, so skipping a hook only delays the failure.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`. Each job below is
required for merging (a repository setting, listed in `CONTRIBUTING.md`):

| Job              | What it runs                                                                          |
| ---------------- | ------------------------------------------------------------------------------------- |
| `format`         | `prettier --check .`                                                                  |
| `lint`           | `eslint .` after `build:core`, and `scripts/check-readme.mjs`                         |
| `typecheck`      | `npm run typecheck`                                                                   |
| `test`           | `build:core`, then `vitest run --coverage` with the gates above                       |
| `audit`          | `npm audit --audit-level=high` over every dependency; fails on high or critical       |
| `osv-scanner`    | `scripts/check-osv-ignores.mjs`, then OSV-Scanner over `package-lock.json`            |
| `startup-budget` | `scripts/startup-budget.mjs`: 150 ms median, 1 MB, no `@angular/compiler`             |
| `build`          | the three builds, then `scripts/check-pack.mjs` over `dist/core`, `testing` and `cli` |
| `e2e`            | `scripts/e2e.mjs`                                                                     |
| `parity`         | `node parity/run.mjs`                                                                 |
| `pack-install`   | `scripts/pack-install.mjs` on Node 22.18.0 and 24, and on Node 22.18.0 with `@angular/core` 22.0.0 |

`test` builds `dist/core` first because `build.spec.ts` packs it and reuses one that exists, so a
stale build would test old code. `pack-install` installs the three tarballs into an empty folder,
builds a hello app with `angular-ink build` and checks its output. The Angular 22.0.0 run is there
because `ɵINJECTOR_SCOPE` is private and the peer range starts at 22.0.0.

Other workflows: `codeql.yml` (CodeQL, `security-extended`), `scorecard.yml` (OpenSSF Scorecard),
`weekly.yml` (OSV-Scanner, StrykerJS over `engine/`, with a break threshold of 80, and a check of
the `ink` version on npm that opens an issue when it is newer than the pinned one) and
`release.yml`. Third-party actions are pinned to a full commit SHA with the version in a comment,
every workflow sets `permissions: contents: read` and a job raises only what it needs, every job
has `timeout-minutes`, and no workflow uses `pull_request_target`.

## Security

- **Threat model:** the data an app shows (text, file names, server responses) and the bytes on
  stdin are untrusted. The engine must not let them move the cursor, change the terminal's mode or
  run a sequence of the user's choice. The limits in `AGENTS.md` bound the work they can cause.
- **Dependencies:** a new runtime dependency must pass `npm audit` and OSV-Scanner. Fix
  vulnerabilities within the CVSS deadlines in `SECURITY.md`.
- **Ignoring an advisory:** only when it cannot reach angular-ink. Add it to `osv-scanner.toml`
  with an `id`, a `reason` and an `ignoreUntil` at most 90 days ahead; `scripts/check-osv-ignores.mjs`
  fails CI otherwise. The list is empty today. A dev-tool advisory with a fix is fixed through an
  `overrides` entry in `package.json` (`minimatch` and `qs` are), and the override goes when the
  tool ships the fix itself.
- **Terminal safety:** the process-exit tests (signals, uncaught errors, closed stdout) are part of
  the gate.

## Releases

- The three packages share one version, kept in step with changesets (`fixed`).
- `VERSION` in `projects/core/src/version.ts` is rewritten from `projects/core/package.json` when
  the version is bumped.
- `.changeset/config.json` has the three packages in one `fixed` group, so a changeset for any of
  them bumps all three. A pull request that changes a published package adds a changeset.
- `release.yml` opens the "chore: version packages" pull request from the changesets
  (`npm run changeset:version` also runs `scripts/sync-version.mjs` and refreshes the lockfile).
  Merging it publishes `@angular-ink/core`, `@angular-ink/testing` and `angular-ink` with npm
  trusted publishing and provenance, then creates the GitHub release with a CycloneDX SBOM.
- `engines.node` of `angular-ink` (the command) is `^22.18.0 || >=24.11.0`, the range of Babel 8,
  which it depends on. The two libraries accept Node `>=22`.
- Publishing is a maintainer step. Nothing is pushed or published without the maintainer's review.
  The one-time setup (branch protection, secrets, trusted publishers, the first-release token) is
  the checklist at the end of `CONTRIBUTING.md`.
