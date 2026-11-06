import { loadYoga, type Yoga } from 'yoga-layout/load';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { findStaticNodes, layoutTree, type LayoutBox } from './layout';
import { createNode, type InkNode } from '../tree/node';

let yoga: Yoga;

beforeAll(async () => {
  yoga = await loadYoga();
});

function element(tag: string, props: Record<string, unknown>, ...children: InkNode[]): InkNode {
  const node = createNode('element', tag);
  node.owner = { inkProps: () => props };
  for (const child of children) {
    child.parent = node;
    node.children.push(child);
  }
  return node;
}

const box = (props: Record<string, unknown>, ...children: InkNode[]): InkNode =>
  element('ink-box', props, ...children);
const text = (props: Record<string, unknown>, ...children: InkNode[]): InkNode =>
  element('ink-text', props, ...children);
const literal = (value: string): InkNode => createNode('text', '', value);
/** A box of a fixed size in cells. */
const leaf = (width: number, height: number, props: Record<string, unknown> = {}): InkNode =>
  box({ width, height, ...props });

function rootNode(...children: InkNode[]): InkNode {
  const tree = createNode('element', 'ink-root');
  for (const child of children) {
    child.parent = tree;
    tree.children.push(child);
  }
  return tree;
}

const root = (columns: number, ...children: InkNode[]): LayoutBox =>
  layoutTree(rootNode(...children), columns, yoga);

type Rect = readonly [x: number, y: number, width: number, height: number];
const rectOf = (layout: LayoutBox): Rect => [layout.x, layout.y, layout.width, layout.height];

describe('layoutTree root', () => {
  it('gives the root the width of the terminal and the height of its content', () => {
    const layout = root(30, leaf(3, 1), leaf(4, 2));
    expect(rectOf(layout)).toEqual([0, 0, 30, 3]);
  });

  it('stacks the children of the root in a column', () => {
    const layout = root(30, leaf(3, 1), leaf(4, 2));
    expect(layout.children.map(rectOf)).toEqual([
      [0, 0, 3, 1],
      [0, 1, 4, 2],
    ]);
  });

  it('lays out left to right: a narrow child sits at the left edge', () => {
    expect(root(20, leaf(5, 1)).children.map(rectOf)).toEqual([[0, 0, 5, 1]]);
  });

  it('keeps the node of each box', () => {
    const child = leaf(1, 1);
    const layout = root(10, child);
    expect(layout.children[0]?.node.tag).toBe('ink-box');
    expect(layout.children[0]?.node.owner).toBe(child.owner);
  });

  it('does not change the tree it receives', () => {
    const child = box({ width: 4 }, element('ng-host', {}, leaf(1, 1)));
    root(10, child);
    expect(child.children).toHaveLength(1);
    expect(child.children[0]?.tag).toBe('ng-host');
  });

  it('leaves ink-static out of the live layout', () => {
    const layout = root(
      10,
      element('ink-static', { position: 'absolute' }, leaf(5, 5)),
      leaf(2, 1),
    );
    expect(layout.children.map(rectOf)).toEqual([[0, 0, 2, 1]]);
    expect(rectOf(layout)).toEqual([0, 0, 10, 1]);
  });

  it('gives the root the layer of the first ink-static, wrapped in its parent', () => {
    const permanent = element('ink-static', { position: 'absolute', marginBottom: 1 }, leaf(5, 2));
    const layout = root(10, box({ width: 8 }, permanent), element('ink-static', {}, leaf(1, 1)));
    expect(layout.staticLayer?.columns).toBe(5);
    expect(layout.staticLayer?.rows).toBe(3);
    expect(layout.children[0]?.children).toEqual([]);
    expect(layout.children[0]?.staticLayer).toBeUndefined();
  });

  it('finds every ink-static in document order, at any depth', () => {
    const first = element('ink-static', {});
    const second = element('ink-static', {});
    const third = element('ink-static', {});
    let deep = box({}, second);
    for (let depth = 0; depth < 200_000; depth++) deep = box({}, deep);
    expect(findStaticNodes(rootNode(box({}, first), deep, third))).toEqual([first, second, third]);
  });

  it('has no layer for an ink-static that is hidden, or for the one after it', () => {
    const hidden = element('ink-static', { position: 'absolute' }, leaf(5, 5));
    const later = element('ink-static', { position: 'absolute' }, leaf(5, 5));
    expect(root(10, box({ display: 'none' }, hidden), later).staticLayer).toBeUndefined();
    const self = element('ink-static', { display: 'none' }, leaf(5, 5));
    expect(root(10, self).staticLayer).toBeUndefined();
  });
});

describe('ink-box defaults', () => {
  it('is a row that does not wrap and shrinks (INK-BOX-03)', () => {
    const layout = root(20, box({ width: 10 }, leaf(8, 1), leaf(8, 1)));
    expect(layout.children[0]?.children.map(rectOf)).toEqual([
      [0, 0, 5, 1],
      [5, 0, 5, 1],
    ]);
  });

  it('does not grow', () => {
    const layout = root(20, box({}, box({}), leaf(2, 1)));
    expect(layout.children[0]?.children.map(rectOf)).toEqual([
      [0, 0, 0, 1],
      [0, 0, 2, 1],
    ]);
  });

  it('lets the inputs override the defaults', () => {
    const layout = root(20, box({ flexDirection: 'column' }, leaf(2, 1), leaf(3, 1)));
    expect(layout.children[0]?.children.map(rectOf)).toEqual([
      [0, 0, 2, 1],
      [0, 1, 3, 1],
    ]);
  });

  it('makes ink-spacer take the free space', () => {
    const layout = root(
      20,
      box({}, leaf(2, 1), element('ink-spacer', { flexGrow: 1 }), leaf(3, 1)),
    );
    expect(layout.children[0]?.children.map(rectOf)).toEqual([
      [0, 0, 2, 1],
      [2, 0, 15, 1],
      [17, 0, 3, 1],
    ]);
  });
});

interface StyleCase {
  readonly name: string;
  readonly props: Record<string, unknown>;
  readonly kids: readonly InkNode[];
  readonly box: Rect;
  readonly kidRects: readonly Rect[];
  readonly columns?: number;
}

const styleCases: readonly StyleCase[] = [
  {
    name: 'padding',
    props: { padding: 2 },
    kids: [leaf(5, 1)],
    box: [0, 0, 20, 5],
    kidRects: [[2, 2, 5, 1]],
  },
  {
    name: 'paddingX',
    props: { paddingX: 3 },
    kids: [leaf(4, 1)],
    box: [0, 0, 20, 1],
    kidRects: [[3, 0, 4, 1]],
  },
  {
    name: 'paddingY',
    props: { paddingY: 1 },
    kids: [leaf(4, 1)],
    box: [0, 0, 20, 3],
    kidRects: [[0, 1, 4, 1]],
  },
  {
    name: 'paddingTop',
    props: { paddingTop: 2 },
    kids: [leaf(4, 1)],
    box: [0, 0, 20, 3],
    kidRects: [[0, 2, 4, 1]],
  },
  {
    name: 'paddingBottom',
    props: { paddingBottom: 2 },
    kids: [leaf(4, 1)],
    box: [0, 0, 20, 3],
    kidRects: [[0, 0, 4, 1]],
  },
  {
    name: 'paddingLeft',
    props: { paddingLeft: 2 },
    kids: [leaf(4, 1)],
    box: [0, 0, 20, 1],
    kidRects: [[2, 0, 4, 1]],
  },
  {
    name: 'paddingRight',
    props: { paddingRight: 4, width: 10 },
    kids: [leaf(8, 1)],
    box: [0, 0, 10, 1],
    kidRects: [[0, 0, 6, 1]],
  },
  {
    name: 'margin',
    props: { margin: 1 },
    kids: [leaf(2, 1)],
    box: [1, 1, 18, 1],
    kidRects: [[0, 0, 2, 1]],
  },
  {
    name: 'marginX',
    props: { marginX: 2 },
    kids: [leaf(2, 1)],
    box: [2, 0, 16, 1],
    kidRects: [[0, 0, 2, 1]],
  },
  {
    name: 'marginY',
    props: { marginY: 2 },
    kids: [leaf(2, 1)],
    box: [0, 2, 20, 1],
    kidRects: [[0, 0, 2, 1]],
  },
  {
    name: 'marginTop',
    props: { marginTop: 3 },
    kids: [],
    box: [0, 3, 20, 0],
    kidRects: [],
  },
  {
    name: 'marginBottom',
    props: { marginBottom: 3, height: 2 },
    kids: [],
    box: [0, 0, 20, 2],
    kidRects: [],
  },
  {
    name: 'marginLeft',
    props: { marginLeft: 4 },
    kids: [],
    box: [4, 0, 16, 0],
    kidRects: [],
  },
  {
    name: 'marginRight',
    props: { marginRight: 4 },
    kids: [],
    box: [0, 0, 16, 0],
    kidRects: [],
  },
  {
    name: 'gap',
    props: { gap: 1 },
    kids: [leaf(2, 1), leaf(3, 1)],
    box: [0, 0, 20, 1],
    kidRects: [
      [0, 0, 2, 1],
      [3, 0, 3, 1],
    ],
  },
  {
    name: 'columnGap',
    props: { columnGap: 2 },
    kids: [leaf(2, 1), leaf(3, 1)],
    box: [0, 0, 20, 1],
    kidRects: [
      [0, 0, 2, 1],
      [4, 0, 3, 1],
    ],
  },
  {
    name: 'rowGap',
    props: { rowGap: 1, flexDirection: 'column' },
    kids: [leaf(2, 1), leaf(3, 1)],
    box: [0, 0, 20, 3],
    kidRects: [
      [0, 0, 2, 1],
      [0, 2, 3, 1],
    ],
  },
  {
    name: 'justifyContent flex-start',
    props: { justifyContent: 'flex-start' },
    kids: [leaf(2, 1), leaf(4, 1)],
    box: [0, 0, 20, 1],
    kidRects: [
      [0, 0, 2, 1],
      [2, 0, 4, 1],
    ],
  },
  {
    name: 'justifyContent flex-end',
    props: { justifyContent: 'flex-end' },
    kids: [leaf(2, 1), leaf(4, 1)],
    box: [0, 0, 20, 1],
    kidRects: [
      [14, 0, 2, 1],
      [16, 0, 4, 1],
    ],
  },
  {
    name: 'justifyContent center',
    props: { justifyContent: 'center' },
    kids: [leaf(2, 1), leaf(4, 1)],
    box: [0, 0, 20, 1],
    kidRects: [
      [7, 0, 2, 1],
      [9, 0, 4, 1],
    ],
  },
  {
    name: 'justifyContent space-between',
    props: { justifyContent: 'space-between' },
    kids: [leaf(2, 1), leaf(4, 1)],
    box: [0, 0, 20, 1],
    kidRects: [
      [0, 0, 2, 1],
      [16, 0, 4, 1],
    ],
  },
  {
    name: 'justifyContent space-around',
    props: { justifyContent: 'space-around' },
    kids: [leaf(2, 1), leaf(4, 1)],
    columns: 18,
    box: [0, 0, 18, 1],
    kidRects: [
      [3, 0, 2, 1],
      [11, 0, 4, 1],
    ],
  },
  {
    name: 'justifyContent space-evenly',
    props: { justifyContent: 'space-evenly' },
    kids: [leaf(2, 1), leaf(4, 1)],
    columns: 21,
    box: [0, 0, 21, 1],
    kidRects: [
      [5, 0, 2, 1],
      [12, 0, 4, 1],
    ],
  },
  {
    name: 'alignItems flex-start',
    props: { alignItems: 'flex-start', height: 5 },
    kids: [leaf(2, 1)],
    box: [0, 0, 20, 5],
    kidRects: [[0, 0, 2, 1]],
  },
  {
    name: 'alignItems center',
    props: { alignItems: 'center', height: 5 },
    kids: [leaf(2, 1)],
    box: [0, 0, 20, 5],
    kidRects: [[0, 2, 2, 1]],
  },
  {
    name: 'alignItems flex-end',
    props: { alignItems: 'flex-end', height: 5 },
    kids: [leaf(2, 1)],
    box: [0, 0, 20, 5],
    kidRects: [[0, 4, 2, 1]],
  },
  {
    name: 'alignItems stretch',
    props: { alignItems: 'stretch', height: 5 },
    kids: [box({ width: 2 })],
    box: [0, 0, 20, 5],
    kidRects: [[0, 0, 2, 5]],
  },
  {
    name: 'alignItems baseline',
    props: { alignItems: 'baseline' },
    kids: [leaf(2, 1), leaf(2, 3)],
    box: [0, 0, 20, 3],
    kidRects: [
      [0, 2, 2, 1],
      [2, 0, 2, 3],
    ],
  },
  {
    name: 'alignSelf flex-end',
    props: { alignItems: 'flex-start', height: 5 },
    kids: [leaf(2, 1, { alignSelf: 'flex-end' })],
    box: [0, 0, 20, 5],
    kidRects: [[0, 4, 2, 1]],
  },
  {
    name: 'alignSelf center',
    props: { alignItems: 'flex-start', height: 5 },
    kids: [leaf(2, 1, { alignSelf: 'center' })],
    box: [0, 0, 20, 5],
    kidRects: [[0, 2, 2, 1]],
  },
  {
    name: 'alignSelf flex-start',
    props: { alignItems: 'flex-end', height: 5 },
    kids: [leaf(2, 1, { alignSelf: 'flex-start' })],
    box: [0, 0, 20, 5],
    kidRects: [[0, 0, 2, 1]],
  },
  {
    name: 'alignSelf stretch',
    props: { alignItems: 'flex-start', height: 5 },
    kids: [box({ width: 2, alignSelf: 'stretch' })],
    box: [0, 0, 20, 5],
    kidRects: [[0, 0, 2, 5]],
  },
  {
    name: 'alignSelf auto',
    props: { alignItems: 'flex-end', height: 5 },
    kids: [leaf(2, 1, { alignSelf: 'auto' })],
    box: [0, 0, 20, 5],
    kidRects: [[0, 4, 2, 1]],
  },
  {
    name: 'alignSelf baseline',
    props: {},
    kids: [leaf(2, 1, { alignSelf: 'baseline' }), leaf(2, 3, { alignSelf: 'baseline' })],
    box: [0, 0, 20, 3],
    kidRects: [
      [0, 2, 2, 1],
      [2, 0, 2, 3],
    ],
  },
  {
    name: 'flexWrap wrap',
    props: { flexWrap: 'wrap', width: 5 },
    kids: [leaf(3, 1), leaf(3, 1)],
    box: [0, 0, 5, 2],
    kidRects: [
      [0, 0, 3, 1],
      [0, 1, 3, 1],
    ],
  },
  {
    name: 'flexWrap wrap-reverse',
    props: { flexWrap: 'wrap-reverse', width: 5 },
    kids: [leaf(3, 1), leaf(3, 1)],
    box: [0, 0, 5, 2],
    kidRects: [
      [0, 1, 3, 1],
      [0, 0, 3, 1],
    ],
  },
  {
    name: 'flexWrap nowrap',
    props: { flexWrap: 'nowrap' },
    kids: [leaf(3, 1), leaf(3, 1)],
    box: [0, 0, 20, 1],
    kidRects: [
      [0, 0, 3, 1],
      [3, 0, 3, 1],
    ],
  },
  ...(
    [
      ['flex-start', [0, 1]],
      ['flex-end', [4, 5]],
      ['center', [2, 3]],
      ['space-between', [0, 5]],
      ['space-around', [1, 4]],
      ['stretch', [0, 3]],
    ] as const
  ).map(([alignContent, ys]): StyleCase => ({
    name: `alignContent ${alignContent}`,
    props: { flexWrap: 'wrap', width: 5, height: 6, alignContent },
    kids: [leaf(3, 1), leaf(3, 1)],
    box: [0, 0, 5, 6],
    kidRects: [
      [0, ys[0], 3, 1],
      [0, ys[1], 3, 1],
    ],
  })),
  {
    name: 'flexDirection column-reverse',
    props: { flexDirection: 'column-reverse', height: 4 },
    kids: [leaf(2, 1), leaf(3, 1)],
    box: [0, 0, 20, 4],
    kidRects: [
      [0, 3, 2, 1],
      [0, 2, 3, 1],
    ],
  },
  {
    name: 'flexDirection row-reverse',
    props: { flexDirection: 'row-reverse' },
    kids: [leaf(2, 1), leaf(3, 1)],
    box: [0, 0, 20, 1],
    kidRects: [
      [18, 0, 2, 1],
      [15, 0, 3, 1],
    ],
  },
  {
    name: 'flexBasis',
    props: {},
    kids: [box({ flexBasis: 8 }), leaf(2, 1)],
    box: [0, 0, 20, 1],
    kidRects: [
      [0, 0, 8, 1],
      [8, 0, 2, 1],
    ],
  },
  {
    name: 'flexBasis 50%',
    props: {},
    kids: [box({ flexBasis: '50%' }), leaf(2, 1)],
    box: [0, 0, 20, 1],
    kidRects: [
      [0, 0, 10, 1],
      [10, 0, 2, 1],
    ],
  },
  {
    name: 'flexGrow',
    props: {},
    kids: [box({ flexGrow: 1 }), leaf(5, 1)],
    box: [0, 0, 20, 1],
    kidRects: [
      [0, 0, 15, 1],
      [15, 0, 5, 1],
    ],
  },
  {
    name: 'flexShrink',
    props: { width: 10 },
    kids: [leaf(8, 1), leaf(8, 1, { flexShrink: 0 })],
    box: [0, 0, 10, 1],
    kidRects: [
      [0, 0, 2, 1],
      [2, 0, 8, 1],
    ],
  },
  {
    name: 'width as a percentage',
    props: { width: '50%' },
    kids: [],
    box: [0, 0, 10, 0],
    kidRects: [],
  },
  {
    name: 'height as a percentage of a fixed parent',
    props: { height: 10 },
    kids: [box({ height: '50%', width: 2 })],
    box: [0, 0, 20, 10],
    kidRects: [[0, 0, 2, 5]],
  },
  {
    name: 'minWidth',
    props: { width: 5, minWidth: 12 },
    kids: [],
    box: [0, 0, 12, 0],
    kidRects: [],
  },
  {
    name: 'maxWidth',
    props: { maxWidth: 8 },
    kids: [],
    box: [0, 0, 8, 0],
    kidRects: [],
  },
  {
    name: 'minHeight',
    props: { minHeight: 4 },
    kids: [leaf(2, 1)],
    box: [0, 0, 20, 4],
    kidRects: [[0, 0, 2, 1]],
  },
  {
    name: 'minHeight as a percentage',
    props: { height: 10 },
    kids: [box({ width: 2, height: 1, minHeight: '40%' })],
    box: [0, 0, 20, 10],
    kidRects: [[0, 0, 2, 4]],
  },
  {
    name: 'maxHeight',
    props: { maxHeight: 2 },
    kids: [leaf(2, 5)],
    box: [0, 0, 20, 2],
    kidRects: [[0, 0, 2, 5]],
  },
  {
    name: 'maxHeight as a percentage',
    props: { height: 10 },
    kids: [box({ width: 2, height: 9, maxHeight: '30%' })],
    box: [0, 0, 20, 10],
    kidRects: [[0, 0, 2, 3]],
  },
  {
    name: 'aspectRatio',
    props: { width: 10, aspectRatio: 2 },
    kids: [],
    box: [0, 0, 10, 5],
    kidRects: [],
  },
  {
    name: 'position absolute with top and left',
    props: { height: 5 },
    kids: [leaf(2, 1), box({ position: 'absolute', top: 2, left: 3, width: 4, height: 1 })],
    box: [0, 0, 20, 5],
    kidRects: [
      [0, 0, 2, 1],
      [3, 2, 4, 1],
    ],
  },
  {
    name: 'position absolute with right, bottom and a percentage',
    props: { height: 5 },
    kids: [
      box({ position: 'absolute', right: 1, bottom: 1, width: 4, height: 1 }),
      box({ position: 'absolute', left: '50%', width: 2, height: 1 }),
    ],
    box: [0, 0, 20, 5],
    kidRects: [
      [15, 3, 4, 1],
      [10, 0, 2, 1],
    ],
  },
  {
    name: 'position relative',
    props: {},
    kids: [leaf(2, 1, { position: 'relative', top: 1, left: 2 })],
    box: [0, 0, 20, 1],
    kidRects: [[2, 1, 2, 1]],
  },
  {
    name: 'position static',
    props: {},
    kids: [leaf(2, 1, { position: 'static', top: 3, left: 5 })],
    box: [0, 0, 20, 1],
    kidRects: [[0, 0, 2, 1]],
  },
  {
    name: 'display none',
    props: {},
    kids: [leaf(5, 1, { display: 'none' }), leaf(2, 1)],
    box: [0, 0, 20, 1],
    kidRects: [
      [0, 0, 0, 0],
      [0, 0, 2, 1],
    ],
  },
  {
    name: 'display flex',
    props: {},
    kids: [leaf(5, 1, { display: 'flex' })],
    box: [0, 0, 20, 1],
    kidRects: [[0, 0, 5, 1]],
  },
  {
    name: 'borderStyle',
    props: { borderStyle: 'single' },
    kids: [leaf(2, 1)],
    box: [0, 0, 20, 3],
    kidRects: [[1, 1, 2, 1]],
  },
  {
    name: 'borderStyle with borderTop off',
    props: { borderStyle: 'round', borderTop: false },
    kids: [leaf(2, 1)],
    box: [0, 0, 20, 2],
    kidRects: [[1, 0, 2, 1]],
  },
  {
    name: 'borderStyle with borderBottom off',
    props: { borderStyle: 'round', borderBottom: false },
    kids: [leaf(2, 1)],
    box: [0, 0, 20, 2],
    kidRects: [[1, 1, 2, 1]],
  },
  {
    name: 'borderStyle with borderLeft and borderRight off',
    props: { borderStyle: 'double', borderLeft: false, borderRight: false, width: 6 },
    kids: [leaf(8, 1)],
    box: [0, 0, 6, 3],
    kidRects: [[0, 1, 6, 1]],
  },
  {
    name: 'borderStyle with a custom set of characters',
    props: {
      borderStyle: {
        topLeft: '+',
        top: '-',
        topRight: '+',
        left: '|',
        bottomLeft: '+',
        bottom: '-',
        bottomRight: '+',
        right: '|',
      },
    },
    kids: [leaf(2, 1)],
    box: [0, 0, 20, 3],
    kidRects: [[1, 1, 2, 1]],
  },
  {
    name: 'borderTop false without a borderStyle',
    props: { borderTop: false },
    kids: [leaf(2, 1)],
    box: [0, 0, 20, 1],
    kidRects: [[0, 0, 2, 1]],
  },
  {
    name: 'border together with padding',
    props: { borderStyle: 'single', padding: 1 },
    kids: [leaf(2, 1)],
    box: [0, 0, 20, 5],
    kidRects: [[2, 2, 2, 1]],
  },
];

describe('layoutTree box styles (INK-BOX-STYLE-01..42)', () => {
  it.each(styleCases)('maps $name to Yoga', (testCase) => {
    const layout = root(testCase.columns ?? 20, box(testCase.props, ...testCase.kids));
    const target = layout.children[0];
    expect(target ? rectOf(target) : null).toEqual(testCase.box);
    expect(target?.children.map(rectOf)).toEqual(testCase.kidRects);
  });

  it('ignores a prop that has no layout meaning', () => {
    const layout = root(20, box({ backgroundColor: 'red', overflow: 'hidden', color: 'blue' }));
    expect(rectOf(layout.children[0]!)).toEqual([0, 0, 20, 0]);
  });

  it('does not lay out the children of a hidden box', () => {
    const hidden = root(20, box({ display: 'none' }, leaf(3, 1))).children[0];
    expect(hidden?.children).toEqual([]);
    expect(hidden?.lines).toBeNull();
  });
});

describe('layoutTree size strings', () => {
  const widthOf = (width: unknown) => root(40, box({ width })).children[0]?.width;

  it('reads a string with no percent sign as a percentage, as Ink does', () => {
    expect(widthOf('50x')).toBe(20);
    expect(widthOf('25')).toBe(10);
  });

  it('leaves a string with no number at the default', () => {
    expect(widthOf('wide')).toBe(widthOf(undefined));
  });
});

describe('layoutTree text (INK-TEXT-13)', () => {
  const textLayout = (columns: number, node: InkNode): LayoutBox => {
    const found = root(columns, box({}, node)).children[0]?.children[0];
    if (!found) throw new Error('no text box');
    return found;
  };

  it('measures the natural size of text that fits', () => {
    const layout = textLayout(20, text({}, literal('hello world')));
    expect(rectOf(layout)).toEqual([0, 0, 11, 1]);
    expect(layout.lines).toEqual(['hello world']);
    expect(layout.children).toEqual([]);
  });

  it('wraps to the width of the terminal and fills lines with the final width', () => {
    const layout = textLayout(6, text({}, literal('hello world')));
    expect(rectOf(layout)).toEqual([0, 0, 6, 2]);
    expect(layout.lines).toEqual(['hello ', 'world']);
  });

  it('counts one row per line of text', () => {
    const layout = textLayout(20, text({}, literal('a\nbb\nccc')));
    expect(rectOf(layout)).toEqual([0, 0, 3, 3]);
    expect(layout.lines).toEqual(['a', 'bb', 'ccc']);
  });

  it('does not grow and shrinks in a row (flexGrow 0, flexShrink 1)', () => {
    const grown = root(20, box({}, text({}, literal('hi')))).children[0]?.children[0];
    expect(grown ? rectOf(grown) : null).toEqual([0, 0, 2, 1]);
    const shrunk = root(6, box({}, text({}, literal('hello world')))).children[0]?.children[0];
    expect(shrunk ? rectOf(shrunk) : null).toEqual([0, 0, 6, 2]);
    expect(shrunk?.lines).toEqual(['hello ', 'world']);
  });

  it('shrinks to the width a sibling leaves', () => {
    const layout = root(12, box({}, text({}, literal('abcdefghij')), leaf(4, 1, { flexShrink: 0 })))
      .children[0];
    expect(layout?.children.map(rectOf)).toEqual([
      [0, 0, 8, 2],
      [8, 0, 4, 1],
    ]);
    expect(layout?.children[0]?.lines).toEqual(['abcdefgh', 'ij']);
  });

  it('truncates with the wrap input', () => {
    const layout = textLayout(6, text({ wrap: 'truncate' }, literal('hello world')));
    expect(rectOf(layout)).toEqual([0, 0, 6, 1]);
    expect(layout.lines).toEqual(['hello…']);
  });

  it('measures the text of nested ink-text with its styles', () => {
    const layout = textLayout(
      20,
      text({}, literal('a '), text({ bold: true }, literal('b')), literal(' c')),
    );
    expect(rectOf(layout)).toEqual([0, 0, 5, 1]);
    expect(layout.lines).toEqual(['a \x1b[1mb\x1b[0m c']);
  });

  it('gives text the background of the nearest box that sets one', () => {
    const layout = root(20, box({ backgroundColor: 'red' }, box({}, text({}, literal('x')))))
      .children[0]?.children[0]?.children[0];
    expect(layout?.lines).toEqual(['\x1b[41mx\x1b[0m']);
  });

  it('has no lines and no size for empty text', () => {
    const layout = textLayout(20, text({}));
    expect(rectOf(layout)).toEqual([0, 0, 0, 0]);
    expect(layout.lines).toEqual([]);
  });

  it('gives a box no lines', () => {
    expect(root(20, leaf(1, 1)).children[0]?.lines).toBeNull();
  });
});

describe('layoutTree memory', () => {
  const build = (): InkNode =>
    box({ padding: 1 }, text({}, literal('hello world')), box({ gap: 1 }, leaf(2, 1), leaf(3, 1)));

  const spyOnFree = () => {
    const prototype = Object.getPrototypeOf(yoga.Node.create()) as { freeRecursive(): void };
    return vi.spyOn(prototype, 'freeRecursive');
  };

  it('gives the same result twice in a row', () => {
    const tree = rootNode(build());
    const first = layoutTree(tree, 8, yoga);
    const second = layoutTree(tree, 8, yoga);
    expect(second).toEqual(first);
    expect(rectOf(first)).toEqual([0, 0, 8, 6]);
  });

  it('frees the Yoga tree after each layout', () => {
    const free = spyOnFree();
    // The spy sees the call on the root and the call each child receives from it: 6 nodes.
    root(10, build());
    expect(free).toHaveBeenCalledTimes(6);
    root(10, build());
    expect(free).toHaveBeenCalledTimes(12);
  });

  it('frees the Yoga tree when Yoga rejects a style', () => {
    const free = spyOnFree();
    const prototype = Object.getPrototypeOf(yoga.Node.create()) as { setWidth(): void };
    vi.spyOn(prototype, 'setWidth').mockImplementation(() => {
      throw new Error('rejected');
    });
    expect(() => root(10, box({ width: 5 }))).toThrow();
    expect(free).toHaveBeenCalledTimes(2);
  });

  it('rejects text outside ink-text', () => {
    expect(() => root(10, box({}, literal('loose')))).toThrow(/angular-ink:/);
  });
});
