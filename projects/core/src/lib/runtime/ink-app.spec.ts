import { Component, input } from '@angular/core';
import { Writable } from 'node:stream';
import { loadYoga, type Yoga } from 'yoga-layout/load';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InkText } from '../elements';
import { InkApp, type InkAppOptions } from './ink-app';

let yoga: Yoga;

beforeAll(async () => {
  yoga = await loadYoga();
});

class Sink extends Writable {
  isTTY = true;
  columns = 20;
  rows = 5;
  text = '';
  override _write(chunk: Buffer, _encoding: string, done: () => void): void {
    this.text += chunk.toString();
    done();
  }
}

@Component({
  selector: 'ink-test-label',
  imports: [InkText],
  template: `<ink-text>{{ label() }}</ink-text>`,
})
class Label {
  readonly label = input('one');
}

function newApp(overrides: Partial<InkAppOptions> = {}): { app: InkApp; stdout: Sink } {
  const stdout = new Sink();
  const app = new InkApp({
    stdout,
    stdin: new Sink() as unknown as NodeJS.ReadableStream,
    stderr: new Sink(),
    interactive: true,
    exitOnCtrlC: true,
    patchConsole: false,
    maxFps: 30,
    yoga,
    providers: [],
    onExit: vi.fn(),
    ...overrides,
  });
  return { app, stdout };
}

describe('InkApp', () => {
  it('tells its owner when it has ended, once', async () => {
    const onExit = vi.fn();
    const { app } = newApp({ onExit });
    app.render(Label, {});
    app.unmount();
    app.unmount();
    await app.waitUntilExit();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('turns stdin raw mode off only on a TTY', async () => {
    const setRawMode = vi.fn();
    const stdin = Object.assign(new Sink(), { isTTY: false, setRawMode });
    const { app } = newApp({ stdin: stdin as unknown as NodeJS.ReadableStream });
    app.render(Label, {});
    app.unmount();
    await app.waitUntilExit();
    expect(setRawMode).not.toHaveBeenCalled();
  });

  it('survives a stdin whose setRawMode throws', async () => {
    const setRawMode = vi.fn(() => {
      throw new Error('EIO');
    });
    const stdin = Object.assign(new Sink(), { isTTY: true, setRawMode });
    const { app } = newApp({ stdin: stdin as unknown as NodeJS.ReadableStream });
    app.render(Label, {});
    app.unmount();
    await expect(app.waitUntilExit()).resolves.toBeUndefined();
  });

  it('coalesces the change detection passes of one tick into one frame', async () => {
    const sink = vi.fn();
    const { app } = newApp({ frameSink: sink });
    app.render(Label, {});
    expect(sink).toHaveBeenCalledTimes(1);
    app.unmount();
    await app.waitUntilExit();
  });

  it('removes the beforeExit listener when the app ends', async () => {
    const before = process.listenerCount('beforeExit');
    const { app } = newApp();
    app.render(Label, {});
    void app.waitUntilExit();
    void app.waitUntilExit();
    expect(process.listenerCount('beforeExit')).toBe(before + 1);
    app.unmount();
    expect(process.listenerCount('beforeExit')).toBe(before);
    await app.waitUntilExit();
  });
});
