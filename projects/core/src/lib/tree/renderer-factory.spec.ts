import { describe, expect, it, vi } from 'vitest';
import { type InkNode } from './node';
import { InkRendererFactory } from './renderer-factory';

function setup() {
  const onCommit = vi.fn();
  const warn = vi.fn();
  const factory = new InkRendererFactory(onCommit, warn);
  return { factory, onCommit, warn, r: factory.createRenderer(null, null) };
}

describe('InkRendererFactory', () => {
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

  it('throws on listen with the event and tag', () => {
    const { r } = setup();
    const el = r.createElement('ink-text') as InkNode;
    expect(() => r.listen(el, 'click', () => true)).toThrow(
      'angular-ink: unknown event "click" on <ink-text>',
    );
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
});
