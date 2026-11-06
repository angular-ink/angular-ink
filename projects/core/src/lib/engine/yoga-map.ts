import type { Align, FlexDirection, Justify, Node as YogaNode, Wrap, Yoga } from 'yoga-layout/load';

type Props = Readonly<Record<string, unknown>>;
type Size = number | `${number}%`;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' ? value : undefined;

/** Any string is a percentage of its leading number, as in Ink: `'50x'` is half the parent. */
function asSize(value: unknown): Size | undefined {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return undefined;
  const percent = Number.parseFloat(value);
  return Number.isNaN(percent) ? undefined : (`${String(percent)}%` as Size);
}

interface Tables {
  readonly flexWrap: ReadonlyMap<unknown, Wrap>;
  readonly flexDirection: ReadonlyMap<unknown, FlexDirection>;
  readonly alignItems: ReadonlyMap<unknown, Align>;
  readonly alignSelf: ReadonlyMap<unknown, Align>;
  readonly alignContent: ReadonlyMap<unknown, Align>;
  readonly justifyContent: ReadonlyMap<unknown, Justify>;
}

const tablesByYoga = new WeakMap<Yoga, Tables>();

function tablesOf(yoga: Yoga): Tables {
  let tables = tablesByYoga.get(yoga);
  if (tables === undefined) {
    tables = {
      flexWrap: new Map([
        ['nowrap', yoga.WRAP_NO_WRAP],
        ['wrap', yoga.WRAP_WRAP],
        ['wrap-reverse', yoga.WRAP_WRAP_REVERSE],
      ]),
      flexDirection: new Map([
        ['row', yoga.FLEX_DIRECTION_ROW],
        ['row-reverse', yoga.FLEX_DIRECTION_ROW_REVERSE],
        ['column', yoga.FLEX_DIRECTION_COLUMN],
        ['column-reverse', yoga.FLEX_DIRECTION_COLUMN_REVERSE],
      ]),
      alignItems: new Map([
        ['stretch', yoga.ALIGN_STRETCH],
        ['flex-start', yoga.ALIGN_FLEX_START],
        ['center', yoga.ALIGN_CENTER],
        ['flex-end', yoga.ALIGN_FLEX_END],
        ['baseline', yoga.ALIGN_BASELINE],
      ]),
      alignSelf: new Map([
        ['auto', yoga.ALIGN_AUTO],
        ['flex-start', yoga.ALIGN_FLEX_START],
        ['center', yoga.ALIGN_CENTER],
        ['flex-end', yoga.ALIGN_FLEX_END],
        ['stretch', yoga.ALIGN_STRETCH],
        ['baseline', yoga.ALIGN_BASELINE],
      ]),
      alignContent: new Map([
        ['flex-start', yoga.ALIGN_FLEX_START],
        ['center', yoga.ALIGN_CENTER],
        ['flex-end', yoga.ALIGN_FLEX_END],
        ['space-between', yoga.ALIGN_SPACE_BETWEEN],
        ['space-around', yoga.ALIGN_SPACE_AROUND],
        ['space-evenly', yoga.ALIGN_SPACE_EVENLY],
        ['stretch', yoga.ALIGN_STRETCH],
      ]),
      justifyContent: new Map([
        ['flex-start', yoga.JUSTIFY_FLEX_START],
        ['center', yoga.JUSTIFY_CENTER],
        ['flex-end', yoga.JUSTIFY_FLEX_END],
        ['space-between', yoga.JUSTIFY_SPACE_BETWEEN],
        ['space-around', yoga.JUSTIFY_SPACE_AROUND],
        ['space-evenly', yoga.JUSTIFY_SPACE_EVENLY],
      ]),
    };
    tablesByYoga.set(yoga, tables);
  }
  return tables;
}

export function applyPosition(yoga: Yoga, node: YogaNode, props: Props): void {
  const { position } = props;
  if (position !== undefined) {
    node.setPositionType(
      position === 'absolute'
        ? yoga.POSITION_TYPE_ABSOLUTE
        : position === 'static'
          ? yoga.POSITION_TYPE_STATIC
          : yoga.POSITION_TYPE_RELATIVE,
    );
  }
  const edges = [
    ['top', yoga.EDGE_TOP],
    ['right', yoga.EDGE_RIGHT],
    ['bottom', yoga.EDGE_BOTTOM],
    ['left', yoga.EDGE_LEFT],
  ] as const;
  for (const [name, edge] of edges) {
    const value = asSize(props[name]);
    if (value !== undefined) node.setPosition(edge, value);
  }
}

export function applyMargin(yoga: Yoga, node: YogaNode, props: Props): void {
  // Left and right use the start and end edges, as Ink does; the direction is always LTR.
  const edges = [
    ['margin', yoga.EDGE_ALL],
    ['marginX', yoga.EDGE_HORIZONTAL],
    ['marginY', yoga.EDGE_VERTICAL],
    ['marginLeft', yoga.EDGE_START],
    ['marginRight', yoga.EDGE_END],
    ['marginTop', yoga.EDGE_TOP],
    ['marginBottom', yoga.EDGE_BOTTOM],
  ] as const;
  for (const [name, edge] of edges) {
    const value = asNumber(props[name]);
    if (value !== undefined) node.setMargin(edge, value);
  }
}

export function applyPadding(yoga: Yoga, node: YogaNode, props: Props): void {
  const edges = [
    ['padding', yoga.EDGE_ALL],
    ['paddingX', yoga.EDGE_HORIZONTAL],
    ['paddingY', yoga.EDGE_VERTICAL],
    ['paddingLeft', yoga.EDGE_LEFT],
    ['paddingRight', yoga.EDGE_RIGHT],
    ['paddingTop', yoga.EDGE_TOP],
    ['paddingBottom', yoga.EDGE_BOTTOM],
  ] as const;
  for (const [name, edge] of edges) {
    const value = asNumber(props[name]);
    if (value !== undefined) node.setPadding(edge, value);
  }
}

export function applyFlex(yoga: Yoga, node: YogaNode, props: Props): void {
  const tables = tablesOf(yoga);
  const grow = asNumber(props['flexGrow']);
  if (grow !== undefined) node.setFlexGrow(grow);
  if ('flexShrink' in props) node.setFlexShrink(asNumber(props['flexShrink']) ?? 1);
  const basis = asSize(props['flexBasis']);
  if (basis !== undefined) node.setFlexBasis(basis);
  const wrap = tables.flexWrap.get(props['flexWrap']);
  if (wrap !== undefined) node.setFlexWrap(wrap);
  const direction = tables.flexDirection.get(props['flexDirection']);
  if (direction !== undefined) node.setFlexDirection(direction);
  const alignItems = tables.alignItems.get(props['alignItems']);
  if (alignItems !== undefined) node.setAlignItems(alignItems);
  const alignSelf = tables.alignSelf.get(props['alignSelf']);
  if (alignSelf !== undefined) node.setAlignSelf(alignSelf);
  const alignContent = tables.alignContent.get(props['alignContent']);
  if (alignContent !== undefined) node.setAlignContent(alignContent);
  const justify = tables.justifyContent.get(props['justifyContent']);
  if (justify !== undefined) node.setJustifyContent(justify);
}

export function applyDimensions(_yoga: Yoga, node: YogaNode, props: Props): void {
  const width = asSize(props['width']);
  if (width !== undefined) node.setWidth(width);
  const height = asSize(props['height']);
  if (height !== undefined) node.setHeight(height);
  const minWidth = asNumber(props['minWidth']);
  if (minWidth !== undefined) node.setMinWidth(minWidth);
  const minHeight = asSize(props['minHeight']);
  if (minHeight !== undefined) node.setMinHeight(minHeight);
  const maxWidth = asNumber(props['maxWidth']);
  if (maxWidth !== undefined) node.setMaxWidth(maxWidth);
  const maxHeight = asSize(props['maxHeight']);
  if (maxHeight !== undefined) node.setMaxHeight(maxHeight);
  const aspectRatio = asNumber(props['aspectRatio']);
  if (aspectRatio !== undefined) node.setAspectRatio(aspectRatio);
}

export function applyDisplay(yoga: Yoga, node: YogaNode, props: Props): void {
  if ('display' in props) {
    node.setDisplay(props['display'] === 'none' ? yoga.DISPLAY_NONE : yoga.DISPLAY_FLEX);
  }
}

/** A border takes one cell on each side that has one; `borderTop: false` and the like turn a side off. */
export function applyBorder(yoga: Yoga, node: YogaNode, props: Props): void {
  const width = props['borderStyle'] ? 1 : 0;
  node.setBorder(yoga.EDGE_TOP, props['borderTop'] === false ? 0 : width);
  node.setBorder(yoga.EDGE_BOTTOM, props['borderBottom'] === false ? 0 : width);
  node.setBorder(yoga.EDGE_LEFT, props['borderLeft'] === false ? 0 : width);
  node.setBorder(yoga.EDGE_RIGHT, props['borderRight'] === false ? 0 : width);
}

export function applyGap(yoga: Yoga, node: YogaNode, props: Props): void {
  const gaps = [
    ['gap', yoga.GUTTER_ALL],
    ['columnGap', yoga.GUTTER_COLUMN],
    ['rowGap', yoga.GUTTER_ROW],
  ] as const;
  for (const [name, gutter] of gaps) {
    const value = asNumber(props[name]);
    if (value !== undefined) node.setGap(gutter, value);
  }
}

/** Maps the props of an `ink-box` (or any box-like element) to Yoga setters. */
export function applyBoxStyle(yoga: Yoga, node: YogaNode, props: Props): void {
  applyPosition(yoga, node, props);
  applyMargin(yoga, node, props);
  applyPadding(yoga, node, props);
  applyFlex(yoga, node, props);
  applyDimensions(yoga, node, props);
  applyDisplay(yoga, node, props);
  applyBorder(yoga, node, props);
  applyGap(yoga, node, props);
}
