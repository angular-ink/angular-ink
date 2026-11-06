import xterm from '@xterm/headless';
import { describe, expect, it } from 'vitest';
import { compareScreens, readScreen } from './compare-screens.mjs';

function screenOf(text, { columns = 20, rows = 4 } = {}) {
  const terminal = new xterm.Terminal({ cols: columns, rows, allowProposedApi: true });
  return new Promise((resolve) => {
    terminal.write(text, () => {
      const screen = readScreen(terminal);
      terminal.dispose();
      resolve(screen);
    });
  });
}

async function differenceOf(a, b, size) {
  return compareScreens(await screenOf(a, size), await screenOf(b, size));
}

describe('compareScreens', () => {
  it('finds no difference between two screens made by different sequences', async () => {
    // The same cells: one way moves the cursor, and the other writes the row in two styled runs.
    const moved = 'x\x1b[1;5H\x1b[31mabc\x1b[0m';
    const written = 'x   \x1b[31mab\x1b[39m\x1b[31mc\x1b[39m';
    expect(await differenceOf(moved, written)).toBeNull();
  });

  it('reports the first different character with its position', async () => {
    expect(await differenceOf('abc\r\nde', 'abc\r\ndX')).toMatchObject({
      row: 1,
      column: 1,
      field: 'char',
      a: 'e',
      b: 'X',
    });
  });

  it('reads the rows from the top, so the first difference is the upper one', async () => {
    expect(await differenceOf('aX\r\nbX', 'aY\r\nbY')).toMatchObject({ row: 0, column: 1 });
  });

  it('tells a wide character from two narrow cells', async () => {
    expect(await differenceOf('日', 'ab')).toMatchObject({ row: 0, column: 0, field: 'char' });
    expect(await differenceOf('日x', '日y')).toMatchObject({ row: 0, column: 2, field: 'char' });
  });

  it('compares the width of a cell with the same character', () => {
    const cell = { char: 'a', width: 1, fg: 'default', bg: 'default', attributes: '' };
    const wide = { ...cell, width: 2 };
    const screen = (only) => ({ columns: 1, rows: [[only]], cursor: null });
    expect(compareScreens(screen(cell), screen(wide))).toMatchObject({
      row: 0,
      column: 0,
      field: 'width',
      a: 1,
      b: 2,
    });
  });

  it.each([
    ['a named and a palette color', '\x1b[31ma', '\x1b[38;5;9ma'],
    ['two palette colors', '\x1b[38;5;1ma', '\x1b[38;5;2ma'],
    ['two true colors', '\x1b[38;2;1;2;3ma', '\x1b[38;2;1;2;4ma'],
    ['a palette and a true color of the same number', '\x1b[38;5;1ma', '\x1b[38;2;0;0;1ma'],
    ['a color and none', '\x1b[31ma', 'a'],
  ])('tells the foreground of %s', async (_name, a, b) => {
    expect(await differenceOf(a, b)).toMatchObject({ row: 0, column: 0, field: 'fg' });
  });

  it.each([
    ['two palette colors', '\x1b[41ma', '\x1b[42ma'],
    ['two true colors', '\x1b[48;2;1;2;3ma', '\x1b[48;2;9;2;3ma'],
    ['a color and none', '\x1b[41ma', 'a'],
  ])('tells the background of %s', async (_name, a, b) => {
    expect(await differenceOf(a, b)).toMatchObject({ row: 0, column: 0, field: 'bg' });
  });

  it('sees a background on an empty cell', async () => {
    expect(await differenceOf('\x1b[41m \x1b[0m', ' ')).toMatchObject({
      row: 0,
      column: 0,
      field: 'bg',
    });
  });

  it.each([
    ['bold', '\x1b[1m'],
    ['dim', '\x1b[2m'],
    ['italic', '\x1b[3m'],
    ['underline', '\x1b[4m'],
    ['blink', '\x1b[5m'],
    ['inverse', '\x1b[7m'],
    ['invisible', '\x1b[8m'],
    ['strikethrough', '\x1b[9m'],
    ['overline', '\x1b[53m'],
  ])('tells %s from a plain cell', async (name, sequence) => {
    expect(await differenceOf(`${sequence}a`, 'a')).toMatchObject({
      row: 0,
      column: 0,
      field: 'attributes',
      a: name,
      b: '',
    });
  });

  it('reads the scrollback too, where an overflowing frame leaves its rows', async () => {
    const lines = (...rows) => rows.join('\r\n');
    const size = { columns: 5, rows: 2 };
    expect(await differenceOf(lines('a', 'b', 'c'), lines('X', 'b', 'c'), size)).toMatchObject({
      row: 0,
      column: 0,
      field: 'char',
    });
  });

  it('reports a screen with more rows in its history', async () => {
    const size = { columns: 5, rows: 2 };
    expect(await differenceOf('a\r\nb\r\nc', 'a', size)).toMatchObject({ field: 'rows' });
  });

  it('reports terminals of different sizes before any cell', async () => {
    const a = await screenOf('a', { columns: 5, rows: 2 });
    const b = await screenOf('a', { columns: 6, rows: 2 });
    expect(compareScreens(a, b)).toMatchObject({ field: 'columns', a: 5, b: 6 });
  });

  it('compares where the cursor ended', async () => {
    expect(await differenceOf('a\r\n', 'a')).toMatchObject({ field: 'cursor' });
  });
});
