export type InkNodeKind = 'element' | 'text' | 'comment';

export interface InkNode {
  kind: InkNodeKind;
  /** Element tag; empty for text and comment nodes. */
  tag: string;
  /** The element component that owns this node; set by the ink-* components. */
  owner: { inkProps(): Record<string, unknown> } | null;
  text: string;
  parent: InkNode | null;
  children: InkNode[];
}

/** The elements whose children are squashed into one run of text. */
export const holdsText = (tag: string): boolean => tag === 'ink-text' || tag === 'ink-transform';

/**
 * Once an app has hydrated from server-rendered HTML, Angular reads the `ngh` attribute of every
 * component host it creates, ours included, to find server-rendered DOM to reuse. An ink node has
 * none, so it answers that it has no attributes. Non-enumerable, so copies and equality checks
 * of nodes never see these. Angular 22.0 also reads `tagName` of a root host element, in
 * `createComponent`, to refuse a `<script>`.
 */
const ELEMENT_ONLY: PropertyDescriptorMap = {
  getAttribute: { value: (): null => null },
  hasAttribute: { value: (): boolean => false },
  tagName: {
    get(this: InkNode): string {
      return this.tag;
    },
  },
};

export function createNode(kind: InkNodeKind, tag = '', text = ''): InkNode {
  const node: InkNode = { kind, tag, owner: null, text, parent: null, children: [] };
  return kind === 'element' ? Object.defineProperties(node, ELEMENT_ONLY) : node;
}
