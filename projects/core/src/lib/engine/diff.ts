import type { CellStyle } from './ansi';
import { PLAIN_STYLE } from './ansi';
import type { CellGrid } from './grid';

export interface RunCell {
  readonly char: string;
  readonly style: CellStyle;
}

/** Adjacent cells of one row that differ from the previous frame, starting at column `x`. */
export interface CellRun {
  readonly x: number;
  readonly y: number;
  readonly cells: readonly RunCell[];
}

const BLANK_CHAR = ' ';

/**
 * The cells of `next` that differ from `previous`, as runs in reading order. Without a previous
 * grid, with another width, or below its last row, the screen counts as blank: the writer erases
 * before it draws there. A run never cuts a wide character: both of its cells are in the run.
 */
export function diffGrids(previous: CellGrid | null, next: CellGrid): readonly CellRun[] {
  const basis = previous !== null && previous.columns === next.columns ? previous : null;
  const runs: CellRun[] = [];
  for (let y = 0; y < next.rows; y++) {
    const changed = changedCells(basis, next, y);
    collectRuns(next, y, changed, runs);
  }
  return runs;
}

function changedCells(basis: CellGrid | null, next: CellGrid, y: number): Uint8Array {
  const { columns } = next;
  const row = y * columns;
  const changed = new Uint8Array(columns);
  const hasOldRow = basis !== null && y < basis.rows;
  const oldChar = (x: number): string => (hasOldRow ? (basis.chars[row + x] ?? '') : BLANK_CHAR);
  const oldStyle = (x: number): CellStyle =>
    hasOldRow ? (basis.styles[row + x] ?? PLAIN_STYLE) : PLAIN_STYLE;
  let any = false;
  for (let x = 0; x < columns; x++) {
    const index = row + x;
    if (next.chars[index] !== oldChar(x) || next.styles[index] !== oldStyle(x)) {
      changed[x] = 1;
      any = true;
    }
  }
  if (any)
    spreadOverWideCharacters(changed, (x) => oldChar(x) === '' || next.chars[row + x] === '');
  return changed;
}

// A cell that is the second half of a wide character, in either frame, cannot be drawn alone:
// its first half joins the run, and the second half follows its first half.
function spreadOverWideCharacters(changed: Uint8Array, isSecondHalf: (x: number) => boolean): void {
  const columns = changed.length;
  let grew = true;
  while (grew) {
    grew = false;
    for (let x = 0; x < columns; x++) {
      if (changed[x] === 0) continue;
      if (x > 0 && changed[x - 1] === 0 && isSecondHalf(x)) {
        changed[x - 1] = 1;
        grew = true;
      }
      if (x + 1 < columns && changed[x + 1] === 0 && isSecondHalf(x + 1)) {
        changed[x + 1] = 1;
        grew = true;
      }
    }
  }
}

function collectRuns(next: CellGrid, y: number, changed: Uint8Array, runs: CellRun[]): void {
  const { columns } = next;
  const row = y * columns;
  let x = 0;
  while (x < columns) {
    if (changed[x] === 0) {
      x++;
      continue;
    }
    const start = x;
    const cells: RunCell[] = [];
    while (x < columns && changed[x] === 1) {
      cells.push({
        char: next.chars[row + x] ?? BLANK_CHAR,
        style: next.styles[row + x] ?? PLAIN_STYLE,
      });
      x++;
    }
    runs.push({ x: start, y, cells });
  }
}
