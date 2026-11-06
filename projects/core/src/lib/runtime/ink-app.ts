import {
  ApplicationRef,
  isDevMode,
  signal,
  type EnvironmentProviders,
  type Provider,
  type Type,
} from '@angular/core';
import type { Yoga } from 'yoga-layout/load';
import { detectColorLevel, type ColorLevel } from '../engine/color-level';
import type { CellGrid } from '../engine/grid';
import { findStaticNodes, layoutTree } from '../engine/layout';
import { paintStatic, paintTree } from '../engine/paint';
import { InputBus, type KeyHandler, type PasteHandler } from '../input/input-bus';
import { KeyParser } from '../input/key-parser';
import { RawMode } from '../input/raw-mode';
import { mountTree, type MountedTree } from '../platform/mount';
import { patchConsole } from './console-patch';
import { paintErrorOverview } from './error-overview';
import { installExitHooks } from './exit-hooks';
import { FrameScheduler } from './frame-scheduler';
import { InkRuntime, type WindowSize } from './inject';
import { FrameLog, frameText, staticText, takeStaticOutput } from './log';
import { createStreamPort, type StreamPort } from './terminal-port';

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const BRACKETED_PASTE_ON = '\x1b[?2004h';
const BRACKETED_PASTE_OFF = '\x1b[?2004l';
const ERASE_LINE_END = '\x1b[K';

export interface InkAppOptions {
  readonly stdout: NodeJS.WritableStream;
  readonly stdin: NodeJS.ReadableStream;
  readonly stderr: NodeJS.WritableStream;
  readonly interactive: boolean;
  readonly exitOnCtrlC: boolean;
  readonly patchConsole: boolean;
  readonly maxFps: number;
  readonly yoga: Yoga;
  readonly providers: readonly (Provider | EnvironmentProviders)[];
  readonly frameSink?: (grid: CellGrid) => void;
  /** Takes `ink-static` output instead of the terminal, in the two forms a sink may want. */
  readonly staticSink?: (output: { readonly plain: string; readonly ansi: string }) => void;
  /** Called once, when the app has ended and its stdout is free for another. */
  readonly onExit: () => void;
}

type Phase = 'running' | 'unmounting' | 'unmounted';

const isError = (value: unknown): value is Error =>
  value instanceof Error || Object.prototype.toString.call(value) === '[object Error]';

const toError = (value: unknown): Error => (isError(value) ? value : new Error(String(value)));

/**
 * One running app, from the first frame to the restored terminal. Flow of a frame: a commit from
 * the renderer, the scheduler, layout and paint, then the frame sink or the log and the port.
 */
export class InkApp implements InkRuntime {
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
  readonly stdin: NodeJS.ReadableStream;
  readonly windowSize;

  private readonly size = signal<WindowSize>({ columns: 0, rows: 0 });
  private readonly port: StreamPort;
  private readonly errorPort: StreamPort;
  private readonly level: ColorLevel;
  /** Whether frames reach the terminal as cursor moves. If not, only the last one is printed. */
  private readonly drawsInPlace: boolean;
  private readonly usesCursor: boolean;
  private readonly log: FrameLog;
  private readonly scheduler: FrameScheduler;
  private readonly exitPromise: Promise<unknown>;
  private readonly parser: KeyParser;
  private readonly inputBus: InputBus;
  private readonly rawMode: RawMode;

  private resolveExit!: (result: unknown) => void;
  private rejectExit!: (error: Error) => void;
  private phase: Phase = 'running';
  private tree: MountedTree | null = null;
  private component: Type<unknown> | null = null;
  /** The newest grid of a run that prints only its last frame. */
  private lastGrid: CellGrid | null = null;
  private portClosed = false;
  private commitQueued = false;
  private writing = false;
  private frameWaitsForWrite = false;
  private lastWrite: Promise<void> = Promise.resolve();
  private exitRequested = false;
  private result: unknown;
  /** The error `exit(error)` was given: it rejects, and the frame stays. */
  private exitError: Error | null = null;
  /** The error that was thrown: it rejects, and the overview replaces the frame. */
  private crash: Error | null = null;
  private restored = false;
  private warnedAboutReuse = false;
  private warnedAboutStatics = false;
  private readonly warnedAboutInput = new Set<string>();
  private warnedAboutPaste = false;
  /** How many paste handlers keep bracketed paste on. */
  private pasteListeners = 0;
  private bracketedPasteOn = false;
  private restoreConsole: (() => void) | null = null;
  private stopResizing: (() => void) | null = null;
  private removeExitHooks: (() => void) | null = null;
  private beforeExit: (() => void) | null = null;

  constructor(private readonly options: InkAppOptions) {
    this.stdout = options.stdout;
    this.stderr = options.stderr;
    this.stdin = options.stdin;
    this.windowSize = this.size.asReadonly();
    this.port = createStreamPort(options.stdout, () => {
      this.portClosed = true;
      queueMicrotask(() => {
        this.unmount();
      });
    });
    this.errorPort = createStreamPort(options.stderr, () => undefined);
    this.level = detectColorLevel(process.env, this.port.isTty);
    this.size.set({ columns: this.port.columns, rows: this.port.rows });
    this.drawsInPlace = options.interactive && options.frameSink === undefined;
    this.usesCursor = this.drawsInPlace && this.port.isTty;
    this.log = new FrameLog({
      level: this.level,
      synchronized: this.usesCursor,
      // A pipe has no screen to fill, whatever size it claims.
      terminalRows: () => (this.port.isTty ? this.port.rows : Number.POSITIVE_INFINITY),
    });
    this.scheduler = new FrameScheduler(() => {
      this.drawFrame();
    }, options.maxFps);
    this.inputBus = new InputBus({
      exitOnCtrlC: options.exitOnCtrlC,
      onExitKey: () => {
        this.exit();
      },
      settle: () => this.tree?.whenStable() ?? Promise.resolve(),
      onError: (error) => {
        this.fail(error);
      },
    });
    this.parser = new KeyParser(
      (event) => {
        this.inputBus.push(event);
      },
      (flush, ms) => {
        const timer = setTimeout(flush, ms);
        return () => {
          clearTimeout(timer);
        };
      },
      (message) => {
        this.warnAboutPaste(message);
      },
    );
    this.rawMode = new RawMode(
      options.stdin,
      (chunk) => {
        this.parser.feed(chunk);
      },
      () => {
        this.parser.reset();
      },
    );
    this.exitPromise = new Promise((resolve, reject) => {
      this.resolveExit = resolve;
      this.rejectExit = reject;
    });
    // An app that fails with nobody waiting must not become an unhandled rejection.
    this.exitPromise.catch(() => undefined);

    this.removeExitHooks = installExitHooks(() => {
      this.restore();
    });
    if (options.patchConsole) {
      this.restoreConsole = patchConsole((stream, data) => {
        if (stream === 'stdout') this.writeStdout(data);
        else this.writeStderr(data);
      });
    }
    if (options.interactive) {
      this.stopResizing = this.port.onResize(() => {
        this.resized();
      });
    }
    if (this.usesCursor) this.send(HIDE_CURSOR + this.freshLine());
  }

  /** Shows `component` with `inputs`. The same component only takes the new inputs. */
  render(component: Type<unknown>, inputs: Record<string, unknown>): void {
    if (this.phase !== 'running') return;
    if (this.tree !== null && this.component === component) {
      this.rerender(inputs);
      return;
    }
    try {
      this.tree?.destroy();
      this.tree = null;
      this.component = component;
      this.warnedAboutStatics = false;
      this.warnedAboutInput.clear();
      this.warnedAboutPaste = false;
      this.tree = mountTree(component, {
        inputs,
        providers: [{ provide: InkRuntime, useValue: this }, ...this.options.providers],
        onCommit: () => {
          this.takeStatic();
          this.queueCommit();
        },
        warn: (message) => {
          this.writeStderr(`${message}\n`);
        },
        errorHandler: {
          handleError: (error: unknown) => {
            this.fail(error);
          },
        },
      });
      this.tree.injector.get(ApplicationRef).tick();
    } catch (error) {
      this.crash ??= toError(error);
      this.unmount();
      return;
    }
    this.commit();
  }

  rerender(inputs: Record<string, unknown>): void {
    const { tree } = this;
    if (tree === null || this.phase !== 'running') return;
    for (const [name, value] of Object.entries(inputs)) tree.setInput(name, value);
    // The same inputs bring no commit, but a render after clear() must draw.
    void tree.whenStable().then(() => {
      if (this.drawsInPlace && this.log.height === 0) this.commit();
    });
  }

  exit(errorOrResult?: unknown): void {
    if (this.phase !== 'running' || this.exitRequested) return;
    this.exitRequested = true;
    if (isError(errorOrResult)) this.exitError = errorOrResult;
    else this.result = errorOrResult;
    // A component can call this during change detection, when the tree cannot be destroyed.
    queueMicrotask(() => {
      this.unmount();
    });
  }

  unmount(): void {
    if (this.phase !== 'running') return;
    this.phase = 'unmounting';
    if (this.beforeExit !== null) process.off('beforeExit', this.beforeExit);
    if (!this.portClosed) this.drawFinalFrame();
    this.scheduler.cancel();
    this.phase = 'unmounted';
    this.restoreConsole?.();
    this.stopResizing?.();
    try {
      this.tree?.destroy();
    } catch (error) {
      this.exitError ??= toError(error);
    }
    this.restore();
    this.removeExitHooks?.();
    this.options.onExit();

    const settle = (): void => {
      this.port.dispose();
      this.errorPort.dispose();
      const failure = this.crash ?? this.exitError;
      if (failure === null) this.resolveExit(this.result);
      else this.rejectExit(failure);
    };
    // An empty write is a barrier: its callback fires after all the writes before it.
    void this.port.write('').then(settle);
  }

  waitUntilExit(): Promise<unknown> {
    if (this.phase === 'running' && this.beforeExit === null) {
      // With nothing left to do Node would end the process, and this promise, without a word.
      this.beforeExit = () => {
        this.unmount();
      };
      process.once('beforeExit', this.beforeExit);
    }
    return this.exitPromise;
  }

  async waitUntilRenderFlush(): Promise<void> {
    if (this.phase === 'running') {
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
    }
    if (this.phase === 'running') await this.inputBus.idle();
    if (this.phase !== 'running') {
      await this.exitPromise.catch(() => undefined);
      return;
    }
    this.runChangeDetection();
    if (this.commitQueued) this.commit();
    do {
      this.scheduler.flush();
      await this.lastWrite;
    } while (this.scheduler.pending || this.writing || this.frameWaitsForWrite);
  }

  clear(): void {
    if (!this.drawsInPlace || this.phase !== 'running') return;
    const bytes = this.log.clear();
    if (bytes !== '') this.send(bytes);
  }

  writeStdout(data: string): void {
    if (this.phase === 'unmounted' || data === '') return;
    if (!this.drawsInPlace) {
      this.send(data);
      return;
    }
    this.send(this.log.beginText() + endLine(data) + this.log.endText());
  }

  writeStderr(data: string): void {
    if (this.phase === 'unmounted' || data === '') return;
    if (!this.drawsInPlace) {
      void this.errorPort.write(data);
      return;
    }
    const before = this.log.beginText();
    if (before !== '') this.send(before);
    void this.errorPort.write(endLine(data));
    const after = this.log.endText();
    if (after !== '') this.send(after);
  }

  warnAboutReuse(): void {
    if (this.warnedAboutReuse || !isDevMode()) return;
    this.warnedAboutReuse = true;
    // Straight to the real stderr: a patched console would draw it through this very app.
    process.stderr.write(
      'angular-ink: renderInk() was called again for the same stdout before the previous instance was unmounted. Reusing stdout across renderInk() calls is unsupported; call unmount() first.\n',
    );
  }

  get isRawModeSupported(): boolean {
    return this.rawMode.supported;
  }

  setRawMode(enabled: boolean): void {
    if (this.phase !== 'running') return;
    if (enabled) this.rawMode.acquire();
    else this.rawMode.release();
  }

  listenToKeys(handler: KeyHandler): () => void {
    if (!this.canListen('injectInput')) return noop;
    const stop = this.inputBus.onKey(handler);
    this.rawMode.acquire();
    return () => {
      stop();
      this.rawMode.release();
    };
  }

  listenToPaste(handler: PasteHandler): () => void {
    if (!this.canListen('injectPaste')) return noop;
    const stop = this.inputBus.onPaste(handler);
    this.rawMode.acquire();
    this.pasteListeners += 1;
    this.setBracketedPaste(true);
    return () => {
      stop();
      this.rawMode.release();
      this.pasteListeners -= 1;
      if (this.pasteListeners === 0) this.setBracketedPaste(false);
    };
  }

  private canListen(caller: string): boolean {
    if (this.phase !== 'running') return false;
    if (this.rawMode.supported) return true;
    if (!this.warnedAboutInput.has(caller) && isDevMode()) {
      this.warnedAboutInput.add(caller);
      this.writeStderr(`angular-ink: stdin is not a TTY; ${caller} is inactive\n`);
    }
    return false;
  }

  private setBracketedPaste(on: boolean): void {
    // On the way out, restore() writes what is owed.
    if (this.phase !== 'running' || !this.port.isTty || on === this.bracketedPasteOn) return;
    this.bracketedPasteOn = on;
    this.send(on ? BRACKETED_PASTE_ON : BRACKETED_PASTE_OFF);
  }

  private warnAboutPaste(message: string): void {
    if (this.warnedAboutPaste || !isDevMode()) return;
    this.warnedAboutPaste = true;
    this.writeStderr(message);
  }

  private fail(error: unknown): void {
    this.crash ??= toError(error);
    if (this.phase !== 'running') return;
    queueMicrotask(() => {
      this.unmount();
    });
  }

  private runChangeDetection(): void {
    try {
      this.tree?.injector.get(ApplicationRef).tick();
    } catch (error) {
      this.fail(error);
    }
  }

  // Runs inside the commit: the tick goes on to remove these nodes, before any scheduled frame.
  private takeStatic(): void {
    const { tree } = this;
    if (tree === null || this.phase === 'unmounted' || this.crash !== null || this.portClosed) {
      return;
    }
    const statics = findStaticNodes(tree.root);
    if (statics.length > 1) this.warnAboutStatics();
    if (statics[0]?.children.every((child) => child.kind === 'comment') ?? true) return;
    try {
      const layout = layoutTree(tree.root, this.port.columns, this.options.yoga);
      if (this.options.frameSink === undefined) {
        const output = takeStaticOutput(layout, this.level);
        if (output !== null) this.writeStdout(output);
        return;
      }
      const grid = paintStatic(layout);
      if (grid === null) return;
      this.options.staticSink?.({ plain: staticText(grid, 0), ansi: staticText(grid, 3) });
    } catch (error) {
      this.fail(error);
    }
  }

  private warnAboutStatics(): void {
    if (this.warnedAboutStatics || !isDevMode()) return;
    this.warnedAboutStatics = true;
    this.writeStderr(
      'angular-ink: a tree renders only its first <ink-static>; the others are ignored.\n',
    );
  }

  // The renderer calls end() in the middle of change detection, even one that failed. Waiting for
  // the microtask makes every pass of a tick one frame, and shows no half-updated tree.
  private queueCommit(): void {
    if (this.commitQueued) return;
    this.commitQueued = true;
    queueMicrotask(() => {
      if (this.commitQueued) this.commit();
    });
  }

  private commit(): void {
    this.commitQueued = false;
    if (this.phase === 'running') this.scheduler.request();
  }

  private drawFrame(): void {
    if (this.phase !== 'running' || this.crash !== null || this.portClosed) return;
    if (this.writing) {
      // Layout waits too: when the write ends, the frame shows the newest state, once.
      this.frameWaitsForWrite = true;
      return;
    }
    const grid = this.paint();
    if (grid !== null) this.show(grid);
  }

  private paint(): CellGrid | null {
    const { tree } = this;
    if (tree === null) return null;
    try {
      return paintTree(layoutTree(tree.root, this.port.columns, this.options.yoga));
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  private show(grid: CellGrid): void {
    if (this.options.frameSink !== undefined) {
      this.options.frameSink(grid);
    } else if (this.drawsInPlace) {
      const bytes = this.log.frame(grid);
      if (bytes !== '') this.send(bytes);
    } else {
      this.lastGrid = grid;
    }
  }

  private send(bytes: string): void {
    const write = this.port.write(bytes);
    this.writing = true;
    this.lastWrite = write;
    void write.then(() => {
      if (this.lastWrite !== write) return;
      this.writing = false;
      if (!this.frameWaitsForWrite) return;
      this.frameWaitsForWrite = false;
      this.commit();
    });
  }

  private drawFinalFrame(): void {
    this.commitQueued = false;
    if (this.crash === null) this.runChangeDetection();
    let grid = this.crash === null ? this.paint() : null;
    if (this.crash !== null) grid = this.paintOverview(this.crash);
    if (grid === null) return;
    if (this.drawsInPlace && this.log.isClearedFrame(grid)) return;
    this.show(grid);
  }

  private paintOverview(error: Error): CellGrid | null {
    try {
      return paintErrorOverview(error, this.port.columns, this.options.yoga);
    } catch {
      // The rejection still carries the error.
      return null;
    }
  }

  private resized(): void {
    const columns = this.port.columns;
    const rows = this.port.rows;
    const old = this.size();
    if (columns === old.columns && rows === old.rows) return;
    const cut = rows < old.rows && this.log.height >= rows;
    if (this.drawsInPlace && (columns < old.columns || cut)) this.log.invalidate(columns);
    this.size.set({ columns, rows });
    this.drawFrame();
  }

  /**
   * The one way back to a normal terminal, for an unmount and for a dying process alike, which is
   * why it is synchronous. Without a screen to restore, what is owed is the last frame.
   */
  private restore(): void {
    if (this.restored) return;
    this.restored = true;
    this.restoreConsole?.();
    this.inputBus.stop();
    this.rawMode.restore();
    const bytes = this.restoreBytes();
    if (bytes !== '' && !this.portClosed) this.port.writeNow(bytes);
  }

  private restoreBytes(): string {
    if (this.usesCursor) return SHOW_CURSOR + BRACKETED_PASTE_OFF;
    const pasteOff = this.bracketedPasteOn ? BRACKETED_PASTE_OFF : '';
    if (this.drawsInPlace || this.options.frameSink !== undefined) return pasteOff;
    const text = this.lastGrid === null ? '' : frameText(this.lastGrid, this.level);
    return `${pasteOff}${text}\n`;
  }

  // The first frame must start at column 0, and only the terminal knows where the cursor is. From
  // column 0 a full row of blanks ends waiting to wrap, on the same line. From any other column it
  // wraps to a new line, which keeps the partial line. The erase then takes the blanks back, as a
  // reflow would count them.
  private freshLine(): string {
    return `${' '.repeat(this.port.columns)}\r${ERASE_LINE_END}`;
  }
}

const noop = (): void => undefined;

/** The frame is drawn from column 0, so text with no line end needs one. */
function endLine(data: string): string {
  return data.endsWith('\n') ? data : `${data}\n`;
}
