import { describe, expect, it } from 'vitest';
import { parseColor } from './color';

describe('parseColor', () => {
  it.each([
    ['black', 30],
    ['red', 31],
    ['green', 32],
    ['yellow', 33],
    ['blue', 34],
    ['magenta', 35],
    ['cyan', 36],
    ['white', 37],
    ['blackBright', 90],
    ['gray', 90],
    ['grey', 90],
    ['redBright', 91],
    ['greenBright', 92],
    ['yellowBright', 93],
    ['blueBright', 94],
    ['magentaBright', 95],
    ['cyanBright', 96],
    ['whiteBright', 97],
  ])('parses the name %s', (name, code) => {
    expect(parseColor(name)).toEqual({ kind: 'named', code, bgCode: code + 10 });
  });

  it('parses hex, ansi256 and rgb', () => {
    expect(parseColor('#ff8800')).toEqual({ kind: 'rgb', r: 255, g: 136, b: 0 });
    expect(parseColor('#f80')).toEqual({ kind: 'rgb', r: 255, g: 136, b: 0 });
    expect(parseColor('ansi256(208)')).toEqual({ kind: 'ansi256', index: 208 });
    expect(parseColor('ansi256( 5 )')).toEqual({ kind: 'ansi256', index: 5 });
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ kind: 'rgb', r: 1, g: 2, b: 3 });
    expect(parseColor('rgb(1,2,3)')).toEqual({ kind: 'rgb', r: 1, g: 2, b: 3 });
  });

  it.each(['', null, undefined, false, 0, 'nope', '#12', '#gggggg', 'ansi256(256)', 'ansi256(x)'])(
    'gives null for %j',
    (value) => {
      expect(parseColor(value)).toBeNull();
    },
  );

  it('gives null for out-of-range or malformed rgb', () => {
    expect(parseColor('rgb(256, 0, 0)')).toBeNull();
    expect(parseColor('rgb(1, 2)')).toBeNull();
    expect(parseColor('rgb(1, 2, 3, 4)')).toBeNull();
  });
});
