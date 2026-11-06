import { Component } from '@angular/core';
import { InkBox, InkText, renderInk } from '@angular-ink/core';

@Component({
  selector: 'parity-borders',
  imports: [InkBox, InkText],
  template: `
    <ink-box flexDirection="column" padding="2">
      <ink-box>
        <ink-box borderStyle="single" marginRight="2"><ink-text>single</ink-text></ink-box>
        <ink-box borderStyle="double" marginRight="2"><ink-text>double</ink-text></ink-box>
        <ink-box borderStyle="round" marginRight="2"><ink-text>round</ink-text></ink-box>
        <ink-box borderStyle="bold"><ink-text>bold</ink-text></ink-box>
      </ink-box>
      <ink-box marginTop="1">
        <ink-box borderStyle="singleDouble" marginRight="2">
          <ink-text>singleDouble</ink-text>
        </ink-box>
        <ink-box borderStyle="doubleSingle" marginRight="2">
          <ink-text>doubleSingle</ink-text>
        </ink-box>
        <ink-box borderStyle="classic"><ink-text>classic</ink-text></ink-box>
      </ink-box>
    </ink-box>
  `,
})
class Borders {}

void renderInk(Borders);
