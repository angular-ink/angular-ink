/** The keys and modifiers of one key press, with the names and meaning of Ink 8.0.0. */
export interface Key {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageDown: boolean;
  pageUp: boolean;
  home: boolean;
  end: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
}

export type InputEvent =
  | { readonly kind: 'key'; readonly input: string; readonly key: Key }
  | { readonly kind: 'paste'; readonly text: string };

export interface ReadKey {
  readonly input: string;
  readonly key: Key;
  /** Whether the bytes name a key. A complete sequence that names none is not input. */
  readonly recognized: boolean;
}

interface Keypress {
  readonly name: string;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly shift?: boolean;
  /** What the bytes stand for when it is not themselves, as with keypad Enter. */
  readonly sequence?: string;
}

const ESC = '\x1b';
const CTRL_BIT = 4;
const SHIFT_BIT = 1;
/** Alt and Super on the legacy forms. */
const LEGACY_META_BITS = 2 | 8;
/** Alt and Meta on the forms Ink reads with its kitty parser, whether or not the protocol is on. */
const MODERN_META_BITS = 2 | 32;

// Parity needs the names Ink gives these codes. Its MIT notice and Enquirer's, where Ink's table
// comes from, ship in THIRD-PARTY-NOTICES.
const KEY_NAMES: ReadonlyMap<string, string> = new Map([
  ['OP', 'f1'],
  ['OQ', 'f2'],
  ['OR', 'f3'],
  ['OS', 'f4'],
  ['[P', 'f1'],
  ['[Q', 'f2'],
  ['[R', 'f3'],
  ['[S', 'f4'],
  ['[11~', 'f1'],
  ['[12~', 'f2'],
  ['[13~', 'f3'],
  ['[14~', 'f4'],
  ['[[A', 'f1'],
  ['[[B', 'f2'],
  ['[[C', 'f3'],
  ['[[D', 'f4'],
  ['[[E', 'f5'],
  ['[15~', 'f5'],
  ['[17~', 'f6'],
  ['[18~', 'f7'],
  ['[19~', 'f8'],
  ['[20~', 'f9'],
  ['[21~', 'f10'],
  ['[23~', 'f11'],
  ['[24~', 'f12'],
  ['[A', 'up'],
  ['[B', 'down'],
  ['[C', 'right'],
  ['[D', 'left'],
  ['[E', 'clear'],
  ['[F', 'end'],
  ['[H', 'home'],
  ['OA', 'up'],
  ['OB', 'down'],
  ['OC', 'right'],
  ['OD', 'left'],
  ['OE', 'clear'],
  ['OF', 'end'],
  ['OH', 'home'],
  ['[1~', 'home'],
  ['[2~', 'insert'],
  ['[3~', 'delete'],
  ['[4~', 'end'],
  ['[5~', 'pageup'],
  ['[6~', 'pagedown'],
  ['[[5~', 'pageup'],
  ['[[6~', 'pagedown'],
  ['[7~', 'home'],
  ['[8~', 'end'],
  ['[a', 'up'],
  ['[b', 'down'],
  ['[c', 'right'],
  ['[d', 'left'],
  ['[e', 'clear'],
  ['[2$', 'insert'],
  ['[3$', 'delete'],
  ['[5$', 'pageup'],
  ['[6$', 'pagedown'],
  ['[7$', 'home'],
  ['[8$', 'end'],
  ['Oa', 'up'],
  ['Ob', 'down'],
  ['Oc', 'right'],
  ['Od', 'left'],
  ['Oe', 'clear'],
  ['[2^', 'insert'],
  ['[3^', 'delete'],
  ['[5^', 'pageup'],
  ['[6^', 'pagedown'],
  ['[7^', 'home'],
  ['[8^', 'end'],
  ['[Z', 'tab'],
]);

/** Names with no text of their own. */
const SILENT_NAMES: ReadonlySet<string> = new Set([...KEY_NAMES.values(), 'backspace']);

const SHIFTED_CODES: ReadonlySet<string> = new Set([
  '[a',
  '[b',
  '[c',
  '[d',
  '[e',
  '[2$',
  '[3$',
  '[5$',
  '[6$',
  '[7$',
  '[8$',
  '[Z',
]);

const CTRL_CODES: ReadonlySet<string> = new Set([
  'Oa',
  'Ob',
  'Oc',
  'Od',
  'Oe',
  '[2^',
  '[3^',
  '[5^',
  '[6^',
  '[7^',
  '[8^',
]);

const MODERN_LETTERS: ReadonlySet<string> = new Set('ABCDEFHPQS');
const MODERN_NUMBERS: ReadonlySet<string> = new Set([
  '2',
  '3',
  '5',
  '6',
  '7',
  '8',
  '11',
  '12',
  '13',
  '14',
  '15',
  '17',
  '18',
  '19',
  '20',
  '21',
  '23',
  '24',
]);

const isDigit = (char: string | undefined): boolean =>
  char !== undefined && char >= '0' && char <= '9';

const isLetter = (char: string): boolean =>
  (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');

/** Where the run of digits that starts at `from` ends. */
function endOfDigits(text: string, from: number): number {
  let index = from;
  while (isDigit(text[index])) index += 1;
  return index;
}

/** A key with parameters, as `ESC [ code`, `ESC O code` and `ESC [ [ code`. */
function readFunctionKey(bytes: string): Keypress {
  const none: Keypress = { name: '' };
  let start = 0;
  while (bytes[start] === ESC) start += 1;
  if (start === 0) return none;

  let prefix = bytes[start];
  if (prefix !== 'O' && prefix !== 'N' && prefix !== '[') return none;
  if (prefix === '[' && bytes[start + 1] === '[') prefix = '[[';
  const body = start + prefix.length;
  const doubled = bytes[1] === ESC;
  const isCsi = !doubled && prefix === '[';

  const firstEnd = endOfDigits(bytes, body);
  const first = bytes.slice(body, firstEnd);
  if (first !== '') {
    let end = firstEnd;
    let modifier = '';
    if (bytes[end] === ';') {
      const secondEnd = endOfDigits(bytes, end + 1);
      if (secondEnd > end + 1) {
        modifier = bytes.slice(end + 1, secondEnd);
        end = secondEnd;
      }
    }
    const terminator = bytes[end];
    if (terminator === '~' || terminator === '^' || terminator === '$') {
      const modern =
        isCsi && terminator === '~' && end === bytes.length - 1 && MODERN_NUMBERS.has(first);
      return functionKey(`${prefix}${first}${terminator}`, modifier, doubled, modern);
    }
  }

  const after = bytes.startsWith('1;', body) ? body + 2 : body;
  const digitsEnd = endOfDigits(bytes, after);
  const letter = bytes[digitsEnd];
  if (letter === undefined || !isLetter(letter)) return none;
  const modifier = bytes.slice(after, digitsEnd);
  const modern =
    isCsi &&
    first === '1' &&
    digitsEnd === bytes.length - 1 &&
    MODERN_LETTERS.has(letter) &&
    (after === body || modifier !== '');
  return functionKey(`${prefix}${letter}`, modifier, doubled, modern);
}

function functionKey(code: string, modifier: string, doubled: boolean, modern: boolean): Keypress {
  // A modifier of 0 means none on the modern forms. On the legacy ones Ink turns it into -1, which
  // has every bit on.
  const bits = modern ? Math.max(0, Number(modifier || 1) - 1) : Number(modifier || 1) - 1;
  const metaBits = modern ? MODERN_META_BITS : LEGACY_META_BITS;
  return {
    name: KEY_NAMES.get(code) ?? '',
    ctrl: (bits & CTRL_BIT) !== 0 || CTRL_CODES.has(code),
    meta: doubled || (bits & metaBits) !== 0,
    shift: (bits & SHIFT_BIT) !== 0 || SHIFTED_CODES.has(code),
  };
}

function readKeypress(bytes: string): Keypress {
  const meta = bytes.startsWith(ESC);
  switch (bytes) {
    case '\r':
    case '\x1b\r':
      return { name: 'return', meta };
    case '\x1bOM':
      return { name: 'return', sequence: '\r' };
    case '\x1b\x1bOM':
      return { name: 'return', sequence: '\r', meta: true };
    case '\n':
      return { name: 'enter' };
    case '\t':
    case '\x1b\t':
      return { name: 'tab', meta };
    case '\b':
    case '\x1b\b':
    case '\x7f':
    case '\x1b\x7f':
      return { name: 'backspace', meta };
    case ESC:
      return { name: 'escape' };
    case '\x1b\x1b':
      return { name: 'escape', meta: true };
    default:
  }

  const char = bytes.length === 1 || (bytes.length === 2 && meta) ? bytes.at(-1) : undefined;
  if (char !== undefined) {
    if (char === ' ' || char === '\0') return { name: 'space', ctrl: char === '\0', meta };
    const code = char.charCodeAt(0);
    if (code < 0x20) {
      const name = String.fromCharCode(code + (code <= 26 ? 96 : 64));
      return { name, ctrl: true, meta };
    }
  }
  if (bytes.length === 1) {
    const shift = bytes >= 'A' && bytes <= 'Z';
    return { name: isLetter(bytes) ? bytes.toLowerCase() : '', shift };
  }

  const pressed = meta ? bytes.slice(1) : '';
  // One code point, not a control, not the introducer of a sequence.
  if (
    pressed !== '' &&
    pressed !== '[' &&
    pressed.length === ((pressed.codePointAt(0) ?? 0) > 0xffff ? 2 : 1) &&
    !/\p{C}/u.test(pressed)
  ) {
    return { name: pressed.toLowerCase(), meta: true, shift: pressed >= 'A' && pressed <= 'Z' };
  }
  return readFunctionKey(bytes);
}

/** What the given bytes mean as one key press. Follows Ink's `parseKeypress` and `useInput`. */
export function readKey(bytes: string): ReadKey {
  const keypress = readKeypress(bytes);
  const { name } = keypress;
  const ctrl = keypress.ctrl ?? false;
  let input: string;
  if (ctrl) input = name === 'space' ? ' ' : name;
  else input = keypress.sequence ?? bytes;
  if (SILENT_NAMES.has(name)) input = '';
  // A sequence that was cut short, or an escape on its own.
  if (input.startsWith(ESC)) input = input.slice(1);
  return {
    input,
    recognized: name !== '',
    key: {
      upArrow: name === 'up',
      downArrow: name === 'down',
      leftArrow: name === 'left',
      rightArrow: name === 'right',
      pageDown: name === 'pagedown',
      pageUp: name === 'pageup',
      home: name === 'home',
      end: name === 'end',
      return: name === 'return',
      escape: name === 'escape',
      ctrl,
      shift: (keypress.shift ?? false) || (input.length === 1 && input >= 'A' && input <= 'Z'),
      tab: name === 'tab',
      backspace: name === 'backspace',
      delete: name === 'delete',
      meta: keypress.meta ?? false,
    },
  };
}
