// Runs each scenario on Ink and on angular-ink in the same kind of pty, and compares the screens.
// Any difference that parity/README.md does not list makes the exit code 1.
//
//   ./scripts/dev node parity/run.mjs [--only name,name]
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runScenario } from '../e2e/pty-screen.mjs';
import { buildApps, REPO } from '../scripts/packed-core.mjs';
import { compareScreens, readScreen } from './compare-screens.mjs';
import { expectedDivergences, parityReport, problemsOf } from './report.mjs';
import { SCENARIOS } from './scenarios.mjs';

const QUIET_MS = 300;
const POLL_MS = 20;
const LIMIT_MS = 30_000;

const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Waits until the app has written nothing for a while: a frame can come in several chunks. */
async function settled(session) {
  let seen = session.raw().length;
  let quietSince = Date.now();
  while (Date.now() - quietSince < QUIET_MS) {
    await wait(POLL_MS);
    const now = session.raw().length;
    if (now !== seen) {
      seen = now;
      quietSince = Date.now();
    }
  }
}

async function whenGone(session, text) {
  const limit = Date.now() + LIMIT_MS;
  while (session.screen().includes(text)) {
    if (Date.now() > limit) throw new Error(`"${text}" stayed. Screen:\n${session.screen()}`);
    await wait(POLL_MS);
  }
}

async function capture(scenario, file) {
  const screens = [];
  const mark = async (label) => {
    await settled(activeSession);
    screens.push({ label, screen: readScreen(activeSession.terminal) });
  };
  let activeSession;
  const { exitCode } = await runScenario({
    file: process.execPath,
    args: [file, ...(scenario.args ?? [])],
    columns: scenario.columns,
    rows: scenario.rows,
    limitMs: LIMIT_MS,
    drive: async (session) => {
      activeSession = session;
      await scenario.drive?.({
        session,
        mark,
        gone: (text) => whenGone(session, text),
      });
      await session.waitForExit();
      screens.push({ label: 'after the end', screen: readScreen(session.terminal) });
    },
  });
  return { exitCode, screens };
}

const plainRows = ({ rows }) =>
  rows
    .map((row) =>
      row
        .map((cell) => cell.char)
        .join('')
        .trimEnd(),
    )
    .join('\n')
    .trimEnd();

/** Null when the runs match, or what differs with both screens to look at. */
function firstDifference(ink, ng) {
  for (const [index, { label, screen }] of ink.screens.entries()) {
    const other = ng.screens[index];
    const difference = compareScreens(screen, other.screen);
    if (difference !== null) {
      return {
        at: label,
        difference,
        detail: `--- Ink\n${plainRows(screen)}\n--- angular-ink\n${plainRows(other.screen)}`,
      };
    }
  }
  if (ink.exitCode !== ng.exitCode) {
    return {
      at: 'after the end',
      difference: { field: 'exit code', a: ink.exitCode, b: ng.exitCode },
      detail: '',
    };
  }
  return null;
}

function describeDifference({ at, difference }) {
  const position = difference.row === undefined ? '' : ` at ${difference.row},${difference.column}`;
  const values = `Ink ${JSON.stringify(difference.a)}, angular-ink ${JSON.stringify(difference.b)}`;
  return `${at}: ${difference.field}${position}: ${values}`;
}

async function runOne(scenario, bundles) {
  try {
    const ink = await capture(scenario, join(REPO, `parity/ink-apps/${scenario.app}.mjs`));
    const ng = await capture(scenario, bundles[scenario.app]);
    return firstDifference(ink, ng);
  } catch (error) {
    return { at: 'running', difference: { field: 'error' }, detail: String(error), failed: true };
  }
}

async function main() {
  const onlyFlag = process.argv.indexOf('--only');
  const only = onlyFlag === -1 ? null : process.argv[onlyFlag + 1].split(',');
  const scenarios = SCENARIOS.filter(({ name }) => only === null || only.includes(name));
  const expected = expectedDivergences(readFileSync(join(REPO, 'parity/README.md'), 'utf8'));

  mkdirSync(join(REPO, 'out-tsc'), { recursive: true });
  const fixture = mkdtempSync(join(REPO, 'out-tsc/parity-'));
  const results = [];
  try {
    const apps = [...new Set(SCENARIOS.map(({ app }) => app))];
    const bundles = await buildApps(
      fixture,
      Object.fromEntries(apps.map((app) => [app, join(REPO, `parity/ng-apps/${app}.ts`)])),
    );
    for (const scenario of scenarios) {
      const found = await runOne(scenario, bundles);
      const reason = expected.get(scenario.name);
      results.push({
        name: scenario.name,
        difference: found === null ? null : describeDifference(found),
        reason,
        failed: found?.failed === true,
      });
      if (found === null) {
        console.log(`${reason === undefined ? 'SAME' : 'STALE'} ${scenario.name}`);
      } else {
        const known = reason !== undefined && found.failed !== true;
        console.log(`${known ? 'KNOWN' : 'DIFF'} ${scenario.name}`);
        console.log(`  ${describeDifference(found)}`);
        if (!known) console.log(found.detail);
      }
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }

  const report = parityReport(results);
  if (only === null) writeFileSync(join(REPO, 'docs/parity.md'), report.text);
  console.log(report.summary);
  const problems = problemsOf(
    results,
    expected,
    SCENARIOS.map(({ name }) => name),
  );
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exitCode = 1;
}

await main();
