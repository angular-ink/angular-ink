import { Component } from '@angular/core';
import { InkBox, InkText, renderInk } from '@angular-ink/core';

@Component({
  selector: 'parity-box-backgrounds',
  imports: [InkBox, InkText],
  template: `
    <ink-box flexDirection="column" gap="1">
      <ink-text bold>Box Background Examples:</ink-text>

      <ink-box><ink-text>1. Standard red background (10x3):</ink-text></ink-box>
      <ink-box backgroundColor="red" width="10" height="3" alignSelf="flex-start">
        <ink-text>Hello</ink-text>
      </ink-box>

      <ink-box><ink-text>2. Blue background with border (12x4):</ink-text></ink-box>
      <ink-box
        backgroundColor="blue"
        borderStyle="round"
        width="12"
        height="4"
        alignSelf="flex-start"
      >
        <ink-text>Border</ink-text>
      </ink-box>

      <ink-box><ink-text>3. Green background with padding (14x4):</ink-text></ink-box>
      <ink-box backgroundColor="green" padding="1" width="14" height="4" alignSelf="flex-start">
        <ink-text>Padding</ink-text>
      </ink-box>

      <ink-box><ink-text>4. Yellow background with center alignment (16x3):</ink-text></ink-box>
      <ink-box
        backgroundColor="yellow"
        width="16"
        height="3"
        justifyContent="center"
        alignSelf="flex-start"
      >
        <ink-text>Centered</ink-text>
      </ink-box>

      <ink-box><ink-text>5. Magenta background, column layout (12x5):</ink-text></ink-box>
      <ink-box
        backgroundColor="magenta"
        flexDirection="column"
        width="12"
        height="5"
        alignSelf="flex-start"
      >
        <ink-text>Line 1</ink-text>
        <ink-text>Line 2</ink-text>
      </ink-box>

      <ink-box><ink-text>6. Hex color background #FF8800 (10x3):</ink-text></ink-box>
      <ink-box backgroundColor="#FF8800" width="10" height="3" alignSelf="flex-start">
        <ink-text>Hex</ink-text>
      </ink-box>

      <ink-box><ink-text>7. RGB background rgb(0,255,0) (10x3):</ink-text></ink-box>
      <ink-box backgroundColor="rgb(0,255,0)" width="10" height="3" alignSelf="flex-start">
        <ink-text>RGB</ink-text>
      </ink-box>

      <ink-box><ink-text>8. Text inheritance test:</ink-text></ink-box>
      <ink-box backgroundColor="cyan" alignSelf="flex-start">
        <ink-text>{{ 'Inherited ' }}</ink-text>
        <ink-text backgroundColor="red">{{ 'Override ' }}</ink-text>
        <ink-text>Back to inherited</ink-text>
      </ink-box>

      <ink-box><ink-text>9. Nested background inheritance:</ink-text></ink-box>
      <ink-box backgroundColor="blue" alignSelf="flex-start">
        <ink-text>{{ 'Outer: ' }}</ink-text>
        <ink-box backgroundColor="yellow">
          <ink-text>{{ 'Inner: ' }}</ink-text>
          <ink-text backgroundColor="red">Deep</ink-text>
        </ink-box>
      </ink-box>

      <ink-box marginTop="1"><ink-text>Press Ctrl+C to exit</ink-text></ink-box>
    </ink-box>
  `,
})
class BoxBackgrounds {}

void renderInk(BoxBackgrounds);
