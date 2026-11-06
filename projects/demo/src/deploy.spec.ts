import { cleanup, renderForTest, type InkTestInstance } from '@angular-ink/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Deploy, DEPLOY_STEPS } from './deploy';

const SPINNER = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u;

const frameOf = (test: InkTestInstance): string => test.lastFrame() ?? '';

afterEach(() => {
  cleanup();
});

describe('deploy', () => {
  it('lists the environments and marks the first', async () => {
    const test = await renderForTest(Deploy);
    expect(frameOf(test)).toContain('Deploy to which environment?');
    expect(frameOf(test)).toContain('> staging');
    expect(frameOf(test)).toContain('  prod');
  });

  it('shows the spinner for staging on Enter', async () => {
    const test = await renderForTest(Deploy, { inputs: { stepMs: 60_000 } });
    await test.stdin.press('enter');
    expect(frameOf(test)).toMatch(SPINNER);
    expect(frameOf(test)).toContain('Deploying to staging');
    expect(frameOf(test)).not.toContain('Deploy to which environment?');
  });

  it('shows the spinner for prod on down and Enter', async () => {
    const test = await renderForTest(Deploy, { inputs: { stepMs: 60_000 } });
    await test.stdin.press('down', 'enter');
    expect(frameOf(test)).toMatch(SPINNER);
    expect(frameOf(test)).toContain('Deploying to prod');
  });

  it('stays on the list when the arrows go past its ends', async () => {
    const test = await renderForTest(Deploy);
    await test.stdin.press('up');
    expect(frameOf(test)).toContain('> staging');
    await test.stdin.press('down', 'down');
    expect(frameOf(test)).toContain('> prod');
  });

  it('turns the spinner frame as time passes', async () => {
    const test = await renderForTest(Deploy, { inputs: { stepMs: 60_000 } });
    await test.stdin.press('enter');
    const first = SPINNER.exec(frameOf(test))?.[0];
    await vi.waitFor(() => {
      expect(SPINNER.exec(frameOf(test))?.[0]).not.toBe(first);
    });
  });

  it('writes each finished step once, above the live area, and ends', async () => {
    const test = await renderForTest(Deploy, { inputs: { stepMs: 1 } });
    await test.stdin.press('down', 'enter');
    await test.waitUntilExit();

    const lines = frameOf(test).split('\n');
    const finished = DEPLOY_STEPS.map((step) => `✔ ${step}`);
    expect(lines.filter((line) => finished.includes(line))).toEqual(finished);
    expect(lines.indexOf(finished.at(-1) ?? '')).toBeLessThan(lines.indexOf('Deployed to prod'));
    expect(frameOf(test)).not.toMatch(SPINNER);
  });

  it('ends on the ErrorOverview and rejects with --fail', async () => {
    const test = await renderForTest(Deploy, { inputs: { stepMs: 1, fail: true } });
    await test.stdin.press('enter');
    await expect(test.waitUntilExit()).rejects.toThrow('Run migrations failed on staging');
    expect(frameOf(test)).toContain('ERROR');
    expect(frameOf(test)).toContain('Run migrations failed on staging');
    expect(frameOf(test)).toContain('✔ Build image');
  });
});
