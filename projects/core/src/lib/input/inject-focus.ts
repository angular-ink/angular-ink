import { computed, effect, inject, isSignal, untracked, type Signal } from '@angular/core';
import { FocusManager } from './focus-manager';

export interface FocusOptions {
  /** Whether Tab can reach this component. Defaults to true. An inactive one keeps its place. */
  isActive?: Signal<boolean> | boolean;
  /** Takes the focus on start when nothing else has it. */
  autoFocus?: boolean;
  /** Must be unique. Defaults to a generated one. */
  id?: string;
}

export interface FocusProps {
  readonly isFocused: Signal<boolean>;
  focus(id: string): void;
}

/** Makes the component focusable, in the order components call this in. */
export function injectFocus(options: FocusOptions = {}): FocusProps {
  const manager = inject(FocusManager);
  const id = options.id ?? manager.generateId();
  const autoFocus = options.autoFocus ?? false;
  const { isActive = true } = options;

  effect((onCleanup) => {
    untracked(() => {
      manager.register(id, autoFocus);
    });
    onCleanup(() => {
      manager.unregister(id);
    });
  });
  effect(() => {
    const on = isSignal(isActive) ? isActive() : isActive;
    untracked(() => {
      manager.setActive(id, on);
    });
  });

  return {
    isFocused: computed(() => manager.activeId() === id),
    focus: (target) => {
      manager.focus(target);
    },
  };
}
