import { loadYoga, type Yoga } from 'yoga-layout/load';
import { beforeAll, describe, expect, it } from 'vitest';
import { gridToString } from './grid';
import { layoutTree } from './layout';
import { paintTree } from './paint';
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
const words = (value: string, props: Record<string, unknown> = {}): InkNode =>
  text(props, literal(value));

function paint(columns: number, ...children: InkNode[]) {
  const tree = createNode('element', 'ink-root');
  for (const child of children) {
    child.parent = tree;
    tree.children.push(child);
  }
  return paintTree(layoutTree(tree, columns, yoga));
}

function render(columns: number, ...children: InkNode[]): string {
  return gridToString(paint(columns, ...children), { ansi: false });
}

function renderAnsi(columns: number, ...children: InkNode[]): string {
  return gridToString(paint(columns, ...children), { ansi: true });
}

describe('paintTree text', () => {
  it('paints text at the offset of every ancestor', () => {
    const tree = box({ paddingLeft: 2, paddingTop: 1 }, box({ marginLeft: 1 }, words('hi')));
    expect(render(10, tree)).toBe('\n   hi');
  });

  it('takes the grid height from the root', () => {
    const grid = paint(6, words('a'), words('b'));
    expect([grid.columns, grid.rows]).toEqual([6, 2]);
  });

  it('paints nothing for a box with display none', () => {
    expect(render(10, box({ display: 'none' }, words('hidden')), words('shown'))).toBe('shown');
  });

  it('keeps the SGR of the text', () => {
    expect(renderAnsi(10, words('hi', { color: 'red' }))).toBe('\x1b[31mhi\x1b[0m');
  });
});

describe('paintTree borders', () => {
  const frame = (borderStyle: unknown): string =>
    render(10, box({ borderStyle, width: 4, height: 3 }));

  it.each([
    ['single', '┌──┐\n│  │\n└──┘'],
    ['double', '╔══╗\n║  ║\n╚══╝'],
    ['round', '╭──╮\n│  │\n╰──╯'],
    ['bold', '┏━━┓\n┃  ┃\n┗━━┛'],
    ['singleDouble', '╓──╖\n║  ║\n╙──╜'],
    ['doubleSingle', '╒══╕\n│  │\n╘══╛'],
    ['classic', '+--+\n|  |\n+--+'],
    ['arrow', '↘↓↓↙\n→  ←\n↗↑↑↖'],
  ])('draws the %s style', (name, expected) => {
    expect(frame(name)).toBe(expected);
  });

  it('draws a custom BoxStyle', () => {
    const custom = {
      topLeft: 'a',
      top: 'b',
      topRight: 'c',
      right: 'd',
      bottomRight: 'e',
      bottom: 'f',
      bottomLeft: 'g',
      left: 'h',
    };
    expect(frame(custom)).toBe('abbc\nh  d\ngffe');
  });

  it('draws no border without a style', () => {
    expect(render(10, box({ width: 3, height: 2 }, words('x')))).toBe('x');
  });

  it('draws a border around the content', () => {
    expect(render(10, box({ borderStyle: 'single', alignSelf: 'flex-start' }, words('ab')))).toBe(
      '┌──┐\n│ab│\n└──┘',
    );
  });

  it('omits a side with border<Side> false', () => {
    const border = (side: string): string =>
      render(10, box({ borderStyle: 'single', width: 4, height: 3, [side]: false }));
    expect(border('borderLeft')).toBe('───┐\n   │\n───┘');
    expect(border('borderRight')).toBe('┌───\n│\n└───');
    expect(border('borderTop')).toBe('│  │\n│  │\n└──┘');
    expect(border('borderBottom')).toBe('┌──┐\n│  │\n│  │');
  });

  it('colors the sides, with the side color ahead of borderColor', () => {
    const out = renderAnsi(
      10,
      box({
        borderStyle: 'single',
        width: 3,
        height: 3,
        borderColor: 'green',
        borderTopColor: 'red',
        borderBackgroundColor: 'blue',
        borderLeftBackgroundColor: 'yellow',
      }),
    );
    expect(out.split('\n')).toEqual([
      '\x1b[31;44m┌─┐\x1b[0m',
      '\x1b[32;43m│\x1b[0m \x1b[32;44m│\x1b[0m',
      '\x1b[32;44m└─┘\x1b[0m',
    ]);
  });

  it('dims the sides, with the side flag ahead of borderDimColor', () => {
    const out = renderAnsi(
      10,
      box({
        borderStyle: 'single',
        width: 3,
        height: 3,
        borderDimColor: true,
        borderBottomDimColor: false,
      }),
    );
    expect(out.split('\n')).toEqual([
      '\x1b[2m┌─┐\x1b[0m',
      '\x1b[2m│\x1b[0m \x1b[2m│\x1b[0m',
      '└─┘',
    ]);
  });

  it('does not throw on a box too small for its border', () => {
    expect(() => render(10, box({ borderStyle: 'single', width: 1, height: 1 }))).not.toThrow();
  });
});

describe('paintTree backgroundColor', () => {
  it('fills the whole area of the box', () => {
    expect(renderAnsi(10, box({ backgroundColor: 'blue', width: 3, height: 2 }))).toBe(
      '\x1b[44m   \x1b[0m\n\x1b[44m   \x1b[0m',
    );
  });

  it('fills inside the border and keeps the border plain', () => {
    const out = renderAnsi(
      10,
      box({ backgroundColor: 'blue', borderStyle: 'single', width: 4, height: 3 }),
    );
    expect(out.split('\n')).toEqual(['┌──┐', '│\x1b[44m  \x1b[0m│', '└──┘']);
  });

  it('is inherited by a text without its own background', () => {
    const out = renderAnsi(
      10,
      box(
        { backgroundColor: 'blue', flexDirection: 'column', width: 3 },
        words('a'),
        words('b', { backgroundColor: 'red' }),
      ),
    );
    expect(out).toBe('\x1b[44ma  \x1b[0m\n\x1b[41mb\x1b[0m\x1b[44m  \x1b[0m');
  });

  it('reaches the cells of a nested box that has no background of its own', () => {
    const out = renderAnsi(10, box({ backgroundColor: 'blue', width: 4 }, box({}, words('ab'))));
    expect(out).toBe('\x1b[44mab  \x1b[0m');
  });
});

describe('paintTree overflow', () => {
  const wide = (): InkNode => words('abcdefgh', { wrap: 'wrap' });
  const content = (): InkNode => box({ width: 8, flexShrink: 0 }, wide());

  it('leaves the children alone without overflow hidden', () => {
    expect(render(10, box({ width: 4 }, content()))).toBe('abcdefgh');
  });

  it('clips the children to the box with overflow hidden', () => {
    expect(render(10, box({ width: 4, overflow: 'hidden' }, content()))).toBe('abcd');
  });

  it('clips vertically', () => {
    const tall = box(
      { flexDirection: 'column', height: 3, flexShrink: 0 },
      words('a'),
      words('b'),
      words('c'),
    );
    expect(render(10, box({ height: 2, overflow: 'hidden' }, tall))).toBe('a\nb');
  });

  it('clips inside the border', () => {
    const out = render(
      10,
      box({ width: 5, height: 3, borderStyle: 'single', overflow: 'hidden' }, content()),
    );
    expect(out).toBe('┌───┐\n│abc│\n└───┘');
  });

  it('clips only the x axis with overflowX', () => {
    const tall = box(
      { flexDirection: 'column', width: 8, height: 2, flexShrink: 0 },
      words('abcdefgh'),
      words('ij'),
    );
    expect(
      render(10, box({ height: 2 }, box({ width: 4, height: 1, overflowX: 'hidden' }, tall))),
    ).toBe('abcd\nij');
  });

  it('lets overflowX take priority over overflow', () => {
    const kept = render(10, box({ width: 4, overflow: 'hidden', overflowX: 'visible' }, content()));
    expect(kept).toBe('abcdefgh');
    const cut = render(10, box({ width: 4, overflow: 'visible', overflowX: 'hidden' }, content()));
    expect(cut).toBe('abcd');
  });

  it('lets overflowY take priority over overflow', () => {
    const tall = box({ flexDirection: 'column', height: 2, flexShrink: 0 }, words('a'), words('b'));
    expect(
      render(
        10,
        box({ height: 2 }, box({ height: 1, overflow: 'hidden', overflowY: 'visible' }, tall)),
      ),
    ).toBe('a\nb');
  });

  it('uses the intersection for nested clips', () => {
    const inner = box({ width: 3, overflow: 'hidden', flexShrink: 0 }, content());
    expect(render(10, box({ width: 5, overflow: 'hidden' }, inner))).toBe('abc');
    const small = box(
      { width: 2, overflow: 'hidden' },
      box({ width: 6, overflow: 'hidden', flexShrink: 0 }, content()),
    );
    expect(render(10, small)).toBe('ab');
  });

  it('never splits a wide character at the clip edge', () => {
    const cjk = box({ width: 6, flexShrink: 0 }, words('日本語'));
    expect(render(10, box({ width: 3, overflow: 'hidden' }, cjk))).toBe('日');
  });
});

describe('paintTree where a bold run ends on a dim one', () => {
  const styled = (props: Record<string, unknown>, content: string) => text(props, literal(content));

  // The output of Ink ends the bold with a code that ends the dim too, and never opens it again.
  it('loses the dim until the dim ends', () => {
    const { styles } = paint(
      40,
      box(
        {},
        styled({ dimColor: true, bold: true }, 'a'),
        styled({ dimColor: true }, 'b'),
        styled({}, 'c'),
        styled({ dimColor: true }, 'd'),
      ),
    );
    expect(styles[0]).toMatchObject({ dim: true, bold: true });
    expect(styles[1]).toMatchObject({ dim: false, bold: false });
    expect(styles[3]).toMatchObject({ dim: true });
  });

  it('loses the bold the same way when the dim ends first', () => {
    const { styles } = paint(
      40,
      box({}, styled({ dimColor: true, bold: true }, 'a'), styled({ bold: true }, 'b')),
    );
    expect(styles[1]).toMatchObject({ dim: false, bold: false });
  });

  it('keeps the dim that opens after a bold has closed', () => {
    const { styles } = paint(
      40,
      box({}, styled({ bold: true }, 'a'), styled({ dimColor: true }, 'b')),
    );
    expect(styles[1]).toMatchObject({ dim: true, bold: false });
  });

  it('starts each row again', () => {
    const { styles } = paint(
      1,
      box(
        { flexDirection: 'column' },
        styled({ dimColor: true, bold: true }, 'a'),
        styled({ dimColor: true }, 'b'),
      ),
    );
    expect(styles[1]).toMatchObject({ dim: true });
  });
});
