// The packed packages as users get them from npm: installs the tarballs of @angular-ink/core,
// @angular-ink/testing and angular-ink into an empty folder, builds a hello app with the
// `angular-ink` command and checks what it prints. Run after `npm run build:core`,
// `build:testing` and `build:cli`. `--angular <version>` installs that Angular instead of the
// one the repository uses (the lowest the peer range allows, for `ɵINJECTOR_SCOPE`).
// Usage: node scripts/pack-install.mjs [--angular 22.0.0]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELLO = `import { Component } from '@angular/core';
import { InkBox, InkText, renderInk } from '@angular-ink/core';

@Component({
  selector: 'app-hello',
  imports: [InkBox, InkText],
  template: '<ink-box borderStyle="round"><ink-text>hello from a packed app</ink-text></ink-box>',
})
class Hello {}

const app = await renderInk(Hello);
app.unmount();
await app.waitUntilExit();
`;

export function parseAngularFlag(argv) {
  const at = argv.indexOf('--angular');
  if (at < 0) return null;
  const version = argv[at + 1];
  if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('pack-install: --angular needs a version');
  }
  return version;
}

export function angularPackages(version) {
  return ['core', 'compiler', 'compiler-cli'].map((name) => `@angular/${name}@${version}`);
}

const repo = fileURLToPath(new URL('../', import.meta.url));
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

function main() {
  const angular = parseAngularFlag(process.argv.slice(2));
  const rootPackage = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  const dependencies = rootPackage.devDependencies;
  const folder = mkdtempSync(join(tmpdir(), 'angular-ink-pack-'));
  try {
    const tarballs = ['core', 'testing', 'cli'].map((name) => {
      run(
        'npm',
        ['pack', join(repo, 'dist', name), '--pack-destination', folder, '--silent'],
        folder,
      );
      const prefix = name === 'cli' ? 'angular-ink-' : `angular-ink-${name}-`;
      const file = readdirSync(folder).find(
        (entry) =>
          entry.startsWith(prefix) &&
          entry.endsWith('.tgz') &&
          /\d/.test(entry[prefix.length] ?? ''),
      );
      if (file === undefined) throw new Error(`pack-install: no tarball for ${name}`);
      return join(folder, file);
    });
    writeFileSync(
      join(folder, 'package.json'),
      '{ "name": "hello", "private": true, "type": "module" }\n',
    );
    const angularSpecs = angular
      ? angularPackages(angular)
      : angularPackages(dependencies['@angular/compiler-cli'].replace(/^\D+/, '')).map((spec) =>
          spec.replace(/@(\d.*)$/, '@^$1'),
        );
    run(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        ...tarballs,
        ...angularSpecs,
        `typescript@${dependencies.typescript}`,
        `rxjs@${rootPackage.dependencies.rxjs}`,
        '@types/node',
      ],
      folder,
    );
    writeFileSync(join(folder, 'main.ts'), HELLO);
    writeFileSync(
      join(folder, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ES2022',
          moduleResolution: 'bundler',
          strict: true,
          skipLibCheck: true,
          types: ['node'],
        },
        angularCompilerOptions: { strictTemplates: true },
        files: ['main.ts'],
      }),
    );
    run('npx', ['--no-install', 'angular-ink', 'build', 'main.ts', '--out', 'hello.mjs'], folder);
    const hello = spawnSync(process.execPath, ['hello.mjs'], { cwd: folder, encoding: 'utf8' });
    if (hello.status !== 0 || !hello.stdout.includes('hello from a packed app')) {
      // Node prints the minified line the error came from before its message, so ask for the
      // message alone.
      const why = spawnSync(
        process.execPath,
        ['-e', "import('./hello.mjs').catch((error) => { console.error(error.stack); })"],
        { cwd: folder, encoding: 'utf8' },
      );
      throw new Error(
        `pack-install: the built app exited ${String(hello.status)}:\n${hello.stdout}\n${why.stderr.slice(0, 1500)}`,
      );
    }
    const installed = JSON.parse(
      readFileSync(join(folder, 'node_modules/@angular/core/package.json'), 'utf8'),
    ).version;
    console.log(
      `OK the packed hello app printed its frame, on Angular ${installed}, Node ${process.versions.node}`,
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
