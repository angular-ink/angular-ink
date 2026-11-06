import { Component, signal, type OnDestroy } from '@angular/core';
import { InkBox, InkStatic, InkText, renderInk } from '@angular-ink/core';

@Component({
  selector: 'parity-static-tall',
  imports: [InkBox, InkStatic, InkText],
  template: `
    <ink-static [items]="lines()">
      <ng-template let-line>
        <ink-text color="green">{{ line }}</ink-text>
      </ng-template>
    </ink-static>
    <ink-box flexDirection="column">
      @for (row of rows; track row) {
        <ink-text>row {{ row }} of {{ lines().length }}</ink-text>
      }
    </ink-box>
  `,
})
class StaticTall implements OnDestroy {
  protected readonly lines = signal<readonly string[]>([]);
  protected readonly rows = Array.from({ length: 12 }, (_, index) => index + 1);
  private timer: NodeJS.Timeout | undefined;

  constructor() {
    this.run();
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }

  private run(): void {
    if (this.lines().length >= 3) return;
    this.lines.update((previous) => [...previous, `permanent ${String(previous.length + 1)}`]);
    this.timer = setTimeout(() => {
      this.run();
    }, 100);
  }
}

void renderInk(StaticTall);
