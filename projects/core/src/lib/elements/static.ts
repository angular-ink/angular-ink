import {
  Component,
  Directive,
  ElementRef,
  TemplateRef,
  ViewContainerRef,
  afterRenderEffect,
  computed,
  contentChild,
  inject,
  input,
  signal,
  untracked,
  type OnInit,
} from '@angular/core';
import type { InkNode } from '../tree/node';
import type { InkBoxStyle } from './box';

/** What the `ng-template` of an `ink-static` receives for each item. */
export interface InkStaticContext<T> {
  $implicit: T;
  index: number;
}

/** Renders a template once, inside the element it sits on (what `ngTemplateOutlet` does). */
@Directive({ selector: 'ng-container[inkStaticOutlet]' })
export class InkStaticOutlet<T> implements OnInit {
  readonly inkStaticOutlet = input.required<TemplateRef<InkStaticContext<T>>>();
  readonly inkStaticOutletContext = input.required<InkStaticContext<T>>();
  private readonly container = inject(ViewContainerRef);

  ngOnInit(): void {
    this.container.createEmbeddedView(this.inkStaticOutlet(), this.inkStaticOutletContext());
  }
}

/**
 * Renders each item once. Only the items past the ones already shown are rendered: a change to an
 * older item is ignored, and once the new items have been committed no node is left live.
 */
@Component({
  selector: 'ink-static',
  imports: [InkStaticOutlet],
  template: `
    @for (entry of fresh(); track entry.index) {
      <ng-container [inkStaticOutlet]="template()" [inkStaticOutletContext]="entry" />
    }
  `,
})
export class InkStatic<T> {
  readonly items = input.required<readonly T[]>();
  readonly style = input<InkBoxStyle | undefined>();
  private readonly template = contentChild.required(TemplateRef<InkStaticContext<T>>);
  private readonly shown = signal(0);
  protected readonly fresh = computed<InkStaticContext<T>[]>(() => {
    const start = this.shown();
    return this.items()
      .slice(start)
      .map((item, offset) => ({ $implicit: item, index: start + offset }));
  });

  constructor() {
    (inject(ElementRef).nativeElement as InkNode).owner = this;
    // After the pass that rendered the new items, so the engine sees them once.
    afterRenderEffect(() => {
      const count = this.items().length;
      untracked(() => {
        this.shown.set(count);
      });
    });
  }

  inkProps(): Record<string, unknown> {
    const style = this.style();
    return {
      position: 'absolute',
      flexDirection: 'column',
      ...style,
      display: this.fresh().length > 0 ? style?.display : 'none',
    };
  }
}
