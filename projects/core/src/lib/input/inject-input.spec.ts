import { Component, inject, input, PendingTasks, signal, type WritableSignal } from '@angular/core';
import { cleanup, FakeStdin, renderForTest, type InkTestInstance } from '@angular-ink/testing';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { PassThrough, Readable, Writable } from 'node:stream';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InkText } from '../elements';
import { renderInk, type Instance } from '../runtime/render-ink';
import { renderInkToString } from '../runtime/render-to-string';
import { injectApp } from '../runtime/inject';
import { injectFocus } from './inject-focus';
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

@Component({
  selector: 'ink-test-busy',
  imports: [Keys],
  template: `<ink-test-keys />`,
})
class Busy {
  static finish: () => void = () => undefined;

  constructor() {
    Busy.finish = inject(PendingTasks).add();
  }
}

/** One component that notes its name for each key. */
function noter(name: string, order: string[], selector: string): new () => unknown {
  @Component({ selector, imports: [InkText], template: `<ink-text>{{ '' }}</ink-text>` })
  class Noter {
    constructor() {
      injectInput(() => order.push(name));
    }
  }
  return Noter;
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
      interactive: true,
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

    it('with exitOnCtrlC still delivers the keys before it, in order', async () => {
      const test = await renderForTest(Keys, { exitOnCtrlC: true });
      await test.stdin.write('a\x03');
      await test.waitUntilExit();
      expect(seen.map(({ input: text }) => text)).toEqual(['a']);
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
        interactive: true,
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

    it('a handler can unmount the app there and then', async () => {
      const stdin = new FakeStdin();
      let app: Instance | null = null;
      @Component({
        selector: 'ink-test-unmounter',
        imports: [InkText],
        template: `<ink-text>u</ink-text>`,
      })
      class Unmounter {
        constructor() {
          injectInput(() => {
            app?.unmount();
          });
        }
      }
      app = await renderInk(Unmounter, {
        stdout: new Sink(),
        stderr: new Sink(),
        stdin: stdin as unknown as NodeJS.ReadableStream,
        interactive: true,
        patchConsole: false,
      });
      await stdin.write('x');
      await expect(app.waitUntilExit()).resolves.toBeUndefined();
    });

    it('stops at exit, and the keys left in the batch are dropped', async () => {
      const test = await renderForTest(QuitKey);
      await test.stdin.write('\x1b[A\x1b[B');
      await expect(test.waitUntilExit()).resolves.toBe('done');
      expect(seen).toHaveLength(1);
    });
  });

  describe('while a task is pending', () => {
    afterEach(() => {
      Busy.finish();
    });

    it('keys and frames do not wait for it', async () => {
      const test = await renderForTest(Busy);
      await test.stdin.press('up', 'down');
      await test.stdin.write('\x1b[A\x1b[B');
      expect(seen).toHaveLength(4);
      expect(test.lastFrame()).toBe('keys 4');
    });

    it('Ctrl+C still ends the app', async () => {
      const test = await renderForTest(Busy, { exitOnCtrlC: true });
      await test.stdin.press('ctrl+c');
      await expect(test.waitUntilExit()).resolves.toBeUndefined();
    });
  });

  describe('order across components (children first, as React effects run)', () => {
    it('a child gets the key before its parent', async () => {
      const order: string[] = [];
      const Child = noter('child', order, 'ink-test-child');
      @Component({
        selector: 'ink-test-parent',
        imports: [Child],
        template: `<ink-test-child />`,
      })
      class Parent {
        constructor() {
          injectInput(() => order.push('parent'));
        }
      }
      const test = await renderForTest(Parent);
      await test.stdin.write('x');
      expect(order).toEqual(['child', 'parent']);
    });

    it('goes depth first over siblings', async () => {
      const order: string[] = [];
      const LeafA = noter('a', order, 'ink-test-leaf-a');
      const LeafB = noter('b', order, 'ink-test-leaf-b');
      const LeafC = noter('c', order, 'ink-test-leaf-c');
      @Component({
        selector: 'ink-test-branch',
        imports: [LeafA, LeafB],
        template: `<ink-test-leaf-a /><ink-test-leaf-b />`,
      })
      class Branch {
        constructor() {
          injectInput(() => order.push('branch'));
        }
      }
      @Component({
        selector: 'ink-test-root',
        imports: [Branch, LeafC],
        template: `<ink-test-branch /><ink-test-leaf-c />`,
      })
      class Root {
        constructor() {
          injectInput(() => order.push('root'));
        }
      }
      const test = await renderForTest(Root);
      await test.stdin.write('x');
      expect(order).toEqual(['a', 'b', 'branch', 'c', 'root']);
    });

    it('a component mounted later comes after, and so does one turned back on', async () => {
      const order: string[] = [];
      const show = signal(false);
      const again = signal(true);
      const Late = noter('late', order, 'ink-test-late');
      @Component({
        selector: 'ink-test-early',
        imports: [InkText],
        template: `<ink-text>e</ink-text>`,
      })
      class Early {
        constructor() {
          injectInput(() => order.push('early'), { isActive: again });
        }
      }
      @Component({
        selector: 'ink-test-host',
        imports: [Early, Late],
        template: `<ink-test-early />
          @if (show()) {
            <ink-test-late />
          }`,
      })
      class Host {
        readonly show = show;

        constructor() {
          injectInput(() => order.push('host'));
        }
      }
      const test = await renderForTest(Host);
      show.set(true);
      await test.rerender({});
      await test.stdin.write('x');
      expect(order).toEqual(['early', 'host', 'late']);
      order.length = 0;
      again.set(false);
      await test.rerender({});
      again.set(true);
      await test.rerender({});
      await test.stdin.write('x');
      expect(order).toEqual(['host', 'late', 'early']);
    });

    it('keeps the order of two handlers in one component, for keys and for pastes', async () => {
      const order: string[] = [];
      @Component({
        selector: 'ink-test-pair',
        imports: [InkText],
        template: `<ink-text>p</ink-text>`,
      })
      class Pair {
        constructor() {
          injectInput(() => order.push('key 1'));
          injectInput(() => order.push('key 2'));
          injectPaste(() => order.push('paste 1'));
          injectPaste(() => order.push('paste 2'));
        }
      }
      const test = await renderForTest(Pair);
      await test.stdin.write('x');
      await test.stdin.write('\x1b[200~y\x1b[201~');
      expect(order).toEqual(['key 1', 'key 2', 'paste 1', 'paste 2']);
    });
  });

  describe('another component on the same stdout', () => {
    it('takes over the keyboard', async () => {
      const stdin = new FakeStdin();
      const stdout = new Sink();
      const stderr = new Sink();
      const setRawMode = vi.spyOn(stdin, 'setRawMode');
      const options = {
        stdout,
        stderr,
        stdin: stdin as unknown as NodeJS.ReadableStream,
        interactive: true,
        patchConsole: false,
      };
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const first = await renderInk(Keys, options);
      await stdin.write('a');
      await renderInk(QuitKey, options);
      expect(setRawMode).toHaveBeenCalledTimes(1);
      await stdin.write('b');
      await expect(first.waitUntilExit()).resolves.toBe('done');
      expect(seen.map(({ input: text }) => text)).toEqual(['a', 'b']);
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

    it('warns once per render, whichever functions are used', async () => {
      @Component({
        selector: 'ink-test-both',
        imports: [InkText],
        template: `<ink-text>x</ink-text>`,
      })
      class InputAndPaste {
        constructor() {
          injectInput(() => undefined);
          injectPaste(() => undefined);
        }
      }
      const test = await renderForTest(InputAndPaste, { isTty: false });
      expect(test.stderr.writes).toEqual([NOT_A_TTY]);
    });

    it('warns for injectFocus too, once per render', async () => {
      @Component({
        selector: 'ink-test-focus-rows',
        imports: [InkText],
        template: `<ink-text>x</ink-text>`,
      })
      class TwoFocusables {
        readonly first = injectFocus({ autoFocus: true });
        readonly second = injectFocus();
        constructor() {
          injectInput(() => undefined);
        }
      }
      const test = await renderForTest(TwoFocusables, { isTty: false });
      expect(test.stderr.writes).toHaveLength(1);
      expect(test.stderr.writes[0]).toMatch(
        /^angular-ink: stdin is not a TTY; inject\w+ is inactive\n$/,
      );
    });

    it('names injectFocus when it is the only one asking', async () => {
      @Component({
        selector: 'ink-test-focus-only',
        imports: [InkText],
        template: `<ink-text>x</ink-text>`,
      })
      class OneFocusable {
        readonly focus = injectFocus();
      }
      const test = await renderForTest(OneFocusable, { isTty: false });
      expect(test.stderr.writes).toEqual([
        'angular-ink: stdin is not a TTY; injectFocus is inactive\n',
      ]);
      expect(test.stdin.isRaw).toBe(false);
    });

    it('reports raw mode as unsupported, and setRawMode throws, as in Ink 8.0.0', async () => {
      const test = await renderForTest(StdinProbe, { isTty: false });
      const { terminal } = StdinProbe.last;
      expect(terminal.isRawModeSupported).toBe(false);
      expect(terminal.stdin).toBe(test.stdin);
      expect(() => {
        terminal.setRawMode(true);
      }).toThrow(/^angular-ink: raw mode is not supported/);
      expect(() => {
        terminal.setRawMode(false);
      }).toThrow(/^angular-ink: raw mode is not supported/);
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

    it('a whole app on a held-open pipe, with no TTY, ends by itself', async () => {
      const here = dirname(fileURLToPath(import.meta.url));
      // Beside node_modules, so that the bundle finds its packages.
      const folder = await mkdtemp(join(here, '../../../../../node_modules/.cache-ink-no-tty-'));
      const bundle = join(folder, 'app.mjs');
      try {
        await build({
          stdin: {
            contents: `
              import '@angular/compiler';
              import { Component } from '@angular/core';
              import { InkText, injectInput, renderInk } from '../../public-api';

              @Component({
                selector: 'ink-no-tty',
                imports: [InkText],
                template: '<ink-text>frame</ink-text>',
              })
              class App {
                constructor() {
                  injectInput(() => undefined);
                }
              }

              const app = await renderInk(App, { patchConsole: false });
              await app.waitUntilExit();
              process.stdout.write('ended');
            `,
            resolveDir: here,
            loader: 'ts',
          },
          bundle: true,
          format: 'esm',
          platform: 'node',
          packages: 'external',
          outfile: bundle,
          tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
          logLevel: 'silent',
        });
        const child = spawn(process.execPath, [bundle], { stdio: 'pipe' });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (data: Buffer) => (stdout += data.toString()));
        child.stderr.on('data', (data: Buffer) => (stderr += data.toString()));
        // Our end of its stdin stays open, as with a producer that is slow to finish.
        const code = await new Promise((resolve, reject) => {
          const limit = setTimeout(() => {
            child.kill();
            reject(new Error(`the app was kept alive: ${stderr}`));
          }, 15_000);
          child.on('close', (exitCode) => {
            clearTimeout(limit);
            resolve(exitCode);
          });
        });
        child.stdin.destroy();
        expect(stderr).toContain(NOT_A_TTY);
        expect(stdout).toContain('frame');
        expect(stdout).toContain('ended');
        expect(code).toBe(0);
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    }, 30_000);

    it('without a handler, a real pipe does not keep the process alive', async () => {
      // Imports TypeScript straight into Node, which needs its type stripping: on by default from
      // Node 23.6 and 22.18. So raw-mode.ts must stay free of syntax that only compiles.
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
      interactive: true,
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

describe('a non-interactive app with a terminal on stdin', () => {
  @Component({
    selector: 'ink-test-focusable',
    imports: [InkText],
    template: `<ink-text>{{ focus.isFocused() ? 'focused' : 'blurred' }}</ink-text>`,
  })
  class Focusable {
    readonly focus = injectFocus({ autoFocus: true });
  }

  const start = async (component: Parameters<typeof renderInk>[0]) => {
    const stdin = new FakeStdin();
    const stderr = new Sink();
    const app = await renderInk(component, {
      stdout: new Sink(),
      stderr,
      stdin: stdin as unknown as NodeJS.ReadableStream,
      interactive: false,
      patchConsole: false,
    });
    await app.waitUntilRenderFlush();
    return { app, stdin, stderr };
  };

  it('leaves injectInput inactive, with one warning, and ends by itself', async () => {
    const { app, stdin, stderr } = await start(Keys);
    await stdin.write('a');
    expect(seen).toEqual([]);
    expect(stdin.isRaw).toBe(false);
    expect(stdin.listenerCount('readable')).toBe(0);
    expect(stderr.text).toBe('angular-ink: this app is not interactive; injectInput is inactive\n');
    const exited = app.waitUntilExit();
    process.emit('beforeExit', 0);
    await expect(exited).resolves.toBeUndefined();
  });

  it('leaves injectPaste inactive', async () => {
    const { app, stdin } = await start(Paste);
    await stdin.write('\x1b[200~x\x1b[201~');
    expect(pasted).toEqual([]);
    expect(stdin.isRaw).toBe(false);
    app.unmount();
    await app.waitUntilExit();
  });

  it('leaves injectFocus without a key listener', async () => {
    const { app, stdin } = await start(Focusable);
    expect(stdin.isRaw).toBe(false);
    expect(stdin.listenerCount('readable')).toBe(0);
    app.unmount();
    await app.waitUntilExit();
  });

  it('reports raw mode as unsupported', async () => {
    const { app } = await start(StdinProbe);
    const { terminal } = StdinProbe.last;
    expect(terminal.isRawModeSupported).toBe(false);
    expect(() => {
      terminal.setRawMode(true);
    }).toThrow(/^angular-ink: raw mode is not supported/);
    app.unmount();
    await app.waitUntilExit();
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
