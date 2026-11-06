import { computed, Injectable, inject, signal, type OnDestroy, type Signal } from '@angular/core';
import { InkRuntime } from '../runtime/inject';
import type { Key } from './key';

interface Focusable {
  readonly id: string;
  readonly isActive: boolean;
}

export interface FocusManagerProps {
  enableFocus(): void;
  /** Also takes the focus away from whoever has it. */
  disableFocus(): void;
  focusNext(): void;
  focusPrevious(): void;
  /** Does nothing unless a focusable with this id exists and is active. */
  focus(id: string): void;
  readonly activeId: Signal<string | undefined>;
}

/**
 * Who has the focus, for one app. Focusables keep the order they registered in, and Tab, Shift+Tab
 * and Escape are read through one key listener that is on only while someone is active, so raw
 * mode follows the active focusables too. Where the runtime is inert, nothing is tracked.
 */
@Injectable({ providedIn: 'root' })
export class FocusManager implements FocusManagerProps, OnDestroy {
  private readonly runtime = inject(InkRuntime, { optional: true });
  private readonly current = signal<string | undefined>(undefined);
  private focusables: readonly Focusable[] = [];
  private enabled = true;
  private nextGeneratedId = 0;
  private stopListening: (() => void) | null = null;

  readonly activeId = this.current.asReadonly();

  /** An id for a focusable that was not given one. */
  generateId(): string {
    this.nextGeneratedId += 1;
    return `ink-focus-${String(this.nextGeneratedId)}`;
  }

  readonly isFocused = (id: string): Signal<boolean> => computed(() => this.current() === id);

  register(id: string, autoFocus: boolean): void {
    if (this.runtime?.inert !== false) return;
    this.focusables = [...this.focusables, { id, isActive: true }];
    if (autoFocus && this.enabled && this.current() === undefined) this.current.set(id);
    this.syncListener();
  }

  unregister(id: string): void {
    if (this.current() === id) this.current.set(undefined);
    this.focusables = this.focusables.filter((focusable) => focusable.id !== id);
    this.syncListener();
  }

  setActive(id: string, isActive: boolean): void {
    if (!isActive && this.current() === id) this.current.set(undefined);
    this.focusables = this.focusables.map((focusable) =>
      focusable.id === id ? { id, isActive } : focusable,
    );
    this.syncListener();
  }

  enableFocus(): void {
    this.enabled = true;
  }

  disableFocus(): void {
    this.enabled = false;
    this.current.set(undefined);
  }

  focusNext(): void {
    const active = this.activeFocusables();
    const at = active.findIndex(({ id }) => id === this.current());
    this.current.set((active[at + 1] ?? active[0])?.id);
  }

  focusPrevious(): void {
    const active = this.activeFocusables();
    const at = active.findIndex(({ id }) => id === this.current());
    this.current.set((at === -1 ? active.at(-1) : (active[at - 1] ?? active.at(-1)))?.id);
  }

  focus(id: string): void {
    if (this.focusables.some((focusable) => focusable.id === id && focusable.isActive)) {
      this.current.set(id);
    }
  }

  ngOnDestroy(): void {
    this.stopListening?.();
    this.stopListening = null;
  }

  /** The active ones, one slot per id: a repeated id keeps its first place. */
  private activeFocusables(): readonly Focusable[] {
    const seen = new Set<string>();
    return this.focusables.filter(({ id, isActive }) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return isActive;
    });
  }

  private syncListener(): void {
    const wanted = this.focusables.some(({ isActive }) => isActive);
    if (wanted && this.stopListening === null) {
      // Without a TTY there is no key to read, and no raw mode to ask for.
      if (this.runtime?.isRawModeSupported === true) {
        this.stopListening = this.runtime.listenToKeys((_input, key) => {
          this.onKey(key);
        }, null);
      }
    } else if (!wanted && this.stopListening !== null) {
      this.stopListening();
      this.stopListening = null;
    }
  }

  private onKey(key: Key): void {
    if (!this.enabled) return;
    if (key.escape && !key.ctrl && !key.meta && !key.shift) {
      this.current.set(undefined);
    } else if (key.tab && !key.ctrl && !key.meta) {
      if (key.shift) this.focusPrevious();
      else this.focusNext();
    }
  }
}

/** Moves the focus by hand, and tells who has it. */
export function injectFocusManager(): FocusManagerProps {
  const manager = inject(FocusManager);
  return {
    enableFocus: () => {
      manager.enableFocus();
    },
    disableFocus: () => {
      manager.disableFocus();
    },
    focusNext: () => {
      manager.focusNext();
    },
    focusPrevious: () => {
      manager.focusPrevious();
    },
    focus: (id) => {
      manager.focus(id);
    },
    activeId: manager.activeId,
  };
}
