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

// The next three read a color as chalk does through Ink, which clamps nothing: a terminal gets
// `rgb(256,0,0)` as it is. A number stops at 15 digits so that it always prints as digits.

function parseHex(value: string): Color {
  const digits = /[a-f\d]{6}|[a-f\d]{3}/i.exec(value)?.[0];
  if (digits === undefined) return { kind: 'rgb', r: 0, g: 0, b: 0 };
  const width = digits.length / 3;
  const [r = 0, g = 0, b = 0] = [0, 1, 2].map((i) => {
    const part = digits.slice(i * width, (i + 1) * width);
    return parseInt(width === 1 ? part + part : part, 16);
  });
  return { kind: 'rgb', r, g, b };
}

function parseAnsi256(value: string): Color | null {
  const digits = /^ansi256\(\s?(\d{1,15})\s?\)$/.exec(value)?.[1];
  return digits === undefined ? null : { kind: 'ansi256', index: Number(digits) };
}

function parseRgb(value: string): Color | null {
  const channels = /^rgb\(\s*(\d{1,15})\s*,\s*(\d{1,15})\s*,\s*(\d{1,15})\s*\)$/.exec(value);
  if (channels === null) return null;
  return { kind: 'rgb', r: Number(channels[1]), g: Number(channels[2]), b: Number(channels[3]) };
}
