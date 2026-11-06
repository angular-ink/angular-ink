import { describe, expect, it } from 'vitest';
import { downgrade, detectColorLevel } from './color-level';

describe('detectColorLevel', () => {
  it('honors FORCE_COLOR even without a TTY', () => {
    expect(detectColorLevel({ FORCE_COLOR: '0' }, true)).toBe(0);
    expect(detectColorLevel({ FORCE_COLOR: 'false' }, true)).toBe(0);
    expect(detectColorLevel({ FORCE_COLOR: '3' }, false)).toBe(3);
    expect(detectColorLevel({ FORCE_COLOR: '2' }, false)).toBe(2);
    expect(detectColorLevel({ FORCE_COLOR: '1' }, false)).toBe(1);
    expect(detectColorLevel({ FORCE_COLOR: 'true' }, false)).toBe(1);
    expect(detectColorLevel({ FORCE_COLOR: '' }, false)).toBe(1);
  });

  it('turns color off for NO_COLOR', () => {
    expect(detectColorLevel({ NO_COLOR: '1', COLORTERM: 'truecolor' }, true)).toBe(0);
  });

  it('ignores an empty NO_COLOR', () => {
    expect(detectColorLevel({ NO_COLOR: '', COLORTERM: 'truecolor' }, true)).toBe(3);
  });

  it('reads COLORTERM and TERM', () => {
    expect(detectColorLevel({ COLORTERM: 'truecolor' }, true)).toBe(3);
    expect(detectColorLevel({ COLORTERM: '24bit' }, true)).toBe(3);
    expect(detectColorLevel({ TERM: 'xterm-256color' }, true)).toBe(2);
    expect(detectColorLevel({ TERM: 'xterm' }, true)).toBe(1);
    expect(detectColorLevel({ TERM: 'dumb', COLORTERM: 'truecolor' }, true)).toBe(0);
    expect(detectColorLevel({ TERM: 'weird' }, true)).toBe(0);
    expect(detectColorLevel({}, true)).toBe(0);
  });

  it('gives 0 without a TTY', () => {
    expect(detectColorLevel({ COLORTERM: 'truecolor', TERM: 'xterm-256color' }, false)).toBe(0);
  });
});

describe('downgrade', () => {
  const red = { kind: 'rgb', r: 255, g: 0, b: 0 } as const;

  it('maps rgb to ansi256, then to a name, then to nothing', () => {
    expect(downgrade(red, 3)).toBe(red);
    expect(downgrade(red, 2)).toEqual({ kind: 'ansi256', index: 196 });
    expect(downgrade(red, 1)).toEqual({ kind: 'named', code: 91, bgCode: 101 });
    expect(downgrade(red, 0)).toBeNull();
  });

  it('maps grays and dark colors', () => {
    expect(downgrade({ kind: 'rgb', r: 128, g: 128, b: 128 }, 2)).toEqual({
      kind: 'ansi256',
      index: 244,
    });
    expect(downgrade({ kind: 'rgb', r: 0, g: 0, b: 0 }, 2)).toEqual({ kind: 'ansi256', index: 16 });
    expect(downgrade({ kind: 'rgb', r: 255, g: 255, b: 255 }, 2)).toEqual({
      kind: 'ansi256',
      index: 231,
    });
    expect(downgrade({ kind: 'rgb', r: 0, g: 0, b: 128 }, 1)).toEqual({
      kind: 'named',
      code: 34,
      bgCode: 44,
    });
  });

  it('maps ansi256 to names at level 1', () => {
    expect(downgrade({ kind: 'ansi256', index: 3 }, 1)).toEqual({
      kind: 'named',
      code: 33,
      bgCode: 43,
    });
    expect(downgrade({ kind: 'ansi256', index: 12 }, 1)).toEqual({
      kind: 'named',
      code: 94,
      bgCode: 104,
    });
    expect(downgrade({ kind: 'ansi256', index: 196 }, 1)).toEqual({
      kind: 'named',
      code: 91,
      bgCode: 101,
    });
    expect(downgrade({ kind: 'ansi256', index: 232 }, 1)).toEqual({
      kind: 'named',
      code: 30,
      bgCode: 40,
    });
    expect(downgrade({ kind: 'ansi256', index: 208 }, 2)).toEqual({ kind: 'ansi256', index: 208 });
  });

  it('keeps names at levels 1 to 3 and drops them at 0', () => {
    const name = { kind: 'named', code: 32, bgCode: 42 } as const;
    expect(downgrade(name, 1)).toBe(name);
    expect(downgrade(name, 0)).toBeNull();
  });
});
