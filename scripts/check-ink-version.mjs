// Compares the `ink` pinned in package.json (the version the inventory and the parity harness are
// for) with the latest on npm. A newer version prints the title and body of an issue to open, as
// JSON, and the weekly workflow opens it. Prints nothing when there is nothing to do.
// Usage: node scripts/check-ink-version.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXACT = /^\d+\.\d+\.\d+$/;

export function inventoriedInkVersion(packageJson) {
  const version = packageJson.devDependencies?.ink;
  if (typeof version !== 'string' || !EXACT.test(version)) {
    throw new Error(`check-ink-version: ink must be pinned to one version, found "${version}"`);
  }
  return version;
}

const numbers = (version) => version.split('.').map(Number);

/** True when `latest` is a release above `inventoried`. A prerelease never counts. */
function isNewer(latest, inventoried) {
  if (!EXACT.test(latest)) return false;
  const [a, b] = [numbers(latest), numbers(inventoried)];
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return false;
}

/** The issue to open, or null when npm has nothing newer than the inventoried version. */
export function inkIssue(inventoried, latest) {
  if (!isNewer(latest, inventoried)) return null;
  return {
    title: `Ink ${latest} is out: add its changes to the inventory and the parity harness`,
    body: [
      `npm has \`ink\` ${latest}. The inventory, \`docs/parity.md\` and the parity harness are for ${inventoried}.`,
      '',
      `Changelog: https://github.com/vadimdemedes/ink/releases/tag/v${latest}`,
      '',
      'Add inventory rows and parity scenarios for what changed before any code, then move the `ink` devDependency.',
    ].join('\n'),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inventoried = inventoriedInkVersion(JSON.parse(readFileSync('package.json', 'utf8')));
  const latest = execFileSync('npm', ['view', 'ink', 'version'], { encoding: 'utf8' }).trim();
  const issue = inkIssue(inventoried, latest);
  if (issue) console.log(JSON.stringify(issue));
  else console.error(`ink ${latest} on npm, inventory is for ${inventoried}`);
}
