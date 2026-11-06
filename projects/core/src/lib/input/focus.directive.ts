import {
  Directive,
  effect,
  output,
  untracked,
  type OutputEmitterRef,
  type Signal,
} from '@angular/core';
import { injectFocus } from './inject-focus';

/** Makes an element focusable and reports when it gains or loses the focus. */
@Directive({ selector: '[inkFocus]' })
export class InkFocus {
  readonly isFocused: Signal<boolean> = injectFocus().isFocused;
  readonly inkFocusChange: OutputEmitterRef<boolean> = output<boolean>();
  private reported = false;

  constructor() {
    effect(() => {
      const focused = this.isFocused();
      if (focused === this.reported) return;
      this.reported = focused;
      untracked(() => {
        this.inkFocusChange.emit(focused);
      });
    });
  }
}
