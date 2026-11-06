import { describe, expect, it } from 'vitest';
import { PLAIN_STYLE, type CellStyle } from './ansi';
import { namedColor } from './color';
import { diffGrids } from './diff';
import { createGrid, internStyle, writeSpan, type CellGrid } from './grid';

const RED: CellStyle = internStyle({ ...PLAIN_STYLE, fg: namedColor(31) });

function gridOf(lines: readonly string[], columns: number, style: CellStyle = PLAIN_STYLE) {
  const grid = createGrid(columns, lines.length);
  const clip = { x0: 0, y0: 0, x1: columns, y1: lines.length };
  lines.forEach((text, y) => {
    writeSpan(grid, 0, y, { text, style }, clip);
  });
  return grid;
}

const chars = (grid: CellGrid, run: ReturnType<typeof diffGrids>[number]): string =>
  run.cells.map((cell) => cell.char).join('');

describe('diffGrids', () => {
  it('returns no runs when nothing changed', () => {
    expect(diffGrids(gridOf(['abc', 'def'], 4), gridOf(['abc', 'def'], 4))).toEqual([]);
  });

  it('joins adjacent changed cells into one run and splits at unchanged cells', () => {
    const before = gridOf(['abcdef'], 6);
    const after = gridOf(['aXYdeZ'], 6);
    const runs = diffGrids(before, after);
    expect(runs.map((run) => [run.x, run.y, chars(after, run)])).toEqual([
      [1, 0, 'XY'],
      [5, 0, 'Z'],
    ]);
  });

  it('sees a style change on an unchanged character', () => {
    const runs = diffGrids(gridOf(['ab'], 2), gridOf(['ab'], 2, RED));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.cells.every((cell) => cell.style === RED)).toBe(true);
  });

  it('treats a missing previous grid as a blank screen', () => {
    const runs = diffGrids(null, gridOf(['  hi', '    '], 4));
    expect(runs.map((run) => [run.x, run.y, run.cells.length])).toEqual([[2, 0, 2]]);
  });

  it('treats rows beyond the previous grid as blank and ignores rows that disappeared', () => {
    const grown = diffGrids(gridOf(['ab'], 2), gridOf(['ab', 'cd'], 2));
    expect(grown.map((run) => [run.x, run.y])).toEqual([[0, 1]]);
    expect(diffGrids(gridOf(['ab', 'cd'], 2), gridOf(['ab'], 2))).toEqual([]);
  });

  it('compares against a blank screen when the width changed', () => {
    const runs = diffGrids(gridOf(['ab'], 2), gridOf(['ab'], 3));
    expect(runs.map((run) => [run.x, run.y, run.cells.length])).toEqual([[0, 0, 2]]);
  });

  it('keeps both halves of a wide character in one run', () => {
    const before = gridOf(['a日b'], 4);
    const after = gridOf(['abcd'], 4);
    const runs = diffGrids(before, after);
    expect(runs.map((run) => [run.x, run.cells.length])).toEqual([[1, 3]]);
    const wideAfter = diffGrids(after, before);
    expect(wideAfter.map((run) => [run.x, run.cells.length])).toEqual([[1, 3]]);
  });

  it('starts a run on the first half when only the second half differs', () => {
    const before = gridOf(['日'], 2);
    const after = gridOf(['日'], 2);
    after.chars[1] = ' ';
    const runs = diffGrids(before, after);
    expect(runs.map((run) => run.x)).toEqual([0]);
  });
});
