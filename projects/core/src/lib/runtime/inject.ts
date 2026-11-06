import { inject, type Signal } from '@angular/core';
import type { KeyHandler, PasteHandler } from '../input/input-bus';

/** The running app, as its components see it. Internal: the public face is the `inject*` below. */
export abstract class InkRuntime {
  abstract readonly stdout: NodeJS.WritableStream;
  abstract readonly stderr: NodeJS.WritableStream;
  abstract readonly windowSize: Signal<WindowSize>;
  abstract exit(errorOrResult?: unknown): void;
  abstract waitUntilRenderFlush(): Promise<void>;
  abstract writeStdout(data: string): void;
  abstract writeStderr(data: string): void;
  abstract readonly stdin: NodeJS.ReadableStream;
  abstract readonly isRawModeSupported: boolean;
  /** True where nothing is live (`renderInkToString`): focus does not track anything there. */
  abstract readonly inert: boolean;
  abstract setRawMode(enabled: boolean): void;
  /** Returns how to stop. `host` is the node of the component, which orders the handlers. */
  abstract listenToKeys(handler: KeyHandler, host: object | null): () => void;
  /** Returns how to stop. `host` is the node of the component, which orders the handlers. */
  abstract listenToPaste(handler: PasteHandler, host: object | null): () => void;
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

export function injectRuntime(caller: string): InkRuntime {
  const found = inject(InkRuntime, { optional: true });
  if (found === null) {
    throw new Error(`angular-ink: ${caller}() must be called inside an app started by renderInk()`);
  }
  return found;
}

export function injectApp(): AppProps {
  const app = injectRuntime('injectApp');
  return {
    exit: (errorOrResult) => {
      app.exit(errorOrResult);
    },
    waitUntilRenderFlush: () => app.waitUntilRenderFlush(),
  };
}

export function injectStdout(): StdoutProps {
  const app = injectRuntime('injectStdout');
  return {
    stdout: app.stdout,
    write: (data) => {
      app.writeStdout(data);
    },
  };
}

export function injectStderr(): StderrProps {
  const app = injectRuntime('injectStderr');
  return {
    stderr: app.stderr,
    write: (data) => {
      app.writeStderr(data);
    },
  };
}

export function injectWindowSize(): Signal<WindowSize> {
  return injectRuntime('injectWindowSize').windowSize;
}
