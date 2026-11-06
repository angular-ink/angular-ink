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
  /** Height of the screen when `previous` was drawn, if it has changed since. */
  readonly previousTerminalRows?: number;
  /** The cursor rests on the last row of `previous`, as `previous` filled the screen then. */
  readonly previousEndsOnLastRow?: boolean;
  /** The terminal changed size. A frame that overflows is drawn again even with no change. */
  readonly resized?: boolean;
  /** This is the last frame of the app. One that fills the screen is drawn again. */
  readonly unmounting?: boolean;
}

/**
 * The bytes that turn what `previous` put on the terminal into `next`, or `''` when nothing
 * differs. Moves are relative to where the cursor rests, because an inline app does not know its
 * absolute row. It rests on column 0 of the row after the frame or, when the frame fills the screen
 * and that row would scroll it, just after the last cell of the frame.
 *
 * The rules for what can be drawn over follow Ink 8.0.0. A frame that overflows the screen is out of
 * reach of relative moves, so it is erased from the top of the screen and drawn again in full, which
 * sends a copy of its top rows to the scrollback. The scrollback itself is never erased.
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
export function eraseFrame(height: number, endsOnLastRow = false): string {
  if (height <= 0) return '';
  const above = endsOnLastRow ? height - 1 : height;
  return `${above > 0 ? moveUp(above) : ''}\r${ERASE_DOWN}`;
}

function frameBytes(previous: CellGrid | null, next: CellGrid, options: WriteOptions): string {
  let runs = diffGrids(previous, next);
  const { terminalRows } = options;
  const shrunk = (options.previousTerminalRows ?? terminalRows) > terminalRows;
  const fills = next.rows >= terminalRows;
  const filled = previous !== null && previous.rows >= terminalRows;
  const overflows = previous !== null && (previous.rows > terminalRows || next.rows > terminalRows);
  const redraw =
    overflows || (filled && (next.rows < terminalRows || shrunk || options.unmounting === true));

  const sameSize =
    previous !== null && previous.columns === next.columns && previous.rows === next.rows;
  const forced = shrunk || options.resized === true || options.unmounting === true;
  if (sameSize && runs.length === 0 && !(redraw && forced)) return '';

  const endsOnLastRow = previous !== null && options.previousEndsOnLastRow === true;
  const height = previous?.rows ?? 0;
  const restRow = endsOnLastRow ? height - 1 : height;
  const pen = new Pen(options.level, restRow, endsOnLastRow ? -1 : 0);
  let eraseTail = false;
  if (redraw && filled) {
    // The frame is all there is on the screen, so home erases exactly that.
    pen.out += HOME + ERASE_DOWN;
    pen.start(0, terminalRows - 1);
    runs = diffGrids(null, next);
  } else if (redraw || (previous !== null && previous.columns !== next.columns)) {
    pen.out += eraseFrame(height, endsOnLastRow);
    pen.start(0, restRow);
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
      // From `occupied`, not from the run: blanks an earlier frame wrote may lie before the run.
      pen.moveToColumn(occupied);
      pen.eraseLineEnd();
    }
  }
  if (fills) {
    pen.restAfterLastCell(next);
    return pen.out;
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
    restColumn: number,
  ) {
    this.row = restRow;
    this.lastRow = restRow;
    this.column = restColumn;
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

  /**
   * Writes the last cell of the frame again. Only that leaves the cursor as a terminal has it after
   * a whole frame, which at the last column is still waiting to wrap.
   */
  restAfterLastCell(grid: CellGrid): void {
    const y = grid.rows - 1;
    this.moveToRow(y);
    const end = occupiedColumns(grid, y);
    if (end === 0) {
      this.resetStyle();
      this.moveToColumn(0);
      return;
    }
    const start = y * grid.columns;
    // The second cell of a wide character holds ''.
    const x = grid.chars[start + end - 1] === '' ? end - 2 : end - 1;
    const cells = [];
    for (let i = x; i < end; i++) {
      cells.push({
        char: grid.chars[start + i] ?? ' ',
        style: grid.styles[start + i] ?? PLAIN_STYLE,
      });
    }
    this.moveToColumn(x);
    this.draw(cells, grid.columns);
    this.resetStyle();
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
