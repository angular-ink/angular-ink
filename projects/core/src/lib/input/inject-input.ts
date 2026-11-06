import { effect, isSignal, untracked, type Signal } from '@angular/core';
import { injectRuntime, type InkRuntime } from '../runtime/inject';
import type { KeyHandler, PasteHandler } from './input-bus';

export interface InputOptions {
  /** Whether the handler gets events. Defaults to true. */
  isActive?: Signal<boolean> | boolean;
}

export interface StdinProps {
  readonly stdin: NodeJS.ReadableStream;
  /** Counted. Does nothing where raw mode is not supported. */
  setRawMode(enabled: boolean): void;
  readonly isRawModeSupported: boolean;
}

/** Keeps `listen` running, and undone, for as long as `isActive` holds. */
function whileActive(isActive: InputOptions['isActive'], listen: () => () => void): void {
  effect((onCleanup) => {
    const on = isSignal(isActive) ? isActive() : (isActive ?? true);
    if (on) onCleanup(untracked(listen));
  });
}

/** Calls `handler` for each key press, with raw mode on while it is active. Without a TTY it warns. */
export function injectInput(handler: KeyHandler, options: InputOptions = {}): void {
  const app: InkRuntime = injectRuntime('injectInput');
  whileActive(options.isActive, () => app.listenToKeys(handler));
}

/** Calls `handler` for each paste, whole, with bracketed paste on while it is active. */
export function injectPaste(handler: PasteHandler, options: InputOptions = {}): void {
  const app: InkRuntime = injectRuntime('injectPaste');
  whileActive(options.isActive, () => app.listenToPaste(handler));
}

export function injectStdin(): StdinProps {
  const app = injectRuntime('injectStdin');
  return {
    stdin: app.stdin,
    setRawMode: (enabled) => {
      app.setRawMode(enabled);
    },
    isRawModeSupported: app.isRawModeSupported,
  };
}
