import { Component, input, signal, type WritableSignal } from '@angular/core';
import { cleanup, renderForTest, type InkTestInstance } from '@angular-ink/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InkBox, InkText } from '../elements';
import { renderInkToString } from '../runtime/render-to-string';
import { InkFocus } from './focus.directive';
import { injectFocus } from './inject-focus';
import { injectFocusManager, type FocusManagerProps } from './focus-manager';

type Focus = ReturnType<typeof injectFocus>;

/** Reset before each test; the components below read them as they are created. */
let manager: FocusManagerProps;
let names: WritableSignal<string[]>;
let flags: Record<string, WritableSignal<boolean>>;
let autoFocused: Set<string>;
let idQueue: string[];
let foci: Focus[];
let changes: boolean[];

@Component({
  selector: 'ink-test-row',
  imports: [InkText],
  template: `<ink-text>{{ name() }}{{ focus.isFocused() ? '*' : '-' }}</ink-text>`,
})
class Row {
  readonly name = input.required<string>();
  private readonly id = idQueue.shift() ?? 'extra';
  readonly focus = injectFocus({
    id: this.id,
    isActive: flags[this.id] ?? true,
    autoFocus: autoFocused.has(this.id),
  });

  constructor() {
    foci.push(this.focus);
  }
}

@Component({
  selector: 'ink-test-rows',
  imports: [InkBox, Row],
  template: `<ink-box flexDirection="column">
    @for (name of names(); track name) {
      <ink-test-row [name]="name" />
    }
  </ink-box>`,
})
class Rows {
  readonly names = names;

  constructor() {
    manager = injectFocusManager();
  }
}

@Component({
  selector: 'ink-test-directive',
  imports: [InkBox, InkText, InkFocus],
  template: `<ink-box inkFocus (inkFocusChange)="changes.push($event)"
    ><ink-text>box</ink-text></ink-box
  >`,
})
class WithDirective {
  readonly changes = changes;
}

@Component({
  selector: 'ink-test-lone',
  imports: [InkText],
  template: `<ink-text>{{ focus.isFocused() ? '*' : '-' }}</ink-text>`,
})
class Lone {
  readonly focus = injectFocus({ autoFocus: true });
}

/** A lone Escape is flushed by the parser after 20 ms. */
async function sendEscape(test: InkTestInstance, bytes = '\x1b'): Promise<void> {
  await test.stdin.write(bytes);
  await new Promise((resolve) => setTimeout(resolve, 40));
  await test.rerender({});
}

beforeEach(() => {
  flags = { a: signal(true), b: signal(true), c: signal(true) };
  autoFocused = new Set();
  idQueue = ['a', 'b', 'c'];
  names = signal(['a', 'b', 'c']);
  foci = [];
  changes = [];
});

afterEach(() => {
  cleanup();
});

describe('injectFocus', () => {
  it('registers a component that Tab then reaches (INK-FOCUS-01)', async () => {
    const test = await renderForTest(Rows);
    expect(test.lastFrame()).toBe('a-\nb-\nc-');
    await test.stdin.press('tab');
    expect(test.lastFrame()).toBe('a*\nb-\nc-');
  });

  it('keeps the place of an inactive component in the order (INK-FOCUS-01)', async () => {
    flags['b']?.set(false);
    const test = await renderForTest(Rows);
    await test.stdin.press('tab', 'tab');
    expect(test.lastFrame()).toBe('a-\nb-\nc*');
    flags['b']?.set(true);
    await test.rerender({});
    await test.stdin.press('shift+tab');
    expect(test.lastFrame()).toBe('a-\nb*\nc-');
  });

  it('focuses the first autoFocus component when nothing is focused (INK-FOCUS-01)', async () => {
    autoFocused = new Set(['b', 'c']);
    const test = await renderForTest(Rows);
    expect(test.lastFrame()).toBe('a-\nb*\nc-');
  });

  it('gives a generated id when none is passed (INK-FOCUS-01)', async () => {
    const test = await renderForTest(Lone);
    expect(test.lastFrame()).toBe('*');
  });

  it('returns focus(id) next to isFocused (INK-FOCUS-02)', async () => {
    const test = await renderForTest(Rows);
    foci[0]?.focus('c');
    await test.stdin.press('shift+tab');
    expect(test.lastFrame()).toBe('a-\nb*\nc-');
  });

  it('keeps raw mode on while a component is active (INK-FOCUS-03)', async () => {
    flags['a']?.set(false);
    flags['b']?.set(false);
    flags['c']?.set(false);
    const test = await renderForTest(Rows);
    expect(test.stdin.isRaw).toBe(false);
    flags['b']?.set(true);
    await test.stdin.press('tab');
    expect(test.stdin.isRaw).toBe(true);
    flags['b']?.set(false);
    await test.stdin.press('tab');
    await Promise.resolve();
    expect(test.stdin.isRaw).toBe(false);
  });

  it('orders by registration, not by the order in the list (INK-FOCUS-04)', async () => {
    const test = await renderForTest(Rows);
    names.set(['c', 'b', 'a']);
    await test.rerender({});
    expect(test.lastFrame()).toBe('c-\nb-\na-');
    await test.stdin.press('tab');
    expect(test.lastFrame()).toBe('c-\nb-\na*');
    await test.stdin.press('tab');
    expect(test.lastFrame()).toBe('c-\nb*\na-');
  });

  it('goes round on Tab and Shift+Tab, skipping the inactive (INK-FOCUS-05, 09, 10)', async () => {
    flags['b']?.set(false);
    const test = await renderForTest(Rows);
    await test.stdin.press('tab');
    expect(test.lastFrame()).toBe('a*\nb-\nc-');
    await test.stdin.press('tab');
    expect(test.lastFrame()).toBe('a-\nb-\nc*');
    await test.stdin.press('tab');
    expect(test.lastFrame()).toBe('a*\nb-\nc-');
    await test.stdin.press('shift+tab');
    expect(test.lastFrame()).toBe('a-\nb-\nc*');
  });

  it('starts Shift+Tab from the last (INK-FOCUS-10)', async () => {
    const test = await renderForTest(Rows);
    await test.stdin.press('shift+tab');
    expect(test.lastFrame()).toBe('a-\nb-\nc*');
  });

  it('ignores Tab with Ctrl or Meta (INK-FOCUS-05)', async () => {
    const test = await renderForTest(Rows);
    await test.stdin.write('\x1b[9;5u');
    await test.stdin.write('\x1b\t');
    expect(test.lastFrame()).toBe('a-\nb-\nc-');
    await test.stdin.press('tab');
    expect(test.lastFrame()).toBe('a*\nb-\nc-');
  });

  it('takes the focus away on Escape (INK-FOCUS-06)', async () => {
    const test = await renderForTest(Rows);
    await test.stdin.press('tab');
    await sendEscape(test);
    expect(test.lastFrame()).toBe('a-\nb-\nc-');
    expect(manager.activeId()).toBeUndefined();
  });

  it('does not take the focus away on Escape with a modifier (INK-FOCUS-06)', async () => {
    const test = await renderForTest(Rows);
    await test.stdin.press('tab');
    await sendEscape(test, '\x1b\x1b');
    expect(test.lastFrame()).toBe('a*\nb-\nc-');
  });

  it('drops the focus on disableFocus and stops reacting to Tab (INK-FOCUS-07, 08)', async () => {
    const test = await renderForTest(Rows);
    await test.stdin.press('tab');
    manager.disableFocus();
    await test.stdin.press('tab');
    expect(test.lastFrame()).toBe('a-\nb-\nc-');
    await sendEscape(test);
    manager.enableFocus();
    await test.stdin.press('tab');
    expect(test.lastFrame()).toBe('a*\nb-\nc-');
  });

  it('does not autoFocus while focus is disabled (INK-FOCUS-07)', async () => {
    autoFocused = new Set(['a']);
    const test = await renderForTest(Rows);
    expect(test.lastFrame()).toBe('a*\nb-\nc-');
    manager.disableFocus();
    await test.stdin.press('tab');
    expect(manager.activeId()).toBeUndefined();
  });

  it('moves with focusNext and focusPrevious, from nothing too (INK-FOCUS-09, 10)', async () => {
    const test = await renderForTest(Rows);
    manager.focusNext();
    await sendEscape(test);
    manager.focusPrevious();
    expect(manager.activeId()).toBe('c');
    manager.focusPrevious();
    expect(manager.activeId()).toBe('b');
    manager.focusNext();
    manager.focusNext();
    expect(manager.activeId()).toBe('a');
    expect(test.lastFrame()).toBe('a-\nb-\nc-');
  });

  it('focuses by id only when it exists and is active (INK-FOCUS-11)', async () => {
    flags['c']?.set(false);
    const test = await renderForTest(Rows);
    manager.focus('b');
    expect(manager.activeId()).toBe('b');
    manager.focus('nope');
    manager.focus('c');
    expect(manager.activeId()).toBe('b');
    await test.stdin.press('tab');
    expect(manager.activeId()).toBe('a');
  });

  it('follows the focus in activeId (INK-FOCUS-12)', async () => {
    const test = await renderForTest(Rows);
    expect(manager.activeId()).toBeUndefined();
    await test.stdin.press('tab', 'tab');
    expect(manager.activeId()).toBe('b');
  });

  it('clears activeId when the focused one is deactivated (INK-FOCUS-13)', async () => {
    const test = await renderForTest(Rows);
    await test.stdin.press('tab');
    expect(manager.activeId()).toBe('a');
    flags['a']?.set(false);
    await test.rerender({});
    expect(manager.activeId()).toBeUndefined();
    expect(test.lastFrame()).toBe('a-\nb-\nc-');
  });

  it('clears activeId when the focused one is removed (INK-FOCUS-13)', async () => {
    const test = await renderForTest(Rows);
    manager.focus('b');
    names.set(['a', 'c']);
    await test.rerender({});
    expect(manager.activeId()).toBeUndefined();
    expect(test.lastFrame()).toBe('a-\nc-');
  });

  it('does nothing in renderInkToString', async () => {
    await expect(renderInkToString(Lone)).resolves.toBe('-');
  });
});

describe('InkFocus', () => {
  it('emits inkFocusChange when the element gains and loses the focus', async () => {
    const test = await renderForTest(WithDirective);
    expect(changes).toEqual([]);
    await test.stdin.press('tab');
    await sendEscape(test);
    expect(changes).toEqual([true, false]);
  });
});
