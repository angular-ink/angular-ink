import { describe, expect, it } from 'vitest';
import { openSgr, parseAnsi, PLAIN_STYLE, sanitizeAnsi } from './ansi';

describe('sanitizeAnsi', () => {
  it('keeps SGR sequences', () => {
    expect(sanitizeAnsi('\x1b[31mred\x1b[39m \x1b[1;4mx\x1b[0m')).toBe(
      '\x1b[31mred\x1b[39m \x1b[1;4mx\x1b[0m',
    );
  });

  it('removes screen clearing and cursor movement', () => {
    expect(sanitizeAnsi('a\x1b[2Jb\x1b[Hc\x1b[10;5Hd\x1b[?25le')).toBe('abcde');
  });

  it('removes OSC 52 and OSC 8 but keeps the link text', () => {
    expect(sanitizeAnsi('a\x1b]52;c;SGVsbG8=\x07b')).toBe('ab');
    expect(sanitizeAnsi('a\x1b]52;c;SGVsbG8=\x1b\\b')).toBe('ab');
    expect(sanitizeAnsi('\x1b]8;;https://example.com\x07link\x1b]8;;\x07')).toBe('link');
  });

  it('removes other escape sequences and string controls', () => {
    expect(sanitizeAnsi('a\x1bcb\x1b(Bc\x1bPdata\x1b\\d')).toBe('abcd');
    expect(sanitizeAnsi('a\x1b')).toBe('a');
  });

  it('removes C0 controls and DEL except tab and newline', () => {
    expect(sanitizeAnsi('a\tb\nc\rd\x00e\x07f\x08g\x7fh')).toBe('a\tb\ncdefgh');
  });

  it('removes C1 controls', () => {
    expect(sanitizeAnsi('a\u009b2Jb\u009dx')).toBe('a2Jbx');
  });

  it('normalizes colon parameters', () => {
    expect(sanitizeAnsi('\x1b[38:2::1:2:3mx')).toBe('\x1b[38;2;1;2;3mx');
    expect(sanitizeAnsi('\x1b[48:2:1:2:3mx')).toBe('\x1b[48;2;1;2;3mx');
    expect(sanitizeAnsi('\x1b[38:5:208mx')).toBe('\x1b[38;5;208mx');
    expect(sanitizeAnsi('\x1b[4:3mx')).toBe('\x1b[4mx');
    expect(sanitizeAnsi('\x1b[4:0mx')).toBe('\x1b[24mx');
    expect(sanitizeAnsi('\x1b[1;4:3;31mx')).toBe('\x1b[1;4;31mx');
  });

  it('removes CSI sequences with private markers even when they end in m', () => {
    expect(sanitizeAnsi('a\x1b[>4;2mb')).toBe('ab');
  });

  it('ends in linear time on unterminated sequences', () => {
    for (const unit of ['\x1b[', '\x1b]', '\x1b[1;', '\x1bP']) {
      const input = unit.repeat(Math.ceil(1_048_576 / unit.length));
      const start = performance.now();
      const out = sanitizeAnsi(input);
      expect(performance.now() - start).toBeLessThan(1000);
      expect(out).toBe('');
    }
  });

  it('does not leak an unterminated long CSI as text', () => {
    expect(sanitizeAnsi('\x1b[' + '1;'.repeat(500) + 'x')).not.toContain('1;1;1;1');
  });
});

describe('parseAnsi', () => {
  it('splits spans on style changes', () => {
    const red = { kind: 'named', code: 31, bgCode: 41 } as const;
    expect(parseAnsi('\x1b[31mA\x1b[39mB', PLAIN_STYLE)).toEqual([
      { text: 'A', style: { ...PLAIN_STYLE, fg: red } },
      { text: 'B', style: PLAIN_STYLE },
    ]);
  });

  it('returns to the base style on reset', () => {
    const base = {
      ...PLAIN_STYLE,
      bold: true,
      fg: { kind: 'named', code: 32, bgCode: 42 },
    } as const;
    const spans = parseAnsi('\x1b[3;31mA\x1b[0mB', base);
    expect(spans[0]?.style).toMatchObject({ italic: true, bold: true, fg: { code: 31 } });
    expect(spans[1]).toEqual({ text: 'B', style: base });
  });

  it('applies attributes, backgrounds and extended colors', () => {
    const [span] = parseAnsi('\x1b[1;2;3;4;7;9;48;5;208;38;2;1;2;3mx', PLAIN_STYLE);
    expect(span?.style).toEqual({
      fg: { kind: 'rgb', r: 1, g: 2, b: 3 },
      bg: { kind: 'ansi256', index: 208 },
      bold: true,
      dim: true,
      italic: true,
      underline: true,
      strikethrough: true,
      inverse: true,
    });
  });

  it('turns attributes off and handles bright colors', () => {
    const spans = parseAnsi('\x1b[1;2;3;4;7;9mA\x1b[22;23;24;27;29;91;104mB', PLAIN_STYLE);
    expect(spans[1]?.style).toEqual({
      ...PLAIN_STYLE,
      fg: { kind: 'named', code: 91, bgCode: 101 },
      bg: { kind: 'named', code: 94, bgCode: 104 },
    });
  });

  it('treats an empty SGR as reset and ignores unknown or truncated codes', () => {
    const spans = parseAnsi('\x1b[1mA\x1b[mB\x1b[99mC\x1b[38;5mD', PLAIN_STYLE);
    expect(spans.map((s) => s.text)).toEqual(['A', 'BCD']);
  });

  it('skips the underline color parameters', () => {
    const [span] = parseAnsi('\x1b[58;2;1;2;3;1mx', PLAIN_STYLE);
    expect(span?.style).toEqual({ ...PLAIN_STYLE, bold: true });
  });

  it('sanitizes the text it parses', () => {
    expect(parseAnsi('a\x1b[2Jb\x1b[38:2::1:2:3mc', PLAIN_STYLE).map((s) => s.text)).toEqual([
      'ab',
      'c',
    ]);
  });

  it('returns no spans for empty input', () => {
    expect(parseAnsi('', PLAIN_STYLE)).toEqual([]);
  });
});

describe('openSgr', () => {
  it('is empty for the plain style', () => {
    expect(openSgr(PLAIN_STYLE)).toBe('');
  });

  it('emits chalk-style parameters', () => {
    expect(
      openSgr({
        fg: { kind: 'rgb', r: 1, g: 2, b: 3 },
        bg: { kind: 'ansi256', index: 208 },
        bold: true,
        dim: false,
        italic: true,
        underline: true,
        strikethrough: true,
        inverse: true,
      }),
    ).toBe('\x1b[1;3;4;7;9;38;2;1;2;3;48;5;208m');
    expect(
      openSgr({
        ...PLAIN_STYLE,
        fg: { kind: 'named', code: 91, bgCode: 101 },
        bg: { kind: 'named', code: 34, bgCode: 44 },
        dim: true,
      }),
    ).toBe('\x1b[2;91;44m');
  });
});

describe('parseAnsi with channels out of range', () => {
  it('keeps them, as the terminal gets them through Ink', () => {
    const [span] = parseAnsi('\x1b[38;2;300;0;0ma', PLAIN_STYLE);
    expect(span?.style.fg).toEqual({ kind: 'rgb', r: 300, g: 0, b: 0 });
  });

  it('drops a number too long to print as digits', () => {
    const [span] = parseAnsi(`\x1b[38;5;${'9'.repeat(30)}ma`, PLAIN_STYLE);
    expect(span?.style.fg).toBeNull();
  });
});
