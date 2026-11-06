import { namedColor, type Color } from './color';

/** 0 = no color, 1 = 16 colors, 2 = 256 colors, 3 = truecolor. */
export type ColorLevel = 0 | 1 | 2 | 3;

const BASIC_TERMS = [
  'screen',
  'xterm',
  'vt100',
  'vt220',
  'rxvt',
  'color',
  'ansi',
  'cygwin',
  'linux',
];

export function detectColorLevel(
  env: Readonly<Record<string, string | undefined>>,
  isTty: boolean,
): ColorLevel {
  const force = env['FORCE_COLOR'];
  if (force !== undefined) return forcedLevel(force);
  if ((env['NO_COLOR'] ?? '') !== '') return 0;
  if (!isTty) return 0;
  const term = env['TERM'] ?? '';
  if (term === 'dumb') return 0;
  const colorTerm = env['COLORTERM'] ?? '';
  if (colorTerm === 'truecolor' || colorTerm === '24bit') return 3;
  if (term.includes('256color')) return 2;
  if (BASIC_TERMS.some((prefix) => term.toLowerCase().includes(prefix))) return 1;
  return colorTerm === '' ? 0 : 1;
}

function forcedLevel(value: string): ColorLevel {
  if (value === '0' || value === 'false') return 0;
  if (value === '2') return 2;
  if (value === '3') return 3;
  return 1;
}

/** Brings a color down to what the terminal supports, or to null when it has no color. */
export function downgrade(color: Color, level: ColorLevel): Color | null {
  if (level === 0) return null;
  if (level === 3) return color;
  if (color.kind === 'named') return color;
  if (level === 2) {
    return color.kind === 'rgb'
      ? { kind: 'ansi256', index: rgbToAnsi256(color.r, color.g, color.b) }
      : color;
  }
  const index = color.kind === 'rgb' ? rgbToAnsi256(color.r, color.g, color.b) : color.index;
  return namedColor(ansi256ToAnsi16(index));
}

// The conversions follow ansi-styles, so the output matches what chalk prints.
function rgbToAnsi256(r: number, g: number, b: number): number {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  return (
    16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5)
  );
}

function ansi256ToAnsi16(index: number): number {
  if (index < 8) return 30 + index;
  if (index < 16) return 90 + (index - 8);
  let red: number;
  let green: number;
  let blue: number;
  if (index >= 232) {
    red = green = blue = ((index - 232) * 10 + 8) / 255;
  } else {
    const cube = index - 16;
    const remainder = cube % 36;
    red = Math.floor(cube / 36) / 5;
    green = Math.floor(remainder / 6) / 5;
    blue = (remainder % 6) / 5;
  }
  const value = Math.max(red, green, blue) * 2;
  if (value === 0) return 30;
  const code = 30 + ((Math.round(blue) << 2) | (Math.round(green) << 1) | Math.round(red));
  return value === 2 ? code + 60 : code;
}
