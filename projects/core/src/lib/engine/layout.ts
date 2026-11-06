import type { Node as YogaNode, Yoga } from 'yoga-layout/load';
import { PLAIN_STYLE, type CellStyle } from './ansi';
import { parseColor } from './color';
import { layoutLines, measureText, squashText, type TextWrap } from './text-layout';
import { applyBoxStyle } from './yoga-map';
import { flattenHosts } from '../tree/flatten';
import { holdsText, type InkNode } from '../tree/node';

/** A laid-out node. `x` and `y` are in cells, relative to the parent box. */
export interface LayoutBox {
  readonly node: InkNode;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The wrapped lines of an `ink-text`, with SGR; `null` for any other node. */
  readonly lines: readonly string[] | null;
  readonly children: readonly LayoutBox[];
  /** On the root only: the `ink-static` that has output to give. */
  readonly staticLayer?: StaticLayer;
}

/** An `ink-static`, kept out of `children`, and the size of the grid it is painted on. */
export interface StaticLayer {
  readonly box: LayoutBox;
  readonly columns: number;
  readonly rows: number;
}

interface Pending {
  readonly node: InkNode;
  readonly yoga: YogaNode;
  readonly children: Pending[];
  /** The squashed text and wrap mode of an `ink-text`. */
  readonly text: { readonly squashed: string; readonly wrap: TextWrap } | null;
}

/**
 * Lays the tree out in `columns` cells and returns the result as plain data. The Yoga tree is
 * built, calculated, read and freed inside this call, so none of it outlives the call.
 */
export function layoutTree(root: InkNode, columns: number, yoga: Yoga): LayoutBox {
  const flat = flattenHosts(root);
  const measured: YogaNode[] = [];
  const rootYoga = yoga.Node.create();
  try {
    const pending = build(yoga, flat, rootYoga, PLAIN_STYLE, measured);
    rootYoga.setWidth(columns);
    rootYoga.calculateLayout(undefined, undefined, yoga.DIRECTION_LTR);
    const box = read(pending);
    const staticLayer = readStaticLayer(yoga, pending);
    return staticLayer === null ? box : { ...box, staticLayer };
  } finally {
    for (const node of measured) node.unsetMeasureFunc();
    rootYoga.freeRecursive();
  }
}

/** Every `ink-static` of the tree in document order, even the ones under `display: none`. */
export function findStaticNodes(root: InkNode): readonly InkNode[] {
  const found: InkNode[] = [];
  // Runs on the raw tree, before flatten can reject one that is too deep, so it must not recurse.
  const pending = [...root.children].reverse();
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.tag === 'ink-static') found.push(node);
    else for (const child of [...node.children].reverse()) pending.push(child);
  }
  return found;
}

/** Fills `yogaNode` for `node` and creates the Yoga nodes of its children. */
function build(
  yoga: Yoga,
  node: InkNode,
  yogaNode: YogaNode,
  inherited: CellStyle,
  measured: YogaNode[],
): Pending {
  const props = node.owner?.inkProps() ?? {};
  // Its line breaks take rows where it stands, as a text of its own does in Ink.
  if (holdsText(node.tag) || node.tag === 'ink-newline') {
    return buildText(yoga, node, yogaNode, props, inherited, measured);
  }
  if (node.tag !== 'ink-root') {
    yogaNode.setFlexDirection(yoga.FLEX_DIRECTION_ROW);
    yogaNode.setFlexGrow(0);
    yogaNode.setFlexShrink(1);
    yogaNode.setFlexWrap(yoga.WRAP_NO_WRAP);
    applyBoxStyle(yoga, yogaNode, props);
  }
  const hidden = props['display'] === 'none';
  const background = parseColor(props['backgroundColor']) ?? inherited.bg;
  const style = background === inherited.bg ? inherited : { ...inherited, bg: background };
  const children: Pending[] = [];
  if (!hidden) {
    for (const child of node.children) {
      const childYoga = yoga.Node.create();
      yogaNode.insertChild(childYoga, yogaNode.getChildCount());
      children.push(build(yoga, child, childYoga, style, measured));
    }
  }
  return { node, yoga: yogaNode, children, text: null };
}

function buildText(
  yoga: Yoga,
  node: InkNode,
  yogaNode: YogaNode,
  props: Readonly<Record<string, unknown>>,
  inherited: CellStyle,
  measured: YogaNode[],
): Pending {
  yogaNode.setFlexGrow(0);
  yogaNode.setFlexShrink(1);
  yogaNode.setFlexDirection(yoga.FLEX_DIRECTION_ROW);
  const wrap = (props['wrap'] as TextWrap | undefined) ?? 'wrap';
  const squashed = squashText(node, inherited);
  yogaNode.setMeasureFunc((width, widthMode) =>
    // An unconstrained measure asks for the natural size, not a wrap at an undefined width.
    measureText(squashed, wrap, widthMode === yoga.MEASURE_MODE_UNDEFINED ? Infinity : width),
  );
  measured.push(yogaNode);
  return { node, yoga: yogaNode, children: [], text: { squashed, wrap } };
}

function read(pending: Pending): LayoutBox {
  const { yoga, node, text } = pending;
  const width = yoga.getComputedWidth();
  return {
    node,
    x: yoga.getComputedLeft(),
    y: yoga.getComputedTop(),
    width,
    height: yoga.getComputedHeight(),
    lines:
      text === null
        ? null
        : text.squashed === ''
          ? []
          : layoutLines(text.squashed, width, text.wrap),
    // ink-static takes part in the layout, as an absolute child, but its output is painted apart.
    children: pending.children.filter((child) => child.node.tag !== 'ink-static').map(read),
  };
}

/** Only the first `ink-static` of the tree counts, and only if nothing hides it. */
function readStaticLayer(yoga: Yoga, root: Pending): StaticLayer | null {
  const [first] = findStaticNodes(root.node);
  if (first === undefined || first.owner?.inkProps()['display'] === 'none') return null;
  const pending = findPending(root, first);
  if (pending === null) return null;
  const box = read(pending);
  return {
    box,
    columns: box.x + box.width + pending.yoga.getComputedMargin(yoga.EDGE_RIGHT),
    rows: box.y + box.height + pending.yoga.getComputedMargin(yoga.EDGE_BOTTOM),
  };
}

/** A hidden box builds no children, so a node under one has no entry. */
function findPending(pending: Pending, node: InkNode): Pending | null {
  if (pending.node === node) return pending;
  for (const child of pending.children) {
    const found = findPending(child, node);
    if (found !== null) return found;
  }
  return null;
}
