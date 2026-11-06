import { writeSync } from 'node:fs';

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

/** Where frames go: the one thing the runtime knows about the terminal. */
export interface TerminalPort {
  /** Resolves once the stream took the bytes and, if it asked for it, drained. Never rejects. */
  write(data: string): Promise<void>;
  readonly columns: number;
  readonly rows: number;
  readonly isTty: boolean;
  onResize(listener: () => void): () => void;
}

export interface StreamPort extends TerminalPort {
  /** Writes at once, ahead of the exit of the process, along with anything still queued. */
  writeNow(data: string): void;
  /** Lets go of the stream once its last write ended. */
  dispose(): void;
}

interface OutputStream extends Omit<NodeJS.WritableStream, 'writable'> {
  readonly writable?: boolean;
  readonly columns?: number;
  readonly rows?: number;
  readonly isTTY?: boolean;
  readonly fd?: unknown;
  readonly destroyed?: boolean;
  readonly writableEnded?: boolean;
}

interface QueuedWrite {
  readonly data: string;
  readonly resolve: () => void;
}

/**
 * The adapter for a Node stream. One write goes at a time, so a frame respects `drain` and bytes
 * keep their order. Any stream error, `EPIPE` above all, counts as a closed stream: `onClosed` is
 * called once and later writes do nothing.
 */
export function createStreamPort(stream: NodeJS.WritableStream, onClosed: () => void): StreamPort {
  return new StreamAdapter(stream, onClosed);
}

class StreamAdapter implements StreamPort {
  private readonly stream: OutputStream;
  private readonly queue: QueuedWrite[] = [];
  private current: QueuedWrite | null = null;
  private waitingForDrain: (() => void) | null = null;
  private closed = false;
  private disposed = false;

  private readonly handleClosed = (): void => {
    this.close();
  };

  constructor(
    stream: NodeJS.WritableStream,
    private readonly onClosed: () => void,
  ) {
    this.stream = stream;
    stream.on('error', this.handleClosed);
    stream.on('close', this.handleClosed);
  }

  get columns(): number {
    return positive(this.stream.columns, DEFAULT_COLUMNS);
  }

  get rows(): number {
    return positive(this.stream.rows, DEFAULT_ROWS);
  }

  get isTty(): boolean {
    return Boolean(this.stream.isTTY);
  }

  onResize(listener: () => void): () => void {
    this.stream.on('resize', listener);
    return () => {
      this.stream.off('resize', listener);
    };
  }

  write(data: string): Promise<void> {
    if (this.isClosed()) return Promise.resolve();
    return new Promise((resolve) => {
      this.queue.push({ data, resolve });
      if (this.current === null) this.sendNext();
    });
  }

  writeNow(data: string): void {
    if (this.isClosed()) return;
    if (typeof this.stream.fd !== 'number') {
      void this.write(data);
      return;
    }
    const queued = this.queue.splice(0);
    const bytes = Buffer.from(queued.map((item) => item.data).join('') + data);
    let offset = 0;
    try {
      while (offset < bytes.length) offset += writeSync(this.stream.fd, bytes, offset);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EAGAIN') {
        // A full non-blocking pipe: the stream can still take the rest later.
        void this.write(bytes.subarray(offset).toString());
      } else {
        this.close();
      }
    }
    for (const item of queued) item.resolve();
  }

  dispose(): void {
    this.disposed = true;
    this.release();
  }

  private isClosed(): boolean {
    const { destroyed, writableEnded, writable } = this.stream;
    if (!this.closed && (destroyed === true || writableEnded === true || writable === false)) {
      this.close();
    }
    return this.closed;
  }

  private sendNext(): void {
    const item = this.queue.shift() ?? null;
    this.current = item;
    if (item === null) {
      this.release();
      return;
    }
    let flushed = false;
    let drained = false;
    const finish = (): void => {
      if (!flushed || !drained || this.current !== item) return;
      item.resolve();
      this.sendNext();
    };
    try {
      const accepted = this.stream.write(item.data, (error?: Error | null) => {
        if (error) {
          this.close();
          return;
        }
        flushed = true;
        finish();
      });
      if (accepted) {
        drained = true;
        finish();
      } else if (!this.closed) {
        this.waitingForDrain = () => {
          this.waitingForDrain = null;
          drained = true;
          finish();
        };
        this.stream.once('drain', this.waitingForDrain);
      }
    } catch {
      this.close();
    }
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.waitingForDrain !== null) this.stream.off('drain', this.waitingForDrain);
    this.waitingForDrain = null;
    const waiting = this.current === null ? this.queue : [this.current, ...this.queue];
    this.current = null;
    for (const item of [...waiting]) item.resolve();
    this.queue.length = 0;
    this.onClosed();
  }

  // A closed stream keeps the listeners: an error can still come after a write's callback, and
  // with no listener it would crash the app with a stack trace.
  private release(): void {
    if (!this.disposed || this.closed || this.current !== null) return;
    this.stream.off('error', this.handleClosed);
    this.stream.off('close', this.handleClosed);
  }
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && value > 0 ? value : fallback;
}
