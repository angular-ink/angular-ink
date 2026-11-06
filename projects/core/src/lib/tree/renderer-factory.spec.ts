import { Component, ViewEncapsulation, type RendererType2, type Type } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { InkBox, InkText } from '../elements';
import { mountTree } from '../platform/mount';
import { type InkNode } from './node';
import { InkRendererFactory } from './renderer-factory';

function setup() {
  const onCommit = vi.fn();
  const warn = vi.fn();
  const factory = new InkRendererFactory(onCommit, warn);
  return { factory, onCommit, warn, r: factory.createRenderer(null, null) };
}

describe('InkRendererFactory', () => {
  it('gives an element the tagName Angular 22.0 reads from a host element', () => {
    const { r } = setup();
    const box = r.createElement('ink-box') as InkNode;
    expect((box as unknown as { tagName: string }).tagName).toBe('ink-box');
    expect(Object.keys(box)).not.toContain('tagName');
  });

  it('keeps children in DOM order across append, insertBefore and remove', () => {
    const { r } = setup();
    const p = r.createElement('ink-box') as InkNode;
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((n) => r.createElement(n) as InkNode);
    r.appendChild(p, a);
    r.appendChild(p, c);
    r.insertBefore(p, b, c);
    r.insertBefore(p, d, null);
    expect(p.children).toEqual([a, b, c, d]);
    expect(r.parentNode(b)).toBe(p);
    expect(r.nextSibling(a)).toBe(b);
    expect(r.nextSibling(d)).toBeNull();
    r.removeChild(p, b);
    expect(p.children).toEqual([a, c, d]);
    expect(r.parentNode(b)).toBeNull();
  });

  it('moves a node that is appended again', () => {
    const { r } = setup();
    const p = r.createElement('p') as InkNode;
    const a = r.createElement('a') as InkNode;
    const b = r.createElement('b') as InkNode;
    r.appendChild(p, a);
    r.appendChild(p, b);
    r.appendChild(p, a);
    expect(p.children).toEqual([b, a]);
  });

  it('selectRootElement returns the node it was given', () => {
    const { r } = setup();
    const root = r.createElement('ink-root') as InkNode;
    expect(r.selectRootElement(root)).toBe(root);
  });

  it('calls onCommit once per end()', () => {
    const { factory, onCommit } = setup();
    factory.end();
    expect(onCommit).toHaveBeenCalledTimes(1);
    factory.end();
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('updates text with setValue', () => {
    const { r } = setup();
    const t = r.createText('a') as InkNode;
    r.setValue(t, 'b');
    expect(t.text).toBe('b');
  });

  it('accepts listen for any event and returns an unsubscribe that does nothing', () => {
    const { r } = setup();
    const el = r.createElement('ink-text') as InkNode;
    const handler = vi.fn(() => true);
    const unsubscribe = r.listen(el, 'click', handler);
    expect(() => {
      unsubscribe();
    }).not.toThrow();
    expect(r.listen(el, 'ping', handler)).toBeTypeOf('function');
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(['setStyle', 'addClass', 'setProperty'] as const)(
    '%s changes nothing and warns once',
    (method) => {
      const { r, warn } = setup();
      const el = r.createElement('ink-box') as InkNode;
      const before = structuredClone({ ...el });
      if (method === 'setStyle') {
        r.setStyle(el, 'color', 'red');
        r.setStyle(el, 'color', 'blue');
      } else if (method === 'addClass') {
        r.addClass(el, 'x');
        r.addClass(el, 'y');
      } else {
        r.setProperty(el, 'title', 'x');
        r.setProperty(el, 'title', 'y');
      }
      expect({ ...el }).toEqual(before);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/^angular-ink: /);
    },
  );

  describe('what has no effect in a terminal', () => {
    const rendererType = (styles: string[]): RendererType2 => ({
      id: 'x',
      encapsulation: ViewEncapsulation.None,
      styles,
      data: {},
    });

    it('warns once for the class and style attributes, and not for others', () => {
      const { r, warn } = setup();
      const box = r.createElement('ink-box') as InkNode;
      r.setAttribute(box, 'title', 'a');
      expect(warn).not.toHaveBeenCalled();
      r.setAttribute(box, 'class', 'a');
      r.setAttribute(box, 'class', 'b');
      r.addClass(box, 'c');
      expect(warn).toHaveBeenCalledTimes(1);
      r.setAttribute(box, 'style', 'color: red');
      r.setStyle(box, 'color', 'red');
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls.map(([message]) => message as string)).toEqual([
        expect.stringMatching(/^angular-ink: classes /),
        expect.stringMatching(/^angular-ink: styles /),
      ]);
    });

    it('warns once for component styles, and not for a component without any', () => {
      const { factory, warn } = setup();
      factory.createRenderer(null, rendererType([]));
      factory.createRenderer(null, null);
      expect(warn).not.toHaveBeenCalled();
      factory.createRenderer(null, rendererType(['a { color: red }']));
      factory.createRenderer(null, rendererType(['b { color: red }']));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/^angular-ink: component styles /);
    });

    @Component({
      imports: [InkBox, InkText],
      template: `<ink-box class="a"><ink-text class="b">x</ink-text></ink-box>`,
    })
    class StaticClass {}

    @Component({
      imports: [InkBox],
      template: `<ink-box style="color: red" />`,
    })
    class StaticStyle {}

    @Component({
      imports: [InkBox],
      styles: 'ink-box { color: red; }',
      template: `<ink-box />`,
    })
    class ComponentStyles {}

    @Component({
      imports: [InkBox, InkText],
      template: `<ink-box borderStyle="round"><ink-text color="red">x</ink-text></ink-box>`,
    })
    class Clean {}

    async function warningsOf(component: Type<unknown>): Promise<string[]> {
      const warn = vi.fn<(message: string) => void>();
      const tree = mountTree(component, {
        onCommit: vi.fn(),
        warn,
        errorHandler: { handleError: vi.fn() },
      });
      await tree.whenStable();
      tree.destroy();
      return warn.mock.calls.map(([message]) => message);
    }

    it.each([
      ['a static class', StaticClass, 'classes'],
      ['a static style', StaticStyle, 'styles'],
      ['component styles', ComponentStyles, 'component styles'],
    ])('warns for %s in a real template', async (_name, component, word) => {
      expect(await warningsOf(component)).toEqual([
        expect.stringMatching(new RegExp(`^angular-ink: ${word} `)),
      ]);
    });

    it('stays quiet for a template that uses only inputs', async () => {
      expect(await warningsOf(Clean)).toEqual([]);
    });
  });
});
