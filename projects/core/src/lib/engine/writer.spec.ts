import xterm from '@xterm/headless';
import { describe, expect, it } from 'vitest';
import { PLAIN_STYLE, type CellStyle } from './ansi';
import { namedColor } from './color';
import type { ColorLevel } from './color-level';
import { createGrid, internStyle, writeSpan, type CellGrid } from './grid';
import { eraseFrame, writeFrame } from './writer';

const { Terminal } = xterm;

interface Screen {
  write(bytes: string): Promise<void>;
  resize(columns: number, rows: number): void;
  /** The visible rows, trailing blanks cut. */
  viewport(): string[];
  /** The rows that scrolled off the top. */
  scrollback(): string[];
  cursor(): { x: number; y: number };
}

function openScreen(columns: number, rows: number): Screen {
  const terminal = new Terminal({ cols: columns, rows, scrollback: 100, allowProposedApi: true });
  const lines = (from: number, to: number): string[] => {
    const out: string[] = [];
    for (let y = from; y < to; y++) {
      out.push(terminal.buffer.active.getLine(y)?.translateToString(true) ?? '');
    }
    return out;
  };
  return {
    write: (bytes) =>
      new Promise((resolve) => {
        terminal.write(bytes, resolve);
      }),
    resize: (nextColumns, nextRows) => {
      terminal.resize(nextColumns, nextRows);
    },
    viewport: () =>
      lines(terminal.buffer.active.baseY, terminal.buffer.active.baseY + terminal.rows),
    scrollback: () => lines(0, terminal.buffer.active.baseY),
    cursor: () => ({ x: terminal.buffer.active.cursorX, y: terminal.buffer.active.cursorY }),
  };
}

async function screenOf(bytes: string, columns: number, rows: number): Promise<string[]> {
  const screen = openScreen(columns, rows);
  await screen.write(bytes);
  return screen.viewport();
}

const RED: CellStyle = internStyle({ ...PLAIN_STYLE, fg: namedColor(31) });
const BOLD: CellStyle = internStyle({ ...PLAIN_STYLE, bold: true });
const hasSgr = (bytes: string): boolean =>
  bytes
    .split('\x1b[')
    .slice(1)
    .some((part) => /^[0-9;]*m/.test(part));

function gridOf(lines: readonly string[], columns: number, style: CellStyle = PLAIN_STYLE) {
  const grid = createGrid(columns, lines.length);
  const clip = { x0: 0, y0: 0, x1: columns, y1: lines.length };
  lines.forEach((text, y) => {
    writeSpan(grid, 0, y, { text, style }, clip);
  });
  return grid;
}

const options = (overrides: Partial<Parameters<typeof writeFrame>[2]> = {}) => ({
  terminalRows: 10,
  level: 3 as ColorLevel,
  synchronized: false,
  ...overrides,
});

const frame = (previous: CellGrid | null, next: CellGrid, overrides = {}): string =>
  writeFrame(previous, next, options(overrides));

describe('writeFrame without a change', () => {
  it('writes nothing for an identical frame', () => {
    const grid = gridOf(['abc', 'def'], 5);
    expect(frame(grid, gridOf(['abc', 'def'], 5))).toBe('');
  });

  it('writes nothing for an identical frame that fills the screen', () => {
    const grid = gridOf(['a', 'b', 'c'], 3);
    expect(frame(grid, gridOf(['a', 'b', 'c'], 3), { terminalRows: 3 })).toBe('');
  });
});

describe('writeFrame', () => {
  it('draws the first frame and rests on column 0 of the next row', async () => {
    const screen = openScreen(10, 6);
    await screen.write(frame(null, gridOf(['one', '', 'three'], 10)));
    expect(screen.viewport()).toEqual(['one', '', 'three', '', '', '']);
    expect(screen.cursor()).toEqual({ x: 0, y: 3 });
  });

  it('changes one cell with only that cell and the moves', async () => {
    const before = gridOf(['aaaa', 'bbbb', 'cccc'], 6);
    const after = gridOf(['aaaa', 'bXbb', 'cccc'], 6);
    const first = frame(null, before);
    const bytes = frame(before, after);
    expect(bytes.length).toBeLessThan(40);
    const screen = openScreen(6, 8);
    await screen.write(first + bytes);
    expect(screen.viewport()).toEqual(['aaaa', 'bXbb', 'cccc', '', '', '', '', '']);
    expect(screen.cursor()).toEqual({ x: 0, y: 3 });
  });

  it('erases the rows left over when the frame gets shorter', async () => {
    const tall = gridOf(['one', 'two', 'three', 'four'], 8);
    const short = gridOf(['one', 'two'], 8);
    const screen = openScreen(8, 8);
    await screen.write(frame(null, tall) + frame(tall, short));
    expect(screen.viewport()).toEqual(['one', 'two', '', '', '', '', '', '']);
    expect(screen.cursor()).toEqual({ x: 0, y: 2 });
  });

  it('grows without touching what is above the frame', async () => {
    const small = gridOf(['one'], 8);
    const big = gridOf(['one', 'two', 'three'], 8);
    const screen = openScreen(8, 8);
    await screen.write('above\r\n' + frame(null, small) + frame(small, big));
    expect(screen.viewport()).toEqual(['above', 'one', 'two', 'three', '', '', '', '']);
    expect(screen.cursor()).toEqual({ x: 0, y: 4 });
  });

  it('grows at the bottom of the screen by scrolling', async () => {
    const small = gridOf(['one'], 8);
    const big = gridOf(['one', 'two', 'three'], 8);
    const screen = openScreen(8, 4);
    await screen.write('a\r\nb\r\nc\r\n' + frame(null, small) + frame(small, big));
    expect(screen.viewport()).toEqual(['one', 'two', 'three', '']);
    expect(screen.scrollback()).toEqual(['a', 'b', 'c']);
    expect(screen.cursor()).toEqual({ x: 0, y: 3 });
  });

  it('rewrites both halves of a wide character that changes', async () => {
    const before = gridOf(['a日b'], 6);
    const after = gridOf(['abcd'], 6);
    const back = gridOf(['x日y'], 6);
    const screen = openScreen(6, 4);
    await screen.write(frame(null, before) + frame(before, after));
    expect(screen.viewport()[0]).toBe('abcd');
    await screen.write(frame(after, back));
    expect(screen.viewport()[0]).toBe('x日y');
  });

  it('redraws the frame when the width changed', async () => {
    const narrow = gridOf(['abc', 'def'], 4);
    const wide = gridOf(['abc', 'def', 'ghi'], 8);
    const screen = openScreen(8, 8);
    await screen.write(frame(null, narrow) + frame(narrow, wide));
    expect(screen.viewport()).toEqual(['abc', 'def', 'ghi', '', '', '', '', '']);
  });
});

describe('writeFrame when a row gets shorter', () => {
  const ERASE_LINE_END = '\x1b[K';
  const visible = (screen: Screen): string[] => {
    const rows = screen.viewport();
    while (rows.at(-1) === '') rows.pop();
    return rows;
  };

  it('erases the end of the row and writes no blanks, which a terminal would keep', async () => {
    const screen = openScreen(10, 5);
    const long = gridOf(['abcdefgh'], 10);
    const short = gridOf(['abc'], 10);
    await screen.write(frame(null, long));
    const bytes = frame(long, short);
    expect(bytes).toContain(ERASE_LINE_END);
    expect(bytes).not.toMatch(/ {2}/);
    await screen.write(bytes);
    expect(visible(screen)).toEqual(['abc']);
    // Only cells with content reflow: at 2 columns this row takes 2 rows, not 4.
    screen.resize(2, 5);
    expect(visible(screen)).toEqual(['ab', 'c']);
  });

  it('draws the cells before the blanks in the same run', async () => {
    const screen = openScreen(10, 5);
    const long = gridOf(['abcdefgh'], 10);
    const short = gridOf(['abX'], 10);
    await screen.write(frame(null, long));
    await screen.write(frame(long, short));
    expect(visible(screen)).toEqual(['abX']);
  });

  it('empties a whole row', async () => {
    const screen = openScreen(10, 5);
    const long = gridOf(['abc', 'def'], 10);
    const short = gridOf(['', 'def'], 10);
    await screen.write(frame(null, long));
    await screen.write(frame(long, short));
    expect(visible(screen)).toEqual(['', 'def']);
    expect(screen.cursor()).toEqual({ x: 0, y: 2 });
  });

  it('keeps blanks in the middle of a row', async () => {
    const screen = openScreen(10, 5);
    const long = gridOf(['abcdef'], 10);
    const gap = gridOf(['ab  ef'], 10);
    await screen.write(frame(null, long));
    const bytes = frame(long, gap);
    expect(bytes).not.toContain(ERASE_LINE_END);
    await screen.write(bytes);
    expect(visible(screen)).toEqual(['ab  ef']);
  });

  it('does not erase with an open background', async () => {
    const screen = openScreen(10, 5);
    const long = gridOf(['abcdef'], 10);
    const short = gridOf(['ab'], 10, RED);
    await screen.write(frame(null, long));
    const bytes = frame(long, short);
    expect(bytes.indexOf('\x1b[0m')).toBeLessThan(bytes.indexOf(ERASE_LINE_END));
    await screen.write(bytes);
    expect(visible(screen)).toEqual(['ab']);
  });

  it('keeps a styled blank, which shows', () => {
    const background = internStyle({ ...PLAIN_STYLE, bg: namedColor(41) });
    const long = gridOf(['abc'], 10);
    const styled = gridOf(['   '], 10, background);
    expect(frame(long, styled)).not.toContain(ERASE_LINE_END);
  });

  it('keeps cells to the right that did not change', async () => {
    const screen = openScreen(10, 5);
    const before = gridOf(['abc   xyz'], 10);
    const after = gridOf(['a     xyz'], 10);
    await screen.write(frame(null, before));
    const bytes = frame(before, after);
    expect(bytes).not.toContain(ERASE_LINE_END);
    await screen.write(bytes);
    expect(visible(screen)).toEqual(['a     xyz']);
  });
});

describe('writeFrame when the frame does not fit the screen', () => {
  const rows = 5;
  const history = Array.from({ length: 7 }, (_, index) => `h${String(index + 1)}`);
  const lines = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1)}`);

  it('homes the cursor and erases down, never the whole screen or scrollback', () => {
    const before = gridOf(lines('a', 3), 6);
    const after = gridOf(lines('b', 8), 6);
    const bytes = frame(before, after, { terminalRows: rows });
    expect(bytes.startsWith('\x1b[1;1H\x1b[J')).toBe(true);
    expect(bytes).not.toContain('\x1b[2J');
    expect(bytes).not.toContain('\x1b[3J');
  });

  it('keeps the scrollback and leaves the last rows on the screen', async () => {
    const before = gridOf(lines('a', 3), 6);
    const after = gridOf(lines('b', 8), 6);
    const screen = openScreen(6, rows);
    await screen.write(history.join('\r\n') + '\r\n');
    const scrolledBefore = screen.scrollback();
    expect(scrolledBefore).toContain('h1');
    await screen.write(frame(null, before, { terminalRows: rows }));
    await screen.write(frame(before, after, { terminalRows: rows }));
    expect(screen.scrollback()).toEqual(expect.arrayContaining(scrolledBefore));
    expect(screen.viewport()).toEqual(['b5', 'b6', 'b7', 'b8', '']);
  });

  it('leaves no ghost lines when the next frame is also taller', async () => {
    const first = gridOf(lines('a', 8), 6);
    const second = gridOf(lines('b', 7), 6);
    const screen = openScreen(6, rows);
    await screen.write(frame(null, first, { terminalRows: rows }));
    await screen.write(frame(first, second, { terminalRows: rows }));
    expect(screen.viewport()).toEqual(['b4', 'b5', 'b6', 'b7', '']);
  });

  it('redraws cleanly after the terminal shrinks under a frame', async () => {
    const before = gridOf(lines('a', 6), 6);
    const after = gridOf(lines('b', 6), 6);
    const screen = openScreen(6, 10);
    await screen.write('top\r\n' + frame(null, before));
    screen.resize(6, rows);
    await screen.write(frame(before, after, { terminalRows: rows }));
    expect(screen.viewport()).toEqual(['b3', 'b4', 'b5', 'b6', '']);
    expect(screen.scrollback()).toContain('top');
  });

  it('comes back to a short frame without ghosts', async () => {
    const tall = gridOf(lines('a', 8), 6);
    const short = gridOf(lines('b', 2), 6);
    const screen = openScreen(6, rows);
    await screen.write(frame(null, tall, { terminalRows: rows }));
    await screen.write(frame(tall, short, { terminalRows: rows }));
    expect(screen.viewport()).toEqual(['b1', 'b2', '', '', '']);
    expect(screen.cursor()).toEqual({ x: 0, y: 2 });
  });
});

describe('writeFrame synchronized output', () => {
  it('wraps the output in the synchronized update markers', () => {
    const bytes = frame(null, gridOf(['hi'], 4), { synchronized: true });
    expect(bytes.startsWith('\x1b[?2026h')).toBe(true);
    expect(bytes.endsWith('\x1b[?2026l')).toBe(true);
    expect(bytes.slice('\x1b[?2026h'.length, -'\x1b[?2026l'.length)).toBe(
      frame(null, gridOf(['hi'], 4)),
    );
  });

  it('writes nothing for an empty change', () => {
    const grid = gridOf(['hi'], 4);
    expect(frame(grid, gridOf(['hi'], 4), { synchronized: true })).toBe('');
  });
});

describe('writeFrame colors', () => {
  it('opens a style once for a run of equal cells', () => {
    const bytes = frame(null, gridOf(['x'.repeat(80)], 80, RED));
    expect(bytes.split('\x1b[31m')).toHaveLength(2);
  });

  it('changes the style only where it changes and resets before the end', async () => {
    const grid = createGrid(6, 1);
    const clip = { x0: 0, y0: 0, x1: 6, y1: 1 };
    writeSpan(grid, 0, 0, { text: 'ab', style: PLAIN_STYLE }, clip);
    writeSpan(grid, 2, 0, { text: 'cd', style: BOLD }, clip);
    writeSpan(grid, 4, 0, { text: 'ef', style: RED }, clip);
    const bytes = frame(null, grid);
    expect(bytes).toContain('ab\x1b[1mcd\x1b[0m\x1b[31mef');
    expect(bytes.endsWith('\x1b[0m\n\r')).toBe(true);
    expect(await screenOf(bytes, 6, 3)).toEqual(['abcdef', '', '']);
  });

  it('emits no color at level 0 but keeps other attributes', () => {
    const bytes = frame(null, gridOf(['red'], 4, RED), { level: 0 });
    expect(hasSgr(bytes)).toBe(false);
    expect(frame(null, gridOf(['b'], 4, BOLD), { level: 0 })).toContain('\x1b[1m');
  });

  it('degrades colors to the level of the terminal', () => {
    const rgb = internStyle({ ...PLAIN_STYLE, fg: { kind: 'rgb', r: 255, g: 0, b: 0 } });
    const grid = gridOf(['r'], 2, rgb);
    expect(frame(null, grid, { level: 3 })).toContain('\x1b[38;2;255;0;0m');
    expect(frame(null, grid, { level: 2 })).toContain('\x1b[38;5;196m');
    expect(frame(null, grid, { level: 1 })).toContain('\x1b[91m');
  });
});

describe('eraseFrame', () => {
  it('erases the frame and rests where it started', async () => {
    const grid = gridOf(['one', 'two', 'three'], 8);
    const screen = openScreen(8, 6);
    await screen.write('above\r\n' + frame(null, grid) + eraseFrame(3));
    expect(screen.viewport()).toEqual(['above', '', '', '', '', '']);
    expect(screen.cursor()).toEqual({ x: 0, y: 1 });
  });

  it('writes nothing for an empty frame', () => {
    expect(eraseFrame(0)).toBe('');
  });
});
