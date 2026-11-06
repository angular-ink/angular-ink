import { Component } from '@angular/core';
import { InkText, renderInk } from '@angular-ink/core';
import { join } from 'node:path';

@Component({
  selector: 'parity-error-excerpt',
  imports: [InkText],
  template: `<ink-text>{{ fail() }}</ink-text>`,
})
class Failing {
  protected fail(): string {
    const error = new Error('parity failure');
    error.stack = [
      'Error: parity failure',
      `    at fail (${join(process.cwd(), 'parity/fixtures/long-lines.txt')}:5:3)`,
      '    at /not/a/file.js:2:1',
      '    at native',
    ].join('\n');
    throw error;
  }
}

void renderInk(Failing);
