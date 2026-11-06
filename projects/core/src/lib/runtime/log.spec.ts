import xterm from '@xterm/headless';
import { describe, expect, it } from 'vitest';
import { PLAIN_STYLE } from '../engine/ansi';
import { namedColor } from '../engine/color';
import { createGrid, internStyle, writeSpan, type CellGrid, type Clip } from '../engine/grid';
import type { LayoutBox } from '../engine/layout';
import { createNode } from '../tree/node';
import { FrameLog, frameText, takeStaticOutput } from './log';

const { Terminal } = xterm;

const EVERYWHERE: Clip = { x0: 0, y0: 0, x1: 1000, y1: 1000 };

function grid(columns: number, ...rows: string[]): CellGrid {
  const out = createGrid(columns, rows.length);
  rows.forEach((text, y) => {
    writeSpan(out, 0, y, { text, style: PLAIN_STYLE }, EVERYWHERE);
  });
  return out;
}

function openScreen(columns: number, rows: number) {
  const terminal = new Terminal({ cols: columns, rows, scrollback: 100, allowProposedApi: true });
  return {
    terminal,
    write: (bytes: string) =>
      new Promise<void>((resolve) => {
        terminal.write(bytes, resolve);
      }),
    viewport: () => {
      const out: string[] = [];
      const { baseY } = terminal.buffer.active;
      for (let y = baseY; y < baseY + terminal.rows; y++) {
        out.push(terminal.buffer.active.getLine(y)?.translateToString(true) ?? '');
      }
      while (out.at(-1) === '') out.pop();
      return out;
    },
  };
}

const newLog = (terminalRows = 24, synchronized = false): FrameLog =>
  new FrameLog({ level: 0, synchronized, terminalRows: () => terminalRows });

describe('FrameLog', () => {
  it('writes only what changed against the grid it kept', async () => {
    const log = newLog();
    const screen = openScreen(10, 5);
    await screen.write(log.frame(grid(10, 'abc', 'def')));
    expect(screen.viewport()).toEqual(['abc', 'def']);
    const bytes = log.frame(grid(10, 'abc', 'dXf'));
    expect(bytes).not.toContain('abc');
    await screen.write(bytes);
    expect(screen.viewport()).toEqual(['abc', 'dXf']);
    expect(log.frame(grid(10, 'abc', 'dXf'))).toBe('');
  });

  it('erases the frame for outside text and draws it again below', async () => {
    const log = newLog();
    const screen = openScreen(10, 5);
    await screen.write(log.frame(grid(10, 'abc', 'def')));
    await screen.write(log.beginText() + 'hello\n' + log.endText());
    expect(screen.viewport()).toEqual(['hello', 'abc', 'def']);
    await screen.write(log.frame(grid(10, 'abc', 'dXf')));
    expect(screen.viewport()).toEqual(['hello', 'abc', 'dXf']);
  });

  it('has nothing to erase or draw around text before the first frame', () => {
    const log = newLog();
    expect(log.beginText() + log.endText()).toBe('');
  });

  it('wraps text in one synchronized update when it may', () => {
    const log = newLog(24, true);
    log.frame(grid(10, 'abc'));
    expect(log.beginText().startsWith('\x1b[?2026h')).toBe(true);
    expect(log.endText().endsWith('\x1b[?2026l')).toBe(true);
  });

  it('clear erases the frame, and the next frame draws even if unchanged', async () => {
    const log = newLog();
    const screen = openScreen(10, 5);
    await screen.write('kept\r\n');
    await screen.write(log.frame(grid(10, 'abc')));
    await screen.write(log.clear());
    expect(screen.viewport()).toEqual(['kept']);
    expect(log.height).toBe(0);
    await screen.write(log.frame(grid(10, 'abc')));
    expect(screen.viewport()).toEqual(['kept', 'abc']);
  });

  it('clear with nothing on screen writes nothing', () => {
    const log = newLog();
    expect(log.clear()).toBe('');
    log.frame(grid(10, 'abc'));
    log.clear();
    expect(log.clear()).toBe('');
  });

  it('knows when a grid is what clear took away', () => {
    const log = newLog();
    log.frame(grid(10, 'abc'));
    expect(log.isClearedFrame(grid(10, 'abc'))).toBe(false);
    log.clear();
    expect(log.isClearedFrame(grid(10, 'abc'))).toBe(true);
    expect(log.isClearedFrame(grid(10, 'abd'))).toBe(false);
    expect(log.isClearedFrame(grid(9, 'abc'))).toBe(false);
    expect(log.isClearedFrame(grid(10, 'abc', ''))).toBe(false);
  });

  it('after a narrower resize erases every row the old frame reflowed into', async () => {
    const log = newLog();
    const screen = openScreen(20, 12);
    await screen.write('kept\r\n');
    await screen.write(log.frame(grid(20, 'aaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbb', 'c')));
    screen.terminal.resize(10, 12);
    log.invalidate(10);
    await screen.write(log.frame(grid(10, 'new')));
    expect(screen.viewport()).toEqual(['kept', 'new']);
  });

  it('counts the early wrap of a wide character that does not fit', async () => {
    const log = newLog();
    const screen = openScreen(10, 12);
    await screen.write('kept\r\n');
    await screen.write(log.frame(grid(10, '世界世界世')));
    screen.terminal.resize(3, 12);
    log.invalidate(3);
    await screen.write(log.frame(grid(3, 'new')));
    expect(screen.viewport()).toEqual(['kep', 't', 'new']);
  });

  it('leaves the redraw to the next frame when text arrives with a reflow erase pending', async () => {
    const log = newLog();
    const screen = openScreen(20, 12);
    await screen.write('kept\r\n');
    await screen.write(log.frame(grid(20, 'aaaaaaaaaaaaaaaaaaaa')));
    screen.terminal.resize(10, 12);
    log.invalidate(10);
    const before = log.beginText();
    const after = log.endText();
    expect(after).toBe('');
    await screen.write(`${before}text\r\n${after}`);
    expect(screen.viewport()).toEqual(['kept', 'text']);
    expect(log.height).toBe(0);
    await screen.write(log.frame(grid(10, 'new')));
    expect(screen.viewport()).toEqual(['kept', 'text', 'new']);
  });

  it('closes the synchronized update it opened when it skips the redraw', () => {
    const log = newLog(24, true);
    log.frame(grid(20, 'abc'));
    log.invalidate(10);
    expect(log.beginText().startsWith('\x1b[?2026h')).toBe(true);
    expect(log.endText()).toBe('\x1b[?2026l');
  });

  it('a resize with nothing on screen erases nothing', () => {
    const log = newLog();
    log.invalidate(10);
    expect(log.frame(grid(10, 'x')).includes('\x1b[J')).toBe(false);
  });

  it('wraps a redraw after a resize in one synchronized update', () => {
    const log = newLog(24, true);
    log.frame(grid(20, 'abc'));
    log.invalidate(10);
    const bytes = log.frame(grid(10, 'abc'));
    expect(bytes.startsWith('\x1b[?2026h')).toBe(true);
    expect(bytes.split('\x1b[?2026h')).toHaveLength(2);
    expect(bytes.endsWith('\x1b[?2026l')).toBe(true);
  });
});

describe('frameText', () => {
  const red = internStyle({ ...PLAIN_STYLE, fg: namedColor(31) });

  it('is plain with no color', () => {
    const out = createGrid(5, 1);
    writeSpan(out, 0, 0, { text: 'ab', style: red }, EVERYWHERE);
    expect(frameText(out, 0)).toBe('ab');
  });

  it('keeps colors the terminal supports', () => {
    const out = createGrid(5, 1);
    writeSpan(out, 0, 0, { text: 'ab', style: red }, EVERYWHERE);
    expect(frameText(out, 3)).toBe('\x1b[31mab\x1b[0m');
  });

  it('brings truecolor down to the level', () => {
    const out = createGrid(5, 1);
    const rgb = internStyle({ ...PLAIN_STYLE, fg: { kind: 'rgb', r: 255, g: 0, b: 0 } });
    writeSpan(out, 0, 0, { text: 'ab', style: rgb }, EVERYWHERE);
    expect(frameText(out, 3)).toContain('38;2;255;0;0');
    expect(frameText(out, 2)).toContain('38;5;196');
    expect(frameText(out, 1)).not.toContain('38;');
  });
});

describe('takeStaticOutput', () => {
  const box = (tag: string, fields: Partial<LayoutBox>): LayoutBox => ({
    node: createNode('element', tag),
    x: 0,
    y: 0,
    width: 3,
    height: 1,
    lines: null,
    children: [],
    ...fields,
  });
  const line = box('ink-text', { lines: ['\x1b[31ma\x1b[0m'] });
  const withLayer = (rows: number, columns = 3): LayoutBox =>
    box('ink-root', {
      staticLayer: { box: box('ink-static', { children: [line] }), columns, rows },
    });

  it('has nothing to give without a layer, or with an empty one', () => {
    expect(takeStaticOutput(box('ink-root', {}))).toBeNull();
    expect(takeStaticOutput(withLayer(0))).toBeNull();
    expect(takeStaticOutput(withLayer(1, 0))).toBeNull();
  });

  it('keeps full color by default and follows the level it is given', () => {
    expect(takeStaticOutput(withLayer(1))).toBe('\x1b[31ma\x1b[0m\n');
    expect(takeStaticOutput(withLayer(1), 0)).toBe('a\n');
  });

  it('keeps every row of the grid, blank ones too', () => {
    expect(takeStaticOutput(withLayer(3), 0)).toBe('a\n\n\n');
  });
});

describe('FrameLog with a frame as tall as the screen', () => {
  it('erases for text from its last row, where the cursor rests', async () => {
    const log = newLog(3);
    const screen = openScreen(10, 3);
    await screen.write(log.frame(grid(10, 'a', 'b', 'c')));
    await screen.write(`${log.beginText()}text\r\n${log.endText()}`);
    expect(screen.viewport()).toEqual(['a', 'b', 'c']);
    expect(screen.terminal.buffer.active.getLine(0)?.translateToString(true).trim()).toBe('text');
  });

  it('erases from its last row for clear', async () => {
    const log = newLog(3);
    const screen = openScreen(10, 5);
    await screen.write('kept\r\n');
    await screen.write(log.frame(grid(10, 'a', 'b', 'c')));
    await screen.write(log.clear());
    expect(screen.viewport()).toEqual(['kept']);
  });

  it('draws it again when the terminal lost rows, even with no change', () => {
    let rows = 4;
    const log = new FrameLog({ level: 0, synchronized: false, terminalRows: () => rows });
    const frame = grid(10, 'a', 'b', 'c');
    log.frame(frame);
    expect(log.frame(frame)).toBe('');
    rows = 3;
    expect(log.frame(frame)).toContain('\x1b[1;1H\x1b[J');
    expect(log.frame(frame)).toBe('');
  });

  it('forgets where the cursor rested once the frame is erased', async () => {
    const log = newLog(3);
    const screen = openScreen(10, 5);
    await screen.write(log.frame(grid(10, 'a', 'b', 'c')));
    await screen.write(log.clear());
    await screen.write(log.frame(grid(10)));
    await screen.write(log.frame(grid(10, 'x')));
    expect(screen.viewport()).toEqual(['x']);
  });

  it('forgets it after a resize that erases the frame too', async () => {
    const log = newLog(3);
    const screen = openScreen(10, 5);
    await screen.write(log.frame(grid(10, 'a', 'b', 'c')));
    log.invalidate(10);
    await screen.write(log.frame(grid(10)));
    await screen.write(log.frame(grid(10, 'x')));
    expect(screen.viewport()).toEqual(['x']);
  });

  it('draws it again as the last frame, and not otherwise', () => {
    const log = newLog(3);
    const frame = grid(10, 'a', 'b', 'c');
    log.frame(frame);
    expect(log.frame(frame)).toBe('');
    expect(log.frame(frame, { unmounting: true })).toContain('\x1b[1;1H\x1b[J');
  });
});
