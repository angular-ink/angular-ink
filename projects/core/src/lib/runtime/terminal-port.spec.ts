import { EventEmitter } from 'node:events';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamPort } from './terminal-port';

const fs = vi.hoisted(() => ({ writeSync: null as null | ((...args: unknown[]) => number) }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeSync: (...args: Parameters<typeof actual.writeSync>) =>
      fs.writeSync === null ? actual.writeSync(...args) : fs.writeSync(...args),
  };
});

type Done = (error?: Error | null) => void;

/** A stream whose writes finish only when the test says so. */
class HeldStream extends Writable {
  readonly chunks: string[] = [];
  readonly held: Done[] = [];

  constructor(highWaterMark = 1024) {
    super({ decodeStrings: false, highWaterMark });
  }

  override _write(chunk: string, _encoding: string, done: Done): void {
    this.chunks.push(chunk);
    this.held.push(done);
  }

  release(error?: Error): void {
    this.held.shift()?.(error);
  }
}

const settled = (promise: Promise<void>): (() => boolean) => {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  return () => done;
};

const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

describe('createStreamPort', () => {
  it('reads the size of the stream, or 80x24 without one', () => {
    const sized = Object.assign(new HeldStream(), { columns: 100, rows: 30, isTTY: true });
    const port = createStreamPort(sized, vi.fn());
    expect([port.columns, port.rows, port.isTty]).toEqual([100, 30, true]);
    port.dispose();

    const bare = createStreamPort(new HeldStream(), vi.fn());
    expect([bare.columns, bare.rows, bare.isTty]).toEqual([80, 24, false]);
    bare.dispose();

    const zero = createStreamPort(
      Object.assign(new HeldStream(), { columns: 0, rows: 0 }),
      vi.fn(),
    );
    expect([zero.columns, zero.rows]).toEqual([80, 24]);
    zero.dispose();
  });

  it('treats a stream with no writable property as open', async () => {
    const written: string[] = [];
    const stream = Object.assign(new EventEmitter(), {
      write(chunk: string, done: () => void) {
        written.push(chunk);
        done();
        return true;
      },
    }) as unknown as NodeJS.WritableStream;
    const onClosed = vi.fn();
    const port = createStreamPort(stream, onClosed);
    await port.write('x');
    expect(written).toEqual(['x']);
    expect(onClosed).not.toHaveBeenCalled();
    port.dispose();
  });

  it('calls resize listeners until they are removed', () => {
    const stream = new HeldStream();
    const port = createStreamPort(stream, vi.fn());
    const listener = vi.fn();
    const off = port.onResize(listener);
    stream.emit('resize');
    off();
    stream.emit('resize');
    expect(listener).toHaveBeenCalledTimes(1);
    port.dispose();
  });

  it('writes at once when idle and resolves only after the stream took the bytes', async () => {
    const stream = new HeldStream();
    const port = createStreamPort(stream, vi.fn());
    const done = settled(port.write('a'));
    expect(stream.chunks).toEqual(['a']);
    await tick();
    expect(done()).toBe(false);
    stream.release();
    await tick();
    expect(done()).toBe(true);
    port.dispose();
  });

  it('keeps writes in order and waits for drain before the next one', async () => {
    const stream = new HeldStream(1);
    const port = createStreamPort(stream, vi.fn());
    const first = settled(port.write('first'));
    const second = settled(port.write('second'));
    expect(stream.chunks).toEqual(['first']);
    // The write returned false, so only drain lets the next one go.
    stream.release();
    await tick();
    expect(first()).toBe(true);
    expect(stream.chunks).toEqual(['first', 'second']);
    expect(second()).toBe(false);
    stream.release();
    await tick();
    expect(second()).toBe(true);
    port.dispose();
  });

  it('holds the next write when the callback fired but drain has not', async () => {
    const stream = new Writable({
      write: (_chunk, _encoding, done) => {
        done();
      },
    });
    const writes: string[] = [];
    stream.write = ((chunk: string, done: () => void) => {
      writes.push(chunk);
      done();
      return false;
    }) as typeof stream.write;
    const port = createStreamPort(stream, vi.fn());
    const first = settled(port.write('first'));
    void port.write('second');
    await tick();
    expect(first()).toBe(false);
    expect(writes).toEqual(['first']);
    stream.emit('drain');
    await tick();
    expect(first()).toBe(true);
    expect(writes).toEqual(['first', 'second']);
    port.dispose();
  });

  it('reports an error once, does not throw, and resolves what was waiting', async () => {
    const stream = new HeldStream();
    const onClosed = vi.fn();
    const port = createStreamPort(stream, onClosed);
    const first = settled(port.write('first'));
    const second = settled(port.write('second'));
    stream.release(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    await tick();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(first()).toBe(true);
    expect(second()).toBe(true);
    await port.write('later');
    expect(stream.chunks).toEqual(['first']);
    port.dispose();
  });

  it('treats a write that throws as a closed stream', async () => {
    const stream = new HeldStream();
    stream.write = (() => {
      throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    }) as typeof stream.write;
    const onClosed = vi.fn();
    const port = createStreamPort(stream, onClosed);
    await port.write('x');
    expect(onClosed).toHaveBeenCalledTimes(1);
    port.dispose();
  });

  it('treats a close with no error as a closed stream', async () => {
    const stream = new HeldStream();
    const onClosed = vi.fn();
    const port = createStreamPort(stream, onClosed);
    stream.destroy();
    await tick();
    expect(onClosed).toHaveBeenCalledTimes(1);
    port.dispose();
  });

  it('does not write to a stream that is already closed', async () => {
    const stream = new HeldStream();
    stream.destroy();
    const onClosed = vi.fn();
    const port = createStreamPort(stream, onClosed);
    await port.write('x');
    expect(stream.chunks).toEqual([]);
    expect(onClosed).toHaveBeenCalledTimes(1);
    port.dispose();
  });

  it('stays silent about a late error from a write still going when it was disposed', async () => {
    const stream = new HeldStream();
    const port = createStreamPort(stream, vi.fn());
    void port.write('x');
    port.dispose();
    expect(stream.listenerCount('error')).toBeGreaterThan(0);
    // With no listener left this would throw out of the event loop.
    stream.release(new Error('write EPIPE'));
    await tick();
    expect(stream.destroyed).toBe(true);
  });

  it('removes its listeners on dispose once idle', async () => {
    const stream = new HeldStream();
    const before = stream.listenerCount('error');
    const port = createStreamPort(stream, vi.fn());
    void port.write('x');
    port.dispose();
    stream.release();
    await tick();
    expect(stream.listenerCount('error')).toBe(before);
  });

  describe('writeNow', () => {
    it('writes what is queued and then its data to the file descriptor at once', () => {
      const dir = mkdtempSync(join(tmpdir(), 'ink-port-'));
      const path = join(dir, 'out');
      const fd = openSync(path, 'w');
      try {
        const stream = Object.assign(new HeldStream(1), { fd });
        const port = createStreamPort(stream, vi.fn());
        void port.write('first');
        const queued = settled(port.write('queued '));
        port.writeNow('now');
        expect(readFileSync(path, 'utf8')).toBe('queued now');
        expect(stream.chunks).toEqual(['first']);
        expect(queued()).toBe(false);
        port.dispose();
      } finally {
        closeSync(fd);
        rmSync(dir, { recursive: true });
      }
    });

    it('goes through the stream in order when there is no file descriptor', async () => {
      const stream = new HeldStream();
      const port = createStreamPort(stream, vi.fn());
      void port.write('first');
      port.writeNow('now');
      stream.release();
      await tick();
      expect(stream.chunks).toEqual(['first', 'now']);
      port.dispose();
    });

    it('treats a bad descriptor as a closed stream and does not throw', () => {
      // A descriptor that was closed here can be open again by now, as the process reuses numbers.
      const neverOpen = 2 ** 31 - 1;
      const onClosed = vi.fn();
      const port = createStreamPort(Object.assign(new HeldStream(), { fd: neverOpen }), onClosed);
      expect(() => {
        port.writeNow('x');
      }).not.toThrow();
      expect(onClosed).toHaveBeenCalledTimes(1);
      port.dispose();
    });

    describe('on a full pipe', () => {
      afterEach(() => {
        fs.writeSync = null;
      });

      it('sends the rest as bytes, even when the pipe filled inside a character', async () => {
        const chunks: Buffer[] = [];
        const stream = Object.assign(
          new Writable({
            write(chunk: Buffer, _encoding, done) {
              chunks.push(chunk);
              done();
            },
          }),
          { fd: 99 },
        );
        const taken: number[] = [];
        // Takes the first byte of "é", then the pipe is full.
        fs.writeSync = (_fd, bytes, offset) => {
          if (taken.length > 0) {
            throw Object.assign(new Error('full'), { code: 'EAGAIN' });
          }
          taken.push((bytes as Buffer)[offset as number]!);
          return 1;
        };
        const port = createStreamPort(stream, vi.fn());
        port.writeNow('é!');
        await tick();
        expect(Buffer.concat([Buffer.from(taken), ...chunks]).toString()).toBe('é!');
        port.dispose();
      });
    });

    it('writes nothing after the stream closed', () => {
      const stream = new HeldStream();
      const port = createStreamPort(stream, vi.fn());
      stream.destroy();
      port.writeNow('x');
      expect(stream.chunks).toEqual([]);
      port.dispose();
    });
  });
});
