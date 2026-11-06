import type { InkNode } from '../tree/node';
import { readKey, type InputEvent, type Key } from './key';

export type KeyHandler = (input: string, key: Key) => void;
export type PasteHandler = (text: string) => void;

export interface InputBusOptions {
  readonly exitOnCtrlC: boolean;
  /** Ctrl+C with `exitOnCtrlC`, which no handler sees. */
  onExitKey(): void;
  /** Called after each event that reached a handler, so the next one finds the state it left. */
  afterEvent(): void;
  onError(error: unknown): void;
  /** The tree the hosts of the handlers are in. */
  root(): InkNode | null;
}

interface Listener<H> {
  readonly handler: H;
  readonly host: object | null;
}

/**
 * Hands each event to the handlers, there and then, in the order Ink has: that of its effects.
 * Handlers that come in the same change detection go children first and then in tree order, and
 * after those already listening.
 */
export class InputBus {
  private readonly keys = new Listeners<KeyHandler>();
  private readonly pastes = new Listeners<PasteHandler>();
  private sealQueued = false;
  private stopped = false;

  constructor(private readonly options: InputBusOptions) {}

  onKey(handler: KeyHandler, host: object | null): () => void {
    return this.listen(this.keys, handler, host);
  }

  onPaste(handler: PasteHandler, host: object | null): () => void {
    return this.listen(this.pastes, handler, host);
  }

  push(event: InputEvent): void {
    if (this.stopped) return;
    this.seal();
    try {
      if (!this.deliver(event)) return;
    } catch (error) {
      this.stop();
      this.options.onError(error);
      return;
    }
    this.options.afterEvent();
  }

  /** No more events are handled. */
  stop(): void {
    this.stopped = true;
  }

  private listen<H>(listeners: Listeners<H>, handler: H, host: object | null): () => void {
    if (!this.sealQueued) {
      this.sealQueued = true;
      // A change detection is synchronous, so its handlers are all in by the microtask.
      queueMicrotask(() => {
        this.seal();
      });
    }
    return listeners.add({ handler, host });
  }

  private seal(): void {
    this.sealQueued = false;
    const positions =
      this.keys.pendingCount + this.pastes.pendingCount > 1 ? this.positions() : null;
    this.keys.seal(positions);
    this.pastes.seal(positions);
  }

  private positions(): ReadonlyMap<object, number> {
    const root = this.options.root();
    return root === null ? new Map<object, number>() : postOrder(root);
  }

  /** Whether any handler was called. */
  private deliver(event: InputEvent): boolean {
    if (event.kind === 'paste' && this.pastes.count > 0) {
      for (const handler of this.pastes.handlers()) handler(event.text);
      return true;
    }
    // With nobody listening for pastes, Ink hands the text to the keys.
    const { input, key } = event.kind === 'key' ? event : readKey(event.text);
    if (this.options.exitOnCtrlC && key.ctrl && input === 'c') {
      this.stop();
      this.options.onExitKey();
      return false;
    }
    if (this.keys.count === 0) return false;
    for (const handler of this.keys.handlers()) handler(input, key);
    return true;
  }
}

class Listeners<H> {
  private readonly sealed: Listener<H>[] = [];
  private pending: Listener<H>[] = [];

  get count(): number {
    return this.sealed.length + this.pending.length;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  add(listener: Listener<H>): () => void {
    this.pending.push(listener);
    return () => {
      for (const list of [this.sealed, this.pending]) {
        const index = list.indexOf(listener);
        if (index !== -1) list.splice(index, 1);
      }
    };
  }

  /** Moves those that just came to the end of the line, in the order of `positions`. */
  seal(positions: ReadonlyMap<object, number> | null): void {
    if (this.pending.length === 0) return;
    const place = ({ host }: Listener<H>): number =>
      (host === null ? undefined : positions?.get(host)) ?? Number.MAX_SAFE_INTEGER;
    this.sealed.push(...this.pending.sort((a, b) => place(a) - place(b)));
    this.pending = [];
  }

  handlers(): H[] {
    return this.sealed.map(({ handler }) => handler);
  }
}

/** Each node's position in a walk that visits children first. Iterative: no limit on the depth. */
function postOrder(root: InkNode): ReadonlyMap<object, number> {
  const positions = new Map<object, number>();
  const stack: { node: InkNode; next: number }[] = [{ node: root, next: 0 }];
  for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
    const child = top.node.children[top.next];
    if (child === undefined) {
      positions.set(top.node, positions.size);
      stack.pop();
    } else {
      top.next += 1;
      stack.push({ node: child, next: 0 });
    }
  }
  return positions;
}
