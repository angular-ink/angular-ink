import type { EnvironmentProviders, Provider, Type } from '@angular/core';
import { renderInk, ɵgridToString, type Instance, type ɵCellGrid } from '@angular-ink/core';
import { FakeStderr, FakeStdin, FakeStdout } from './fake-streams';

const DEFAULT_COLUMNS = 100;
const DEFAULT_ROWS = 24;

export interface RenderForTestOptions {
  /** Defaults to 100. */
  columns?: number;
  /** Defaults to 24. */
  rows?: number;
  inputs?: Record<string, unknown>;
  providers?: readonly (Provider | EnvironmentProviders)[];
  /** Whether the fake stdout and stdin claim to be a TTY. Defaults to false. */
  isTty?: boolean;
}

export interface InkTestInstance {
  /** The last frame as text. With `ansi`, colors and styles are kept. */
  lastFrame(options?: { ansi?: boolean }): string | undefined;
  /** One item per frame, without ANSI. */
  readonly frames: readonly string[];
  readonly stdout: FakeStdout;
  readonly stderr: FakeStderr;
  readonly stdin: FakeStdin;
  rerender(inputs: Record<string, unknown>): Promise<void>;
  resize(columns: number, rows: number): Promise<void>;
  unmount(): void;
  cleanup(): void;
  waitUntilExit(): Promise<unknown>;
}

const running = new Set<InkTestInstance>();

/** Renders `component` on virtual streams and resolves after its first frame. */
export async function renderForTest<T>(
  component: Type<T>,
  options: RenderForTestOptions = {},
): Promise<InkTestInstance> {
  const isTty = options.isTty ?? false;
  const stdout = new FakeStdout(
    options.columns ?? DEFAULT_COLUMNS,
    options.rows ?? DEFAULT_ROWS,
    isTty,
  );
  const stderr = new FakeStderr();
  const frames: string[] = [];
  let lastGrid: ɵCellGrid | null = null;
  let app: Instance | null = null;
  const settle = async (): Promise<void> => {
    await app?.waitUntilRenderFlush();
  };
  const stdin = new FakeStdin({ isTTY: isTty, settle });

  app = await renderInk(component, {
    stdout,
    stderr,
    stdin: stdin as unknown as NodeJS.ReadableStream,
    // Ctrl+C is a key press here, never the end of the test.
    exitOnCtrlC: false,
    patchConsole: false,
    // Needed for resize events; frames go to the sink, so no cursor moves are written.
    interactive: true,
    inputs: options.inputs ?? {},
    providers: options.providers ?? [],
    ɵframeSink: (grid) => {
      lastGrid = grid;
      frames.push(ɵgridToString(grid, { ansi: false }));
    },
  });
  const started = app;

  const instance: InkTestInstance = {
    lastFrame: (frameOptions) =>
      lastGrid === null
        ? undefined
        : ɵgridToString(lastGrid, { ansi: frameOptions?.ansi ?? false }),
    frames,
    stdout,
    stderr,
    stdin,
    rerender: async (inputs) => {
      started.rerender(inputs);
      await started.waitUntilRenderFlush();
    },
    resize: async (columns, rows) => {
      stdout.columns = columns;
      stdout.rows = rows;
      stdout.emit('resize');
      await started.waitUntilRenderFlush();
    },
    unmount: () => {
      started.unmount();
    },
    cleanup: () => {
      running.delete(instance);
      started.cleanup();
    },
    waitUntilExit: () => started.waitUntilExit(),
  };
  running.add(instance);
  await started.waitUntilRenderFlush();
  return instance;
}

/** Unmounts every instance `renderForTest` made and forgets them. */
export function cleanup(): void {
  for (const instance of [...running]) instance.cleanup();
}
