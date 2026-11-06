import wrapAnsi from 'wrap-ansi';
import { describe, expect, it, vi } from 'vitest';
import { namedColor } from './color';
import { openSgr, parseAnsi, PLAIN_STYLE, type CellStyle } from './ansi';
import { layoutLines, measureText, squashText } from './text-layout';
import { createNode, type InkNode } from '../tree/node';

vi.mock('wrap-ansi', async (importOriginal) => {
  const original = await importOriginal<{ default: typeof import('wrap-ansi').default }>();
  return { default: vi.fn(original.default) };
});

function textElement(props: Record<string, unknown>, ...children: InkNode[]): InkNode {
  const node = createNode('element', 'ink-text');
  node.owner = { inkProps: () => props };
  for (const child of children) {
    child.parent = node;
    node.children.push(child);
  }
  return node;
}

const literal = (text: string): InkNode => createNode('text', '', text);

const RED = namedColor(31);
const BLUE = namedColor(34);
const RESET = '\x1b[0m';

describe('squashText', () => {
  it('returns plain text unchanged when no style applies', () => {
    expect(squashText(textElement({}, literal('hi')), PLAIN_STYLE)).toBe('hi');
  });

  it('combines the styles of nested ink-text', () => {
    const inner = textElement({ backgroundColor: 'blue', bold: true }, literal('x'));
    const outer = textElement({ dimColor: true, color: 'red' }, inner);
    const combined: CellStyle = { ...PLAIN_STYLE, dim: true, fg: RED, bg: BLUE, bold: true };
    expect(squashText(outer, PLAIN_STYLE)).toBe(`${openSgr(combined)}x${RESET}`);
  });

  it('applies the flags in the Ink order: dim, color, bg, bold, italic, underline, strikethrough, inverse', () => {
    const node = textElement(
      {
        dimColor: true,
        color: 'red',
        backgroundColor: 'blue',
        bold: true,
        italic: true,
        underline: true,
        strikethrough: true,
        inverse: true,
      },
      literal('x'),
    );
    const [span] = parseAnsi(squashText(node, PLAIN_STYLE), PLAIN_STYLE);
    expect(span?.style).toEqual({
      fg: RED,
      bg: BLUE,
      bold: true,
      dim: true,
      italic: true,
      underline: true,
      strikethrough: true,
      inverse: true,
    });
  });

  it('gives the inherited background to text without its own', () => {
    const inherited: CellStyle = { ...PLAIN_STYLE, bg: BLUE };
    const [span] = parseAnsi(squashText(textElement({}, literal('x')), inherited), PLAIN_STYLE);
    expect(span?.style.bg).toEqual(BLUE);
  });

  it('keeps the inherited background when the empty string is given', () => {
    const inherited: CellStyle = { ...PLAIN_STYLE, bg: BLUE };
    const node = textElement({ backgroundColor: '' }, literal('x'));
    const [span] = parseAnsi(squashText(node, inherited), PLAIN_STYLE);
    expect(span?.style.bg).toEqual(BLUE);
  });

  it('lets a text own background win over the inherited one', () => {
    const inherited: CellStyle = { ...PLAIN_STYLE, bg: BLUE };
    const node = textElement({ backgroundColor: 'red' }, literal('x'));
    const [span] = parseAnsi(squashText(node, inherited), PLAIN_STYLE);
    expect(span?.style.bg).toEqual(namedColor(31));
  });

  it('reads the line breaks of ink-newline from its owner', () => {
    const newline = createNode('element', 'ink-newline');
    newline.owner = Object.assign({ inkProps: () => ({ count: 2 }) }, { text: () => '\n\n' });
    expect(squashText(textElement({}, literal('a'), newline, literal('b')), PLAIN_STYLE)).toBe(
      'a\n\nb',
    );
  });

  it('ignores comment nodes and sanitizes control sequences', () => {
    const node = textElement({}, createNode('comment'), literal('a\x1b[2Jb'));
    expect(squashText(node, PLAIN_STYLE)).toBe('ab');
  });

  it('keeps the outer style after an inner reset code in user text', () => {
    const node = textElement({ color: 'red' }, literal('a\x1b[0mb'));
    const spans = parseAnsi(squashText(node, PLAIN_STYLE), PLAIN_STYLE);
    expect(spans.map((span) => [span.text, span.style.fg])).toEqual([['ab', RED]]);
  });

  it('expands tabs to the next multiple of 8 columns', () => {
    expect(squashText(textElement({}, literal('ab\tc')), PLAIN_STYLE)).toBe('ab      c');
    expect(squashText(textElement({}, literal('\tc')), PLAIN_STYLE)).toBe('        c');
  });

  it('drops the carriage return of CRLF', () => {
    expect(squashText(textElement({}, literal('a\r\nb')), PLAIN_STYLE)).toBe('a\nb');
  });
});

describe('layoutLines', () => {
  it('wraps at word boundaries', () => {
    // Ink 8.0.0 wraps with trim: false, so the space that fits nowhere stays on a row of its own.
    expect(layoutLines('hello world', 5, 'wrap')).toEqual(['hello', ' ', 'world']);
    expect(layoutLines('hello big world', 9, 'wrap')).toEqual(['hello big', ' world']);
  });

  it('breaks a word longer than the line when wrapping', () => {
    expect(layoutLines('abcdefgh', 3, 'wrap')).toEqual(['abc', 'def', 'gh']);
  });

  it('hard wraps in the middle of words', () => {
    expect(layoutLines('hello world', 4, 'hard')).toEqual(['hell', 'o wo', 'rld']);
  });

  it('keeps the natural width when the width is zero or negative', () => {
    expect(layoutLines('hello world', 0, 'wrap')).toEqual(['hello world']);
    expect(layoutLines('hello world', -3, 'hard')).toEqual(['hello world']);
  });

  it('rounds a fraction of a column up to one column', () => {
    expect(layoutLines('abc', 0.4, 'hard')).toEqual(['a', 'b', 'c']);
  });

  it('truncates at the end, middle and start with an ellipsis', () => {
    expect(layoutLines('abcdefghij', 6, 'truncate')).toEqual(['abcde…']);
    expect(layoutLines('abcdefghij', 6, 'truncate-end')).toEqual(['abcde…']);
    expect(layoutLines('abcdefghij', 6, 'truncate-middle')).toEqual(['abc…ij']);
    expect(layoutLines('abcdefghij', 6, 'truncate-start')).toEqual(['…fghij']);
  });

  it('truncates to nothing at zero columns', () => {
    expect(layoutLines('abc', 0, 'truncate')).toEqual(['']);
  });

  it('truncates each line of a multiline text on its own', () => {
    expect(layoutLines('abcdefgh\nxy\nabcdefgh', 5, 'truncate-end')).toEqual([
      'abcd…',
      'xy',
      'abcd…',
    ]);
  });

  it('reopens a style that spans a newline on each truncated line', () => {
    const lines = layoutLines('\x1b[31mabcdefgh\nijklmnop\x1b[39m', 4, 'truncate-end');
    const spans = lines.map((line) => parseAnsi(line, PLAIN_STYLE)[0]?.style.fg);
    expect(spans).toEqual([RED, RED]);
  });

  it('keeps the style across an explicit newline when wrapping', () => {
    const lines = layoutLines('\x1b[31mab\ncd\x1b[39m', 10, 'wrap');
    expect(lines).toHaveLength(2);
    expect(parseAnsi(lines[1] ?? '', PLAIN_STYLE)[0]?.style.fg).toEqual(RED);
  });

  it('expands tabs and drops carriage returns', () => {
    expect(layoutLines('a\tb\r\nc', 20, 'wrap')).toEqual(['a       b', 'c']);
  });

  it('gives one empty line for empty text', () => {
    expect(layoutLines('', 5, 'wrap')).toEqual(['']);
  });

  it('wraps text with SGR without counting the codes as columns', () => {
    const lines = layoutLines('\x1b[31mhello world\x1b[39m', 5, 'wrap');
    expect(lines).toHaveLength(3);
  });
});

describe('measureText', () => {
  it('measures wide characters by their cells', () => {
    expect(measureText('日本語', 'wrap', 80)).toEqual({ width: 6, height: 1 });
    expect(measureText('👍🏽', 'wrap', 80)).toEqual({ width: 2, height: 1 });
    expect(measureText('é', 'wrap', 80)).toEqual({ width: 1, height: 1 });
  });

  it('ignores SGR when measuring', () => {
    expect(measureText('\x1b[31mred\x1b[39m', 'wrap', 80)).toEqual({ width: 3, height: 1 });
  });

  it('gives the wrapped height', () => {
    expect(measureText('hello world', 'wrap', 5)).toEqual({ width: 5, height: 3 });
  });

  it('counts each line of a multiline text', () => {
    expect(measureText('ab\nabcd', 'wrap', 80)).toEqual({ width: 4, height: 2 });
  });

  it('measures truncated text at the available width', () => {
    expect(measureText('abcdefghij', 'truncate', 6)).toEqual({ width: 6, height: 1 });
  });

  it('measures empty text as zero by zero', () => {
    expect(measureText('', 'wrap', 10)).toEqual({ width: 0, height: 0 });
  });

  it('keeps the natural size when the width is zero', () => {
    expect(measureText('hello world', 'wrap', 0)).toEqual({ width: 11, height: 1 });
  });
});

describe('wrap cache', () => {
  it('runs wrapAnsi once for two equal calls', () => {
    const spy = vi.mocked(wrapAnsi);
    spy.mockClear();
    layoutLines('cache me please', 7, 'wrap');
    layoutLines('cache me please', 7, 'wrap');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('keeps width and wrap mode in the key', () => {
    const spy = vi.mocked(wrapAnsi);
    spy.mockClear();
    layoutLines('key matters here', 6, 'wrap');
    layoutLines('key matters here', 7, 'wrap');
    layoutLines('key matters here', 6, 'hard');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('does not keep a result larger than the cap', () => {
    const spy = vi.mocked(wrapAnsi);
    const huge = 'x'.repeat(2 ** 20 + 1);
    spy.mockClear();
    layoutLines(huge, 80, 'hard');
    layoutLines(huge, 80, 'hard');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
