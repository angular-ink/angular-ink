export type Color =
  | { readonly kind: 'named'; readonly code: number; readonly bgCode: number }
  | { readonly kind: 'ansi256'; readonly index: number }
  | { readonly kind: 'rgb'; readonly r: number; readonly g: number; readonly b: number };

// Foreground SGR codes of the chalk names (INK-COLOR-01). The background code is code + 10.
const NAMED_CODES: Readonly<Record<string, number>> = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  blackBright: 90,
  gray: 90,
  grey: 90,
  redBright: 91,
  greenBright: 92,
  yellowBright: 93,
  blueBright: 94,
  magentaBright: 95,
  cyanBright: 96,
  whiteBright: 97,
};

export function namedColor(code: number): Color {
  return { kind: 'named', code, bgCode: code + 10 };
}

/** Reads a color prop. Falsy and unknown values give no color, like Ink (INK-COLOR-05, 06). */
export function parseColor(value: unknown): Color | null {
  if (typeof value !== 'string' || value === '') return null;
  const code = Object.hasOwn(NAMED_CODES, value) ? NAMED_CODES[value] : undefined;
  if (code !== undefined) return namedColor(code);
  if (value.startsWith('#')) return parseHex(value);
  if (value.startsWith('ansi256(')) return parseAnsi256(value);
  if (value.startsWith('rgb(')) return parseRgb(value);
  return null;
}

function parseHex(value: string): Color | null {
  const digits = value.slice(1);
  if (digits.length !== 3 && digits.length !== 6) return null;
  const width = digits.length / 3;
  const channels: number[] = [];
  for (let i = 0; i < 3; i++) {
    const part = digits.slice(i * width, (i + 1) * width);
    if (!isHex(part)) return null;
    channels.push(parseInt(width === 1 ? part + part : part, 16));
  }
  return { kind: 'rgb', r: channels[0] ?? 0, g: channels[1] ?? 0, b: channels[2] ?? 0 };
}

function isHex(text: string): boolean {
  for (const char of text) {
    if (!'0123456789abcdefABCDEF'.includes(char)) return false;
  }
  return true;
}

/** Reads a run of digits that fills the whole text. */
function parseUint(text: string): number | null {
  if (text === '' || text.length > 4) return null;
  for (const char of text) {
    if (char < '0' || char > '9') return null;
  }
  return Number(text);
}

function parseAnsi256(value: string): Color | null {
  if (!value.endsWith(')')) return null;
  const index = parseUint(value.slice('ansi256('.length, -1).trim());
  return index !== null && index <= 255 ? { kind: 'ansi256', index } : null;
}

function parseRgb(value: string): Color | null {
  if (!value.endsWith(')')) return null;
  const parts = value.slice('rgb('.length, -1).split(',');
  if (parts.length !== 3) return null;
  const [r, g, b] = parts.map((part) => parseUint(part.trim()));
  if (r == null || g == null || b == null || r > 255 || g > 255 || b > 255) return null;
  return { kind: 'rgb', r, g, b };
}
