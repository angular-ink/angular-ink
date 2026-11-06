import { writeSync } from 'node:fs';

/** What the hooks need of `process`. */
export interface ExitHookTarget {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
  exit(code: number): unknown;
}

const SIGNAL_EXIT_CODES: Readonly<Record<string, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
};

const FATAL_EVENTS = ['uncaughtException', 'unhandledRejection'];

/**
 * Runs `restore` once if the process dies before the app ends. It runs alone in a dying process,
 * so it must be synchronous. A listener on the fatal events silences the report Node would print,
 * so `report` does that. Returns the function that removes the listeners.
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
  for (const [event, code] of Object.entries(SIGNAL_EXIT_CODES)) {
    listeners.set(event, () => {
      restoreOnce();
      target.exit(code);
    });
  }
  for (const event of FATAL_EVENTS) {
    listeners.set(event, (error: unknown) => {
      restoreOnce();
      report(error);
      target.exit(1);
    });
  }

  for (const [event, listener] of listeners) target.on(event, listener);
  return () => {
    for (const [event, listener] of listeners) target.off(event, listener);
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
