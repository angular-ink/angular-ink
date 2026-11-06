# angular-ink

The command for angular-ink, terminal apps built with Angular components. It compiles an app ahead
of time and bundles it into one executable file, without `@angular/compiler`.

```sh
npx angular-ink build src/main.ts --out dist/cli.mjs
node dist/cli.mjs
```

```text
angular-ink build <entry> --out <file> [--tsconfig <file>] [--sourcemap] [--no-minify]
```

Without `--tsconfig`, it uses `tsconfig.json` in the current folder, and a strict internal config
when there is none. The project needs `@angular/compiler-cli` and `typescript`.

Not an official Angular project.

MIT
