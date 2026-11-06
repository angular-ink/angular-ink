import { describe, expect, it } from 'vitest';
import { flattenHosts } from './flatten';
import { createNode, type InkNode } from './node';

function el(tag: string, ...children: InkNode[]): InkNode {
  const node = createNode('element', tag);
  for (const child of children) {
    child.parent = node;
    node.children.push(child);
  }
  return node;
}
const text = (value: string): InkNode => createNode('text', '', value);
const comment = (): InkNode => createNode('comment');

describe('flattenHosts', () => {
  it('drops hosts and lifts their children', () => {
    const a = el('ink-text', text('a'));
    const b = el('ink-text', text('b'));
    const root = el('ink-root', el('app-host', a, el('inner-host', b)));
    const flat = flattenHosts(root);
    expect(flat.children.map((c) => c.tag)).toEqual(['ink-text', 'ink-text']);
    expect(flat.children[1]?.children[0]?.text).toBe('b');
    expect(flat.children[0]?.parent).toBe(flat);
  });

  it('drops comments', () => {
    const flat = flattenHosts(el('ink-root', comment(), el('ink-text', comment(), text('x'))));
    expect(flat.children).toHaveLength(1);
    expect(flat.children[0]?.children.map((c) => c.kind)).toEqual(['text']);
  });

  it('rejects text outside ink-text, also through a host', () => {
    expect(() => flattenHosts(el('ink-root', el('ink-box', text('Olá'))))).toThrow(
      'angular-ink: text "Olá" must be inside <ink-text>',
    );
    expect(() => flattenHosts(el('ink-root', el('ink-box', el('host', text('Olá')))))).toThrow(
      'angular-ink: text "Olá" must be inside <ink-text>',
    );
  });

  it('rejects ink-box inside ink-text, also through a host', () => {
    const message = "angular-ink: <ink-box> can't be inside <ink-text>";
    expect(() => flattenHosts(el('ink-root', el('ink-text', el('ink-box'))))).toThrow(message);
    expect(() => flattenHosts(el('ink-root', el('ink-text', el('host', el('ink-box')))))).toThrow(
      message,
    );
  });

  it('limits text to 1 MiB', () => {
    const ok = el('ink-root', el('ink-text', text('a'.repeat(1_048_576))));
    expect(() => flattenHosts(ok)).not.toThrow();
    const big = el('ink-root', el('ink-text', text('a'.repeat(1_048_577))));
    expect(() => flattenHosts(big)).toThrow(/^angular-ink:/);
  });

  it('counts bytes, not characters', () => {
    const wide = el('ink-root', el('ink-text', text('é'.repeat(524_289))));
    expect(() => flattenHosts(wide)).toThrow(/^angular-ink:/);
  });

  it('limits nesting to 256', () => {
    const chain = (depth: number): InkNode => {
      let node = el('ink-box');
      for (let i = 1; i < depth; i++) node = el('ink-box', node);
      return el('ink-root', node);
    };
    expect(() => flattenHosts(chain(256))).not.toThrow();
    expect(() => flattenHosts(chain(257))).toThrow(/^angular-ink:/);
  });

  it('does not change the input', () => {
    const t = text('a');
    const host = el('host', el('ink-text', t), comment());
    const root = el('ink-root', host);
    flattenHosts(root);
    expect(root.children).toEqual([host]);
    expect(host.children).toHaveLength(2);
    expect(t.parent?.tag).toBe('ink-text');
  });
});
