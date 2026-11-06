import { EventEmitter } from 'node:events';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { installExitHooks, printFatal, type ExitHookTarget } from './exit-hooks';

function fakeProcess() {
  const emitter = new EventEmitter();
  const exit = vi.fn();
  const target: ExitHookTarget = {
    on: (event, listener) => emitter.on(event, listener),
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
