import { Component, signal, type OnDestroy } from '@angular/core';
import { InkText, renderInk } from '@angular-ink/core';

const LAST = 10;

@Component({
  selector: 'parity-counter',
  imports: [InkText],
  template: `<ink-text color="green">{{ counter() }} tests passed</ink-text>`,
})
class Counter implements OnDestroy {
  protected readonly counter = signal(0);
  private readonly timer = setInterval(() => {
    this.counter.update((previous) => previous + 1);
    if (this.counter() === LAST) clearInterval(this.timer);
  }, 100);

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }
}

void renderInk(Counter);
