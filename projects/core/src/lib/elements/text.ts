import { Component, ElementRef, inject, input } from '@angular/core';
import type { InkNode } from '../tree/node';
import { definedProps, optionalBoolean } from './attributes';

@Component({
  selector: 'ink-text',
  template: '<ng-content />',
})
export class InkText {
  readonly color = input<string | undefined>();
  readonly backgroundColor = input<string | undefined>();
  readonly dimColor = input<boolean | undefined, unknown>(undefined, {
    transform: optionalBoolean,
  });
  readonly bold = input<boolean | undefined, unknown>(undefined, { transform: optionalBoolean });
  readonly italic = input<boolean | undefined, unknown>(undefined, { transform: optionalBoolean });
  readonly underline = input<boolean | undefined, unknown>(undefined, {
    transform: optionalBoolean,
  });
  readonly strikethrough = input<boolean | undefined, unknown>(undefined, {
    transform: optionalBoolean,
  });
  readonly inverse = input<boolean | undefined, unknown>(undefined, { transform: optionalBoolean });
  readonly wrap = input<
    'wrap' | 'hard' | 'truncate' | 'truncate-end' | 'truncate-middle' | 'truncate-start' | undefined
  >();

  constructor() {
    (inject(ElementRef).nativeElement as InkNode).owner = this;
  }

  inkProps(): Record<string, unknown> {
    return definedProps({
      color: this.color,
      backgroundColor: this.backgroundColor,
      dimColor: this.dimColor,
      bold: this.bold,
      italic: this.italic,
      underline: this.underline,
      strikethrough: this.strikethrough,
      inverse: this.inverse,
      wrap: this.wrap,
    });
  }
}
