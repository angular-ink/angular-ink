import type { Node as YogaNode, Yoga } from 'yoga-layout/load';
import { PLAIN_STYLE, type CellStyle } from './ansi';
import { parseColor } from './color';
import { layoutLines, measureText, squashText, type TextWrap } from './text-layout';
import { applyBoxStyle } from './yoga-map';
import { flattenHosts } from '../tree/flatten';
import type { InkNode } from '../tree/node';

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
    return read(pending);
  } finally {
    for (const node of measured) node.unsetMeasureFunc();
    rootYoga.freeRecursive();
  }
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
  if (node.tag === 'ink-text') {
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
      // ink-static is laid out apart from the live tree.
      if (child.tag === 'ink-static') continue;
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
    children: pending.children.map(read),
  };
}
