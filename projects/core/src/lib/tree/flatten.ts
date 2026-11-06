import { createNode, holdsText, type InkNode } from './node';

export const MAX_TEXT_BYTES = 1_048_576;
export const MAX_DEPTH = 256;

const textEncoder = new TextEncoder();

// A UTF-16 unit takes at most 3 UTF-8 bytes, so only long strings need the exact count.
function exceedsTextLimit(text: string): boolean {
  if (text.length * 3 <= MAX_TEXT_BYTES) return false;
  return textEncoder.encode(text).length > MAX_TEXT_BYTES;
}

const QUOTED_TEXT_LENGTH = 80;
const CONTROL_CHARACTER = /[\p{Cc}\p{Cf}]/u;

/** The data as an error may show it: the message reaches a terminal raw, through Node or the app. */
function quoteForError(text: string): string {
  let quoted = '';
  let length = 0;
  for (const character of text) {
    if (CONTROL_CHARACTER.test(character)) continue;
    if (length === QUOTED_TEXT_LENGTH) return `${quoted}…`;
    quoted += character;
    length += 1;
  }
  return quoted;
}

const isInkTag = (tag: string): boolean => tag.startsWith('ink-');

/**
 * Returns a copy of the tree without transparent hosts (elements that are not `ink-*`, whose
 * children take their place) and without comments. Validates what the tree may contain. The
 * input is not changed. `display: none` is left to the layout.
 */
export function flattenHosts(root: InkNode): InkNode {
  const out = createNode(root.kind, root.tag, root.text);
  out.owner = root.owner;
  collect(root, out, root.tag, 0);
  return out;
}

/** `inkParent` is the tag of the nearest `ink-*` ancestor, seen through any hosts. */
function collect(source: InkNode, target: InkNode, inkParent: string, depth: number): void {
  if (depth >= MAX_DEPTH + 1) {
    throw new Error(`angular-ink: nesting deeper than ${String(MAX_DEPTH)} levels`);
  }
  for (const child of source.children) {
    if (child.kind === 'comment') continue;
    if (child.kind === 'text') {
      if (exceedsTextLimit(child.text)) {
        throw new Error(`angular-ink: text longer than ${String(MAX_TEXT_BYTES)} bytes`);
      }
      if (!holdsText(inkParent)) {
        throw new Error(
          `angular-ink: text "${quoteForError(child.text)}" must be inside <ink-text>`,
        );
      }
      const copy = createNode('text', '', child.text);
      copy.parent = target;
      target.children.push(copy);
    } else if (!isInkTag(child.tag)) {
      // Host: its children stand in its place, one level deeper in the source.
      collect(child, target, inkParent, depth + 1);
    } else {
      if ((child.tag === 'ink-box' || child.tag === 'ink-spacer') && holdsText(inkParent)) {
        throw new Error(`angular-ink: <${child.tag}> can't be inside <${inkParent}>`);
      }
      const copy = createNode('element', child.tag);
      copy.owner = child.owner;
      copy.parent = target;
      target.children.push(copy);
      collect(child, copy, child.tag, depth + 1);
    }
  }
}
