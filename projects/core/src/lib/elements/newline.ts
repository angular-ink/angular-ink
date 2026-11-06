import { Component, ElementRef, computed, inject, input, numberAttribute } from '@angular/core';
import type { InkNode } from '../tree/node';

@Component({
  selector: 'ink-newline',
  template: '',
})
export class InkNewline {
  readonly count = input(1, { transform: numberAttribute });
  /** The line breaks this element stands for; the engine reads it as the node's text. */
  readonly text = computed(() => '\n'.repeat(Math.max(0, this.count())));

  constructor() {
    (inject(ElementRef).nativeElement as InkNode).owner = this;
  }

  inkProps(): Record<string, unknown> {
    return { count: this.count() };
  }
}
