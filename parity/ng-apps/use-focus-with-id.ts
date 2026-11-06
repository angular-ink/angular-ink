import { Component, HostAttributeToken, inject, input } from '@angular/core';
import {
  InkBox,
  InkText,
  injectFocus,
  injectFocusManager,
  injectInput,
  renderInk,
} from '@angular-ink/core';

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
  // injectFocus runs in the constructor, where an input has no value yet.
  protected readonly focus = injectFocus({ id: inject(new HostAttributeToken('id')) });
}

@Component({
  selector: 'parity-focus',
  imports: [InkBox, InkText, Item],
  template: `
    <ink-box flexDirection="column" padding="1">
      <ink-box marginBottom="1">
        <ink-text>{{ help }}</ink-text>
      </ink-box>
      <parity-item id="1" label="Press 1 to focus" />
      <parity-item id="2" label="Press 2 to focus" />
      <parity-item id="3" label="Press 3 to focus" />
    </ink-box>
  `,
})
class Focus {
  protected readonly help =
    'Press Tab to focus next element, Shift+Tab to focus previous element, Esc to reset focus.';
  private readonly manager = injectFocusManager();

  constructor() {
    injectInput((text) => {
      if (['1', '2', '3'].includes(text)) this.manager.focus(text);
    });
  }
}

void renderInk(Focus);
