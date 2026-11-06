import { Console } from 'node:console';
import { Writable } from 'node:stream';

export type ConsoleStream = 'stdout' | 'stderr';

const METHODS = [
  'assert',
  'count',
  'countReset',
  'debug',
  'dir',
  'dirxml',
  'error',
  'group',
  'groupCollapsed',
  'groupEnd',
  'info',
  'log',
  'table',
  'time',
  'timeEnd',
  'timeLog',
  'trace',
  'warn',
] as const;

type ConsoleMethod = (...args: unknown[]) => void;
type ConsoleTable = Record<(typeof METHODS)[number], ConsoleMethod>;

function sink(write: (data: string) => void): Writable {
  return new Writable({
    decodeStrings: false,
    write(chunk: string, _encoding, done) {
      write(chunk);
      done();
    },
  });
}

/**
 * Sends the global console to `write`, formatted by a real `Console`, and returns the function that
 * puts it back. Another app may have patched on top by then: its methods stay, and ours, which it
 * will put back later, pass calls on to the original from then on.
 */
export function patchConsole(write: (stream: ConsoleStream, data: string) => void): () => void {
  const target = console as unknown as ConsoleTable;
  const formatter = new Console({
    stdout: sink((data) => {
      write('stdout', data);
    }),
    stderr: sink((data) => {
      write('stderr', data);
    }),
  }) as unknown as ConsoleTable;

  let restored = false;
  const originals = new Map<(typeof METHODS)[number], ConsoleMethod>();
  const patched = new Map<(typeof METHODS)[number], ConsoleMethod>();
  for (const method of METHODS) {
    const original = target[method];
    const replacement: ConsoleMethod = (...args) => {
      (restored ? original : formatter[method]).apply(console, args);
    };
    originals.set(method, original);
    patched.set(method, replacement);
    target[method] = replacement;
  }

  return () => {
    if (restored) return;
    restored = true;
    for (const method of METHODS) {
      if (target[method] !== patched.get(method)) continue;
      const original = originals.get(method);
      if (original !== undefined) target[method] = original;
    }
  };
}
