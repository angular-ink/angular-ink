import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { KEY_BYTES, type KeyName } from './keys';

/** A writable that keeps what it was given, chunk by chunk. */
class RecordingStream extends Writable {
  readonly writes: string[] = [];

  constructor() {
    super({ decodeStrings: false });
  }

  override _write(chunk: string | Buffer, _encoding: string, done: () => void): void {
    this.writes.push(chunk.toString());
    done();
  }
}

/** Stdout of a virtual terminal. Frames are not bytes here: the instance keeps them. */
export class FakeStdout extends RecordingStream {
  columns: number;
  rows: number;
  readonly isTTY: boolean;

  constructor(columns: number, rows: number, isTTY: boolean) {
    super();
    this.columns = columns;
    this.rows = rows;
    this.isTTY = isTTY;
  }
}

export class FakeStderr extends RecordingStream {}

export interface FakeStdinOptions {
  /** Defaults to true. */
  isTTY?: boolean;
  /** Awaited after each write; the test instance passes "the app is stable". */
  settle?: () => Promise<void>;
}

/** Stdin of a virtual terminal. A write emits `readable` and `data`, like a real TTY does. */
export class FakeStdin extends EventEmitter {
  readonly isTTY: boolean;
  isRaw = false;
  private readonly settle: () => Promise<void>;
  private pending: string | null = null;

  constructor(options: FakeStdinOptions = {}) {
    super();
    this.isTTY = options.isTTY ?? true;
    this.settle = options.settle ?? (() => Promise.resolve());
  }

  /** Sends raw bytes and resolves once the app is stable again. */
  async write(data: string): Promise<void> {
    this.pending = data;
    this.emit('readable');
    this.emit('data', data);
    await this.settle();
  }

  /** Sends keys one after the other, waiting for the app after each. */
  async press(...keys: readonly KeyName[]): Promise<void> {
    for (const key of keys) await this.write(KEY_BYTES[key]);
  }

  read(): string | null {
    const data = this.pending;
    this.pending = null;
    return data;
  }

  setRawMode(enabled: boolean): void {
    this.isRaw = enabled;
  }

  setEncoding(): void {
    // Nothing to do on a virtual stream.
  }
  resume(): void {
    // Nothing to do on a virtual stream.
  }
  pause(): void {
    // Nothing to do on a virtual stream.
  }
  ref(): void {
    // Nothing to do on a virtual stream.
  }
  unref(): void {
    // Nothing to do on a virtual stream.
  }
}
