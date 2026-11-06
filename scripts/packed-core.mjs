// What the scripts that build an app the way a user does have in common.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
