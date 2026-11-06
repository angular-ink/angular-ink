import { Component, input, signal, type WritableSignal } from '@angular/core';
import { cleanup, FakeStdin, renderForTest, type InkTestInstance } from '@angular-ink/testing';
import { spawn } from 'node:child_process';
import { PassThrough, Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InkText } from '../elements';
import { renderInk } from '../runtime/render-ink';
import { renderInkToString } from '../runtime/render-to-string';
import { injectApp } from '../runtime/inject';
import { injectInput, injectPaste, injectStdin } from './inject-input';
import type { Key } from './key';
import { MAX_PASTE_BYTES } from './key-parser';

const PASTE_ON = '\x1b[?2004h';
const PASTE_OFF = '\x1b[?2004l';
const NOT_A_TTY = 'angular-ink: stdin is not a TTY; injectInput is inactive\n';

/** Filled by the component of the running test. */
let seen: { input: string; key: Key }[] = [];
let pasted: string[] = [];
let active: WritableSignal<boolean>;

@Component({
  selector: 'ink-test-keys',
  imports: [InkText],
  template: `<ink-text>keys {{ count() }}</ink-text>`,
})
class Keys {
  readonly count = signal(0);

  constructor() {
    injectInput((text, key) => {
      seen.push({ input: text, key });
      this.count.update((value) => value + 1);
    });
  }
}

@Component({
  selector: 'ink-test-switch',
  imports: [InkText],
  template: `<ink-text>switch</ink-text>`,
})
class Switched {
  constructor() {
    injectInput(
      (text, key) => {
        seen.push({ input: text, key });
      },
      { isActive: active },
    );
  }
}

@Component({
  selector: 'ink-test-off',
  imports: [InkText],
  template: `<ink-text>off</ink-text>`,
})
class AlwaysOff {
  constructor() {
    injectInput(
      (text, key) => {
        seen.push({ input: text, key });
      },
      { isActive: false },
    );
  }
}

@Component({
  selector: 'ink-test-two',
  imports: [Keys, Switched],
  template: `<ink-test-keys />
    @if (second()) {
      <ink-test-switch />
    }`,
})
class Two {
  readonly second = input(true);
}

@Component({
  selector: 'ink-test-swap',
  imports: [Keys, Switched],
  template: `@if (first()) {
      <ink-test-keys />
    } @else {
      <ink-test-switch />
    }`,
})
class Swap {
  readonly first = input(true);
}

@Component({
  selector: 'ink-test-paste',
  imports: [InkText],
  template: `<ink-text>paste</ink-text>`,
})
class Paste {
  constructor() {
    injectInput((text, key) => {
      seen.push({ input: text, key });
    });
    injectPaste(
      (text) => {
        pasted.push(text);
      },
      { isActive: active },
    );
  }
}

@Component({
  selector: 'ink-test-row',
  imports: [InkText],
  template: `<ink-text>row {{ row() }}</ink-text>`,
})
class Row {
  readonly row = input.required<number>();
  readonly move = input.required<() => void>();
  static readonly rowsAtKey: number[] = [];

  constructor() {
    injectInput(() => {
      Row.rowsAtKey.push(this.row());
      this.move()();
    });
  }
}

@Component({
  selector: 'ink-test-list',
  imports: [Row],
  template: `<ink-test-row [row]="row()" [move]="move" />`,
})
class List {
  readonly row = signal(0);
  readonly move = (): void => {
    this.row.update((value) => value + 1);
  };
}

@Component({
  selector: 'ink-test-stdin',
  imports: [InkText],
  template: `<ink-text>stdin</ink-text>`,
})
class StdinProbe {
  static last: StdinProbe;
  readonly terminal = injectStdin();

  constructor() {
    StdinProbe.last = this;
  }
}

@Component({
  selector: 'ink-test-all',
  imports: [InkText],
  template: `<ink-text>inert</ink-text>`,
})
class AllInputs {
  static stdin: ReturnType<typeof injectStdin>;

  constructor() {
    injectInput(() => undefined);
    injectPaste(() => undefined);
    AllInputs.stdin = injectStdin();
    AllInputs.stdin.setRawMode(true);
    AllInputs.stdin.setRawMode(false);
  }
}

@Component({
  selector: 'ink-test-thrower',
  imports: [InkText],
  template: `<ink-text>thrower</ink-text>`,
})
class Thrower {
  constructor() {
    injectInput(() => {
      throw new Error('from a key');
    });
  }
}

@Component({
  selector: 'ink-test-quit-key',
  imports: [InkText],
  template: `<ink-text>quit</ink-text>`,
})
class QuitKey {
  readonly app = injectApp();

  constructor() {
    injectInput((text) => {
      seen.push({ input: text, key: {} as Key });
      this.app.exit('done');
    });
  }
}

const output = (test: InkTestInstance): string => test.stdout.writes.join('');

class Sink extends Writable {
  isTTY = true;
  columns = 40;
  rows = 10;
  text = '';
  override _write(chunk: Buffer, _encoding: string, done: () => void): void {
    this.text += chunk.toString();
    done();
  }
}

afterEach(() => {
  cleanup();
  seen = [];
  pasted = [];
  active = signal(true);
});
active = signal(true);

describe('injectInput', () => {
  it('gives each key to the handler (INK-INPUT-01)', async () => {
    const test = await renderForTest(Keys);
    await test.stdin.press('up');
    await test.stdin.write('a');
    expect(seen.map(({ input: text }) => text)).toEqual(['', 'a']);
    expect(seen[0]?.key.upArrow).toBe(true);
    expect(test.lastFrame()).toBe('keys 2');
  });

  it('sees a key once, though the stream emits readable and data', async () => {
    const test = await renderForTest(Keys);
    await test.stdin.write('a');
    expect(seen).toHaveLength(1);
  });

  it('reads a real stream chunk by chunk, each key once', async () => {
    const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() });
    const app = await renderInk(Keys, {
      stdout: new Sink(),
      stderr: new Sink(),
      stdin,
      patchConsole: false,
    });
    stdin.write('a');
    await vi.waitFor(() => {
      expect(seen.map(({ input: text }) => text)).toEqual(['a']);
    });
    // A character cut in two by the chunks comes back whole.
    const bytes = Buffer.from('é');
    stdin.write(bytes.subarray(0, 1));
    stdin.write(bytes.subarray(1));
    await vi.waitFor(() => {
      expect(seen.map(({ input: text }) => text)).toEqual(['a', 'é']);
    });
    expect(stdin.setRawMode).toHaveBeenCalledWith(true);
    app.unmount();
    await app.waitUntilExit();
    expect(stdin.listenerCount('readable')).toBe(0);
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it('flushes a lone escape on its own after 20 ms (INK-INPUT-09)', async () => {
    const test = await renderForTest(Keys);
    await test.stdin.press('escape');
    await vi.waitFor(() => {
      expect(seen[0]?.key.escape).toBe(true);
    });
  });

  it('gives no flag to Key.ctrl for a plain letter', async () => {
    const test = await renderForTest(Keys);
    await test.stdin.write('x');
    expect(seen[0]?.key.ctrl).toBe(false);
  });

  it('follows isActive as a signal (INK-INPUT-02)', async () => {
    const test = await renderForTest(Switched);
    await test.stdin.write('a');
    active.set(false);
    await test.rerender({});
    await test.stdin.write('b');
    active.set(true);
    await test.rerender({});
    await test.stdin.write('c');
    expect(seen.map(({ input: text }) => text)).toEqual(['a', 'c']);
  });

  it('takes isActive as a plain boolean', async () => {
    const test = await renderForTest(AlwaysOff);
    await test.stdin.write('a');
    expect(seen).toEqual([]);
    expect(test.stdin.isRaw).toBe(false);
  });

  it('hands out keys in the order of registration', async () => {
    const order: string[] = [];
    @Component({
      selector: 'ink-test-a',
      imports: [InkText],
      template: `<ink-text>a</ink-text>`,
    })
    class First {
      constructor() {
        injectInput(() => order.push('a'));
      }
    }
    @Component({
      selector: 'ink-test-b',
      imports: [InkText],
      template: `<ink-text>b</ink-text>`,
    })
    class Second {
      constructor() {
        injectInput(() => order.push('b'));
      }
    }
    @Component({
      selector: 'ink-test-ab',
      imports: [First, Second],
      template: `<ink-test-a /><ink-test-b />`,
    })
    class Both {}
    const test = await renderForTest(Both);
    await test.stdin.write('x');
    expect(order).toEqual(['a', 'b']);
  });

  it('ends the app with the error of a handler that throws', async () => {
    const test = await renderForTest(Thrower);
    const exited = test.waitUntilExit();
    await test.stdin.write('x');
    await expect(exited).rejects.toThrow('from a key');
    expect(test.stdin.isRaw).toBe(false);
  });

  describe('raw mode (INK-HOOK-STDIN-02)', () => {
    it('goes on with the first active handler and off with the last, counted', async () => {
      const test = await renderForTest(Two, { inputs: { second: true } });
      expect(test.stdin.isRaw).toBe(true);
      const calls = vi.spyOn(test.stdin, 'setRawMode');
      await test.rerender({ second: false });
      expect(test.stdin.isRaw).toBe(true);
      expect(calls).not.toHaveBeenCalled();
      test.unmount();
      await test.waitUntilExit();
      expect(test.stdin.isRaw).toBe(false);
    });

    it('turns off when the last handler goes inactive, and lets go of the stream', async () => {
      const test = await renderForTest(Switched);
      const unref = vi.spyOn(test.stdin, 'unref');
      expect(test.stdin.isRaw).toBe(true);
      expect(test.stdin.listenerCount('readable')).toBe(1);
      active.set(false);
      await test.rerender({});
      expect(test.stdin.isRaw).toBe(false);
      expect(test.stdin.listenerCount('readable')).toBe(0);
      expect(unref).toHaveBeenCalled();
    });

    it('keeps raw mode across a swap of components in one change detection', async () => {
      const test = await renderForTest(Swap, { inputs: { first: true } });
      const calls = vi.spyOn(test.stdin, 'setRawMode');
      await test.rerender({ first: false });
      expect(test.stdin.isRaw).toBe(true);
      expect(calls).not.toHaveBeenCalled();
      await test.stdin.write('a');
      expect(seen.map(({ input: text }) => text)).toEqual(['a']);
    });

    it('unmount turns it off', async () => {
      const test = await renderForTest(Keys);
      expect(test.stdin.isRaw).toBe(true);
      test.unmount();
      expect(test.stdin.isRaw).toBe(false);
      await test.waitUntilExit();
    });

    it('a key held by the parser does not reach the next owner', async () => {
      const test = await renderForTest(Switched);
      await test.stdin.write('\x1b[');
      active.set(false);
      await test.rerender({});
      active.set(true);
      await test.rerender({});
      await test.stdin.write('A');
      expect(seen.map(({ input: text }) => text)).toEqual(['A']);
    });

    it('survives a setRawMode that throws on the way in', async () => {
      const stdin = new FakeStdin();
      vi.spyOn(stdin, 'setRawMode').mockImplementation(() => {
        throw new Error('EIO');
      });
      const app = await renderInk(Keys, {
        stdout: new Sink(),
        stderr: new Sink(),
        stdin: stdin as unknown as NodeJS.ReadableStream,
        patchConsole: false,
      });
      app.unmount();
      await expect(app.waitUntilExit()).resolves.toBeUndefined();
    });

    it('ignores an error of the stream', async () => {
      const test = await renderForTest(Keys);
      expect(() => test.stdin.emit('error', new Error('EIO'))).not.toThrow();
    });
  });

  describe('Ctrl+C (INK-RENDER-07)', () => {
    it('with exitOnCtrlC ends the app and never reaches a handler', async () => {
      const test = await renderForTest(Keys, { exitOnCtrlC: true });
      await test.stdin.press('ctrl+c');
      await expect(test.waitUntilExit()).resolves.toBeUndefined();
      expect(seen).toEqual([]);
    });

    it('with exitOnCtrlC drops the rest of the chunk', async () => {
      const test = await renderForTest(Keys, { exitOnCtrlC: true });
      await test.stdin.write('\x03abc');
      await test.waitUntilExit();
      expect(seen).toEqual([]);
    });

    it('without exitOnCtrlC reaches the handler and the app goes on', async () => {
      const test = await renderForTest(Keys, { exitOnCtrlC: false });
      await test.stdin.press('ctrl+c');
      expect(seen[0]?.input).toBe('c');
      expect(seen[0]?.key.ctrl).toBe(true);
      expect(test.lastFrame()).toBe('keys 1');
    });

    it('defaults to on in renderInk', async () => {
      const stdin = new FakeStdin();
      const app = await renderInk(Keys, {
        stdout: new Sink(),
        stderr: new Sink(),
        stdin: stdin as unknown as NodeJS.ReadableStream,
        patchConsole: false,
      });
      await stdin.press('ctrl+c');
      await expect(app.waitUntilExit()).resolves.toBeUndefined();
      expect(seen).toEqual([]);
    });
  });

  describe('order of a batch (INK-INPUT-03, 10)', () => {
    it('runs change detection between the keys of one chunk', async () => {
      Row.rowsAtKey.length = 0;
      const test = await renderForTest(List);
      await test.stdin.write('\x1b[B\x1b[B\x1b[B');
      expect(Row.rowsAtKey).toEqual([0, 1, 2]);
      expect(test.lastFrame()).toBe('row 3');
    });

    it("shows the right frame after press('down', 'down')", async () => {
      Row.rowsAtKey.length = 0;
      const test = await renderForTest(List);
      await test.stdin.press('down', 'down');
      expect(Row.rowsAtKey).toEqual([0, 1]);
      expect(test.lastFrame()).toBe('row 2');
    });

    it('stops at exit, and the keys left in the batch are dropped', async () => {
      const test = await renderForTest(QuitKey);
      await test.stdin.write('\x1b[A\x1b[B');
      await expect(test.waitUntilExit()).resolves.toBe('done');
      expect(seen).toHaveLength(1);
    });
  });

  describe('without a TTY (Review Focus 4)', () => {
    it('does not throw, warns once and stays inactive', async () => {
      const test = await renderForTest(Keys, { isTty: false });
      await test.stdin.write('a');
      expect(seen).toEqual([]);
      expect(test.stderr.writes.filter((text) => text === NOT_A_TTY)).toHaveLength(1);
      expect(test.stdin.isRaw).toBe(false);
      expect(test.stdin.listenerCount('readable')).toBe(0);
    });

    it('warns once per render, with two handlers', async () => {
      const test = await renderForTest(Two, { isTty: false, inputs: { second: true } });
      expect(test.stderr.writes.filter((text) => text === NOT_A_TTY)).toHaveLength(1);
    });

    it('an inactive handler has nothing to warn about', async () => {
      const test = await renderForTest(AlwaysOff, { isTty: false });
      expect(test.stderr.writes).toEqual([]);
    });

    it('names injectPaste when that is what stays inactive', async () => {
      @Component({
        selector: 'ink-test-only-paste',
        imports: [InkText],
        template: `<ink-text>x</ink-text>`,
      })
      class OnlyPaste {
        constructor() {
          injectPaste(() => undefined);
        }
      }
      const test = await renderForTest(OnlyPaste, { isTty: false });
      expect(test.stderr.writes).toEqual([
        'angular-ink: stdin is not a TTY; injectPaste is inactive\n',
      ]);
      expect(output(test)).not.toContain(PASTE_ON);
    });

    it('reports raw mode as unsupported, and setRawMode does nothing', async () => {
      const test = await renderForTest(StdinProbe, { isTty: false });
      const { terminal } = StdinProbe.last;
      expect(terminal.isRawModeSupported).toBe(false);
      expect(terminal.stdin).toBe(test.stdin);
      expect(() => {
        terminal.setRawMode(true);
      }).not.toThrow();
      expect(test.stdin.isRaw).toBe(false);
    });

    it('a closed stdin is inactive too, and the app ends by itself', async () => {
      const stderr = new Sink();
      const stdin = new Readable({ read: () => undefined });
      stdin.destroy();
      const ttyLike = Object.assign(stdin, { isTTY: true, setRawMode: vi.fn() });
      const app = await renderInk(Keys, {
        stdout: new Sink(),
        stderr,
        stdin: ttyLike,
        patchConsole: false,
      });
      expect(stderr.text).toContain(NOT_A_TTY);
      expect(ttyLike.setRawMode).not.toHaveBeenCalledWith(true);
      const exited = app.waitUntilExit();
      process.emit('beforeExit', 0);
      await expect(exited).resolves.toBeUndefined();
    });

    it('without a handler, a real pipe does not keep the process alive', async () => {
      const module = fileURLToPath(new URL('./raw-mode.ts', import.meta.url));
      const script = `
        import { RawMode } from ${JSON.stringify(module)};
        const stdin = Object.assign(process.stdin, { isTTY: true, setRawMode() {} });
        const raw = new RawMode(stdin, () => {}, () => {});
        raw.acquire();
        raw.release();
      `;
      const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      // The parent keeps its end of the pipe open, as a shell does with a slow producer.
      const code = await new Promise((resolve, reject) => {
        const limit = setTimeout(() => {
          child.kill();
          reject(new Error('the process was kept alive'));
        }, 5000);
        child.on('exit', (exitCode) => {
          clearTimeout(limit);
          resolve(exitCode);
        });
      });
      child.stdin.destroy();
      expect(code).toBe(0);
    }, 10_000);
  });
});

describe('injectPaste', () => {
  it('keeps pastes away from injectInput, and turns bracketed paste on (INK-HOOK-PASTE-02)', async () => {
    const test = await renderForTest(Paste, { isTty: true });
    expect(output(test)).toContain(PASTE_ON);
    await test.stdin.write('\x1b[200~a\nb\x1b[201~');
    expect(pasted).toEqual(['a\nb']);
    expect(seen).toEqual([]);
  });

  it('without injectPaste, the text comes as input (INK-HOOK-PASTE-02)', async () => {
    const test = await renderForTest(Keys, { isTty: true });
    await test.stdin.write('\x1b[200~a\nb\x1b[201~');
    expect(seen.map(({ input: text }) => text)).toEqual(['a\nb']);
    expect(output(test)).not.toContain(PASTE_ON);
  });

  it('an inactive injectPaste sends the text to injectInput', async () => {
    active = signal(false);
    const test = await renderForTest(Paste, { isTty: true });
    expect(output(test)).not.toContain(PASTE_ON);
    await test.stdin.write('\x1b[200~x\x1b[201~');
    expect(pasted).toEqual([]);
    expect(seen.map(({ input: text }) => text)).toEqual(['x']);
  });

  it('turns bracketed paste off with the last handler (INK-TERM-04)', async () => {
    const test = await renderForTest(Paste, { isTty: true });
    active.set(false);
    await test.rerender({});
    expect(output(test)).toContain(PASTE_OFF);
    active.set(true);
    await test.rerender({});
    expect(output(test).lastIndexOf(PASTE_ON)).toBeGreaterThan(output(test).indexOf(PASTE_OFF));
  });

  it('unmount turns bracketed paste off, once', async () => {
    const test = await renderForTest(Paste, { isTty: true });
    test.unmount();
    await test.waitUntilExit();
    expect(output(test).split(PASTE_OFF)).toHaveLength(2);
    expect(test.stdin.isRaw).toBe(false);
  });

  it('never writes the mode to a stdout that is not a terminal', async () => {
    const stdin = new FakeStdin();
    const stdout = Object.assign(new Sink(), { isTTY: false });
    const app = await renderInk(Paste, {
      stdout,
      stderr: new Sink(),
      stdin: stdin as unknown as NodeJS.ReadableStream,
      patchConsole: false,
    });
    await stdin.write('\x1b[200~x\x1b[201~');
    expect(pasted).toEqual(['x']);
    app.unmount();
    await app.waitUntilExit();
    expect(stdout.text).not.toContain('2004');
  });

  it('comes back on a dying process, through the one restore', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const before = process.listeners('SIGTERM');
    const test = await renderForTest(Paste, { isTty: true });
    const listener = process.listeners('SIGTERM').find((item) => !before.includes(item));
    listener?.('SIGTERM');
    expect(test.stdin.isRaw).toBe(false);
    expect(output(test)).toContain(PASTE_OFF);
    expect(exit).toHaveBeenCalled();
  });
});

describe('a paste over the limit', () => {
  it('warns on stderr, once, and hands over what fits', async () => {
    const test = await renderForTest(Paste);
    const big = 'x'.repeat(MAX_PASTE_BYTES + 10);
    await test.stdin.write(`\x1b[200~${big}\x1b[201~`);
    await test.stdin.write(`\x1b[200~${big}\x1b[201~`);
    expect(pasted.map((text) => text.length)).toEqual([MAX_PASTE_BYTES, MAX_PASTE_BYTES]);
    expect(test.stderr.writes.filter((text) => text.includes('paste'))).toHaveLength(1);
  });
});

describe('injectStdin', () => {
  it('counts setRawMode with the handlers (INK-HOOK-STDIN-02)', async () => {
    const test = await renderForTest(StdinProbe);
    const { terminal } = StdinProbe.last;
    expect(terminal.isRawModeSupported).toBe(true);
    expect(terminal.stdin).toBe(test.stdin);
    terminal.setRawMode(true);
    terminal.setRawMode(true);
    expect(test.stdin.isRaw).toBe(true);
    terminal.setRawMode(false);
    expect(test.stdin.isRaw).toBe(true);
    terminal.setRawMode(false);
    await test.rerender({});
    expect(test.stdin.isRaw).toBe(false);
    terminal.setRawMode(false);
    expect(test.stdin.isRaw).toBe(false);
    test.unmount();
    terminal.setRawMode(true);
    expect(test.stdin.isRaw).toBe(false);
    await test.waitUntilExit();
  });
});

describe('renderInkToString', () => {
  it('leaves the input functions with nothing to do', async () => {
    await expect(renderInkToString(AllInputs)).resolves.toBe('inert');
    expect(AllInputs.stdin.isRawModeSupported).toBe(false);
  });
});

describe('outside an app', () => {
  it.each([
    [
      'injectInput',
      () => {
        injectInput(() => undefined);
      },
    ],
    [
      'injectPaste',
      () => {
        injectPaste(() => undefined);
      },
    ],
    ['injectStdin', () => injectStdin()],
  ])('%s needs an injection context', (_name, call) => {
    expect(call).toThrow();
  });
});
