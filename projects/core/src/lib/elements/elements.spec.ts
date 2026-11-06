import { Component, signal, type Type } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { mountTree } from '../platform/mount';
import type { InkNode } from '../tree/node';
import { INK_ELEMENTS, InkBox, InkNewline, InkSpacer, InkStatic, InkText, InkTransform } from '.';

function mount(component: Type<unknown>, inputs?: Record<string, unknown>) {
  const commits: string[][] = [];
  const tree = mountTree(component, {
    onCommit: () => {
      commits.push(liveTags(tree.root));
    },
    warn: vi.fn(),
    errorHandler: { handleError: vi.fn() },
    ...(inputs ? { inputs } : {}),
  });
  return { tree, commits };
}

/** Tags and texts of the live nodes under a node, in order. */
function liveTags(node: InkNode): string[] {
  return node.children.flatMap((child) =>
    child.kind === 'text'
      ? [child.text]
      : child.kind === 'element'
        ? [child.tag, ...liveTags(child)]
        : [],
  );
}

const propsOf = (node: InkNode): Record<string, unknown> => node.owner?.inkProps() ?? {};

/** Mounts one element as the root component and reads its props. */
async function propsWith(element: Type<unknown>, inputs: Record<string, unknown>) {
  const { tree } = mount(element, inputs);
  await tree.whenStable();
  const props = propsOf(tree.root);
  tree.destroy();
  return props;
}

const BOX_INPUTS: Record<string, unknown> = {
  position: 'absolute',
  top: 1,
  right: '10%',
  bottom: 2,
  left: 3,
  columnGap: 1,
  rowGap: 2,
  gap: 3,
  margin: 1,
  marginX: 2,
  marginY: 3,
  marginTop: 4,
  marginBottom: 5,
  marginLeft: 6,
  marginRight: 7,
  padding: 1,
  paddingX: 2,
  paddingY: 3,
  paddingTop: 4,
  paddingBottom: 5,
  paddingLeft: 6,
  paddingRight: 7,
  flexGrow: 1,
  flexShrink: 0,
  flexDirection: 'column-reverse',
  flexBasis: '50%',
  flexWrap: 'wrap-reverse',
  alignItems: 'center',
  alignSelf: 'flex-end',
  alignContent: 'space-between',
  justifyContent: 'space-evenly',
  width: 10,
  height: '25%',
  minWidth: 4,
  minHeight: '10%',
  maxWidth: 40,
  maxHeight: 20,
  aspectRatio: 2,
  display: 'none',
  overflow: 'hidden',
  overflowX: 'hidden',
  overflowY: 'visible',
  backgroundColor: 'blue',
  borderStyle: 'round',
  borderTop: false,
  borderBottom: false,
  borderLeft: true,
  borderRight: false,
  borderColor: 'red',
  borderTopColor: 'green',
  borderBottomColor: 'yellow',
  borderLeftColor: '#ff0000',
  borderRightColor: 'cyan',
  borderDimColor: true,
  borderTopDimColor: true,
  borderBottomDimColor: false,
  borderLeftDimColor: true,
  borderRightDimColor: false,
  borderBackgroundColor: 'white',
  borderTopBackgroundColor: 'black',
  borderBottomBackgroundColor: 'gray',
  borderLeftBackgroundColor: 'magenta',
  borderRightBackgroundColor: 'blue',
};

describe('InkBox', () => {
  it.each(Object.entries(BOX_INPUTS))('accepts %s', async (name, value) => {
    expect(await propsWith(InkBox, { [name]: value })).toEqual({ [name]: value });
  });

  it('accepts a custom border style object', async () => {
    const borderStyle = {
      topLeft: 'a',
      top: 'b',
      topRight: 'c',
      left: 'd',
      bottomLeft: 'e',
      bottom: 'f',
      bottomRight: 'g',
      right: 'h',
    };
    expect(await propsWith(InkBox, { borderStyle })).toEqual({ borderStyle });
  });

  it('returns only the defined inputs, with no undefined keys', async () => {
    expect(await propsWith(InkBox, {})).toEqual({});
    const props = await propsWith(InkBox, { padding: 1, margin: undefined });
    expect(props).toEqual({ padding: 1 });
    expect('margin' in props).toBe(false);
  });

  it('turns static attributes into numbers, keeping percentages', async () => {
    @Component({
      selector: 'ink-test-static-attributes',
      imports: [InkBox],
      template: `<ink-box padding="1" width="50%" flexGrow="2" borderTop="false" />`,
    })
    class Host {}
    const { tree } = mount(Host);
    await tree.whenStable();
    const box = tree.root.children.find((child) => child.tag === 'ink-box');
    expect(propsOf(box!)).toEqual({
      padding: 1,
      width: '50%',
      flexGrow: 2,
      borderTop: false,
    });
    tree.destroy();
  });

  it('reads a bare boolean attribute as true', async () => {
    @Component({
      selector: 'ink-test-bare-attribute',
      imports: [InkBox],
      template: `<ink-box borderDimColor />`,
    })
    class Host {}
    const { tree } = mount(Host);
    await tree.whenStable();
    const box = tree.root.children.find((child) => child.tag === 'ink-box');
    expect(propsOf(box!)).toEqual({ borderDimColor: true });
    tree.destroy();
  });
});

describe('InkText', () => {
  it.each(
    Object.entries({
      color: 'green',
      backgroundColor: 'red',
      dimColor: true,
      bold: true,
      italic: true,
      underline: true,
      strikethrough: true,
      inverse: true,
      wrap: 'truncate-middle',
    }),
  )('accepts %s', async (name, value) => {
    expect(await propsWith(InkText, { [name]: value })).toEqual({ [name]: value });
  });

  it('returns only the defined inputs', async () => {
    expect(await propsWith(InkText, {})).toEqual({});
  });
});

describe('InkNewline and InkSpacer', () => {
  it('counts one line by default', async () => {
    expect(await propsWith(InkNewline, {})).toEqual({ count: 1 });
  });

  it('repeats the line break count times', async () => {
    const { tree } = mount(InkNewline, { count: 3 });
    await tree.whenStable();
    expect((tree.root.owner as InkNewline).text()).toBe('\n\n\n');
    tree.destroy();
  });

  it('makes a spacer grow', async () => {
    expect(await propsWith(InkSpacer, {})).toEqual({ flexGrow: 1 });
  });
});

describe('InkTransform', () => {
  it('exposes the transform', async () => {
    const transform = (line: string): string => line.toUpperCase();
    expect(await propsWith(InkTransform, { transform })).toEqual({ transform });
  });
});

describe('InkStatic', () => {
  const lines = signal<readonly string[]>([]);

  @Component({
    selector: 'ink-test-log',
    imports: [InkStatic, InkText],
    template: `
      <ink-static [items]="lines()">
        <ng-template let-line let-index="index">
          <ink-text>{{ index }}:{{ line }}</ink-text>
        </ng-template>
      </ink-static>
    `,
  })
  class Log {
    readonly lines = lines;
  }

  it('renders each new item once, with its index, and keeps no live nodes after', async () => {
    lines.set(['a', 'b']);
    const { tree, commits } = mount(Log);
    await tree.whenStable();
    expect(commits.some((c) => c.join() === 'ink-static,ink-text,0:a,ink-text,1:b')).toBe(true);
    expect(liveTags(tree.root)).toEqual(['ink-static']);

    commits.length = 0;
    lines.set(['x', 'b', 'c']); // 'a' changed, 'c' is new
    await tree.whenStable();
    expect(commits.some((c) => c.join() === 'ink-static,ink-text,2:c')).toBe(true);
    expect(commits.some((c) => c.includes('0:x'))).toBe(false);
    expect(liveTags(tree.root)).toEqual(['ink-static']);

    commits.length = 0;
    lines.set(['x', 'b', 'c']);
    await tree.whenStable();
    expect(commits.every((c) => c.join() === 'ink-static')).toBe(true);
    tree.destroy();
  });
});

describe('INK_ELEMENTS', () => {
  it('lists the six elements', () => {
    expect(INK_ELEMENTS).toEqual([InkBox, InkText, InkNewline, InkSpacer, InkStatic, InkTransform]);
  });
});
