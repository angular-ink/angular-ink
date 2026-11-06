import type { InputEvent, Key } from './key';
import { readKey } from './key';

export type KeyHandler = (input: string, key: Key) => void;
export type PasteHandler = (text: string) => void;

export interface InputBusOptions {
  readonly exitOnCtrlC: boolean;
  /** Ctrl+C with `exitOnCtrlC`, which no handler sees. */
  onExitKey(): void;
  /** Awaited after each event, so the next one finds the state this one left. */
  settle(): Promise<void>;
  onError(error: unknown): void;
}

/**
 * Hands each event to the handlers, in the order they registered and one event at a time. Events
 * that arrive while the app settles wait in a queue.
 */
export class InputBus {
  private readonly keyHandlers: KeyHandler[] = [];
  private readonly pasteHandlers: PasteHandler[] = [];
  private queue: InputEvent[] = [];
  private next = 0;
  private draining: Promise<void> | null = null;
  private stopped = false;
  private wake: (() => void) | null = null;

  constructor(private readonly options: InputBusOptions) {}

  onKey(handler: KeyHandler): () => void {
    return register(this.keyHandlers, handler);
  }

  onPaste(handler: PasteHandler): () => void {
    return register(this.pasteHandlers, handler);
  }

  push(event: InputEvent): void {
    if (this.stopped) return;
    // Ahead of the queue: a task that never ends must not take Ctrl+C away from the user.
    if (event.kind === 'key' && this.exitsOn(event.input, event.key)) {
      this.exit();
      return;
    }
    this.queue.push(event);
    this.draining ??= this.drain();
  }

  /** Resolves when every event so far was handled and the app settled after it. */
  idle(): Promise<void> {
    return this.draining ?? Promise.resolve();
  }

  /** No more events are handled, and what is queued is dropped. */
  stop(): void {
    this.stopped = true;
    this.queue = [];
    this.next = 0;
    this.wake?.();
  }

  private exitsOn(input: string, key: Key): boolean {
    return this.options.exitOnCtrlC && key.ctrl && input === 'c';
  }

  private exit(): void {
    this.stop();
    this.options.onExitKey();
  }

  private async drain(): Promise<void> {
    // So that `draining` is set before any handler runs, should one write to stdin.
    await Promise.resolve();
    for (let event = this.take(); event !== undefined; event = this.take()) {
      this.deliver(event);
      if (this.stopped) break;
      await this.settle();
    }
    this.draining = null;
  }

  private take(): InputEvent | undefined {
    const event = this.queue[this.next];
    this.next += 1;
    if (this.next >= this.queue.length) {
      this.queue = [];
      this.next = 0;
    }
    return event;
  }

  private settle(): Promise<void> {
    // Not a Promise.race with one long-lived promise, which would keep every call alive. A tree
    // destroyed while it settles never reports stable: stop() wakes this up.
    return new Promise((resolve) => {
      this.wake = resolve;
      void this.options.settle().then(resolve, resolve);
    });
  }

  private deliver(event: InputEvent): void {
    try {
      if (event.kind === 'paste' && this.pasteHandlers.length > 0) {
        for (const handler of [...this.pasteHandlers]) handler(event.text);
        return;
      }
      // With nobody listening for pastes, Ink hands the text to the keys.
      const { input, key } = event.kind === 'key' ? event : readKey(event.text);
      if (this.exitsOn(input, key)) {
        this.exit();
        return;
      }
      for (const handler of [...this.keyHandlers]) handler(input, key);
    } catch (error) {
      this.stop();
      this.options.onError(error);
    }
  }
}

function register<T>(handlers: T[], handler: T): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.indexOf(handler);
    if (index !== -1) handlers.splice(index, 1);
  };
}
