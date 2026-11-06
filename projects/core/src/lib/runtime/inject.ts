import { inject, type Signal } from '@angular/core';

/** The running app, as its components see it. Internal: the public face is the `inject*` below. */
export abstract class InkRuntime {
  abstract readonly stdout: NodeJS.WritableStream;
  abstract readonly stderr: NodeJS.WritableStream;
  abstract readonly windowSize: Signal<WindowSize>;
  abstract exit(errorOrResult?: unknown): void;
  abstract waitUntilRenderFlush(): Promise<void>;
  abstract writeStdout(data: string): void;
  abstract writeStderr(data: string): void;
}

export interface WindowSize {
  readonly columns: number;
  readonly rows: number;
}

export interface AppProps {
  /** Ends the app. `waitUntilExit` rejects with an `Error` and resolves with anything else. */
  exit(errorOrResult?: unknown): void;
  /** Resolves after the pending frame reached the stream. */
  waitUntilRenderFlush(): Promise<void>;
}

export interface StdoutProps {
  readonly stdout: NodeJS.WritableStream;
  /** Writes above the frame and keeps the frame. */
  write(data: string): void;
}

export interface StderrProps {
  readonly stderr: NodeJS.WritableStream;
  /** Writes to stderr and keeps the frame. */
  write(data: string): void;
}

function runtime(caller: string): InkRuntime {
  const found = inject(InkRuntime, { optional: true });
  if (found === null) {
    throw new Error(`angular-ink: ${caller}() must be called inside an app started by renderInk()`);
  }
  return found;
}

export function injectApp(): AppProps {
  const app = runtime('injectApp');
  return {
    exit: (errorOrResult) => {
      app.exit(errorOrResult);
    },
    waitUntilRenderFlush: () => app.waitUntilRenderFlush(),
  };
}

export function injectStdout(): StdoutProps {
  const app = runtime('injectStdout');
  return {
    stdout: app.stdout,
    write: (data) => {
      app.writeStdout(data);
    },
  };
}

export function injectStderr(): StderrProps {
  const app = runtime('injectStderr');
  return {
    stderr: app.stderr,
    write: (data) => {
      app.writeStderr(data);
    },
  };
}

export function injectWindowSize(): Signal<WindowSize> {
  return runtime('injectWindowSize').windowSize;
}
