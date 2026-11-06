import { isDevMode, type Renderer2, type RendererFactory2 } from '@angular/core';
import { createNode, type InkNode } from './node';

function detach(node: InkNode): void {
  if (!node.parent) return;
  const siblings = node.parent.children;
  const at = siblings.indexOf(node);
  if (at >= 0) siblings.splice(at, 1);
  node.parent = null;
}

/** Adapter: turns Angular's Renderer2 calls into an InkNode tree. */
class InkRenderer implements Renderer2 {
  readonly data: Record<string, unknown> = {};
  destroyNode = null;
  private readonly warned = new Set<string>();

  constructor(private readonly warn: (message: string) => void) {}

  destroy(): void {
    // Nothing to release: the tree is plain data.
  }

  createElement(name: string): InkNode {
    return createNode('element', name);
  }

  createComment(): InkNode {
    return createNode('comment');
  }

  createText(value: string): InkNode {
    return createNode('text', '', value);
  }

  appendChild(parent: InkNode, newChild: InkNode): void {
    detach(newChild);
    newChild.parent = parent;
    parent.children.push(newChild);
  }

  insertBefore(parent: InkNode, newChild: InkNode, refChild: InkNode | null): void {
    detach(newChild);
    const at = refChild ? parent.children.indexOf(refChild) : -1;
    newChild.parent = parent;
    if (at < 0) parent.children.push(newChild);
    else parent.children.splice(at, 0, newChild);
  }

  removeChild(parent: InkNode | null, oldChild: InkNode): void {
    if (oldChild.parent === (parent ?? oldChild.parent)) detach(oldChild);
  }

  // Must return the node it was given: returning another object left the frame empty.
  selectRootElement(selectorOrNode: unknown): InkNode {
    return selectorOrNode as InkNode;
  }

  parentNode(node: InkNode): InkNode | null {
    return node.parent;
  }

  nextSibling(node: InkNode): InkNode | null {
    if (!node.parent) return null;
    return node.parent.children[node.parent.children.indexOf(node) + 1] ?? null;
  }

  setAttribute(): void {
    // Props come from the owner component's inputs.
  }

  removeAttribute(): void {
    // Props come from the owner component's inputs.
  }

  addClass(): void {
    this.warnOnce('addClass', 'classes have no effect in a terminal; use the ink-* inputs');
  }

  removeClass(): void {
    // addClass already warned.
  }

  setStyle(): void {
    this.warnOnce('setStyle', 'styles have no effect in a terminal; use the ink-* inputs');
  }

  removeStyle(): void {
    // setStyle already warned.
  }

  setProperty(): void {
    this.warnOnce('setProperty', 'DOM property bindings have no effect; use the ink-* inputs');
  }

  setValue(node: InkNode, value: string): void {
    node.text = value;
  }

  listen(target: unknown, eventName: string): () => void {
    const tag = typeof target === 'object' && target ? (target as InkNode).tag : String(target);
    throw new Error(`angular-ink: unknown event "${eventName}" on <${tag}>`);
  }

  private warnOnce(key: string, message: string): void {
    if (!isDevMode() || this.warned.has(key)) return;
    this.warned.add(key);
    this.warn(`angular-ink: ${message}`);
  }
}

export class InkRendererFactory implements RendererFactory2 {
  private readonly renderer: InkRenderer;

  constructor(
    private readonly onCommit: () => void,
    warn: (message: string) => void,
  ) {
    this.renderer = new InkRenderer(warn);
  }

  // One renderer serves every component, since neither host nor type changes how nodes are built.
  readonly createRenderer: RendererFactory2['createRenderer'] = () => this.renderer;

  end(): void {
    this.onCommit();
  }
}
