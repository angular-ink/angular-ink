// Compares what two terminals show, cell by cell, whatever sequences got them there.

const ATTRIBUTES = [
  ['bold', 'isBold'],
  ['dim', 'isDim'],
  ['italic', 'isItalic'],
  ['underline', 'isUnderline'],
  ['blink', 'isBlink'],
  ['inverse', 'isInverse'],
  ['invisible', 'isInvisible'],
  ['strikethrough', 'isStrikethrough'],
  ['overline', 'isOverline'],
];

const CELL_FIELDS = ['char', 'width', 'fg', 'bg', 'attributes'];

function colorOf(isDefault, isPalette, color) {
  if (isDefault) return 'default';
  if (isPalette) return `palette:${String(color)}`;
  return `rgb:${color.toString(16).padStart(6, '0')}`;
}

function readCell(cell) {
  const width = cell.getWidth();
  return {
    // A cell never written and a written space look the same. The tail of a wide one stays empty.
    char: width === 0 ? '' : cell.getChars() || ' ',
    width,
    fg: colorOf(cell.isFgDefault(), cell.isFgPalette(), cell.getFgColor()),
    bg: colorOf(cell.isBgDefault(), cell.isBgPalette(), cell.getBgColor()),
    attributes: ATTRIBUTES.filter(([, method]) => cell[method]() !== 0)
      .map(([name]) => name)
      .join(','),
  };
}

/** A plain copy of the buffer of a headless xterm, scrollback included, that outlives it. */
export function readScreen(terminal) {
  const { active } = terminal.buffer;
  const rows = [];
  for (let y = 0; y < active.baseY + terminal.rows; y++) {
    const line = active.getLine(y);
    const row = [];
    for (let x = 0; x < terminal.cols; x++) row.push(readCell(line.getCell(x)));
    rows.push(row);
  }
  return {
    columns: terminal.cols,
    viewportRows: terminal.rows,
    rows,
    cursor: { row: active.baseY + active.cursorY, column: active.cursorX },
  };
}

/** The rows a user sees now, with the cursor counted from their top. */
export function viewportOf(screen) {
  const top = screen.rows.length - screen.viewportRows;
  return {
    columns: screen.columns,
    rows: screen.rows.slice(top),
    cursor: { row: screen.cursor.row - top, column: screen.cursor.column },
  };
}

/** The rows above the viewport. The cursor is never there. */
export function scrollbackOf(screen) {
  const top = screen.rows.length - screen.viewportRows;
  return { columns: screen.columns, rows: screen.rows.slice(0, top), cursor: null };
}

/** The first difference of each kind between two screens, in the order they were found. */
export function differencesBetween(a, b) {
  if (a.columns !== b.columns) return [{ field: 'columns', a: a.columns, b: b.columns }];
  if (a.rows.length !== b.rows.length) {
    return [{ field: 'rows', a: a.rows.length, b: b.rows.length }];
  }
  const found = new Map();
  for (const [row, cells] of a.rows.entries()) {
    for (const [column, cell] of cells.entries()) {
      const other = b.rows[row][column];
      for (const field of CELL_FIELDS) {
        if (cell[field] !== other[field] && !found.has(field)) {
          found.set(field, { row, column, field, a: cell[field], b: other[field] });
        }
      }
    }
  }
  if (a.cursor?.row !== b.cursor?.row || a.cursor?.column !== b.cursor?.column) {
    found.set('cursor', { field: 'cursor', a: a.cursor, b: b.cursor });
  }
  return [...found.values()];
}

/** The first difference between two screens with its position, or null if they are the same. */
export function compareScreens(a, b) {
  return differencesBetween(a, b)[0] ?? null;
}
