import { openSgr, PLAIN_STYLE, type CellStyle } from './ansi';
import { downgrade, type ColorLevel } from './color-level';
import { diffGrids } from './diff';
import type { CellGrid } from './grid';

const CSI = '\x1b[';
const RESET = `${CSI}0m`;
const ERASE_DOWN = `${CSI}J`;
const ERASE_LINE_END = `${CSI}K`;
const HOME = `${CSI}1;1H`;
export const SYNC_BEGIN = `${CSI}?2026h`;
export const SYNC_END = `${CSI}?2026l`;

export interface WriteOptions {
  /** Height of the screen. A frame this tall or taller cannot be moved over with relative moves. */
  readonly terminalRows: number;
  readonly level: ColorLevel;
  /** Wrap the output in a synchronized update, so the terminal paints it at once. */
  readonly synchronized: boolean;
}

/**
 * The bytes that turn what `previous` put on the terminal into `next`, or `''` when nothing
 * differs. The cursor starts and ends on column 0 of the row after the last row of the frame.
 * Moves are relative to that rest position, because an inline app does not know its absolute row.
 *
 * When the old or the new frame fills the screen, rows have scrolled out of reach of a relative
 * move. Then the cursor goes home, the screen is erased down and the frame is drawn again; the
 * scrollback is never erased.
 */
export function writeFrame(
  previous: CellGrid | null,
  next: CellGrid,
  options: WriteOptions,
): string {
  const body = frameBytes(previous, next, options);
  return body === '' || !options.synchronized ? body : SYNC_BEGIN + body + SYNC_END;
}

/** Erases a frame of `height` rows and leaves the cursor where the frame began. */
export function eraseFrame(height: number): string {
  return height <= 0 ? '' : `${moveUp(height)}\r${ERASE_DOWN}`;
}

function frameBytes(previous: CellGrid | null, next: CellGrid, options: WriteOptions): string {
  let runs = diffGrids(previous, next);
  const sameSize =
    previous !== null && previous.columns === next.columns && previous.rows === next.rows;
  if (sameSize && runs.length === 0) return '';

  const { terminalRows } = options;
  const pen = new Pen(options.level, previous?.rows ?? 0);
  let eraseTail = false;
  if (previous !== null && (previous.rows >= terminalRows || next.rows >= terminalRows)) {
    // The cursor is somewhere below the screen top; home is the only place that is known.
    pen.out += HOME + ERASE_DOWN;
    pen.start(0, terminalRows - 1);
    runs = diffGrids(null, next);
  } else if (previous !== null && previous.columns !== next.columns) {
    pen.out += eraseFrame(previous.rows);
    pen.start(0, previous.rows);
    runs = diffGrids(null, next);
  } else {
    eraseTail = previous !== null && next.rows < previous.rows;
  }

  for (const run of runs) {
    pen.moveToRow(run.y);
    const end = run.x + run.cells.length;
    const occupied = occupiedColumns(next, run.y);
    if (end <= occupied) {
      pen.moveToColumn(run.x);
      pen.draw(run.cells, next.columns);
    } else {
      // A blank that is written stays in the terminal's line, which would then reflow longer than
      // it looks, past where a resize erases it. An erase leaves nothing there.
      if (occupied > run.x) {
        pen.moveToColumn(run.x);
        pen.draw(run.cells.slice(0, occupied - run.x), next.columns);
      }
      pen.moveToColumn(Math.max(occupied, run.x));
      pen.eraseLineEnd();
    }
  }
  pen.moveToRow(next.rows);
  // The reset comes first: an erase paints with the open background.
  pen.resetStyle();
  if (eraseTail) pen.out += `\r${ERASE_DOWN}`;
  else if (pen.column !== 0) pen.out += '\r';
  return pen.out;
}

/** How many columns of row `y` hold something other than a plain blank, counting from the left. */
export function occupiedColumns(grid: CellGrid, y: number): number {
  const row = y * grid.columns;
  for (let x = grid.columns - 1; x >= 0; x--) {
    if (grid.chars[row + x] !== ' ' || grid.styles[row + x] !== PLAIN_STYLE) return x + 1;
  }
  return 0;
}

const moveUp = (count: number): string => `${CSI}${String(count)}A`;
const moveDown = (count: number): string => `${CSI}${String(count)}B`;

/** Builds the output while it follows the cursor and the style that the terminal has now. */
class Pen {
  out = '';
  /** The column of the cursor, or -1 when a line feed may have changed it. */
  column = 0;
  private row: number;
  /** The last row, counted from the frame top, that the terminal already has. */
  private lastRow: number;
  private open = '';
  private readonly keys = new Map<CellStyle, string>();

  constructor(
    private readonly level: ColorLevel,
    restRow: number,
  ) {
    this.row = restRow;
    this.lastRow = restRow;
  }

  start(row: number, lastRow: number): void {
    this.row = row;
    this.lastRow = lastRow;
    this.column = 0;
  }

  moveToRow(target: number): void {
    if (target < this.row) {
      this.out += moveUp(this.row - target);
      this.row = target;
    } else if (target > this.row) {
      const existing = Math.min(target, this.lastRow) - this.row;
      if (existing > 0) {
        this.out += moveDown(existing);
        this.row += existing;
      }
      const missing = target - this.row;
      if (missing > 0) {
        // A line feed makes the row, and scrolls at the bottom of the screen. It also paints the
        // new row with the open background.
        this.resetStyle();
        this.out += '\n'.repeat(missing);
        this.row = target;
        this.lastRow = target;
        this.column = -1;
      }
    }
  }

  moveToColumn(target: number): void {
    if (this.column === target) return;
    this.out += `${CSI}${String(target + 1)}G`;
    this.column = target;
  }

  draw(cells: readonly { char: string; style: CellStyle }[], columns: number): void {
    for (const cell of cells) {
      this.setStyle(cell.style);
      // The second half of a wide character has no bytes: the terminal moved over it already.
      this.out += cell.char;
    }
    const end = this.column + cells.length;
    // At the last column the terminal waits to wrap, so the column is unknown.
    this.column = end >= columns ? -1 : end;
  }

  eraseLineEnd(): void {
    // The reset comes first: an erase paints with the open background.
    this.resetStyle();
    this.out += ERASE_LINE_END;
  }

  resetStyle(): void {
    if (this.open === '') return;
    this.out += RESET;
    this.open = '';
  }

  private setStyle(style: CellStyle): void {
    const key = this.keyOf(style);
    if (key === this.open) return;
    this.resetStyle();
    this.out += key;
    this.open = key;
  }

  private keyOf(style: CellStyle): string {
    let key = this.keys.get(style);
    if (key === undefined) {
      key = openSgr(this.level === 3 ? style : degrade(style, this.level));
      this.keys.set(style, key);
    }
    return key;
  }
}

/** The style as a terminal of `level` can show it. */
export function degrade(style: CellStyle, level: ColorLevel): CellStyle {
  return {
    ...style,
    fg: style.fg === null ? null : downgrade(style.fg, level),
    bg: style.bg === null ? null : downgrade(style.bg, level),
  };
}
