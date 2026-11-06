import { Component, signal } from '@angular/core';
import { InkBox, InkText, injectInput, renderInk } from '@angular-ink/core';

const ITEMS = ['Red', 'Green', 'Blue', 'Yellow', 'Magenta', 'Cyan'];

@Component({
  selector: 'parity-select-input',
  imports: [InkBox, InkText],
  template: `
    <ink-box flexDirection="column">
      <ink-text>Select a color:</ink-text>
      @for (item of items; track item) {
        <ink-box>
          <ink-text [color]="$index === selectedIndex() ? 'blue' : undefined">{{
            label(item, $index)
          }}</ink-text>
        </ink-box>
      }
    </ink-box>
  `,
})
class SelectInput {
  protected readonly items = ITEMS;
  protected readonly selectedIndex = signal(0);

  // In a template the compiler would collapse the two spaces of a string literal.
  protected label(item: string, index: number): string {
    return `${index === this.selectedIndex() ? '> ' : '  '}${item}`;
  }

  constructor() {
    injectInput((_input, key) => {
      if (key.upArrow) this.selectedIndex.update((i) => (i - 1 + ITEMS.length) % ITEMS.length);
      if (key.downArrow) this.selectedIndex.update((i) => (i + 1) % ITEMS.length);
    });
  }
}

void renderInk(SelectInput);
