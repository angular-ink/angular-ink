import { Component, input, signal } from '@angular/core';
import { InkText, injectApp, injectInput } from '@angular-ink/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeStdin } from './fake-streams';
import { cleanup, renderForTest } from './render-for-test';

@Component({
  selector: 'ink-test-label',
  imports: [InkText],
  template: `<ink-text color="red">value {{ value() }}</ink-text>`,
})
class Label {
  readonly value = input(0);
}

@Component({
  selector: 'ink-test-line',
  imports: [InkText],
  template: `<ink-text>{{ '-'.repeat(120) }}</ink-text>`,
})
class Line {}

@Component({
  selector: 'ink-test-quitter',
  imports: [InkText],
  template: `<ink-text>bye</ink-text>`,
})
class Quitter {
  constructor() {
    injectApp().exit('done');
  }
}

@Component({
  selector: 'ink-test-key-count',
  imports: [InkText],
  template: `<ink-text>{{ last() }}</ink-text>`,
})
class LastKey {
  readonly last = signal('none');

  constructor() {
    injectInput((text, key) => {
      this.last.set(`${key.ctrl ? 'ctrl+' : ''}${text}`);
    });
  }
}

afterEach(() => {
  cleanup();
});

describe('renderForTest', () => {
  it('renders to a 100 column stdout by default (TEST-07)', async () => {
    const test = await renderForTest(Line);
    expect(test.stdout.columns).toBe(100);
    expect(test.lastFrame()?.split('\n')[0]).toBe('-'.repeat(100));
  });

  it('has a TTY for stdin and not for stdout by default, like ink-testing-library (TEST-07, 09)', async () => {
    const test = await renderForTest(Label);
    expect(test.stdin.isTTY).toBe(true);
    expect(test.stdout.isTTY).toBe(false);
  });

  it('isTty sets stdin and stdout together', async () => {
    const test = await renderForTest(Label, { isTty: false });
    expect(test.stdin.isTTY).toBe(false);
    expect(test.stdout.isTTY).toBe(false);
  });

  it('takes columns, rows and isTTY', async () => {
    const test = await renderForTest(Line, { columns: 20, rows: 5, isTty: true });
    expect(test.stdout.columns).toBe(20);
    expect(test.stdout.rows).toBe(5);
    expect(test.stdout.isTTY).toBe(true);
    expect(test.lastFrame()?.split('\n')[0]).toBe('-'.repeat(20));
  });

  it('returns the last frame without ANSI, or with color (TEST-02)', async () => {
    const test = await renderForTest(Label, { inputs: { value: 1 } });
    expect(test.lastFrame()).toBe('value 1');
    expect(test.lastFrame({ ansi: true })).toBe('\x1b[31mvalue 1\x1b[0m');
  });

  it('keeps one item per frame (TEST-03) and rerender changes the frame (TEST-04)', async () => {
    const test = await renderForTest(Label, { inputs: { value: 1 } });
    expect(test.frames).toEqual(['value 1']);
    await test.rerender({ value: 2 });
    expect(test.lastFrame()).toBe('value 2');
    expect(test.frames).toEqual(['value 1', 'value 2']);
  });

  it('resizes the virtual terminal', async () => {
    const test = await renderForTest(Line, { columns: 30 });
    await test.resize(10, 4);
    expect(test.lastFrame()).toBe(Array<string>(12).fill('-'.repeat(10)).join('\n'));
  });

  it('unmounts (TEST-05) and cleans up (TEST-06)', async () => {
    const test = await renderForTest(Label);
    test.unmount();
    await expect(test.waitUntilExit()).resolves.toBeUndefined();
    const other = await renderForTest(Label);
    other.cleanup();
    await expect(other.waitUntilExit()).resolves.toBeUndefined();
  });

  it('waits for exit with the value of exit()', async () => {
    const test = await renderForTest(Quitter);
    await expect(test.waitUntilExit()).resolves.toBe('done');
  });

  it('cleanup() unmounts every instance (TEST-10)', async () => {
    const a = await renderForTest(Label);
    const b = await renderForTest(Label);
    cleanup();
    await expect(Promise.all([a.waitUntilExit(), b.waitUntilExit()])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it('does not exit on Ctrl+C (TEST-01)', async () => {
    const test = await renderForTest(LastKey);
    await test.stdin.press('ctrl+c');
    expect(test.lastFrame()).toBe('ctrl+c');
    await test.stdin.write('a');
    expect(test.lastFrame()).toBe('a');
  });

  it('has a stderr that records writes', async () => {
    const test = await renderForTest(Label);
    test.stderr.write('oops');
    expect(test.stderr.writes).toEqual(['oops']);
  });
});

describe('FakeStdin', () => {
  const keys = [
    ['down', '\x1b[B'],
    ['enter', '\r'],
    ['tab', '\t'],
    ['shift+tab', '\x1b[Z'],
    ['escape', '\x1b'],
    ['backspace', '\x7f'],
    ['delete', '\x1b[3~'],
    ['up', '\x1b[A'],
    ['left', '\x1b[D'],
    ['right', '\x1b[C'],
    ['home', '\x1b[H'],
    ['end', '\x1b[F'],
    ['pageup', '\x1b[5~'],
    ['pagedown', '\x1b[6~'],
    ['ctrl+c', '\x03'],
  ] as const;

  it.each(keys)('press(%s) writes the exact bytes', async (key, bytes) => {
    const stdin = new FakeStdin();
    const seen: string[] = [];
    stdin.on('data', (data: string) => seen.push(data));
    await stdin.press(key);
    expect(seen).toEqual([bytes]);
  });

  it('is a TTY by default and the isTTY flag can change', () => {
    expect(new FakeStdin().isTTY).toBe(true);
    expect(new FakeStdin({ isTTY: false }).isTTY).toBe(false);
  });

  it('write() emits readable and data, and read() consumes the data', async () => {
    const stdin = new FakeStdin();
    const onReadable = vi.fn(() => stdin.read());
    stdin.on('readable', onReadable);
    await stdin.write('abc');
    expect(onReadable).toHaveBeenCalledOnce();
    expect(stdin.read()).toBeNull();
  });

  it('waits for the app to settle after each write', async () => {
    const settle = vi.fn(() => Promise.resolve());
    const stdin = new FakeStdin({ settle });
    await stdin.press('down', 'up');
    expect(settle).toHaveBeenCalledTimes(2);
  });

  it('takes setRawMode and the no-op stream methods', () => {
    const stdin = new FakeStdin();
    stdin.setRawMode(true);
    expect(stdin.isRaw).toBe(true);
    expect(() => {
      stdin.setEncoding();
      stdin.resume();
      stdin.pause();
      stdin.ref();
      stdin.unref();
    }).not.toThrow();
  });
});
