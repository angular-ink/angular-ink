type RawStream = NodeJS.ReadableStream & {
  readonly isTTY?: boolean;
  readonly destroyed?: boolean;
  readonly readableEnded?: boolean;
  setRawMode?(enabled: boolean): unknown;
  setEncoding(encoding: BufferEncoding): unknown;
  ref?(): unknown;
  unref?(): unknown;
};

const ignore = (): void => undefined;

/**
 * Who owns stdin. Raw mode and the listener are on while anyone asked for them, by count, and with
 * no owner the stream is unref'd, so it cannot hold the process open. A stream is read one way,
 * through `readable` and `read()`, so that no chunk is seen twice.
 */
export class RawMode {
  private readonly stdin: RawStream;
  private readonly onChunk: (chunk: string) => void;
  private readonly onReleased: () => void;
  private count = 0;
  /** Raw mode is on with no owner, until the end of the microtask. */
  private turningOff = false;
  private listening = false;

  private readonly read = (): void => {
    const next = (): string | Buffer | null => this.stdin.read();
    for (let chunk = next(); chunk !== null; chunk = next()) this.onChunk(chunk.toString());
  };

  constructor(
    stdin: NodeJS.ReadableStream,
    onChunk: (chunk: string) => void,
    onReleased: () => void,
  ) {
    this.stdin = stdin;
    this.onChunk = onChunk;
    this.onReleased = onReleased;
  }

  get supported(): boolean {
    const { stdin } = this;
    return (
      stdin.isTTY === true &&
      typeof stdin.setRawMode === 'function' &&
      stdin.destroyed !== true &&
      stdin.readableEnded !== true
    );
  }

  /** Only for a stream that is `supported`. */
  acquire(): void {
    if (this.count === 0) {
      if (this.turningOff) this.turningOff = false;
      else this.turnOn();
      this.listen();
    }
    this.count += 1;
  }

  release(): void {
    if (this.count === 0) return;
    this.count -= 1;
    if (this.count > 0) return;
    this.unlisten();
    this.onReleased();
    // A component that takes over in the same change detection keeps the mode, with no flicker.
    this.turningOff = true;
    queueMicrotask(() => {
      if (this.turningOff) this.turnOff();
    });
  }

  /** The synchronous way out, for an unmount and for a dying process alike. */
  restore(): void {
    this.count = 0;
    this.unlisten();
    this.onReleased();
    this.turnOff();
  }

  private turnOn(): void {
    try {
      this.stdin.setEncoding('utf8');
      this.stdin.ref?.();
      this.stdin.setRawMode?.(true);
    } catch {
      // A terminal that went away has no mode to set.
    }
  }

  private turnOff(): void {
    this.turningOff = false;
    if (this.stdin.isTTY !== true) return;
    try {
      this.stdin.setRawMode?.(false);
      this.stdin.unref?.();
    } catch {
      // A terminal that went away has no mode to restore.
    }
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    this.stdin.on('readable', this.read);
    this.stdin.on('error', ignore);
  }

  private unlisten(): void {
    if (!this.listening) return;
    this.listening = false;
    this.stdin.off('readable', this.read);
    this.stdin.off('error', ignore);
  }
}
