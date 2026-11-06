import { Component } from '@angular/core';
import { InkBox, InkText, renderInk } from '@angular-ink/core';

@Component({
  selector: 'parity-value-edges',
  imports: [InkBox, InkText],
  template: `
    <ink-box flexDirection="column" width="60">
      <ink-text>{{ 'tab\\tstop' }}</ink-text>
      <ink-text>{{ 'abcdefgh\\tnext' }}</ink-text>
      <ink-text>{{ 'a\\tb\\tc' }}</ink-text>
      <ink-text color="rgb(256,0,0)">clamped foreground</ink-text>
      <ink-text backgroundColor="rgb(300, 10, 999)">clamped background</ink-text>
      <ink-text color="rgb(-1,0,0)">negative channel</ink-text>
      <ink-text color="rgb(1.5,0,0)">fractional channel</ink-text>
      <ink-text color="ansi256(300)">large palette index</ink-text>
      <ink-text color="nope">unknown color</ink-text>
      <ink-text color="#12">hex too short</ink-text>
      <ink-text color="#abcd">hex with four digits</ink-text>
      <ink-text color="ansi256(  1)">palette with two spaces</ink-text>
      <ink-box width="50%" backgroundColor="blue"><ink-text>percent width</ink-text></ink-box>
      <ink-box width="50x" backgroundColor="red"><ink-text>width with a unit</ink-text></ink-box>
      <ink-box width="wide" backgroundColor="green">
        <ink-text>width with no number</ink-text>
      </ink-box>
      <ink-box height="2x"><ink-text>height with a unit</ink-text></ink-box>
      <ink-text>end</ink-text>
    </ink-box>
  `,
})
class ValueEdges {}

void renderInk(ValueEdges);
