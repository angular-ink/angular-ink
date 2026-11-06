import { Component } from '@angular/core';
import { InkBox, InkText, renderInk } from '@angular-ink/core';

type Justify =
  'flex-start' | 'flex-end' | 'center' | 'space-around' | 'space-between' | 'space-evenly';

@Component({
  selector: 'parity-justify-content',
  imports: [InkBox, InkText],
  template: `
    <ink-box flexDirection="column">
      @for (justify of modes; track justify) {
        <ink-box>
          <ink-text>[</ink-text>
          <ink-box [justifyContent]="justify" width="20" height="1">
            <ink-text>X</ink-text>
            <ink-text>Y</ink-text>
          </ink-box>
          <ink-text>] {{ justify }}</ink-text>
        </ink-box>
      }
    </ink-box>
  `,
})
class JustifyContent {
  protected readonly modes: readonly Justify[] = [
    'flex-start',
    'flex-end',
    'center',
    'space-around',
    'space-between',
    'space-evenly',
  ];
}

void renderInk(JustifyContent);
