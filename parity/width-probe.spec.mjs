import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openScreen } from '../e2e/pty-screen.mjs';

const PROBE = join(fileURLToPath(new URL('.', import.meta.url)), 'width-probe.mjs');

async function runProbe({ answers }) {
  const session = openScreen({ file: process.execPath, args: [PROBE], columns: 60, rows: 12 });
  try {
    // A real terminal answers by itself. This one only does when its answers go back to the pty.
    if (answers) {
      session.terminal.onData((data) => {
        session.sendKeys(data);
      });
    }
    const { exitCode } = await session.waitForExit();
    return { exitCode, screen: session.screen() };
  } finally {
    session.stop();
  }
}

describe('width-probe', () => {
  it('measures each case in the terminal and compares it with string-width', async () => {
    const { exitCode, screen } = await runProbe({ answers: true });
    expect(exitCode).toBe(0);
    expect(screen).toMatch(/^ascii +string-width 1 +terminal 1 +ok$/m);
    expect(screen).toMatch(/^CJK +string-width 4 +terminal 4 +ok$/m);
    for (const name of ['combining mark', 'emoji', 'ZWJ sequence', 'flag', 'VS16']) {
      expect(screen).toMatch(
        new RegExp(`^${name} +string-width \\d +terminal \\d+ +(ok|DIFFERS)$`, 'm'),
      );
    }
  }, 20_000);

  it('says so when a terminal does not answer, and ends', async () => {
    const { exitCode, screen } = await runProbe({ answers: false });
    expect(exitCode).toBe(0);
    expect(screen).toMatch(/^ascii +string-width 1 +terminal - +NO ANSWER$/m);
  }, 20_000);
});
