import { Component } from '@angular/core';
import { InkBox, InkText, renderInk } from '@angular-ink/core';

@Component({
  selector: 'parity-border-backgrounds',
  imports: [InkBox, InkText],
  template: `
    <ink-box flexDirection="column" gap="1">
      <ink-box borderStyle="round" borderColor="white" borderBackgroundColor="blue" padding="1">
        <ink-text>Box with blue background on white border</ink-text>
      </ink-box>
      <ink-box borderStyle="single" borderColor="black" borderBackgroundColor="yellow" padding="1">
        <ink-text>Box with yellow background on black border</ink-text>
      </ink-box>
      <ink-box
        borderStyle="double"
        borderTopColor="red"
        borderTopBackgroundColor="green"
        borderBottomColor="blue"
        borderBottomBackgroundColor="yellow"
        borderLeftColor="cyan"
        borderLeftBackgroundColor="magenta"
        borderRightColor="white"
        borderRightBackgroundColor="red"
        padding="1"
      >
        <ink-text>Box with different colors per side</ink-text>
      </ink-box>
      <ink-box
        borderDimColor
        borderBackgroundColor="rgb(128, 0, 128)"
        borderStyle="classic"
        borderColor="white"
        padding="1"
      >
        <ink-text>Box with dimmed RGB purple background on border</ink-text>
      </ink-box>
      <ink-box borderStyle="bold" borderColor="#FF00FF" borderBackgroundColor="#00FF00" padding="1">
        <ink-text>Box with hex color backgrounds</ink-text>
      </ink-box>
    </ink-box>
  `,
})
class BorderBackgrounds {}

void renderInk(BorderBackgrounds);
