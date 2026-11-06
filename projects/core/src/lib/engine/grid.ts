import stringWidth from 'string-width';
import { openSgr, PLAIN_STYLE, type CellStyle, type StyledSpan } from './ansi';

/**
 * The screen as cells, row by row: the index of cell (x, y) is `y * columns + x`. The second cell of
 * a wide character holds `''`. Every entry of `styles` comes from `internStyle`, so the diff can
 * compare styles with `===`.
 */
export interface CellGrid {
  readonly columns: number;
  readonly rows: number;
  readonly chars: string[];
  readonly styles: CellStyle[];
}

/** A half-open rectangle of cells: `x0` and `y0` are inside, `x1` and `y1` are not. */
export interface Clip {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const ESC_RESET = '\x1b[0m';
const STYLE_CACHE_CAPACITY = 4096;

const interned = new Map<string, CellStyle>([['', PLAIN_STYLE]]);

/**
 * Returns the one shared object for a style. The cache is shared by every grid, so styles of two
 * frames compare with `===`. It restarts when full; a style then gets a new object, which costs
 * the diff one extra cell write and nothing else.
 */
export function internStyle(style: CellStyle): CellStyle {
  const key = openSgr(style);
  const known = interned.get(key);
  if (known !== undefined) return known;
  if (interned.size >= STYLE_CACHE_CAPACITY) {
    interned.clear();
    interned.set('', PLAIN_STYLE);
  }
  interned.set(key, style);
  return style;
}

export function createGrid(columns: number, rows: number): CellGrid {
  const size = columns * rows;
  return {
    columns,
    rows,
    chars: Array<string>(size).fill(' '),
    styles: Array<CellStyle>(size).fill(PLAIN_STYLE),
  };
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Writes one span on row `y` from column `x`, inside `clip` and the grid. Returns the next column. */
function writeRun(grid: CellGrid, x: number, y: number, span: StyledSpan, clip: Clip): number {
  const left = Math.max(clip.x0, 0);
  const right = Math.min(clip.x1, grid.columns);
  const visibleRow = y >= Math.max(clip.y0, 0) && y < Math.min(clip.y1, grid.rows);
  const style = internStyle(span.style);
  let column = x;
  for (const { segment } of segmenter.segment(span.text)) {
    const width = stringWidth(segment);
    if (width === 0) continue;
    const start = column;
    column += width;
    if (!visibleRow || column <= left) continue;
    if (start >= right) break;
    const first = Math.max(start, left);
    const last = Math.min(column, right) - 1;
    if (splitsOutsideWide(grid, first, last, y, left, right)) continue;
    if (start < left || column > right) {
      // Half a wide character is visible: keep its style on a space.
      for (let at = first; at <= last; at++) setCell(grid, at, y, ' ', style);
    } else {
      setCell(grid, start, y, segment, style);
      for (let at = start + 1; at <= last; at++) setCell(grid, at, y, '', style);
    }
    // The write may have overwritten the first half of a wide character; its second half is a blank now.
    if (last + 1 < grid.columns && grid.chars[y * grid.columns + last + 1] === '') {
      grid.chars[y * grid.columns + last + 1] = ' ';
    }
  }
  return column;
}

// A write that would cut a wide character whose other half is outside the clip is skipped, so
// nothing outside the clip changes.
function splitsOutsideWide(
  grid: CellGrid,
  first: number,
  last: number,
  y: number,
  left: number,
  right: number,
): boolean {
  const row = y * grid.columns;
  const startsOnSecondHalf = grid.chars[row + first] === '' && first - 1 < left;
  const endsOnFirstHalf =
    grid.chars[row + last] !== '' && grid.chars[row + last + 1] === '' && last + 1 >= right;
  return startsOnSecondHalf || endsOnFirstHalf;
}

/** Writes a cell. If it lands on the second half of a wide character, the first half becomes a space. */
function setCell(grid: CellGrid, x: number, y: number, char: string, style: CellStyle): void {
  const index = y * grid.columns + x;
  if (char !== '' && grid.chars[index] === '' && x > 0) grid.chars[index - 1] = ' ';
  grid.chars[index] = char;
  grid.styles[index] = style;
}

/**
 * Writes `span` on row `y` from column `x`. Nothing outside `clip` or the grid changes, and a wide
 * character that does not fit whole is not written (its visible half becomes a space).
 */
export function writeSpan(
  grid: CellGrid,
  x: number,
  y: number,
  span: StyledSpan,
  clip: Clip,
): void {
  writeRun(grid, x, y, span, clip);
}

/** Writes consecutive spans on one row, so each starts where the last ended. */
export function writeSpans(
  grid: CellGrid,
  x: number,
  y: number,
  spans: readonly StyledSpan[],
  clip: Clip,
): void {
  let column = x;
  for (const span of spans) column = writeRun(grid, column, y, span, clip);
}

/**
 * The grid as text, one line per row. Trailing blanks and trailing empty rows are dropped. With
 * `ansi`, a style opens where it starts and every line ends reset.
 */
export function gridToString(grid: CellGrid, options: { ansi: boolean }): string {
  const lines: string[] = [];
  for (let y = 0; y < grid.rows; y++) lines.push(rowToString(grid, y, options.ansi));
  let count = lines.length;
  while (count > 0 && lines[count - 1] === '') count--;
  return lines.slice(0, count).join('\n');
}

function rowToString(grid: CellGrid, y: number, ansi: boolean): string {
  const start = y * grid.columns;
  let end = grid.columns;
  // A blank that opens no SGR prints nothing; a styled one can show a color.
  while (end > 0) {
    const index = start + end - 1;
    const blank =
      grid.chars[index] === ' ' && (!ansi || openSgr(grid.styles[index] ?? PLAIN_STYLE) === '');
    if (!blank) break;
    end--;
  }
  let out = '';
  // Styles compare by their SGR, so equal styles from before a cache restart add no escape.
  let openKey = '';
  for (let x = 0; x < end; x++) {
    const index = start + x;
    if (ansi) {
      const key = openSgr(grid.styles[index] ?? PLAIN_STYLE);
      if (key !== openKey) {
        if (openKey !== '') out += ESC_RESET;
        out += key;
        openKey = key;
      }
    }
    out += grid.chars[index] ?? '';
  }
  return openKey === '' ? out : out + ESC_RESET;
}
