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

  // Angular writes a static class or style through this one, and any other attribute is a no-op.
  setAttribute(_node: InkNode, name: string): void {
    if (name === 'class') this.warnAboutClasses();
    else if (name === 'style') this.warnAboutStyles();
  }

  removeAttribute(): void {
    // Props come from the owner component's inputs.
  }

  addClass(): void {
    this.warnAboutClasses();
  }

  removeClass(): void {
    // addClass already warned.
  }

  setStyle(): void {
    this.warnAboutStyles();
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

  // Angular calls this for every template listener, component outputs included, and it cannot be
  // told which is which. Outputs are delivered by the component. A typo in an output's name goes
  // unnoticed: strictTemplates takes an unknown name for a DOM event, so it compiles and never fires.
  listen(): () => void {
    return () => undefined;
  }

  warnOnce(key: string, message: string): void {
    if (!isDevMode() || this.warned.has(key)) return;
    this.warned.add(key);
    this.warn(`angular-ink: ${message}`);
  }

  private warnAboutClasses(): void {
    this.warnOnce('class', 'classes have no effect in a terminal; use the ink-* inputs');
  }

  private warnAboutStyles(): void {
    this.warnOnce('style', 'styles have no effect in a terminal; use the ink-* inputs');
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
  readonly createRenderer: RendererFactory2['createRenderer'] = (_host, type) => {
    if ((type?.styles.length ?? 0) > 0) {
      this.renderer.warnOnce(
        'componentStyles',
        'component styles have no effect in a terminal; use the ink-* inputs',
      );
    }
    return this.renderer;
  };

  end(): void {
    this.onCommit();
  }
}
