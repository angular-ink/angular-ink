import { InkBox } from './box';
import { InkNewline } from './newline';
import { InkSpacer } from './spacer';
import { InkStatic } from './static';
import { InkText } from './text';
import { InkTransform } from './transform';

export { InkBox, InkNewline, InkSpacer, InkStatic, InkText, InkTransform };
export type { InkSize } from './attributes';
export type { InkBoxStyle } from './box';
export type { InkStaticContext } from './static';

/** Import this in a component's `imports` to use every `ink-*` element. */
export const INK_ELEMENTS = [
  InkBox,
  InkText,
  InkNewline,
  InkSpacer,
  InkStatic,
  InkTransform,
] as const;
