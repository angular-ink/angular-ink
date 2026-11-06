// Public API surface of @angular-ink/core.
export { VERSION } from './version';
export {
  INK_ELEMENTS,
  InkBox,
  InkNewline,
  InkSpacer,
  InkStatic,
  InkText,
  InkTransform,
} from './lib/elements';
export type { InkBoxStyle, InkSize, InkStaticContext } from './lib/elements';
export {
  renderInk,
  type Instance,
  type RenderOptions,
  type ɵFrameSink,
  type ɵStaticSink,
} from './lib/runtime/render-ink';
export { renderInkToString, type RenderToStringOptions } from './lib/runtime/render-to-string';
export {
  injectApp,
  injectStderr,
  injectStdout,
  injectWindowSize,
  type AppProps,
  type StderrProps,
  type StdoutProps,
  type WindowSize,
} from './lib/runtime/inject';
export {
  injectInput,
  injectPaste,
  injectStdin,
  type InputOptions,
  type StdinProps,
} from './lib/input/inject-input';
export { injectFocus, type FocusOptions, type FocusProps } from './lib/input/inject-focus';
export { injectFocusManager, type FocusManagerProps } from './lib/input/focus-manager';
export { InkFocus } from './lib/input/focus.directive';
export type { Key } from './lib/input/key';
export type { InkNode, InkNode as DOMElement } from './lib/tree/node';
export { gridToString as ɵgridToString, type CellGrid as ɵCellGrid } from './lib/engine/grid';
