import { Component, signal } from '@angular/core';
import { InkBox, InkText, injectInput, renderInk } from '@angular-ink/core';

const INNER_ROWS = Number(process.argv[2]) - 2;

@Component({
  selector: 'parity-tall-frame',
  imports: [InkBox, InkText],
  template: `
    <ink-box flexDirection="column" borderStyle="round" borderColor="cyan">
      @for (row of rows; track row) {
        <ink-text [color]="$first ? 'green' : undefined"
          >row {{ row }} seen {{ presses() }}</ink-text
        >
      }
    </ink-box>
  `,
})
class TallFrame {
  protected readonly rows = Array.from({ length: INNER_ROWS }, (_, index) => index + 1);
  protected readonly presses = signal(0);

  constructor() {
    injectInput((text) => {
      if (text === 'n') this.presses.update((previous) => previous + 1);
    });
  }
}

void renderInk(TallFrame);
