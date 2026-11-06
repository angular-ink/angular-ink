// Checks the files `npm pack` would publish from dist/core, dist/testing and dist/cli: a LICENSE,
// a README and the package's own entry files, and no specs, benches or test helpers. Runs in CI
// after the build. Usage: node scripts/check-pack.mjs [package directory...], default all three.
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_FILE = /(?:^|\/)(?:testing\/|[^/]*\.(?:spec|bench)\.)/;
const COMMON = ['LICENSE', 'README.md'];

/** The files each package must ship, by the name of its folder in dist/. */
export const PACKAGES = {
  core: [...COMMON, 'fesm2022/angular-ink-core.mjs', 'types/angular-ink-core.d.ts'],
  testing: [...COMMON, 'fesm2022/angular-ink-testing.mjs', 'types/angular-ink-testing.d.ts'],
  cli: [...COMMON, 'cli.js', 'build.js'],
};

export function checkPackFiles(name, paths) {
  const required = PACKAGES[name];
  if (required === undefined) return [`no file list for the package "${name}"`];
  const problems = paths
    .filter((path) => TEST_FILE.test(path))
    .map((path) => `test file in the package: ${path}`);
  for (const path of required) {
    if (!paths.includes(path)) problems.push(`${path} is missing`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directories = process.argv.slice(2);
  if (directories.length === 0) directories.push('dist/core', 'dist/testing', 'dist/cli');
  let failed = false;
  for (const directory of directories) {
    const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: directory,
      encoding: 'utf8',
    });
    const paths = JSON.parse(output)[0].files.map((file) => file.path);
    const problems = checkPackFiles(basename(directory), paths);
    for (const problem of problems) console.error(`${directory}: ${problem}`);
    if (problems.length > 0) failed = true;
    else
      console.log(`${directory}: ${String(paths.length)} files, LICENSE and README, no test files`);
  }
  if (failed) process.exit(1);
}
