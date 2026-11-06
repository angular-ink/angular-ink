import { Component, ElementRef, inject } from '@angular/core';
import type { InkNode } from '../tree/node';

@Component({
  selector: 'ink-spacer',
  template: '',
})
export class InkSpacer {
  constructor() {
    (inject(ElementRef).nativeElement as InkNode).owner = this;
  }

  inkProps(): Record<string, unknown> {
    return { flexGrow: 1 };
  }
}
