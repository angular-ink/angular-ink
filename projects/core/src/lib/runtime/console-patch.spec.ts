import { describe, expect, it, vi } from 'vitest';
import { patchConsole } from './console-patch';

describe('patchConsole', () => {
  it('formats console.log and friends and sends them to stdout', () => {
    const write = vi.fn();
    const restore = patchConsole(write);
    console.log('a %s', 'b');
    console.info('info');
    console.debug('debug');
    restore();
    expect(write.mock.calls).toEqual([
      ['stdout', 'a b\n'],
      ['stdout', 'info\n'],
      ['stdout', 'debug\n'],
    ]);
  });

  it('sends console.error and console.warn to stderr', () => {
    const write = vi.fn();
    const restore = patchConsole(write);
    console.error('oops');
    console.warn('hmm');
    restore();
    expect(write.mock.calls).toEqual([
      ['stderr', 'oops\n'],
      ['stderr', 'hmm\n'],
    ]);
  });

  it('keeps group indentation', () => {
    const write = vi.fn();
    const restore = patchConsole(write);
    console.group('head');
    console.log('inner');
    console.groupEnd();
    restore();
    expect(write.mock.calls.map((call) => call[1] as string)).toEqual(['head\n', '  inner\n']);
  });

  it('restores the original methods', () => {
    const { log, error, table } = console;
    const restore = patchConsole(vi.fn());
    expect(console.log).not.toBe(log);
    expect(console.table).not.toBe(table);
    restore();
    expect(console.log).toBe(log);
    expect(console.error).toBe(error);
    expect(console.table).toBe(table);
  });

  it('restoring twice is harmless', () => {
    const { log } = console;
    const restore = patchConsole(vi.fn());
    restore();
    restore();
    expect(console.log).toBe(log);
  });

  it('lets two patches end in any order and never loses a line', () => {
    const { log } = console;
    const spy = vi.fn();
    console.log = spy;
    const first = vi.fn();
    const second = vi.fn();
    const restoreFirst = patchConsole(first);
    const restoreSecond = patchConsole(second);
    restoreFirst();
    console.log('to second');
    expect(second).toHaveBeenCalledWith('stdout', 'to second\n');
    restoreSecond();
    console.log('to original');
    expect(first).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith('to original');
    console.log = log;
  });
});
