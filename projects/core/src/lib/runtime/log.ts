import type { ColorLevel } from '../engine/color-level';
import { diffGrids } from '../engine/diff';
import { gridToString, type CellGrid } from '../engine/grid';
import type { LayoutBox } from '../engine/layout';
import { paintStatic } from '../engine/paint';
import {
  degrade,
  eraseFrame,
  occupiedColumns,
  SYNC_BEGIN,
  SYNC_END,
  writeFrame,
  type WriteOptions,
} from '../engine/writer';

export interface FrameLogOptions {
  readonly level: ColorLevel;
  readonly synchronized: boolean;
  readonly terminalRows: () => number;
}

/** Why a frame is drawn, when it is not simply that something changed. */
export type FrameMoment = Pick<WriteOptions, 'resized' | 'unmounting'>;

/**
 * Turns frames into bytes while it keeps the previous grid, the only state between frames, and
 * whether that grid is on the screen now. It only builds strings: the caller writes them, in order.
 */
export class FrameLog {
  private previous: CellGrid | null = null;
  private onScreen = false;
  /** The erase a resize asked for, sent with the next frame so that the two arrive together. */
  private pendingErase = '';
  /** Text is erasing a frame for a size it no longer fits, so the next frame draws instead. */
  private skipRedraw = false;
  /** The frame on the screen filled it, so the cursor rests on its last row and not below it. */
  private endsOnLastRow = false;
  private lastTerminalRows: number | null = null;

  constructor(private readonly options: FrameLogOptions) {}

  /** The rows of the frame on the screen. */
  get height(): number {
    return this.onScreen && this.previous !== null ? this.previous.rows : 0;
  }

  frame(next: CellGrid, moment: FrameMoment = {}): string {
    const erase = this.pendingErase;
    const from = this.onScreen ? this.previous : null;
    this.pendingErase = '';
    this.previous = next;
    this.onScreen = true;
    const options = { ...this.writeOptions(this.options.synchronized), ...moment };
    if (erase !== '') {
      return this.synchronized(erase + this.write(null, next, { ...options, synchronized: false }));
    }
    return this.write(from, next, options);
  }

  /** Bytes that take the frame off the screen, before text from outside goes where it was. */
  beginText(): string {
    this.skipRedraw = this.pendingErase !== '';
    const erase = this.takeErase();
    return this.previous === null ? erase : this.syncBegin() + erase;
  }

  /** Bytes that draw the frame again, below the text that `beginText` made room for. */
  endText(): string {
    if (this.previous === null) return '';
    if (this.skipRedraw) {
      this.skipRedraw = false;
      return this.syncEnd();
    }
    this.onScreen = true;
    // A line feed from the text need not have reset the column, and the frame starts from column 0.
    return `\r${this.write(null, this.previous, this.writeOptions(false))}${this.syncEnd()}`;
  }

  clear(): string {
    return this.takeErase();
  }

  /**
   * The terminal changed size and the frame on it is no longer where its rows say. A narrower
   * terminal has reflowed each row into as many as it now takes, and these have to go too.
   */
  invalidate(columns: number): void {
    if (!this.onScreen || this.previous === null) return;
    this.pendingErase = eraseFrame(reflowedHeight(this.previous, columns), this.endsOnLastRow);
    this.onScreen = false;
  }

  /** Whether `next` is the frame that `clear` took away, which an unmount must not bring back. */
  isClearedFrame(next: CellGrid): boolean {
    const { previous } = this;
    if (this.onScreen || previous === null) return false;
    if (previous.columns !== next.columns || previous.rows !== next.rows) return false;
    return diffGrids(previous, next).length === 0;
  }

  private write(from: CellGrid | null, next: CellGrid, options: WriteOptions): string {
    const bytes = writeFrame(from, next, options);
    if (bytes !== '') this.endsOnLastRow = next.rows >= options.terminalRows;
    return bytes;
  }

  private takeErase(): string {
    const erase = this.pendingErase || eraseFrame(this.height, this.endsOnLastRow);
    this.pendingErase = '';
    this.onScreen = false;
    return erase;
  }

  /** Options for one write, which also records where that write leaves the cursor. */
  private writeOptions(synchronized: boolean): WriteOptions {
    const terminalRows = this.options.terminalRows();
    const options = {
      level: this.options.level,
      synchronized,
      terminalRows,
      previousTerminalRows: this.lastTerminalRows ?? terminalRows,
      previousEndsOnLastRow: this.endsOnLastRow,
    };
    this.lastTerminalRows = terminalRows;
    return options;
  }

  private synchronized(bytes: string): string {
    return this.syncBegin() + bytes + this.syncEnd();
  }

  private syncBegin(): string {
    return this.options.synchronized ? SYNC_BEGIN : '';
  }

  private syncEnd(): string {
    return this.options.synchronized ? SYNC_END : '';
  }
}

/** The rows `grid` takes after a terminal reflowed it into `columns`. */
function reflowedHeight(grid: CellGrid, columns: number): number {
  let height = 0;
  for (let y = 0; y < grid.rows; y++) height += reflowedRowHeight(grid, y, columns);
  return height;
}

function reflowedRowHeight(grid: CellGrid, y: number, columns: number): number {
  const start = y * grid.columns;
  // The writer leaves plain blanks at the end of a row out, so the terminal holds none of them.
  const occupied = occupiedColumns(grid, y);
  let rows = 1;
  let column = 0;
  let x = 0;
  while (x < occupied) {
    // The second cell of a wide character holds ''. One that does not fit wraps early and whole.
    const width = grid.chars[start + x + 1] === '' ? 2 : 1;
    if (column > 0 && column + width > columns) {
      rows++;
      column = 0;
    }
    column += width;
    x += width;
  }
  return rows;
}

/**
 * The new permanent output in `root`, ready to write above the frame, or `null` if there is none.
 * `level` is the color level of the stream it goes to.
 */
export function takeStaticOutput(root: LayoutBox, level: ColorLevel = 3): string | null {
  const grid = paintStatic(root);
  return grid === null ? null : staticText(grid, level);
}

/** Every row of the grid counts, blank ones too, and the frame then starts on a line of its own. */
export function staticText(grid: CellGrid, level: ColorLevel): string {
  const text = frameText(grid, level);
  const rows = text === '' ? 0 : text.split('\n').length;
  return text + '\n'.repeat(grid.rows - rows + 1);
}

/** The frame as plain lines with SGR only, for a stream that takes no cursor moves. */
export function frameText(grid: CellGrid, level: ColorLevel): string {
  if (level === 0) return gridToString(grid, { ansi: false });
  if (level === 3) return gridToString(grid, { ansi: true });
  const styles = grid.styles.map((style) => degrade(style, level));
  return gridToString({ ...grid, styles }, { ansi: true });
}
