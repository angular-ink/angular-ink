import {
  Component,
  DestroyRef,
  Injectable,
  InjectionToken,
  PLATFORM_ID,
  computed,
  inject,
  input,
  signal,
  type OnDestroy,
} from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { InkText } from '../elements';
import type { InkNode } from '../tree/node';
import { mountTree, type MountedTree } from './mount';

@Injectable({ providedIn: 'root' })
class Counter {
  readonly n = signal(0);
}

const GREETING = new InjectionToken<string>('GREETING');

@Component({
  selector: 'ink-test-counter',
  imports: [InkText],
  template: `
    @if (even()) {
      <ink-text>even {{ counter.n() }}</ink-text>
    }
    @for (item of items(); track item) {
      <ink-text>item {{ item }}</ink-text>
    }
  `,
})
class CounterApp {
  readonly counter = inject(Counter);
  readonly even = computed(() => this.counter.n() % 2 === 0);
  readonly items = computed(() => Array.from({ length: this.counter.n() % 3 }, (_, i) => i));
}

@Component({
  selector: 'ink-test-greeting',
  imports: [InkText],
  template: `<ink-text>{{ greeting }} {{ name() }}</ink-text>`,
})
class GreetingApp {
  readonly greeting = inject(GREETING);
  readonly name = input.required<string>();
}

/** The visible text of a tree, one entry per text node. */
function textOf(node: InkNode): string[] {
  return node.children.flatMap((child) =>
    child.kind === 'text' ? [child.text] : child.kind === 'element' ? textOf(child) : [],
  );
}

function mount(
  component: Parameters<typeof mountTree>[0],
  options: Partial<Parameters<typeof mountTree>[1]> = {},
) {
  const onCommit = vi.fn();
  const warn = vi.fn();
  const handleError = vi.fn();
  const tree = mountTree(component, {
    onCommit,
    warn,
    errorHandler: { handleError },
    ...options,
  });
  return { tree, onCommit, warn, handleError };
}

describe('mountTree', () => {
  it('renders @if, @for and signals without a DOM', async () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    const { tree } = mount(CounterApp);
    await tree.whenStable();
    expect(textOf(tree.root)).toEqual(['even 0']);
    tree.injector.get(Counter).n.set(1);
    await tree.whenStable();
    expect(textOf(tree.root)).toEqual(['item 0']);
    tree.destroy();
  });

  it('re-renders a signal set from a timer with no tick, and commits', async () => {
    const { tree, onCommit } = mount(CounterApp);
    await tree.whenStable();
    onCommit.mockClear();
    const counter = tree.injector.get(Counter);
    setTimeout(() => {
      counter.n.set(2);
    }, 1);
    await vi.waitFor(() => {
      expect(textOf(tree.root)).toEqual(['even 2', 'item 0', 'item 1']);
    });
    expect(onCommit).toHaveBeenCalled();
    tree.destroy();
  });

  it('gives the app a terminal platform and root-scoped services', () => {
    const { tree } = mount(CounterApp);
    expect(tree.injector.get(PLATFORM_ID)).toBe('terminal');
    expect(tree.injector.get(Counter)).toBeInstanceOf(Counter);
    tree.destroy();
  });

  it('passes providers and inputs to the component, and setInput updates it', async () => {
    const { tree } = mount(GreetingApp, {
      providers: [{ provide: GREETING, useValue: 'hello' }],
      inputs: { name: 'ana' },
    });
    await tree.whenStable();
    expect(textOf(tree.root)).toEqual(['hello ana']);
    tree.setInput('name', 'bia');
    await tree.whenStable();
    expect(textOf(tree.root)).toEqual(['hello bia']);
    tree.destroy();
  });

  it('keeps warn-once state per mount', () => {
    const first = mount(CounterApp);
    const second = mount(CounterApp);
    expect(first.warn).not.toBe(second.warn);
    first.tree.destroy();
    second.tree.destroy();
  });

  it('destroys the injector even when ngOnDestroy throws', async () => {
    const seen: string[] = [];
    @Component({ selector: 'ink-test-fragile', template: '' })
    class Fragile implements OnDestroy {
      ngOnDestroy(): void {
        seen.push('ngOnDestroy');
        throw new Error('boom');
      }
    }
    const { tree } = mount(Fragile);
    await tree.whenStable();
    const injectorDestroyed = vi.fn();
    tree.injector.get(DestroyRef).onDestroy(injectorDestroyed);
    expect(() => {
      tree.destroy();
    }).toThrow('boom');
    expect(seen).toEqual(['ngOnDestroy']);
    expect(injectorDestroyed).toHaveBeenCalledTimes(1);
  });

  it('exposes the MountedTree shape', () => {
    const { tree } = mount(CounterApp);
    const shape: MountedTree = tree;
    expect(shape.root.tag).toBe('ink-root');
    tree.destroy();
  });
});
