import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { MAX_SEQUENCE_BYTES } from '../engine/ansi';
import { readKey, type InputEvent, type Key } from './key';
import { KeyParser, MAX_PASTE_BYTES } from './key-parser';

const NO_FLAGS: Key = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  home: false,
  end: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
};

const pressed = (input: string, flags: Partial<Key> = {}): InputEvent => ({
  kind: 'key',
  input,
  key: { ...NO_FLAGS, ...flags },
});

interface Harness {
  readonly events: InputEvent[];
  readonly parser: KeyParser;
  /** What the parser asked to be called back with, and after how long. */
  readonly timers: { flush: () => void; ms: number; cancelled: boolean }[];
  readonly warnings: string[];
}

function newParser(): Harness {
  const events: InputEvent[] = [];
  const timers: Harness['timers'] = [];
  const warnings: string[] = [];
  const parser = new KeyParser(
    (event) => {
      events.push(event);
    },
    (flush, ms) => {
      const timer = { flush, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    (message) => {
      warnings.push(message);
    },
  );
  return { events, parser, timers, warnings };
}

const parse = (...chunks: string[]): InputEvent[] => {
  const { events, parser } = newParser();
  for (const chunk of chunks) parser.feed(chunk);
  return events;
};

describe('KeyParser', () => {
  describe('one key (INK-KEY-01 to 16)', () => {
    const table: readonly [string, string, string, Partial<Key>][] = [
      ['up', '\x1b[A', '', { upArrow: true }],
      ['down', '\x1b[B', '', { downArrow: true }],
      ['left', '\x1b[D', '', { leftArrow: true }],
      ['right', '\x1b[C', '', { rightArrow: true }],
      ['up in application mode', '\x1bOA', '', { upArrow: true }],
      ['page down', '\x1b[6~', '', { pageDown: true }],
      ['page up', '\x1b[5~', '', { pageUp: true }],
      ['home', '\x1b[H', '', { home: true }],
      ['home on tmux', '\x1b[1~', '', { home: true }],
      ['end', '\x1b[F', '', { end: true }],
      ['end on tmux', '\x1b[4~', '', { end: true }],
      ['return', '\r', '\r', { return: true }],
      ['line feed, which is not return', '\n', '\n', {}],
      ['tab', '\t', '', { tab: true }],
      ['shift+tab (INK-KEY-13)', '\x1b[Z', '', { tab: true, shift: true }],
      ['backspace is 0x7f (INK-KEY-14)', '\x7f', '', { backspace: true }],
      ['backspace is 0x08', '\b', '', { backspace: true }],
      ['delete is CSI 3 ~ (INK-KEY-15)', '\x1b[3~', '', { delete: true }],
      ['ctrl+up', '\x1b[1;5A', '', { upArrow: true, ctrl: true }],
      ['shift+up', '\x1b[1;2A', '', { upArrow: true, shift: true }],
      ['alt+up', '\x1b[1;3A', '', { upArrow: true, meta: true }],
      ['ctrl+delete', '\x1b[3;5~', '', { delete: true, ctrl: true }],
      ['meta from a doubled escape', '\x1b\x1b[A', '', { upArrow: true, meta: true }],
      ['rxvt shift+up', '\x1b[a', '', { upArrow: true, shift: true }],
      ['rxvt ctrl+up', '\x1bOa', '', { upArrow: true, ctrl: true }],
      ['rxvt shift+delete', '\x1b[3$', '', { delete: true, shift: true }],
      ['rxvt ctrl+delete', '\x1b[3^', '', { delete: true, ctrl: true }],
      ['alt+a', '\x1ba', 'a', { meta: true }],
      ['alt+A', '\x1bA', 'A', { meta: true, shift: true }],
      ['alt+backspace', '\x1b\x7f', '', { backspace: true, meta: true }],
      ['alt+tab', '\x1b\t', '', { tab: true, meta: true }],
      ['alt+space', '\x1b ', ' ', { meta: true }],
      ['Option+Return (INK-INPUT-13)', '\x1b\r', '\r', { return: true, meta: true }],
      ['keypad Enter (INK-INPUT-12)', '\x1bOM', '\r', { return: true }],
      ['alt+keypad Enter', '\x1b\x1bOM', '\r', { return: true, meta: true }],
    ];

    it.each(table)('%s', (_name, bytes, input, flags) => {
      expect(parse(bytes)).toEqual([pressed(input, flags)]);
    });
  });

  describe('modifiers, as Ink 8.0.0 reads them', () => {
    it.each<[string, string, Partial<Key>]>([
      ['Super is not meta on the forms of the kitty table', '\x1b[1;9A', { upArrow: true }],
      ['Meta is, on those forms', '\x1b[1;33A', { upArrow: true, meta: true }],
      ['Super is meta on the legacy forms', '\x1b[1;9R', { meta: true }],
      ['a modifier of 0 is none on the kitty forms', '\x1b[1;0A', { upArrow: true }],
      [
        'and has every bit on the legacy ones',
        '\x1b[0A',
        { upArrow: true, ctrl: true, shift: true, meta: true },
      ],
      ['a digit before the letter is the modifier', '\x1b[2A', { upArrow: true, shift: true }],
      ['SS3 with a modifier', '\x1bO5A', { upArrow: true, ctrl: true }],
      ['legacy function keys', '\x1b[[A', {}],
      ['legacy function keys with a modifier', '\x1b[[1;5A', { ctrl: true }],
      ['a doubled escape is meta', '\x1b\x1b[3~', { delete: true, meta: true }],
    ])('%s', (_name, bytes, flags) => {
      expect(parse(bytes)).toEqual([pressed('', flags)]);
    });

    // Ink's own quirk: Shift+F3 and a cursor report on the first row are the same bytes.
    it('takes a cursor report on the first row for F3', () => {
      expect(parse('\x1b[1;1R')).toEqual([pressed('')]);
    });

    it('Alt+Ctrl+letter has both', () => {
      expect(parse('\x1b\x01')).toEqual([pressed('a', { ctrl: true, meta: true })]);
      expect(parse('\x1b\x00')).toEqual([pressed(' ', { ctrl: true, meta: true })]);
      expect(parse('\x1c')).toEqual([pressed('\\', { ctrl: true })]);
    });

    it('Alt with a control that is not C0 is no key, and keeps the character', () => {
      expect(parse('\x1b\x80')).toEqual([pressed('\x80')]);
      expect(parse('\x1b👍')).toEqual([pressed('👍', { meta: true })]);
    });

    it('reads a whole pasted string as one key, when asked', () => {
      expect(readKey('\x1b[Axyz')).toMatchObject({ input: '', key: { upArrow: true } });
      expect(readKey('\x1bNA').recognized).toBe(false);
      expect(readKey('\x1bQ~').recognized).toBe(false);
      expect(readKey('').recognized).toBe(false);
    });
  });

  describe('the input of a key', () => {
    const empty: readonly string[] = [
      '\x1bOP',
      '\x1bOQ',
      '\x1bOR',
      '\x1bOS',
      '\x1b[15~',
      '\x1b[17~',
      '\x1b[18~',
      '\x1b[19~',
      '\x1b[20~',
      '\x1b[21~',
      '\x1b[23~',
      '\x1b[24~',
      '\x1b[2~',
      '\x1b[E',
    ];

    it.each(empty)('keys with no flag of their own still arrive, empty: %j (INK-INPUT-11)', (b) => {
      expect(parse(b)).toEqual([pressed('')]);
    });

    it('Ctrl+letter names the letter (INK-INPUT-05)', () => {
      expect(parse('\x01')).toEqual([pressed('a', { ctrl: true })]);
      expect(parse('\x1a')).toEqual([pressed('z', { ctrl: true })]);
      expect(parse('\x03')).toEqual([pressed('c', { ctrl: true })]);
    });

    it('space is a space, and Ctrl+space too (INK-INPUT-05)', () => {
      expect(parse(' ')).toEqual([pressed(' ')]);
      expect(parse('\x00')).toEqual([pressed(' ', { ctrl: true })]);
    });

    it('a capital letter on its own turns shift on (INK-INPUT-06)', () => {
      expect(parse('A')).toEqual([pressed('A', { shift: true })]);
      expect(parse('a')).toEqual([pressed('a')]);
      expect(parse('1')).toEqual([pressed('1')]);
      expect(parse('AB')).toEqual([pressed('AB')]);
    });

    it('a grapheme of several code points arrives whole', () => {
      expect(parse('👍🏽')).toEqual([pressed('👍🏽')]);
      expect(parse('é')).toEqual([pressed('é')]);
      expect(parse('👨‍👩‍👧')).toEqual([pressed('👨‍👩‍👧')]);
    });

    it('text typed in one chunk arrives in one call (INK-INPUT-01)', () => {
      expect(parse('hello')).toEqual([pressed('hello')]);
    });
  });

  describe('a lone escape (INK-INPUT-09)', () => {
    it('waits 20 ms and becomes escape', () => {
      const { events, parser, timers } = newParser();
      parser.feed('\x1b');
      expect(events).toEqual([]);
      expect(timers.map(({ ms }) => ms)).toEqual([20]);
      timers[0]!.flush();
      expect(events).toEqual([pressed('', { escape: true })]);
    });

    it('turns into an arrow if the rest arrives before the 20 ms', () => {
      const { events, parser, timers } = newParser();
      parser.feed('\x1b');
      parser.feed('[A');
      expect(timers[0]!.cancelled).toBe(true);
      expect(timers).toHaveLength(1);
      expect(events).toEqual([pressed('', { upArrow: true })]);
    });

    it('survives a split at any byte of a sequence', () => {
      expect(parse('\x1b', '[', '1', ';', '5', 'A')).toEqual([
        pressed('', { upArrow: true, ctrl: true }),
      ]);
    });

    it('a doubled escape flushes as meta escape, and the second escape stays in the input', () => {
      const { events, parser, timers } = newParser();
      parser.feed('\x1b\x1b');
      timers[0]!.flush();
      expect(events).toEqual([pressed('\x1b', { escape: true, meta: true })]);
    });

    it('flush with nothing held does nothing', () => {
      const { events, parser, timers } = newParser();
      parser.feed('a');
      parser.flush();
      expect(timers).toEqual([]);
      expect(events).toEqual([pressed('a')]);
    });
  });

  describe('an incomplete sequence', () => {
    it.each([
      ['\x1b[', '['],
      ['\x1b[1;', '[1;'],
      ['\x1b[20', '[20'],
      ['\x1bO1', 'O1'],
    ])('%j loses its escape when flushed (INK-INPUT-07)', (bytes, input) => {
      const { events, parser, timers } = newParser();
      parser.feed(bytes);
      timers[0]!.flush();
      expect(events).toEqual([pressed(input)]);
    });

    it('keeps meta when the flushed part is ESC O', () => {
      const { events, parser, timers } = newParser();
      parser.feed('\x1bO');
      timers[0]!.flush();
      expect(events).toEqual([pressed('O', { meta: true, shift: true })]);
    });

    it('a byte that cannot continue the sequence breaks it, and the rest is text', () => {
      expect(parse('\x1b[12\x01x')).toEqual([pressed('['), pressed('12\x01x')]);
      expect(parse('\x1b[12\x1b[A')).toEqual([
        pressed('['),
        pressed('12'),
        pressed('', { upArrow: true }),
      ]);
      expect(parse('\x1bO\x03')).toEqual([
        pressed('O', { meta: true, shift: true }),
        pressed('c', { ctrl: true }),
      ]);
    });

    it('waits for the paste start marker without a timer', () => {
      const { events, parser, timers } = newParser();
      parser.feed('\x1b[200');
      expect(timers).toEqual([]);
      parser.flush();
      expect(events).toEqual([]);
    });
  });

  describe('several keys in one chunk (INK-INPUT-10)', () => {
    it('emits the arrow and then the text', () => {
      expect(parse('\x1b[Aabc')).toEqual([pressed('', { upArrow: true }), pressed('abc')]);
    });

    it('emits one event per sequence', () => {
      expect(parse('\x1b[A\x1b[B\x1b[C')).toEqual([
        pressed('', { upArrow: true }),
        pressed('', { downArrow: true }),
        pressed('', { rightArrow: true }),
      ]);
    });

    it('backspace and Ctrl+C split a run of text, other controls do not', () => {
      expect(parse('ab\x7f\x7fc\x03d')).toEqual([
        pressed('ab'),
        pressed('', { backspace: true }),
        pressed('', { backspace: true }),
        pressed('c'),
        pressed('c', { ctrl: true }),
        pressed('d'),
      ]);
      expect(parse('a\rb\tc')).toEqual([pressed('a\rb\tc')]);
    });
  });

  describe('sequences with no key (INK-INPUT-08)', () => {
    it.each([
      ['SGR mouse press', '\x1b[<0;1;1M'],
      ['SGR mouse release', '\x1b[<0;10;20m'],
      ['focus in', '\x1b[I'],
      ['focus out', '\x1b[O'],
      ['cursor position', '\x1b[24;80R'],
      ['primary device attributes', '\x1b[?62;1;4c'],
      ['secondary device attributes', '\x1b[>0;276;0c'],
      ['a stray paste end', '\x1b[201~'],
      ['an unknown final byte', '\x1b[@'],
      ['an unknown SS3 key', '\x1bOz'],
      ['a kitty query reply', '\x1b[?1u'],
      ['kitty protocol keys, which are never asked for', '\x1b[97;5u'],
    ])('%s emits nothing', (_name, bytes) => {
      expect(parse(bytes)).toEqual([]);
    });

    it('keeps the keys around them', () => {
      expect(parse('a\x1b[Ib')).toEqual([pressed('a'), pressed('b')]);
    });
  });

  describe('bracketed paste (INK-HOOK-PASTE-03)', () => {
    it('emits the text between the markers, verbatim', () => {
      expect(parse('\x1b[200~a\nb\x1b[201~')).toEqual([{ kind: 'paste', text: 'a\nb' }]);
      expect(parse('\x1b[200~\x03\x1b[A\x1b\x1b[201~')).toEqual([
        { kind: 'paste', text: '\x03\x1b[A\x1b' },
      ]);
    });

    it('takes markers split across chunks at every position', () => {
      const whole = '\x1b[200~a\nb\x1b[201~';
      for (let cut = 1; cut < whole.length; cut += 1) {
        expect(parse(whole.slice(0, cut), whole.slice(cut))).toEqual([
          { kind: 'paste', text: 'a\nb' },
        ]);
      }
      expect(parse(...Array.from(whole))).toEqual([{ kind: 'paste', text: 'a\nb' }]);
    });

    it('keeps a part of the end marker that turned out to be text', () => {
      expect(parse('\x1b[200~a\x1b[20', '1x\x1b[201~')).toEqual([
        { kind: 'paste', text: 'a\x1b[201x' },
      ]);
    });

    it('goes on parsing after the end marker, in the same chunk', () => {
      expect(parse('x\x1b[200~y\x1b[201~z')).toEqual([
        pressed('x'),
        { kind: 'paste', text: 'y' },
        pressed('z'),
      ]);
    });

    it('an escape flush does not end a paste', () => {
      const { events, parser, timers } = newParser();
      parser.feed('\x1b[200~a');
      expect(timers).toEqual([]);
      parser.flush();
      expect(events).toEqual([]);
    });

    it('an empty paste is a paste', () => {
      expect(parse('\x1b[200~\x1b[201~')).toEqual([{ kind: 'paste', text: '' }]);
    });

    it('over 10 MiB drops the excess, warns once and recovers', () => {
      const { events, parser, warnings } = newParser();
      expect(MAX_PASTE_BYTES).toBe(10_485_760);
      parser.feed('\x1b[200~');
      parser.feed('x'.repeat(MAX_PASTE_BYTES - 1));
      parser.feed('yz');
      parser.feed('more');
      parser.feed('\x1b[201~a');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^angular-ink: /);
      expect(events).toHaveLength(2);
      const [paste, after] = events;
      expect(paste?.kind === 'paste' && paste.text.length).toBe(MAX_PASTE_BYTES);
      expect(paste?.kind === 'paste' && paste.text.endsWith('xy')).toBe(true);
      expect(after).toEqual(pressed('a'));
    });

    it('counts bytes, and never cuts a character in half', () => {
      const { events, parser } = newParser();
      parser.feed('\x1b[200~');
      parser.feed('x'.repeat(MAX_PASTE_BYTES - 1));
      parser.feed('é\x1b[201~');
      const [paste] = events;
      expect(paste?.kind === 'paste' && paste.text.length).toBe(MAX_PASTE_BYTES - 1);
    });
  });

  describe('a sequence with no end', () => {
    it('is dropped after MAX_SEQUENCE_BYTES, and nothing of it reaches a handler', () => {
      const { events, parser } = newParser();
      parser.feed(`\x1b[${'1'.repeat(MAX_SEQUENCE_BYTES * 2)}`);
      expect(events).toEqual([]);
      parser.feed('\x1b[A');
      expect(events).toEqual([pressed('', { upArrow: true })]);
    });

    it('a sequence right at the limit still parses', () => {
      const body = '1'.repeat(MAX_SEQUENCE_BYTES - 4);
      expect(parse(`\x1b[${body}~`)).toEqual([]);
      expect(parse(`\x1b[${body}~a`)).toEqual([pressed('a')]);
    });

    it('its final byte ends the discard', () => {
      expect(parse(`\x1b[${'1'.repeat(MAX_SEQUENCE_BYTES * 2)}~b`)).toEqual([pressed('b')]);
    });

    it('a flush ends the discard, so a pause gives the keyboard back', () => {
      const { events, parser, timers } = newParser();
      parser.feed(`\x1bO${'1'.repeat(MAX_SEQUENCE_BYTES * 2)}`);
      timers[0]!.flush();
      parser.feed('1');
      expect(events).toEqual([pressed('1')]);
    });

    it.each([
      ['parameters', `\x1b[${'1'.repeat(1_048_576)}`],
      ['intermediates', `\x1b[${' '.repeat(1_048_576)}`],
      ['SS3 digits', `\x1bO${'1'.repeat(1_048_576)}`],
      ['escapes', '\x1b'.repeat(1_048_576)],
      ['broken sequences', '\x1b[1\x01'.repeat(262_144)],
      ['paste markers that never finish', `\x1b[200~${'\x1b[201'.repeat(209_715)}`],
    ])('1 MiB of %s takes under 500 ms', (_name, chunk) => {
      const { parser } = newParser();
      const started = performance.now();
      parser.feed(chunk);
      expect(performance.now() - started).toBeLessThan(500);
    });
  });

  it('reset forgets everything held and cancels the timer', () => {
    const { events, parser, timers } = newParser();
    parser.feed('\x1b[1');
    parser.reset();
    expect(timers[0]!.cancelled).toBe(true);
    parser.feed('a');
    expect(events).toEqual([pressed('a')]);
    parser.feed('\x1b[200~lost');
    parser.reset();
    parser.feed('b');
    expect(events).toEqual([pressed('a'), pressed('b')]);
  });

  it('takes no warn callback', () => {
    const emit = vi.fn();
    const parser = new KeyParser(emit, () => () => undefined);
    parser.feed('\x1b[200~');
    parser.feed('x'.repeat(MAX_PASTE_BYTES + 1));
    parser.feed('\x1b[201~');
    expect(emit).toHaveBeenCalledOnce();
  });

  describe('captured sequences (S5)', () => {
    const folder = fileURLToPath(new URL('../../../../../e2e/fixtures/keys/', import.meta.url));
    const expected: Readonly<Record<string, InputEvent>> = {
      up: pressed('', { upArrow: true }),
      down: pressed('', { downArrow: true }),
      left: pressed('', { leftArrow: true }),
      right: pressed('', { rightArrow: true }),
      'app-up': pressed('', { upArrow: true }),
      'app-down': pressed('', { downArrow: true }),
      home: pressed('', { home: true }),
      end: pressed('', { end: true }),
      pageup: pressed('', { pageUp: true }),
      pagedown: pressed('', { pageDown: true }),
      insert: pressed(''),
      delete: pressed('', { delete: true }),
      f1: pressed(''),
      f5: pressed(''),
      f12: pressed(''),
      return: pressed('\r', { return: true }),
      tab: pressed('', { tab: true }),
      'shift-tab': pressed('', { tab: true, shift: true }),
      backspace: pressed('', { backspace: true }),
      'ctrl-a': pressed('a', { ctrl: true }),
      'ctrl-c': pressed('c', { ctrl: true }),
      'ctrl-up': pressed('', { upArrow: true, ctrl: true }),
      'shift-up': pressed('', { upArrow: true, shift: true }),
      'alt-up': pressed('', { upArrow: true, meta: true }),
      'alt-a': pressed('a', { meta: true }),
      'alt-return': pressed('\r', { return: true, meta: true }),
    };
    const files = readdirSync(folder).filter((name) => name.endsWith('.bin'));

    it('has fixtures of xterm, kitty and tmux', () => {
      for (const terminal of ['xterm', 'kitty', 'tmux']) {
        const keys = files.filter((name) => name.startsWith(`${terminal}-`));
        expect(keys.length, terminal).toBe(Object.keys(expected).length);
      }
    });

    it.each(files)('%s', (file) => {
      const name = file.slice(file.indexOf('-') + 1, -'.bin'.length);
      const bytes = readFileSync(`${folder}${file}`).toString('utf8');
      expect(parse(bytes)).toEqual([expected[name]]);
    });
  });
});
