import { Component, ElementRef, inject, input } from '@angular/core';
import type { InkNode } from '../tree/node';

@Component({
  selector: 'ink-transform',
  template: '<ng-content />',
})
export class InkTransform {
  /** Rewrites each output line; `index` is the line number. */
  readonly transform = input.required<(line: string, index: number) => string>();

  constructor() {
    (inject(ElementRef).nativeElement as InkNode).owner = this;
  }

  inkProps(): Record<string, unknown> {
    return { transform: this.transform() };
  }
}
