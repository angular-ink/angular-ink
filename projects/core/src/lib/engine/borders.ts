import cliBoxes, { type BoxStyle } from 'cli-boxes';
import { PLAIN_STYLE, type CellStyle } from './ansi';
import { parseColor, type Color } from './color';
import { internStyle, writeSpan, type CellGrid, type Clip } from './grid';
import type { LayoutBox } from './layout';

type Props = Readonly<Record<string, unknown>>;

export interface Sides<T> {
  readonly top: T;
  readonly bottom: T;
  readonly left: T;
  readonly right: T;
}

/** The cells a border takes on each side, 0 or 1. */
export function borderWidths(props: Props): Sides<number> {
  const width = props['borderStyle'] ? 1 : 0;
  const side = (name: string): number => (props[name] === false ? 0 : width);
  return {
    top: side('borderTop'),
    bottom: side('borderBottom'),
    left: side('borderLeft'),
    right: side('borderRight'),
  };
}

export function paintBorder(
  grid: CellGrid,
  box: LayoutBox,
  props: Props,
  x: number,
  y: number,
  clip: Clip,
): void {
  const glyphs = borderGlyphs(props['borderStyle']);
  if (glyphs === null) return;
  const showTop = props['borderTop'] !== false;
  const showBottom = props['borderBottom'] !== false;
  const showLeft = props['borderLeft'] !== false;
  const showRight = props['borderRight'] !== false;
  const style = (side: 'Top' | 'Bottom' | 'Left' | 'Right'): CellStyle =>
    internStyle({
      ...PLAIN_STYLE,
      fg: colorOf(props[`border${side}Color`] ?? props['borderColor']),
      bg: colorOf(props[`border${side}BackgroundColor`] ?? props['borderBackgroundColor']),
      dim: Boolean(props[`border${side}DimColor`] ?? props['borderDimColor']),
    });
  const inner = Math.max(0, box.width - (showLeft ? 1 : 0) - (showRight ? 1 : 0));
  const sideHeight = Math.max(0, box.height - (showTop ? 1 : 0) - (showBottom ? 1 : 0));
  const firstSideRow = y + (showTop ? 1 : 0);
  const write = (
    column: number,
    row: number,
    text: string,
    side: 'Top' | 'Bottom' | 'Left' | 'Right',
  ) => {
    writeSpan(grid, column, row, { text, style: style(side) }, clip);
  };

  if (showTop) {
    write(
      x,
      y,
      (showLeft ? glyphs.topLeft : '') +
        glyphs.top.repeat(inner) +
        (showRight ? glyphs.topRight : ''),
      'Top',
    );
  }
  for (let row = 0; row < sideHeight; row++) {
    if (showLeft) write(x, firstSideRow + row, glyphs.left, 'Left');
    if (showRight) write(x + box.width - 1, firstSideRow + row, glyphs.right, 'Right');
  }
  if (showBottom) {
    write(
      x,
      y + box.height - 1,
      (showLeft ? glyphs.bottomLeft : '') +
        glyphs.bottom.repeat(inner) +
        (showRight ? glyphs.bottomRight : ''),
      'Bottom',
    );
  }
}

const colorOf = (value: unknown): Color | null => parseColor(value);

function borderGlyphs(value: unknown): BoxStyle | null {
  if (typeof value === 'string') {
    return Object.hasOwn(cliBoxes, value) ? cliBoxes[value as keyof typeof cliBoxes] : null;
  }
  return value !== null && typeof value === 'object' ? (value as BoxStyle) : null;
}
