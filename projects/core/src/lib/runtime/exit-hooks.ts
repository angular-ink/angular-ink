import { writeSync } from 'node:fs';

/** What the hooks need of `process`. */
export interface ExitHookTarget {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  prependListener(event: string, listener: (...args: unknown[]) => void): unknown;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- as `process` declares it
  listeners(event: string): readonly Function[];
  off(event: string, listener: (...args: unknown[]) => void): unknown;
  exit(code: number): unknown;
}

const SIGNAL_EXIT_CODES: Readonly<Record<string, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
};

const FATAL_EVENTS = ['uncaughtException', 'unhandledRejection'];

// In the global registry, so that two copies of this package still see each other's hooks.
const EXIT_HOOK = Symbol.for('angular-ink.exit-hook');

/**
 * Runs `restore` once if the process dies before the app ends. It runs alone in a dying process,
 * so it must be synchronous. A listener on the fatal events silences the report Node would print,
 * so `report` does that. On a signal, an app with its own listener decides when the process ends,
 * so that its async cleanup can finish. Returns the function that removes the listeners.
 */
export function installExitHooks(
  restore: () => void,
  target: ExitHookTarget = process,
  report: (error: unknown) => void = (error) => {
    printFatal(error);
  },
): () => void {
  let restored = false;
  const restoreOnce = (): void => {
    if (restored) return;
    restored = true;
    try {
      restore();
    } catch {
      // Nothing can be done for the terminal now, and the process must still end.
    }
  };

  const listeners = new Map<string, (...args: unknown[]) => void>([['exit', restoreOnce]]);
  const signalListeners = new Map<string, () => void>();
  for (const [event, code] of Object.entries(SIGNAL_EXIT_CODES)) {
    const listener = Object.assign(
      () => {
        restoreOnce();
        if (target.listeners(event).every((other) => EXIT_HOOK in other)) target.exit(code);
        // Nothing is left to do here, and a listener like signal-exit's ends the process only when
        // it is the last one, so staying would leave both waiting for the other.
        else target.off(event, listener);
      },
      { [EXIT_HOOK]: true },
    );
    signalListeners.set(event, listener);
  }
  for (const event of FATAL_EVENTS) {
    listeners.set(event, (error: unknown) => {
      restoreOnce();
      report(error);
      target.exit(1);
    });
  }

  for (const [event, listener] of listeners) target.on(event, listener);
  // First, because a `once` listener that already ran no longer shows in `listeners()`, and because
  // the app's cleanup can then write to a terminal that is back to normal.
  for (const [event, listener] of signalListeners) target.prependListener(event, listener);
  return () => {
    for (const [event, listener] of [...listeners, ...signalListeners]) target.off(event, listener);
  };
}

/** What Node would have printed for a fatal error. Synchronous, as the process ends right after. */
export function printFatal(error: unknown, fd = 2): void {
  const text = error instanceof Error ? (error.stack ?? String(error)) : String(error);
  try {
    writeSync(fd, `${text}\n`);
  } catch {
    // Stderr is gone as well.
  }
}
