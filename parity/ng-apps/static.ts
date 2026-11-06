import { Component, signal, type OnDestroy } from '@angular/core';
import { InkBox, InkStatic, InkText, renderInk } from '@angular-ink/core';

interface Test {
  readonly id: number;
  readonly title: string;
}

@Component({
  selector: 'parity-static',
  imports: [InkBox, InkStatic, InkText],
  template: `
    <ink-static [items]="tests()">
      <ng-template let-test>
        <ink-box>
          <ink-text color="green">✔ {{ test.title }}</ink-text>
        </ink-box>
      </ng-template>
    </ink-static>
    <ink-box marginTop="1">
      <ink-text dimColor>Completed tests: {{ tests().length }}</ink-text>
    </ink-box>
  `,
})
class Example implements OnDestroy {
  protected readonly tests = signal<readonly Test[]>([]);
  private completedTests = 0;
  private timer: NodeJS.Timeout | undefined;

  constructor() {
    this.run();
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }

  private run(): void {
    if (this.completedTests++ >= 10) return;
    this.tests.update((previous) => [
      ...previous,
      { id: previous.length, title: `Test #${String(previous.length + 1)}` },
    ]);
    this.timer = setTimeout(() => {
      this.run();
    }, 100);
  }
}

void renderInk(Example);
