import { namedColor, type Color } from './color';

export interface CellStyle {
  readonly fg: Color | null;
  readonly bg: Color | null;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strikethrough: boolean;
  readonly inverse: boolean;
}

export const PLAIN_STYLE: CellStyle = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  strikethrough: false,
  inverse: false,
};

export interface StyledSpan {
  readonly text: string;
  readonly style: CellStyle;
}

const ESC = '\x1b';
export const MAX_SEQUENCE_BYTES = 256;

/**
 * Keeps SGR and drops every other control: cursor and screen sequences, OSC (so OSC 8 links lose
 * the link and keep the text), C0 except tab and newline, DEL and C1. One pass, no backtracking.
 */
export function sanitizeAnsi(input: string): string {
  const length = input.length;
  let out = '';
  let keepFrom = 0;
  let i = 0;
  while (i < length) {
    const code = input.charCodeAt(i);
    const isText =
      code >= 0x20 ? code !== 0x7f && (code < 0x80 || code > 0x9f) : code === 0x09 || code === 0x0a;
    if (isText) {
      i++;
      continue;
    }
    out += input.slice(keepFrom, i);
    if (code === 0x1b) {
      const scanned = scanEscape(input, i);
      out += scanned.keep;
      i = scanned.next;
    } else {
      i++;
    }
    keepFrom = i;
  }
  return out + input.slice(keepFrom);
}

interface Scanned {
  /** What stays in the output. */
  readonly keep: string;
  /** Where scanning resumes. Always past the ESC. */
  readonly next: number;
}

function scanEscape(input: string, start: number): Scanned {
  const length = input.length;
  const kind = start + 1 < length ? input[start + 1] : '';
  if (kind === '[') return scanCsi(input, start);
  if (kind === ']' || kind === 'P' || kind === 'X' || kind === '^' || kind === '_') {
    return { keep: '', next: skipString(input, start + 2) };
  }
  // Two-byte and charset sequences: ESC, intermediates, one final byte.
  let j = start + 1;
  while (j < length && isIntermediate(input.charCodeAt(j))) j++;
  const final = j < length ? input.charCodeAt(j) : -1;
  return { keep: '', next: final >= 0x30 && final <= 0x7e ? j + 1 : j };
}

function scanCsi(input: string, start: number): Scanned {
  const length = input.length;
  const paramsStart = start + 2;
  let j = paramsStart;
  while (j < length && isParameter(input.charCodeAt(j))) j++;
  const paramsEnd = j;
  while (j < length && isIntermediate(input.charCodeAt(j))) j++;
  const hasIntermediate = j > paramsEnd;
  const final = j < length ? input.charCodeAt(j) : -1;
  if (final < 0x40 || final > 0x7e) return { keep: '', next: j };
  const next = j + 1;
  if (final !== 0x6d || hasIntermediate || next - start > MAX_SEQUENCE_BYTES) {
    return { keep: '', next };
  }
  const params = input.slice(paramsStart, paramsEnd);
  const sgr = normalizeSgr(params);
  return { keep: sgr === null ? '' : `${ESC}[${sgr}m`, next };
}

/** Skips an OSC, DCS, SOS, PM or APC string up to BEL or ST. An ESC that is not ST ends it. */
function skipString(input: string, from: number): number {
  const length = input.length;
  for (let j = from; j < length; j++) {
    const code = input.charCodeAt(j);
    if (code === 0x07) return j + 1;
    if (code === 0x1b) return input[j + 1] === '\\' ? j + 2 : j;
  }
  return length;
}

const isParameter = (code: number): boolean => code >= 0x30 && code <= 0x3f;
const isIntermediate = (code: number): boolean => code >= 0x20 && code <= 0x2f;

/** Returns the SGR parameters with `:` rewritten to `;`, or null when this is not a plain SGR. */
function normalizeSgr(params: string): string | null {
  for (let i = 0; i < params.length; i++) {
    const code = params.charCodeAt(i);
    // Digits, ';' and ':' only. Private markers (< = > ?) make it another sequence.
    if (code > 0x3b) return null;
  }
  if (!params.includes(':')) return params;
  return params.split(';').map(normalizeColonParameter).join(';');
}

function normalizeColonParameter(parameter: string): string {
  if (!parameter.includes(':')) return parameter;
  const [head = '', mode, ...rest] = parameter.split(':');
  if (head === '4') return mode === '0' ? '24' : '4';
  if (head !== '38' && head !== '48' && head !== '58') return head;
  if (mode === '5') return `${head};5;${rest[0] ?? ''}`;
  if (mode !== '2') return head;
  // Drop the optional color-space id: 38:2::r:g:b carries it, 38:2:r:g:b does not.
  const channels = rest.length >= 4 ? rest.slice(1) : rest;
  return [head, '2', ...channels].join(';');
}

/** Splits text with SGR into spans. `\x1b[0m` and the default color codes return to `base`. */
export function parseAnsi(input: string, base: CellStyle): StyledSpan[] {
  const text = sanitizeAnsi(input);
  const spans: StyledSpan[] = [];
  let style = base;
  let pos = 0;
  while (pos < text.length) {
    const esc = text.indexOf(ESC, pos);
    const textEnd = esc === -1 ? text.length : esc;
    if (textEnd > pos) pushSpan(spans, text.slice(pos, textEnd), style);
    if (esc === -1) break;
    // The sanitizer leaves only complete SGR sequences: ESC [ params m.
    const end = text.indexOf('m', esc + 2);
    style = applySgr(text.slice(esc + 2, end), style, base);
    pos = end + 1;
  }
  return spans;
}

// A code that changes nothing keeps the same style object, so its neighbors merge.
function pushSpan(spans: StyledSpan[], text: string, style: CellStyle): void {
  const last = spans[spans.length - 1];
  if (last?.style === style) spans[spans.length - 1] = { text: last.text + text, style };
  else spans.push({ text, style });
}

function applySgr(params: string, current: CellStyle, base: CellStyle): CellStyle {
  const parts = params === '' ? ['0'] : params.split(';');
  let style = current;
  for (let i = 0; i < parts.length; i++) {
    const code = Number(parts[i]);
    if (code === 38 || code === 48 || code === 58) {
      const [color, next] = readExtendedColor(parts, i);
      i = next - 1;
      if (color !== null && code === 38) style = { ...style, fg: color };
      if (color !== null && code === 48) style = { ...style, bg: color };
      continue;
    }
    style = applySimpleCode(code, style, base);
  }
  return style;
}

function applySimpleCode(code: number, style: CellStyle, base: CellStyle): CellStyle {
  switch (code) {
    case 0:
      return base;
    case 1:
      return { ...style, bold: true };
    case 2:
      return { ...style, dim: true };
    case 3:
      return { ...style, italic: true };
    case 4:
      return { ...style, underline: true };
    case 7:
      return { ...style, inverse: true };
    case 9:
      return { ...style, strikethrough: true };
    case 22:
      return { ...style, bold: false, dim: false };
    case 23:
      return { ...style, italic: false };
    case 24:
      return { ...style, underline: false };
    case 27:
      return { ...style, inverse: false };
    case 29:
      return { ...style, strikethrough: false };
    case 39:
      return { ...style, fg: base.fg };
    case 49:
      return { ...style, bg: base.bg };
  }
  if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
    return { ...style, fg: namedColor(code) };
  }
  if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
    return { ...style, bg: namedColor(code - 10) };
  }
  return style;
}

/** Reads `38;5;n` or `38;2;r;g;b` at `index`. Returns the color and the next index to read. */
function readExtendedColor(parts: readonly string[], index: number): [Color | null, number] {
  const mode = parts[index + 1];
  const count = mode === '5' ? 1 : mode === '2' ? 3 : 0;
  if (count === 0) return [null, index + 1];
  const values = parts.slice(index + 2, index + 2 + count).map(Number);
  const next = index + 2 + count;
  // Past the safe integers a number prints as `1e+30`, which is no longer one parameter of a sequence.
  if (values.length < count || !values.every(Number.isSafeInteger)) return [null, next];
  if (count === 1) return [{ kind: 'ansi256', index: values[0] ?? 0 }, next];
  return [{ kind: 'rgb', r: values[0] ?? 0, g: values[1] ?? 0, b: values[2] ?? 0 }, next];
}

/** The SGR sequence that turns `style` on from a reset state. Empty for the plain style. */
export function openSgr(style: CellStyle): string {
  const params: string[] = [];
  if (style.bold) params.push('1');
  if (style.dim) params.push('2');
  if (style.italic) params.push('3');
  if (style.underline) params.push('4');
  if (style.inverse) params.push('7');
  if (style.strikethrough) params.push('9');
  if (style.fg) params.push(colorParams(style.fg, false));
  if (style.bg) params.push(colorParams(style.bg, true));
  return params.length === 0 ? '' : `${ESC}[${params.join(';')}m`;
}

function colorParams(color: Color, background: boolean): string {
  const extended = background ? '48' : '38';
  switch (color.kind) {
    case 'named':
      return String(background ? color.bgCode : color.code);
    case 'ansi256':
      return `${extended};5;${String(color.index)}`;
    case 'rgb':
      return `${extended};2;${String(color.r)};${String(color.g)};${String(color.b)}`;
  }
}
