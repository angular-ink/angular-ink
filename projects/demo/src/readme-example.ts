import { Component, signal } from '@angular/core';
import { InkBox, InkText, injectApp, injectInput, renderInk } from '@angular-ink/core';

@Component({
  selector: 'demo-deploy',
  imports: [InkBox, InkText],
  template: `
    <ink-box flexDirection="column">
      <ink-text bold>Deploy to which environment?</ink-text>
      @for (name of environments; track name) {
        <ink-text [color]="$index === selected() ? 'cyan' : undefined">{{ name }}</ink-text>
      }
    </ink-box>
  `,
})
class Deploy {
  protected readonly environments = ['staging', 'prod'];
  protected readonly selected = signal(0);

  constructor() {
    const app = injectApp();
    injectInput((_text, key) => {
      if (key.upArrow) this.selected.update((index) => Math.max(index - 1, 0));
      if (key.downArrow) this.selected.update((index) => Math.min(index + 1, 1));
      if (key.return) app.exit();
    });
  }
}

const app = await renderInk(Deploy);
await app.waitUntilExit();
