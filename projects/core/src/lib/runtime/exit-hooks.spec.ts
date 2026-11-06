import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { installExitHooks, printFatal, type ExitHookTarget } from './exit-hooks';

function fakeProcess() {
  const emitter = new EventEmitter();
  const exit = vi.fn();
  const target: ExitHookTarget = {
    on: (event, listener) => emitter.on(event, listener),
    prependListener: (event, listener) => emitter.prependListener(event, listener),
    listeners: (event) => emitter.listeners(event),
    off: (event, listener) => emitter.off(event, listener),
    exit,
  };
  return { emitter, exit, target };
}

const EVENTS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'uncaughtException', 'unhandledRejection', 'exit'];

describe('installExitHooks', () => {
  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
    ['uncaughtException', 1],
    ['unhandledRejection', 1],
  ])('on %s restores once and exits with %i', (event, code) => {
    const { emitter, exit, target } = fakeProcess();
    const restore = vi.fn();
    installExitHooks(restore, target, vi.fn());
    emitter.emit(event, new Error('boom'));
    // A real process.exit fires 'exit' next.
    emitter.emit('exit', code);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(code);
  });

  describe.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ])('on %s with a listener of the app', (signal, code) => {
    it('restores and leaves the exit to the app', () => {
      const { emitter, exit, target } = fakeProcess();
      const restore = vi.fn();
      emitter.on(signal, vi.fn());
      installExitHooks(restore, target, vi.fn());
      emitter.emit(signal);
      expect(restore).toHaveBeenCalledTimes(1);
      expect(exit).not.toHaveBeenCalled();
    });

    it('sees a listener added after the hooks, and a once listener', () => {
      const { emitter, exit, target } = fakeProcess();
      installExitHooks(vi.fn(), target, vi.fn());
      emitter.once(signal, vi.fn());
      emitter.emit(signal);
      expect(exit).not.toHaveBeenCalled();
    });

    it('steps aside once restored, so that a later signal is not held back', () => {
      const { emitter, target } = fakeProcess();
      const appListener = vi.fn();
      emitter.on(signal, appListener);
      installExitHooks(vi.fn(), target, vi.fn());
      emitter.emit(signal);
      expect(emitter.listeners(signal)).toEqual([appListener]);
    });

    it('sees a once listener added before the hooks, by running first', () => {
      const { emitter, exit, target } = fakeProcess();
      emitter.once(signal, vi.fn());
      installExitHooks(vi.fn(), target, vi.fn());
      emitter.emit(signal);
      expect(exit).not.toHaveBeenCalled();
    });

    it('still exits when the other listeners are the hooks of another app', () => {
      const { emitter, exit, target } = fakeProcess();
      const first = vi.fn();
      const second = vi.fn();
      installExitHooks(first, target, vi.fn());
      installExitHooks(second, target, vi.fn());
      emitter.emit(signal);
      expect(exit).toHaveBeenCalledWith(code);
      emitter.emit('exit', code);
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
    });
  });

  it('always exits on a fatal error, whoever else listens', () => {
    const { emitter, exit, target } = fakeProcess();
    emitter.on('uncaughtException', vi.fn());
    installExitHooks(vi.fn(), target, vi.fn());
    emitter.emit('uncaughtException', new Error('boom'));
    expect(exit).toHaveBeenCalledWith(1);
  });

  describe('in a real process', () => {
    const HOOKS = fileURLToPath(new URL('./exit-hooks.ts', import.meta.url));

    /** Runs `body` after the hooks are in, sends SIGTERM once it says ready, and returns the end. */
    function runAndTerminate(body: string) {
      const script = `
        import { installExitHooks } from ${JSON.stringify(HOOKS)};
        import { writeSync } from 'node:fs';
        installExitHooks(() => writeSync(1, 'restored\\n'));
        ${body}
        writeSync(1, 'ready\\n');
        setInterval(() => undefined, 1000);
      `;
      const child = spawn(
        process.execPath,
        ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', script],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      let stdout = '';
      // A process that ignores the signal must fail the test and not outlive it.
      const stuck = setTimeout(() => child.kill('SIGKILL'), 5000);
      return new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
        stdout: string;
      }>((resolve, reject) => {
        child.on('error', reject);
        child.stdout.on('data', (chunk: Buffer) => {
          const before = stdout;
          stdout += chunk.toString();
          if (!before.includes('ready') && stdout.includes('ready')) child.kill('SIGTERM');
        });
        child.on('close', (code, signal) => {
          clearTimeout(stuck);
          resolve({ code, signal, stdout });
        });
      });
    }

    it('lets the async cleanup of the app finish, with the terminal restored first', async () => {
      const { code, stdout } = await runAndTerminate(`
        process.on('SIGTERM', async () => {
          await new Promise((done) => setTimeout(done, 50));
          writeSync(1, 'cleaned\\n');
          process.exit(7);
        });
      `);
      expect(stdout).toBe('ready\nrestored\ncleaned\n');
      expect(code).toBe(7);
    }, 30_000);

    // The rule of the signal-exit package, which many dependencies bring in: it ends the process
    // only when its own listeners are the last ones.
    it('does not wait forever for a listener that waits for being the last', async () => {
      const { signal, stdout } = await runAndTerminate(`
        const last = () => {
          if (process.listeners('SIGTERM').length === 1) {
            process.off('SIGTERM', last);
            process.kill(process.pid, 'SIGTERM');
          }
        };
        process.on('SIGTERM', last);
      `);
      expect(stdout).toBe('ready\nrestored\n');
      expect(signal).toBe('SIGTERM');
    }, 30_000);

    it('ends with the exit code of the signal when nobody else listens', async () => {
      const { code, stdout } = await runAndTerminate('');
      expect(stdout).toBe('ready\nrestored\n');
      expect(code).toBe(143);
    }, 30_000);
  });

  it('restores on a plain exit without calling exit again', () => {
    const { emitter, exit, target } = fakeProcess();
    const restore = vi.fn();
    installExitHooks(restore, target, vi.fn());
    emitter.emit('exit', 0);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it('restores first and then reports a fatal error, since a listener silences the default', () => {
    const { emitter, target } = fakeProcess();
    const order: string[] = [];
    const boom = new Error('boom');
    installExitHooks(
      () => order.push('restore'),
      target,
      (error) => order.push(`report ${String(error)}`),
    );
    emitter.emit('uncaughtException', boom);
    expect(order).toEqual(['restore', 'report Error: boom']);
  });

  it('reports an unhandled rejection too', () => {
    const { emitter, target } = fakeProcess();
    const report = vi.fn();
    installExitHooks(vi.fn(), target, report);
    emitter.emit('unhandledRejection', 'why');
    expect(report).toHaveBeenCalledWith('why');
  });

  it('does not report a signal', () => {
    const { emitter, target } = fakeProcess();
    const report = vi.fn();
    installExitHooks(vi.fn(), target, report);
    emitter.emit('SIGINT');
    expect(report).not.toHaveBeenCalled();
  });

  it('still exits when restoring throws', () => {
    const { emitter, exit, target } = fakeProcess();
    installExitHooks(
      () => {
        throw new Error('stuck');
      },
      target,
      vi.fn(),
    );
    emitter.emit('SIGTERM');
    expect(exit).toHaveBeenCalledWith(143);
  });

  it('removes every listener when uninstalled', () => {
    const { emitter, exit, target } = fakeProcess();
    const restore = vi.fn();
    const uninstall = installExitHooks(restore, target, vi.fn());
    for (const event of EVENTS) expect(emitter.listenerCount(event)).toBe(1);
    uninstall();
    for (const event of EVENTS) expect(emitter.listenerCount(event)).toBe(0);
    expect(restore).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('printFatal', () => {
  it('prints the stack of an error, or the value of anything else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ink-fatal-'));
    const path = join(dir, 'err');
    const fd = openSync(path, 'w');
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at here';
    printFatal(error, fd);
    printFatal('why', fd);
    closeSync(fd);
    expect(readFileSync(path, 'utf8')).toBe('Error: boom\n    at here\nwhy\n');
    rmSync(dir, { recursive: true });
  });

  it('does not throw when stderr is gone', () => {
    expect(() => {
      printFatal('why', -1);
    }).not.toThrow();
  });
});
