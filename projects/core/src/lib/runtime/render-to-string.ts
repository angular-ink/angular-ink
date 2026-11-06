import type { EnvironmentProviders, Provider, Type } from '@angular/core';
import { ApplicationRef, inject, provideEnvironmentInitializer, signal } from '@angular/core';
import { Readable, Writable } from 'node:stream';
import { gridToString, type CellGrid } from '../engine/grid';
import { InkRuntime } from './inject';
import { renderInk } from './render-ink';

const DEFAULT_COLUMNS = 80;
const ROWS = 24;

export interface RenderToStringOptions {
  /** Width of the virtual terminal. Defaults to 80. */
  columns?: number;
  /** Values for the inputs of the root component. */
  inputs?: Record<string, unknown>;
  providers?: readonly (Provider | EnvironmentProviders)[];
}

/** A virtual stream that throws every byte away. */
class DiscardingStream extends Writable {
  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    super({ decodeStrings: false });
  }

  override _write(_chunk: unknown, _encoding: string, done: () => void): void {
    done();
  }
}

/**
 * Renders `component` once, at the size of a virtual terminal, and returns the first stable frame
 * as plain text, after any `ink-static` output. Nothing reaches the real streams and no listener
 * outlives the call. The terminal functions of the app do nothing here, and an error from the
 * render rejects after the cleanup.
 */
export async function renderInkToString<T>(
  component: Type<T>,
  options: RenderToStringOptions = {},
): Promise<string> {
  const columns = options.columns ?? DEFAULT_COLUMNS;
  const stdout = new DiscardingStream(columns, ROWS);
  const stderr = new DiscardingStream(columns, ROWS);
  const stdin = new Readable({ read: () => undefined });
  const inertRuntime: InkRuntime = {
    stdout,
    stderr,
    windowSize: signal({ columns, rows: ROWS }).asReadonly(),
    exit: () => undefined,
    waitUntilRenderFlush: () => Promise.resolve(),
    writeStdout: () => undefined,
    writeStderr: () => undefined,
    stdin,
    isRawModeSupported: false,
    inert: true,
    setRawMode: () => undefined,
    listenToKeys: () => () => undefined,
    listenToPaste: () => () => undefined,
  };

  const shown: { frame: CellGrid | null; permanent: string } = { frame: null, permanent: '' };
  let stable = false;
  let appRef: ApplicationRef | null = null;
  const instance = await renderInk(component, {
    stdout,
    stderr,
    stdin,
    interactive: false,
    patchConsole: false,
    inputs: options.inputs ?? {},
    // Last, so it wins over the runtime the app provides for itself.
    providers: [
      ...(options.providers ?? []),
      { provide: InkRuntime, useValue: inertRuntime },
      provideEnvironmentInitializer(() => {
        appRef = inject(ApplicationRef);
      }),
    ],
    ɵframeSink: (grid) => {
      if (!stable) shown.frame = grid;
    },
    ɵstaticSink: ({ plain }) => {
      if (!stable) shown.permanent += plain;
    },
  });
  try {
    // A flush does not wait for pending tasks, and a tree that crashed never reports stable.
    await Promise.race([
      (appRef as ApplicationRef | null)?.whenStable(),
      instance.waitUntilExit().catch(() => undefined),
    ]);
    await instance.waitUntilRenderFlush();
    stable = true;
  } finally {
    instance.unmount();
  }
  // Rejects with the error the render ended on, after everything is released.
  await instance.waitUntilExit();
  // The line end after permanent output only separates it from a frame.
  if (shown.frame === null || shown.frame.rows === 0) return shown.permanent.replace(/\n$/, '');
  return shown.permanent + gridToString(shown.frame, { ansi: false });
}
