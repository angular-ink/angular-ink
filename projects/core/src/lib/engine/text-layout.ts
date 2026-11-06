import cliTruncate from 'cli-truncate';
import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import { openSgr, parseAnsi, PLAIN_STYLE, sanitizeAnsi, type CellStyle } from './ansi';
import { parseColor } from './color';
import type { InkNode } from '../tree/node';

export type TextWrap =
  'wrap' | 'hard' | 'truncate' | 'truncate-end' | 'truncate-middle' | 'truncate-start';

const RESET = '\x1b[0m';
const TAB_STOP = 8;
const CACHE_CAPACITY = 2 ** 20;

/**
 * Joins the text under an `ink-text` into one string with SGR. `inherited` carries what the
 * parent box or text already applies, background included (INK-BOX-08, INK-TEXT-02).
 */
export function squashText(textNode: InkNode, inherited: CellStyle): string {
  return expandTabs(
    newlineBreaks(textNode) ?? squashChildren(textNode, styleOf(textNode, inherited)),
  );
}

/** The line breaks of an `ink-newline`, which has no child text node: its owner knows them. */
function newlineBreaks(node: InkNode): string | null {
  if (node.tag !== 'ink-newline') return null;
  const owner = node.owner as { text?: unknown } | null;
  return typeof owner?.text === 'function' ? String(owner.text.call(owner)) : null;
}

function squashChildren(node: InkNode, style: CellStyle): string {
  let out = '';
  for (const child of node.children) {
    if (child.kind === 'text') out += styledRuns(child.text, style);
    else if (child.kind === 'element') out += squashElement(child, style);
  }
  return out;
}

function squashElement(node: InkNode, style: CellStyle): string {
  const breaks = newlineBreaks(node);
  if (breaks !== null) return breaks;
  const text = squashChildren(node, node.tag === 'ink-text' ? styleOf(node, style) : style);
  return applyNestedTransform(node, text);
}

/** A transform inside another text has no lines of its own in the frame, so it runs here. */
function applyNestedTransform(node: InkNode, text: string): string {
  const transform = node.owner?.inkProps()['transform'];
  if (typeof transform !== 'function' || text === '') return text;
  const rewrite = transform as (line: string, index: number) => string;
  return text
    .split('\n')
    .map((line, index) => sanitizeAnsi(rewrite(line, index)))
    .join('\n');
}

/** A style flag set on a nested text adds to the outer one; it never switches it off. */
function styleOf(node: InkNode, inherited: CellStyle): CellStyle {
  const props = node.owner?.inkProps() ?? {};
  return {
    fg: parseColor(props['color']) ?? inherited.fg,
    bg: parseColor(props['backgroundColor']) ?? inherited.bg,
    bold: props['bold'] === true || inherited.bold,
    dim: props['dimColor'] === true || inherited.dim,
    italic: props['italic'] === true || inherited.italic,
    underline: props['underline'] === true || inherited.underline,
    strikethrough: props['strikethrough'] === true || inherited.strikethrough,
    inverse: props['inverse'] === true || inherited.inverse,
  };
}

/** Sanitizes `text` and writes each run with the SGR that opens its style, closed by a reset. */
function styledRuns(text: string, style: CellStyle): string {
  let out = '';
  for (const span of parseAnsi(text, style)) {
    const open = openSgr(span.style);
    out += open === '' ? span.text : open + span.text + RESET;
  }
  return out;
}

/** Index just past the SGR sequence that starts at `start`, or -1 when none does. */
function sgrEndAt(text: string, start: number): number {
  if (text[start + 1] !== '[') return -1;
  for (let j = start + 2; j < text.length; j++) {
    const code = text.charCodeAt(j);
    if (code === 0x6d) return j + 1;
    if (code !== 0x3b && (code < 0x30 || code > 0x39)) return -1;
  }
  return -1;
}

/** Tabs go to the next multiple of 8 columns. SGR takes no columns. */
function expandTabs(text: string): string {
  if (!text.includes('\t')) return text;
  let out = '';
  let column = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? '';
    const sgrEnd = ch === '\x1b' ? sgrEndAt(text, i) : -1;
    if (sgrEnd !== -1) {
      out += text.slice(i, sgrEnd);
      i = sgrEnd;
    } else if (ch === '\t') {
      const fill = TAB_STOP - (column % TAB_STOP);
      out += ' '.repeat(fill);
      column += fill;
      i++;
    } else if (ch === '\n') {
      out += ch;
      column = 0;
      i++;
    } else {
      const point = String.fromCodePoint(text.codePointAt(i) ?? 0);
      out += point;
      column += stringWidth(point);
      i += point.length;
    }
  }
  return out;
}

/** Least recently used cache bounded by the size of what it holds (INK-TEXT-18). */
class SizedCache {
  private readonly entries = new Map<string, { value: string; size: number }>();
  private total = 0;

  constructor(private readonly capacity: number) {}

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string, size: number): void {
    if (size > this.capacity) return;
    this.total += size - (this.entries.get(key)?.size ?? 0);
    this.entries.delete(key);
    this.entries.set(key, { value, size });
    for (const [oldest, entry] of this.entries) {
      if (this.total <= this.capacity) break;
      this.entries.delete(oldest);
      this.total -= entry.size;
    }
  }
}

const wrapCache = new SizedCache(CACHE_CAPACITY);

/** The text as it renders in `width` columns, newline-joined, still with SGR. */
function wrapText(text: string, width: number, wrap: TextWrap): string {
  // Wrapping into no columns would put one character per row; the text keeps its natural width.
  if (width <= 0 && (wrap === 'wrap' || wrap === 'hard')) return text;
  // Yoga rounds a width up to a whole column, so a fraction is measured as the column it fills.
  const columns = width > 0 && width < 1 ? 1 : width;
  // The text goes last: it is the only part of the key that can hold any character.
  const key = `${String(columns)}\0${wrap}\0${text}`;
  const cached = wrapCache.get(key);
  if (cached !== undefined) return cached;
  const result = applyWrap(text, columns, wrap);
  wrapCache.set(key, result, key.length + result.length);
  return result;
}

function applyWrap(text: string, width: number, wrap: TextWrap): string {
  // wrapAnsi does not carry a style over an explicit newline, so each line is wrapped closed.
  if (wrap === 'wrap' || wrap === 'hard') {
    return splitStyledLines(text)
      .map((line) =>
        wrap === 'wrap'
          ? wrapAnsi(line, width, { hard: true, trim: false })
          : wrapAnsi(line, width, { hard: true, wordWrap: false, trim: false }),
      )
      .join('\n');
  }
  const position =
    wrap === 'truncate-middle' ? 'middle' : wrap === 'truncate-start' ? 'start' : 'end';
  // cliTruncate reads one line, so each line is cut on its own (INK-TEXT-17).
  return splitStyledLines(text)
    .map((line) => cliTruncate(line, width, { position }))
    .join('\n');
}

/** Splits on `\n` and reopens the style that is active at the start of each line. */
function splitStyledLines(text: string): string[] {
  if (!text.includes('\n')) return [text];
  const lines: string[] = [];
  let current = '';
  for (const span of parseAnsi(text, PLAIN_STYLE)) {
    const open = openSgr(span.style);
    const pieces = span.text.split('\n');
    pieces.forEach((piece, index) => {
      if (index > 0) {
        lines.push(current);
        current = '';
      }
      if (piece !== '') current += open === '' ? piece : open + piece + RESET;
    });
  }
  lines.push(current);
  return lines;
}

function prepare(squashed: string): string {
  return expandTabs(squashed.replaceAll('\r', ''));
}

/** The lines of `squashed` in `width` columns: wrapped or truncated, tabs and `\r` gone. */
export function layoutLines(squashed: string, width: number, wrap: TextWrap): readonly string[] {
  return wrapText(prepare(squashed), width, wrap).split('\n');
}

export function measureText(
  squashed: string,
  wrap: TextWrap,
  width: number,
): { width: number; height: number } {
  const text = prepare(squashed);
  if (text === '') return { width: 0, height: 0 };
  const natural = dimensions(text);
  if (natural.width <= width || natural.width < 1) return natural;
  const laidOut = wrapText(text, width, wrap);
  return laidOut === '' ? { width: 0, height: 0 } : dimensions(laidOut);
}

function dimensions(text: string): { width: number; height: number } {
  const lines = text.split('\n');
  let widest = 0;
  for (const line of lines) widest = Math.max(widest, stringWidth(line));
  return { width: widest, height: lines.length };
}
