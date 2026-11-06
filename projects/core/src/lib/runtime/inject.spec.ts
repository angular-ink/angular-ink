import { Component, inject, Injector, runInInjectionContext } from '@angular/core';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InkText } from '../elements';
import { injectApp, injectStderr, injectStdout, injectWindowSize } from './inject';
import { renderInk } from './render-ink';
import type { Instance } from './render-ink';

class Sink extends Writable {
  isTTY = true;
  columns = 50;
  rows = 20;
  text = '';
  override _write(chunk: Buffer, _encoding: string, done: () => void): void {
    this.text += chunk.toString();
    done();
  }
}

@Component({
  selector: 'ink-test-probe',
  imports: [InkText],
  template: `<ink-text>probe</ink-text>`,
})
class Probe {
  static last: Probe | null = null;
  readonly app = injectApp();
  readonly stdout = injectStdout();
  readonly stderr = injectStderr();
  readonly size = injectWindowSize();
  readonly injector = inject(Injector);

  constructor() {
    Probe.last = this;
  }
}

describe('inject functions', () => {
  let instance: Instance | undefined;

  afterEach(() => {
    instance?.cleanup();
    instance = undefined;
  });

  it('give the streams and the size of the app', async () => {
    const stdout = new Sink();
    const stderr = new Sink();
    instance = await renderInk(Probe, {
      stdout,
      stderr,
      stdin: new Sink() as unknown as NodeJS.ReadableStream,
      interactive: true,
    });
    const probe = Probe.last!;
    expect(probe.stdout.stdout).toBe(stdout);
    expect(probe.stderr.stderr).toBe(stderr);
    expect(probe.size()).toEqual({ columns: 50, rows: 20 });
  });

  it('are usable from the injector of a component', async () => {
    const stdout = new Sink();
    instance = await renderInk(Probe, { stdout, interactive: true });
    const late = runInInjectionContext(Probe.last!.injector, () => injectStdout());
    expect(late.stdout).toBe(stdout);
  });

  it.each([
    ['injectApp', injectApp],
    ['injectStdout', injectStdout],
    ['injectStderr', injectStderr],
    ['injectWindowSize', injectWindowSize],
  ])('%s explains itself outside an app', (_name, injectFunction) => {
    const injector = Injector.create({ providers: [] });
    expect(() => runInInjectionContext(injector, () => injectFunction())).toThrow(/^angular-ink: /);
  });

  it('do not leak listeners between renders', async () => {
    vi.stubEnv('CI', 'false');
    const stdout = new Sink();
    const before = stdout.listenerCount('resize');
    const first = await renderInk(Probe, { stdout, interactive: true });
    first.unmount();
    await first.waitUntilExit();
    expect(stdout.listenerCount('resize')).toBe(before);
  });
});
