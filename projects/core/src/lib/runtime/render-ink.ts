import type { EnvironmentProviders, Provider, Type } from '@angular/core';
import { Stream } from 'node:stream';
import { loadYoga, type Yoga } from 'yoga-layout/load';
import type { CellGrid } from '../engine/grid';
import { InkApp } from './ink-app';

export type ɵFrameSink = (grid: CellGrid) => void;
export type ɵStaticSink = (output: { readonly plain: string; readonly ansi: string }) => void;

export interface RenderOptions {
  stdout?: NodeJS.WritableStream;
  stdin?: NodeJS.ReadableStream;
  stderr?: NodeJS.WritableStream;
  /** Exit on Ctrl+C when input is active. Defaults to true. */
  exitOnCtrlC?: boolean;
  /** Keep `console.*` output above the frame. Defaults to true. */
  patchConsole?: boolean;
  /** At most this many frames per second. Defaults to 30. */
  maxFps?: number;
  /** Defaults to true on a TTY outside CI. Otherwise only the last frame prints, on unmount. */
  interactive?: boolean;
  /** Values for the inputs of the root component. */
  inputs?: Record<string, unknown>;
  providers?: readonly (Provider | EnvironmentProviders)[];
  /** Takes each frame instead of the terminal. Private to `@angular-ink/testing`. */
  ɵframeSink?: ɵFrameSink;
  /** Takes `ink-static` output while `ɵframeSink` takes the frames. */
  ɵstaticSink?: ɵStaticSink;
}

export interface Instance {
  /** Sets the given inputs of the root component. Inputs left out keep their values. */
  rerender(inputs: Record<string, unknown>): void;
  unmount(): void;
  /** Resolves with the value of `exit(value)`, and rejects with an error the app ended on. */
  waitUntilExit(): Promise<unknown>;
  /** Resolves after the pending frame reached the stream. */
  waitUntilRenderFlush(): Promise<void>;
  /** Unmounts and forgets the instance of this stdout. */
  cleanup(): void;
  /** Erases the output and keeps the history. The next render draws in full. */
  clear(): void;
}

let yogaLoad: Promise<Yoga> | null = null;
const loadYogaOnce = (): Promise<Yoga> => (yogaLoad ??= loadYoga());

const instances = new WeakMap<object, InkApp>();

/** Same rule as is-in-ci, which Ink uses: `CI=false` and `CI=0` turn the detection off. */
function isInCi(env: NodeJS.ProcessEnv): boolean {
  if (env['CI'] === '0' || env['CI'] === 'false') return false;
  return (
    'CI' in env ||
    'CONTINUOUS_INTEGRATION' in env ||
    Object.keys(env).some((key) => key.startsWith('CI_'))
  );
}

/**
 * Mounts `component` and draws it on the terminal. Resolves after the first frame. A second call
 * for the same stdout, before an unmount, reuses the running app and only swaps what it shows.
 */
export async function renderInk<T>(
  component: Type<T>,
  options?: RenderOptions | NodeJS.WritableStream,
): Promise<Instance> {
  const settings: RenderOptions =
    options instanceof Stream
      ? { stdout: options as NodeJS.WritableStream }
      : ((options ?? {}) as RenderOptions);
  const stdout = settings.stdout ?? process.stdout;
  const yoga = await loadYogaOnce();

  let app = instances.get(stdout);
  if (app === undefined) {
    app = new InkApp({
      stdout,
      stdin: settings.stdin ?? process.stdin,
      stderr: settings.stderr ?? process.stderr,
      interactive:
        settings.interactive ??
        (!isInCi(process.env) && (stdout as Partial<NodeJS.WriteStream>).isTTY === true),
      exitOnCtrlC: settings.exitOnCtrlC ?? true,
      patchConsole: settings.patchConsole ?? true,
      maxFps: settings.maxFps ?? 30,
      yoga,
      providers: settings.providers ?? [],
      ...(settings.ɵframeSink === undefined ? {} : { frameSink: settings.ɵframeSink }),
      ...(settings.ɵstaticSink === undefined ? {} : { staticSink: settings.ɵstaticSink }),
      onExit: () => {
        instances.delete(stdout);
      },
    });
    instances.set(stdout, app);
  } else {
    app.warnAboutReuse();
  }
  app.render(component, settings.inputs ?? {});

  const running = app;
  return {
    rerender: (inputs) => {
      running.rerender(inputs);
    },
    unmount: () => {
      running.unmount();
    },
    waitUntilExit: () => running.waitUntilExit(),
    waitUntilRenderFlush: () => running.waitUntilRenderFlush(),
    cleanup: () => {
      running.unmount();
    },
    clear: () => {
      running.clear();
    },
  };
}
