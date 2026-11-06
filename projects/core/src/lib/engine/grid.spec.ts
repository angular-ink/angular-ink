import { describe, expect, it } from 'vitest';
import { PLAIN_STYLE, type CellStyle } from './ansi';
import { createGrid, gridToString, internStyle, writeSpan, type Clip } from './grid';
import { namedColor } from './color';

const RED: CellStyle = { ...PLAIN_STYLE, fg: namedColor(31) };
const ON_BLUE: CellStyle = { ...PLAIN_STYLE, bg: namedColor(34) };

const everywhere = (columns: number, rows: number): Clip => ({
  x0: 0,
  y0: 0,
  x1: columns,
  y1: rows,
});

const plain = (grid: ReturnType<typeof createGrid>): string => gridToString(grid, { ansi: false });

describe('createGrid', () => {
  it('starts with blank cells in the plain style', () => {
    const grid = createGrid(3, 2);
    expect(grid.chars).toEqual(Array<string>(6).fill(' '));
    expect(grid.styles.every((style) => style === PLAIN_STYLE)).toBe(true);
  });
});

describe('writeSpan', () => {
  it('writes a wide character into two cells and leaves the second empty', () => {
    const grid = createGrid(4, 1);
    writeSpan(grid, 1, 0, { text: '日', style: PLAIN_STYLE }, everywhere(4, 1));
    expect(grid.chars).toEqual([' ', '日', '', ' ']);
  });

  it('blanks the first half when a write lands on the second half of a wide character', () => {
    const grid = createGrid(4, 1);
    const clip = everywhere(4, 1);
    writeSpan(grid, 0, 0, { text: '日', style: RED }, clip);
    writeSpan(grid, 1, 0, { text: 'x', style: PLAIN_STYLE }, clip);
    expect(grid.chars).toEqual([' ', 'x', ' ', ' ']);
    expect(grid.styles[0]).toBe(internStyle(RED));
  });

  it('blanks the second half when a write lands on the first half of a wide character', () => {
    const grid = createGrid(4, 1);
    const clip = everywhere(4, 1);
    writeSpan(grid, 0, 0, { text: '日', style: PLAIN_STYLE }, clip);
    writeSpan(grid, 0, 0, { text: 'x', style: PLAIN_STYLE }, clip);
    expect(grid.chars).toEqual(['x', ' ', ' ', ' ']);
  });

  it('blanks the tail of a wide character that a new wide character overlaps', () => {
    const grid = createGrid(5, 1);
    const clip = everywhere(5, 1);
    writeSpan(grid, 1, 0, { text: '日', style: PLAIN_STYLE }, clip);
    writeSpan(grid, 0, 0, { text: '本', style: PLAIN_STYLE }, clip);
    expect(grid.chars).toEqual(['本', '', ' ', ' ', ' ']);
  });

  it('does not write a wide character that would cross clip.x1', () => {
    const grid = createGrid(8, 1);
    writeSpan(grid, 0, 0, { text: '日本語', style: PLAIN_STYLE }, { x0: 0, y0: 0, x1: 3, y1: 1 });
    expect(grid.chars.slice(0, 4)).toEqual(['日', '', ' ', ' ']);
    expect(plain(grid)).toBe('日');
  });

  it('does not write a wide character that would cross the edge of the grid', () => {
    const grid = createGrid(3, 1);
    writeSpan(grid, 2, 0, { text: '日', style: PLAIN_STYLE }, everywhere(3, 1));
    expect(grid.chars).toEqual([' ', ' ', ' ']);
  });

  it('keeps the style of a wide character cut by the left clip edge on the visible half', () => {
    const grid = createGrid(4, 1);
    writeSpan(grid, 0, 0, { text: '日x', style: ON_BLUE }, { x0: 1, y0: 0, x1: 4, y1: 1 });
    expect(grid.chars).toEqual([' ', ' ', 'x', ' ']);
    expect(grid.styles[1]).toBe(internStyle(ON_BLUE));
    expect(grid.styles[0]).toBe(PLAIN_STYLE);
  });

  it('clips rows and ignores columns left of the grid', () => {
    const grid = createGrid(3, 2);
    const clip = { x0: 0, y0: 1, x1: 3, y1: 2 };
    writeSpan(grid, 0, 0, { text: 'abc', style: PLAIN_STYLE }, clip);
    writeSpan(grid, -1, 1, { text: 'xyz', style: PLAIN_STYLE }, clip);
    expect(grid.chars).toEqual([' ', ' ', ' ', 'y', 'z', ' ']);
  });

  it('skips zero-width characters so they never take a cell', () => {
    const grid = createGrid(4, 1);
    writeSpan(grid, 0, 0, { text: 'a​b\u0007c', style: PLAIN_STYLE }, everywhere(4, 1));
    expect(plain(grid)).toBe('abc');
  });

  it('keeps a combining mark with its base character', () => {
    const grid = createGrid(3, 1);
    writeSpan(grid, 0, 0, { text: 'éx', style: PLAIN_STYLE }, everywhere(3, 1));
    expect(grid.chars).toEqual(['é', 'x', ' ']);
  });

  it('stores one shared object for equal styles', () => {
    const grid = createGrid(2, 1);
    const clip = everywhere(2, 1);
    writeSpan(grid, 0, 0, { text: 'a', style: { ...RED } }, clip);
    writeSpan(grid, 1, 0, { text: 'b', style: { ...RED } }, clip);
    expect(grid.styles[0]).toBe(grid.styles[1]);
  });
});

describe('gridToString', () => {
  it('has no escape byte when ansi is off', () => {
    const grid = createGrid(3, 1);
    writeSpan(grid, 0, 0, { text: 'abc', style: RED }, everywhere(3, 1));
    expect(plain(grid)).toBe('abc');
    expect(plain(grid)).not.toContain('\x1b');
  });

  it('closes the styles at the end of each line when ansi is on', () => {
    const grid = createGrid(3, 2);
    const clip = everywhere(3, 2);
    writeSpan(grid, 0, 0, { text: 'ab', style: RED }, clip);
    writeSpan(grid, 0, 1, { text: 'c', style: RED }, clip);
    expect(gridToString(grid, { ansi: true })).toBe('\x1b[31mab\x1b[0m\n\x1b[31mc\x1b[0m');
  });

  it('switches style between cells with a reset in between', () => {
    const grid = createGrid(2, 1);
    const clip = everywhere(2, 1);
    writeSpan(grid, 0, 0, { text: 'a', style: RED }, clip);
    writeSpan(grid, 1, 0, { text: 'b', style: ON_BLUE }, clip);
    expect(gridToString(grid, { ansi: true })).toBe('\x1b[31ma\x1b[0m\x1b[44mb\x1b[0m');
  });

  it('drops trailing blanks of each line and empty lines at the end', () => {
    const grid = createGrid(5, 4);
    writeSpan(grid, 1, 1, { text: 'x', style: PLAIN_STYLE }, everywhere(5, 4));
    expect(plain(grid)).toBe('\n x');
  });

  it('keeps trailing blanks that carry a style when ansi is on, and drops them when off', () => {
    const grid = createGrid(3, 1);
    writeSpan(grid, 0, 0, { text: 'a  ', style: ON_BLUE }, everywhere(3, 1));
    expect(gridToString(grid, { ansi: true })).toBe('\x1b[44ma  \x1b[0m');
    expect(plain(grid)).toBe('a');
  });

  it('is empty for a grid with nothing in it', () => {
    expect(plain(createGrid(3, 2))).toBe('');
  });
});
