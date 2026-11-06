import { Component, input } from '@angular/core';
import { InkBox, InkText, injectFocus, renderInk } from '@angular-ink/core';

@Component({
  selector: 'parity-item',
  imports: [InkText],
  template: `
    <ink-text
      >{{ label() }}
      @if (focus.isFocused()) {
        <ink-text color="green">(focused)</ink-text>
      }
    </ink-text>
  `,
})
class Item {
  readonly label = input.required<string>();
  protected readonly focus = injectFocus();
}

@Component({
  selector: 'parity-focus',
  imports: [InkBox, InkText, Item],
  template: `
    <ink-box flexDirection="column" padding="1">
      <ink-box marginBottom="1">
        <ink-text>{{ help }}</ink-text>
      </ink-box>
      <parity-item label="First" />
      <parity-item label="Second" />
      <parity-item label="Third" />
    </ink-box>
  `,
})
class Focus {
  protected readonly help =
    'Press Tab to focus next element, Shift+Tab to focus previous element, Esc to reset focus.';
}

void renderInk(Focus);
