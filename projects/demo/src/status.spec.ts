import { cleanup, renderForTest } from '@angular-ink/testing';
import stringWidth from 'string-width';
import { afterEach, describe, expect, it } from 'vitest';
import { Status, type Service } from './status';

const CJK: readonly Service[] = [
  { name: 'search', region: 'eu-west', state: 'ok', latencyMs: 12 },
  { name: '決済サービス', region: '東京', state: 'degraded', latencyMs: 340 },
  { name: '👨‍👩‍👧 family plan', region: 'eu-west', state: 'ok', latencyMs: 7 },
  {
    name: 'カタログ検索エンジンの長い名前のサービス',
    region: 'us-east',
    state: 'down',
    latencyMs: 0,
  },
];

/** The display column of each separator of a table line. */
function separatorColumns(line: string): number[] {
  const columns: number[] = [];
  let column = 0;
  for (const { segment } of new Intl.Segmenter().segment(line)) {
    if (segment === '│') columns.push(column);
    column += stringWidth(segment);
  }
  return columns;
}

const tableLines = (frame: string | undefined): string[] =>
  (frame ?? '').split('\n').filter((line) => line.startsWith('│'));

afterEach(() => {
  cleanup();
});

describe('status', () => {
  it('draws a bordered table as wide as the terminal', async () => {
    const test = await renderForTest(Status, { columns: 80 });
    const lines = (test.lastFrame() ?? '').split('\n');
    expect(lines[0]?.startsWith('╭')).toBe(true);
    expect(stringWidth(lines[0] ?? '')).toBe(80);
    expect(test.lastFrame()).toContain('Service');
    expect(test.lastFrame()).toContain('Region');
    expect(test.lastFrame()).toContain('Latency');
  });

  it('colors the state of a service', async () => {
    const test = await renderForTest(Status, {
      columns: 80,
      inputs: { services: [{ name: 'api', region: 'eu', state: 'down', latencyMs: 0 }] },
    });
    expect(test.lastFrame({ ansi: true })).toContain('\x1b[31mdown');
  });

  it('redraws the table for 40 columns and never passes them', async () => {
    const test = await renderForTest(Status, { columns: 80, rows: 24 });
    expect(test.lastFrame()).toContain('Region');

    await test.resize(40, 24);

    const lines = (test.lastFrame() ?? '').split('\n');
    expect(test.lastFrame()).not.toContain('Region');
    expect(stringWidth(lines[0] ?? '')).toBe(40);
    for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(40);
  });

  it.each([80, 40])('keeps the columns aligned with CJK cells at %i columns', async (columns) => {
    const test = await renderForTest(Status, { columns, inputs: { services: CJK } });
    const lines = tableLines(test.lastFrame());
    expect(lines.length).toBeGreaterThanOrEqual(4);
    const expected = separatorColumns(lines[0] ?? '');
    expect(expected.length).toBeGreaterThan(2);
    for (const line of lines) {
      expect(separatorColumns(line)).toEqual(expected);
      expect(stringWidth(line)).toBe(columns);
    }
  });

  it('drops control sequences from the data', async () => {
    const test = await renderForTest(Status, {
      inputs: {
        services: [
          { name: 'a\x1b[2Jb\x1b]52;c;ZXZpbA==\x07c', region: 'eu', state: 'ok', latencyMs: 1 },
        ],
      },
    });
    expect(test.lastFrame()).toContain('abc');
    expect(test.lastFrame({ ansi: true })).not.toContain('\x1b[2J');
    expect(test.lastFrame({ ansi: true })).not.toContain('\x1b]52');
  });

  it('shows its size and quits on q on a terminal', async () => {
    const test = await renderForTest(Status, { columns: 80, rows: 24, isTty: true });
    expect(test.lastFrame()).toContain('80x24 · q to quit');
    await test.resize(50, 20);
    expect(test.lastFrame()).toContain('50x20 · q to quit');
    await test.stdin.write('q');
    await expect(test.waitUntilExit()).resolves.toBeUndefined();
  });

  it('waits for no key where none can come', async () => {
    const test = await renderForTest(Status, { isTty: false });
    expect(test.stdin.isRaw).toBe(false);
    expect(test.lastFrame()).not.toContain('q to quit');
  });
});
