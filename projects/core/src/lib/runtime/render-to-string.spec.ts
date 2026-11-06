import { Component, inject, input, PendingTasks, signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { InkBox, InkStatic, InkText } from '../elements';
import { injectApp, injectStderr, injectStdout, injectWindowSize } from './inject';
import { renderInkToString } from './render-to-string';

@Component({
  selector: 'ink-test-greeting',
  imports: [InkText],
  template: `<ink-text color="green">hello {{ name() }}</ink-text>`,
})
class Greeting {
  readonly name = input('world');
}

@Component({
  selector: 'ink-test-wide',
  imports: [InkBox, InkText],
  template: `<ink-box width="100%" justifyContent="flex-end"><ink-text>end</ink-text></ink-box>`,
})
class Wide {}

@Component({
  selector: 'ink-test-tools',
  imports: [InkText],
  template: `<ink-text>{{ size().columns }}x{{ size().rows }}</ink-text>`,
})
class Tools {
  readonly app = injectApp();
  readonly out = injectStdout();
  readonly err = injectStderr();
  readonly size = injectWindowSize();
  constructor() {
    this.app.exit();
    this.out.write('leak');
    this.err.write('leak');
  }
}

@Component({
  selector: 'ink-test-settling',
  imports: [InkText],
  template: `<ink-text>{{ value() }}</ink-text>`,
})
class Settling {
  readonly value = signal('first');
  constructor() {
    queueMicrotask(() => {
      this.value.set('later');
    });
  }
}

@Component({
  selector: 'ink-test-broken',
  imports: [InkText],
  template: `<ink-text>broken</ink-text>`,
})
class Broken {
  constructor() {
    throw new Error('boom');
  }
}

@Component({
  selector: 'ink-test-permanent',
  imports: [InkStatic, InkText],
  template: `
    <ink-static [items]="['a', 'b']">
      <ng-template let-item>
        <ink-text color="green">{{ item }}</ink-text>
      </ng-template>
    </ink-static>
    @if (live()) {
      <ink-text>live</ink-text>
    }
  `,
})
class Permanent {
  readonly live = input(true);
}

describe('renderInkToString', () => {
  it('returns the frame without color escapes', async () => {
    expect(await renderInkToString(Greeting, { inputs: { name: 'ana' } })).toBe('hello ana');
  });

  it('is 80 columns wide by default (INK-R2S-02)', async () => {
    expect(await renderInkToString(Wide)).toBe(`${' '.repeat(77)}end`);
  });

  it('takes the columns option', async () => {
    expect(await renderInkToString(Wide, { columns: 10 })).toBe(`${' '.repeat(7)}end`);
  });

  it('has 24 rows and the virtual width in injectWindowSize', async () => {
    expect(await renderInkToString(Tools, { columns: 33 })).toBe('33x24');
  });

  it('writes nothing to the process streams and leaves no exit listener (INK-R2S-01)', async () => {
    const out = vi.spyOn(process.stdout, 'write');
    const err = vi.spyOn(process.stderr, 'write');
    const before = process.listenerCount('exit');
    await renderInkToString(Greeting);
    expect(process.listenerCount('exit')).toBe(before);
    expect(out).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });

  it('turns the inject functions into no-ops (INK-R2S-03)', async () => {
    const out = vi.spyOn(process.stdout, 'write');
    expect(await renderInkToString(Tools)).toBe('80x24');
    expect(out).not.toHaveBeenCalled();
  });

  it('takes providers', async () => {
    const result = await renderInkToString(Greeting, { providers: [] });
    expect(result).toBe('hello world');
  });

  it('returns the frame of the first stabilization (INK-R2S-04)', async () => {
    expect(await renderInkToString(Settling)).toBe('later');
  });

  it('puts ink-static output before the live frame (INK-R2S-05)', async () => {
    expect(await renderInkToString(Permanent)).toBe('a\nb\nlive');
  });

  it('leaves no line end after ink-static output with no live frame (INK-R2S-05)', async () => {
    expect(await renderInkToString(Permanent, { inputs: { live: false } })).toBe('a\nb');
  });

  it('rejects with the error after cleaning up (INK-R2S-06)', async () => {
    const before = process.listenerCount('exit');
    await expect(renderInkToString(Broken)).rejects.toThrow('boom');
    expect(process.listenerCount('exit')).toBe(before);
  });
});

@Component({
  selector: 'ink-test-loading',
  imports: [InkText],
  template: `<ink-text>{{ state() }}</ink-text>`,
})
class Loading {
  readonly state = signal('loading');

  constructor() {
    const finish = inject(PendingTasks).add();
    setTimeout(() => {
      this.state.set('loaded');
      finish();
    }, 5);
  }
}

describe('renderInkToString and pending tasks', () => {
  it('waits for the app to be stable (INK-R2S-04)', async () => {
    await expect(renderInkToString(Loading)).resolves.toBe('loaded');
  });
});
