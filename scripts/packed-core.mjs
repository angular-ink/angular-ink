// What the scripts that build an app the way a user does have in common.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO = fileURLToPath(new URL('../', import.meta.url));

export function run(command, args, cwd = REPO) {
  execFileSync(command, args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
}

/** Installs the packed core by hand: everything else resolves from the repo's node_modules. */
export function installPackedCore(fixture) {
  run('npm', ['pack', join(REPO, 'dist/core'), '--pack-destination', fixture, '--silent'], fixture);
  const tarball = readdirSync(fixture).find((name) => name.endsWith('.tgz'));
  const installed = join(fixture, 'node_modules/@angular-ink/core');
  mkdirSync(installed, { recursive: true });
  run('tar', ['-xzf', join(fixture, tarball), '-C', installed, '--strip-components=1']);
}

/**
 * Builds each app the way a user does, on the packed core, and returns where each bundle went.
 * `entries` maps a name of the caller's choice to the source of the app.
 */
export async function buildApps(fixture, entries) {
  run('npm', ['run', '--silent', 'build:core']);
  run('npm', ['run', '--silent', 'build:cli']);
  const { buildCli } = await import(pathToFileURL(join(REPO, 'dist/cli/build.js')).href);

  installPackedCore(fixture);
  // Like the project of a user: the apps need the types of Node, which the default config leaves out.
  writeFileSync(
    join(fixture, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ES2022',
        moduleResolution: 'bundler',
        strict: true,
        experimentalDecorators: true,
        useDefineForClassFields: false,
        skipLibCheck: true,
        typeRoots: [join(REPO, 'node_modules/@types')],
        types: ['node'],
      },
      angularCompilerOptions: { strictTemplates: true },
      files: [],
    }),
  );

  const bundles = {};
  for (const [key, source] of Object.entries(entries)) {
    const name = basename(source, '.ts');
    copyFileSync(source, join(fixture, `${name}.ts`));
    const out = join(fixture, `${name}.mjs`);
    const { warnings } = await buildCli({ entry: `${name}.ts`, out, cwd: fixture });
    if (warnings.length > 0) throw new Error(`${name}: ${warnings.join('\n')}`);
    bundles[key] = out;
  }
  return bundles;
}
