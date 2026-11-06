import { StringDecoder } from 'node:string_decoder';
import { MAX_SEQUENCE_BYTES } from '../engine/ansi';
import { readKey, type InputEvent } from './key';

export const MAX_PASTE_BYTES = 10_485_760;

const ESC = 0x1b;
const ESC_CHAR = '\x1b';
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
/** Ink's wait for the rest of a sequence the terminal sent in two chunks. */
const ESCAPE_DELAY_MS = 20;

const isFinalByte = (code: number): boolean => code >= 0x40 && code <= 0x7e;
const isParameterByte = (code: number): boolean => code >= 0x30 && code <= 0x3f;
const isIntermediateByte = (code: number): boolean => code >= 0x20 && code <= 0x2f;
const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;
/** The bytes Ink splits off a run of text: backspace, Ctrl+H and Ctrl+C. */
const isKeyInText = (code: number): boolean => code === 0x7f || code === 0x08 || code === 0x03;

type State = 'ground' | 'escape' | 'double-escape' | 'csi' | 'ss3' | 'overflow' | 'paste';

/**
 * Turns the chunks of stdin into key presses and pastes, one character at a time. A chunk can end
 * anywhere, so what a sequence has so far stays here between chunks, up to `MAX_SEQUENCE_BYTES`.
 */
export class KeyParser {
  private state: State = 'ground';
  /** The bytes of the escape sequence in progress. */
  private sequence = '';
  /** What is left of a broken sequence. It holds no escape, and opens the next run of text. */
  private carry = '';
  private pasteParts: string[] = [];
  private pasteBytes = 0;
  /** The end of a paste chunk that may be the start of the end marker. */
  private pasteTail = '';
  private pasteOverflowed = false;
  private pasteDecoder = new StringDecoder('utf8');
  private cancelFlush: (() => void) | null = null;

  constructor(
    private readonly emit: (event: InputEvent) => void,
    private readonly schedule: (flush: () => void, ms: number) => () => void,
    private readonly warn: (message: string) => void = () => undefined,
  ) {}

  feed(chunk: string): void {
    this.cancelTimer();
    let index = 0;
    while (index < chunk.length) {
      if (this.state === 'ground') index = this.readText(chunk, index);
      else if (this.state === 'paste') index = this.readPaste(chunk, index);
      else index = this.readSequence(chunk, index);
    }
    this.emitText(this.takeCarry());
    if (this.canFlush()) {
      this.cancelFlush = this.schedule(() => {
        this.cancelFlush = null;
        this.flush();
      }, ESCAPE_DELAY_MS);
    }
  }

  /** Gives up waiting for the rest of a sequence. What came of it counts as typed. */
  flush(): void {
    if (!this.canFlush()) return;
    const held = this.sequence;
    this.toGround();
    if (held !== '') this.emitKey(held);
  }

  /** Forgets everything held: the next chunk starts clean. */
  reset(): void {
    this.cancelTimer();
    this.toGround();
    this.carry = '';
    this.endPaste();
  }

  private canFlush(): boolean {
    if (this.state === 'ground' || this.state === 'paste') return false;
    // The start of a paste marker, which Ink never takes for typing.
    return this.sequence !== '\x1b[200';
  }

  private cancelTimer(): void {
    this.cancelFlush?.();
    this.cancelFlush = null;
  }

  private toGround(): void {
    this.state = 'ground';
    this.sequence = '';
  }

  private takeCarry(): string {
    const { carry } = this;
    this.carry = '';
    return carry;
  }

  private emitKey(bytes: string): void {
    const { input, key } = readKey(bytes);
    this.emit({ kind: 'key', input, key });
  }

  private emitText(text: string): void {
    if (text !== '') this.emitKey(text);
  }

  private readText(chunk: string, from: number): number {
    let start = from;
    let index = from;
    for (; index < chunk.length; index += 1) {
      const code = chunk.charCodeAt(index);
      if (code === ESC) break;
      if (isKeyInText(code)) {
        this.emitText(this.takeCarry() + chunk.slice(start, index));
        this.emitKey(chunk.charAt(index));
        start = index + 1;
      }
    }
    this.emitText(this.takeCarry() + chunk.slice(start, index));
    if (index === chunk.length) return index;
    this.state = 'escape';
    this.sequence = ESC_CHAR;
    return index + 1;
  }

  /** Takes one character of an escape sequence. Returns where to go on. */
  private readSequence(chunk: string, index: number): number {
    const code = chunk.charCodeAt(index);
    const char = chunk.charAt(index);
    switch (this.state) {
      case 'escape':
        return this.readAfterEscape(chunk, index, code, char);
      case 'double-escape':
        if (char === '[' || char === 'O') {
          this.enter(char);
          return index + 1;
        }
        this.toGround();
        this.emitKey('\x1b\x1b');
        return index;
      case 'csi':
        return this.readCsi(index, code, char);
      case 'ss3':
        if (isFinalByte(code)) return this.complete(index, char);
        if ((code >= 0x30 && code <= 0x39) || code === 0x3b) return this.extend(index, char);
        return this.breakSequence(index);
      default:
        // An overflow: everything up to the end of the sequence goes.
        if (isFinalByte(code)) {
          this.toGround();
          return index + 1;
        }
        if (isParameterByte(code) || isIntermediateByte(code)) return index + 1;
        this.toGround();
        return index;
    }
  }

  private readAfterEscape(chunk: string, index: number, code: number, char: string): number {
    if (code === ESC) {
      this.state = 'double-escape';
      this.sequence += char;
      return index + 1;
    }
    if (char === '[' || char === 'O') {
      this.enter(char);
      return index + 1;
    }
    const pair = isHighSurrogate(code) && isLowSurrogate(chunk.charCodeAt(index + 1));
    const pressed = pair ? chunk.slice(index, index + 2) : char;
    this.toGround();
    this.emitKey(ESC_CHAR + pressed);
    return index + pressed.length;
  }

  private enter(introducer: string): void {
    this.state = introducer === '[' ? 'csi' : 'ss3';
    this.sequence += introducer;
  }

  private readCsi(index: number, code: number, char: string): number {
    const payload = this.sequence.charCodeAt(1) === ESC ? 3 : 2;
    const position = this.sequence.length - payload;
    // The legacy function keys, ESC [ [ A.
    if (char === '[' && position === 0) return this.extend(index, char);
    // The shifted editing keys of rxvt end in `$`, which would otherwise go on.
    const isRxvtEnd =
      char === '$' && position === 1 && '235678'.includes(this.sequence.charAt(payload));
    if (isRxvtEnd || isFinalByte(code)) return this.complete(index, char);
    if (isParameterByte(code) || isIntermediateByte(code)) return this.extend(index, char);
    return this.breakSequence(index);
  }

  private extend(index: number, char: string): number {
    if (this.sequence.length + 1 >= MAX_SEQUENCE_BYTES) {
      this.state = 'overflow';
      this.sequence = '';
    } else {
      this.sequence += char;
    }
    return index + 1;
  }

  private complete(index: number, char: string): number {
    const sequence = this.sequence + char;
    this.toGround();
    if (sequence === PASTE_START) {
      this.state = 'paste';
      return index + 1;
    }
    const { input, key, recognized } = readKey(sequence);
    if (recognized) this.emit({ kind: 'key', input, key });
    return index + 1;
  }

  /** A byte that cannot go on: the escape and its introducer are a key, the rest is text. */
  private breakSequence(index: number): number {
    const held = this.sequence;
    this.toGround();
    this.emitKey(held.slice(0, 2));
    this.carry = held.slice(2);
    return index;
  }

  private readPaste(chunk: string, from: number): number {
    const text = this.pasteTail + chunk.slice(from);
    this.pasteTail = '';
    const end = text.indexOf(PASTE_END);
    if (end === -1) {
      const held = heldMarker(text);
      this.keepPasted(text.slice(0, text.length - held));
      this.pasteTail = text.slice(text.length - held);
      return chunk.length;
    }
    this.keepPasted(text.slice(0, end));
    const pasted = this.pasteParts.join('');
    this.endPaste();
    this.state = 'ground';
    this.emit({ kind: 'paste', text: pasted });
    return chunk.length - (text.length - end - PASTE_END.length);
  }

  private keepPasted(part: string): void {
    if (this.pasteOverflowed || part === '') return;
    const bytes = Buffer.from(part);
    const room = MAX_PASTE_BYTES - this.pasteBytes;
    if (bytes.length <= room) {
      this.pasteParts.push(part);
      this.pasteBytes += bytes.length;
      return;
    }
    // The decoder gives back whole characters only.
    this.pasteParts.push(this.pasteDecoder.write(bytes.subarray(0, room)));
    this.pasteOverflowed = true;
    this.warn(
      `angular-ink: a paste of more than ${String(MAX_PASTE_BYTES)} bytes was cut, and the rest dropped.\n`,
    );
  }

  private endPaste(): void {
    this.pasteParts = [];
    this.pasteBytes = 0;
    this.pasteTail = '';
    this.pasteOverflowed = false;
    this.pasteDecoder = new StringDecoder('utf8');
    if (this.state === 'paste') this.state = 'ground';
  }
}

/** How many characters at the end of `text` could be the start of the paste end marker. */
function heldMarker(text: string): number {
  for (let length = Math.min(PASTE_END.length - 1, text.length); length > 0; length -= 1) {
    if (text.endsWith(PASTE_END.slice(0, length))) return length;
  }
  return 0;
}
