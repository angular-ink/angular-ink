// Builds the demo apps the way a user does, on the packed core, and runs them in real ptys.
//
//   ./scripts/dev node scripts/e2e.mjs [--update]
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runScenario } from '../e2e/pty-screen.mjs';
import { createScenarios } from '../e2e/scenarios.mjs';
import { buildApps, REPO } from './packed-core.mjs';

const EXPECTED = join(REPO, 'e2e/expected');
const demoApp = (name) => join(REPO, `projects/demo/src/${name}.ts`);
const APPS = {
  deploy: demoApp('deploy'),
  newProject: demoApp('new-project'),
  status: demoApp('status'),
};

function compareWithExpected(name, screen, update) {
  const path = join(EXPECTED, `${name}.txt`);
  if (update) {
    writeFileSync(path, `${screen}\n`);
    return;
  }
  let expected;
  try {
    expected = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`no e2e/expected/${name}.txt: run with --update and check the file by hand`);
  }
  if (expected !== `${screen}\n`) {
    throw new Error(`the screen differs from e2e/expected/${name}.txt. Screen:\n${screen}`);
  }
}

async function main() {
  const update = process.argv.includes('--update');
  mkdirSync(join(REPO, 'out-tsc'), { recursive: true });
  const fixture = mkdtempSync(join(REPO, 'out-tsc/e2e-'));
  let failures = 0;
  try {
    const bundles = await buildApps(fixture, APPS);
    for (const scenario of createScenarios(bundles, fixture)) {
      try {
        const result = await runScenario(scenario);
        scenario.check?.(result);
        if (scenario.expected) compareWithExpected(scenario.name, result.screen, update);
        console.log(`PASS ${scenario.name}`);
      } catch (error) {
        failures += 1;
        console.error(`FAIL ${scenario.name}\n${error instanceof Error ? error.message : error}`);
      }
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
  if (failures > 0) {
    console.error(`${String(failures)} scenario(s) failed`);
    process.exitCode = 1;
  }
}

await main();
