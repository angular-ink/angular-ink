import {
  ApplicationRef,
  DOCUMENT,
  ErrorHandler,
  Injector,
  PLATFORM_ID,
  RendererFactory2,
  createComponent,
  createEnvironmentInjector,
  provideZonelessChangeDetection,
  type EnvironmentInjector,
  type EnvironmentProviders,
  type Provider,
  type Type,
} from '@angular/core';
import type { InkNode } from '../tree/node';
import { InkRendererFactory } from '../tree/renderer-factory';
import { rootScopeToken } from './angular-private';

export interface MountedTree {
  /** The `ink-root` node the component renders into. */
  readonly root: InkNode;
  readonly injector: EnvironmentInjector;
  setInput(name: string, value: unknown): void;
  whenStable(): Promise<void>;
  destroy(): void;
}

export interface MountOptions {
  /** Called after each change detection pass, when the tree may have changed. */
  onCommit(): void;
  /** Receives development warnings. Each mount has its own warn-once state. */
  warn(message: string): void;
  /** Values for the component's inputs, by input name. */
  readonly inputs?: Record<string, unknown>;
  readonly providers?: readonly (Provider | EnvironmentProviders)[];
  readonly errorHandler: ErrorHandler;
}

/**
 * Creates `component` in an injector of its own, with no platform and no DOM: root scope,
 * zoneless change detection, an empty `DOCUMENT` (Angular reads it once to find where styles go,
 * and ink elements have none) and our renderer.
 */
export function mountTree<T>(component: Type<T>, options: MountOptions): MountedTree {
  const factory = new InkRendererFactory(
    () => {
      options.onCommit();
    },
    (message) => {
      options.warn(message);
    },
  );
  // createEnvironmentInjector only reads its parent, which has nothing for a root to find.
  const injector = createEnvironmentInjector(
    [
      { provide: rootScopeToken(), useValue: 'root' },
      provideZonelessChangeDetection(),
      { provide: DOCUMENT, useValue: {} },
      { provide: PLATFORM_ID, useValue: 'terminal' },
      { provide: RendererFactory2, useValue: factory },
      { provide: ErrorHandler, useValue: options.errorHandler },
      ...(options.providers ?? []),
    ],
    Injector.NULL as EnvironmentInjector,
  );
  try {
    const root = factory.createRenderer(null, null).createElement('ink-root') as InkNode;
    const appRef = injector.get(ApplicationRef);
    const ref = createComponent(component, {
      environmentInjector: injector,
      hostElement: root as unknown as Element,
    });
    for (const [name, value] of Object.entries(options.inputs ?? {})) ref.setInput(name, value);
    appRef.attachView(ref.hostView);
    let destroyed = false;
    return {
      root,
      injector,
      setInput: (name, value) => {
        ref.setInput(name, value);
      },
      whenStable: () => appRef.whenStable(),
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        try {
          appRef.detachView(ref.hostView);
          ref.destroy();
        } finally {
          injector.destroy();
        }
      },
    };
  } catch (error) {
    injector.destroy();
    throw error;
  }
}
