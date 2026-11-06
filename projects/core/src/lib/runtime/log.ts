import type { ColorLevel } from '../engine/color-level';
import { diffGrids } from '../engine/diff';
import { gridToString, type CellGrid } from '../engine/grid';
import {
  degrade,
  eraseFrame,
  occupiedColumns,
  SYNC_BEGIN,
  SYNC_END,
  writeFrame,
} from '../engine/writer';

export interface FrameLogOptions {
  readonly level: ColorLevel;
  readonly synchronized: boolean;
  readonly terminalRows: () => number;
}

/**
 * Turns frames into bytes while it keeps the previous grid, the only state between frames, and
 * whether that grid is on the screen now. It only builds strings: the caller writes them, in order.
 */
export class FrameLog {
  private previous: CellGrid | null = null;
  private onScreen = false;
  /** The erase a resize asked for, sent with the next frame so that the two arrive together. */
  private pendingErase = '';

  constructor(private readonly options: FrameLogOptions) {}

  /** The rows of the frame on the screen. */
  get height(): number {
    return this.onScreen && this.previous !== null ? this.previous.rows : 0;
  }

  frame(next: CellGrid): string {
    const erase = this.pendingErase;
    const from = this.onScreen ? this.previous : null;
    this.pendingErase = '';
    this.previous = next;
    this.onScreen = true;
    if (erase === '') return writeFrame(from, next, this.writeOptions(this.options.synchronized));
    return this.synchronized(erase + writeFrame(null, next, this.writeOptions(false)));
  }

  /** Bytes that take the frame off the screen, before text from outside goes where it was. */
  beginText(): string {
    const erase = this.takeErase();
    return this.previous === null ? erase : this.syncBegin() + erase;
  }

  /** Bytes that draw the frame again, below the text that `beginText` made room for. */
  endText(): string {
    if (this.previous === null) return '';
    this.onScreen = true;
    // A line feed from the text need not have reset the column, and the frame starts from column 0.
    return `\r${writeFrame(null, this.previous, this.writeOptions(false))}${this.syncEnd()}`;
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
    this.pendingErase = eraseFrame(reflowedHeight(this.previous, columns));
    this.onScreen = false;
  }

  /** Whether `next` is the frame that `clear` took away, which an unmount must not bring back. */
  isClearedFrame(next: CellGrid): boolean {
    const { previous } = this;
    if (this.onScreen || previous === null) return false;
    if (previous.columns !== next.columns || previous.rows !== next.rows) return false;
    return diffGrids(previous, next).length === 0;
  }

  private takeErase(): string {
    const erase = this.pendingErase || eraseFrame(this.height);
    this.pendingErase = '';
    this.onScreen = false;
    return erase;
  }

  private writeOptions(synchronized: boolean) {
    const { level, terminalRows } = this.options;
    return { level, synchronized, terminalRows: terminalRows() };
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
  for (let y = 0; y < grid.rows; y++) {
    // The writer leaves plain blanks at the end of a row out, so the terminal holds none of them.
    height += Math.max(1, Math.ceil(occupiedColumns(grid, y) / columns));
  }
  return height;
}

/** The frame as plain lines with SGR only, for a stream that takes no cursor moves. */
export function frameText(grid: CellGrid, level: ColorLevel): string {
  if (level === 0) return gridToString(grid, { ansi: false });
  if (level === 3) return gridToString(grid, { ansi: true });
  const styles = grid.styles.map((style) => degrade(style, level));
  return gridToString({ ...grid, styles }, { ansi: true });
}
