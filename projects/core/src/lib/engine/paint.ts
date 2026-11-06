import { parseAnsi, PLAIN_STYLE } from './ansi';
import { borderWidths, paintBorder, type Sides } from './borders';
import { parseColor } from './color';
import { createGrid, writeSpan, writeSpans, type CellGrid, type Clip } from './grid';
import type { LayoutBox } from './layout';

type Props = Readonly<Record<string, unknown>>;

/** Paints the laid-out tree into a new grid as wide as the root and as tall as its content. */
export function paintTree(root: LayoutBox): CellGrid {
  const grid = createGrid(root.width, root.height);
  const everywhere: Clip = { x0: 0, y0: 0, x1: root.width, y1: root.height };
  paintBox(grid, root, 0, 0, everywhere);
  return grid;
}

/** `offsetX` and `offsetY` are the absolute position of the parent, which Yoga's x and y add to. */
function paintBox(
  grid: CellGrid,
  box: LayoutBox,
  offsetX: number,
  offsetY: number,
  clip: Clip,
): void {
  const props = box.node.owner?.inkProps() ?? {};
  // A box with display none stays in the tree with no size; it paints nothing.
  if (props['display'] === 'none') return;
  const x = offsetX + box.x;
  const y = offsetY + box.y;
  if (box.node.tag === 'ink-text') {
    paintText(grid, box, x, y, clip);
    return;
  }
  let childClip = clip;
  if (box.node.tag === 'ink-box') {
    const borders = borderWidths(props);
    paintBackground(grid, box, props, x, y, borders, clip);
    paintBorder(grid, box, props, x, y, clip);
    childClip = clipChildren(props, box, x, y, borders, clip);
  }
  if (childClip.x0 >= childClip.x1 || childClip.y0 >= childClip.y1) return;
  for (const child of box.children) paintBox(grid, child, x, y, childClip);
}

function paintText(grid: CellGrid, box: LayoutBox, x: number, y: number, clip: Clip): void {
  box.lines?.forEach((line, index) => {
    writeSpans(grid, x, y + index, parseAnsi(line, PLAIN_STYLE), clip);
  });
}

function paintBackground(
  grid: CellGrid,
  box: LayoutBox,
  props: Props,
  x: number,
  y: number,
  borders: Sides<number>,
  clip: Clip,
): void {
  const background = parseColor(props['backgroundColor']);
  if (background === null) return;
  const width = box.width - borders.left - borders.right;
  const height = box.height - borders.top - borders.bottom;
  if (width <= 0 || height <= 0) return;
  const span = { text: ' '.repeat(width), style: { ...PLAIN_STYLE, bg: background } };
  for (let row = 0; row < height; row++) {
    writeSpan(grid, x + borders.left, y + borders.top + row, span, clip);
  }
}

/**
 * The clip for the children of a box. An axis with `overflow` hidden is cut at the inside edge of
 * the border; the clip of the parent still applies, so nested clips intersect.
 */
function clipChildren(
  props: Props,
  box: LayoutBox,
  x: number,
  y: number,
  borders: Sides<number>,
  clip: Clip,
): Clip {
  const clipX = (props['overflowX'] ?? props['overflow']) === 'hidden';
  const clipY = (props['overflowY'] ?? props['overflow']) === 'hidden';
  if (!clipX && !clipY) return clip;
  return {
    x0: clipX ? Math.max(clip.x0, x + borders.left) : clip.x0,
    x1: clipX ? Math.min(clip.x1, x + box.width - borders.right) : clip.x1,
    y0: clipY ? Math.max(clip.y0, y + borders.top) : clip.y0,
    y1: clipY ? Math.min(clip.y1, y + box.height - borders.bottom) : clip.y1,
  };
}
