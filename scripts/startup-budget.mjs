// Builds a hello app the way a user does, on the packed core, and judges its cold start.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installPackedCore, REPO, run } from './packed-core.mjs';

const MAX_MEDIAN_MS = 150;
const MAX_BYTES = 1_000_000;
const RUNS = 10;

const HELLO = `
import { Component } from '@angular/core';
import { InkBox, InkText, renderInk } from '@angular-ink/core';

@Component({
  selector: 'ink-hello',
  imports: [InkBox, InkText],
  template: '<ink-box borderStyle="round"><ink-text>hello</ink-text></ink-box>',
})
class Hello {}

const app = await renderInk(Hello);
app.unmount();
await app.waitUntilExit();
`;

export function judge({ medianMs, bytes, hasCompiler }) {
  const problems = [];
  if (medianMs > MAX_MEDIAN_MS) {
    problems.push(`median startup ${medianMs} ms is over ${MAX_MEDIAN_MS} ms`);
  }
  if (bytes > MAX_BYTES) problems.push(`bundle of ${bytes} bytes is over ${MAX_BYTES} bytes`);
  if (hasCompiler) problems.push('@angular/compiler is in the bundle');
  return { ok: problems.length === 0, problems };
}

export function median(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function timeOneRun(out) {
  const start = process.hrtime.bigint();
  const { status } = spawnSync(process.execPath, [out], { stdio: 'ignore' });
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  if (status !== 0) throw new Error(`angular-ink: the hello bundle exited with ${status}`);
  return elapsedMs;
}

async function main() {
  run('npm', ['run', '--silent', 'build:core']);
  run('npm', ['run', '--silent', 'build:cli']);
  const { buildCli } = await import(pathToFileURL(join(REPO, 'dist/cli/build.js')).href);

  mkdirSync(join(REPO, 'out-tsc'), { recursive: true });
  const fixture = mkdtempSync(join(REPO, 'out-tsc/startup-budget-'));
  try {
    installPackedCore(fixture);
    writeFileSync(join(fixture, 'main.ts'), HELLO);
    const out = join(fixture, 'hello.mjs');
    const { bytes, hasCompiler } = await buildCli({ entry: 'main.ts', out, cwd: fixture });

    const { stdout } = spawnSync(process.execPath, [out], { encoding: 'utf8' });
    if (!stdout.includes('hello')) throw new Error('angular-ink: the hello frame did not print');

    const medianMs = median(Array.from({ length: RUNS }, () => timeOneRun(out)));
    const { ok, problems } = judge({ medianMs, bytes, hasCompiler });
    const measured = `median ${medianMs.toFixed(1)} ms of ${RUNS} runs, ${bytes} bytes`;
    if (ok) {
      console.log(`OK ${measured}`);
    } else {
      console.error(`FAIL ${measured}\n${problems.join('\n')}`);
      process.exitCode = 1;
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
