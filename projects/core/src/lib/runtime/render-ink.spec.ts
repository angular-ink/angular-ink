import {
  Component,
  inject,
  input,
  output,
  signal,
  type OnDestroy,
  type OnInit,
} from '@angular/core';
import xterm from '@xterm/headless';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InkBox, InkText } from '../elements';
import { injectApp, injectStderr, injectStdout, injectWindowSize } from './inject';
import { renderInk, type Instance, type RenderOptions } from './render-ink';

const { Terminal } = xterm;

const SHOW_CURSOR = '\x1b[?25h';
const HIDE_CURSOR = '\x1b[?25l';
const PASTE_OFF = '\x1b[?2004l';

/** A TTY-like stdout. With a terminal size it feeds an emulator, so a test reads the real screen. */
class FakeTerminal extends Writable {
  isTTY = true;
  columns: number;
  rows: number;
  output = '';
  private readonly terminal: InstanceType<typeof Terminal>;

  constructor(columns = 40, rows = 24) {
    super({ decodeStrings: false });
    this.columns = columns;
    this.rows = rows;
    this.terminal = new Terminal({ cols: columns, rows, scrollback: 200, allowProposedApi: true });
  }

  override _write(chunk: string, _encoding: string, done: () => void): void {
    this.output += chunk;
    this.terminal.write(chunk, done);
  }

  /** What the shell printed before the app started. */
  shell(bytes: string): Promise<void> {
    return new Promise((resolve) => {
      this.terminal.write(bytes, resolve);
    });
  }

  resize(columns: number, rows: number): void {
    this.columns = columns;
    this.rows = rows;
    this.terminal.resize(columns, rows);
    this.emit('resize');
  }

  private lines(from: number, to: number): string[] {
    const out: string[] = [];
    for (let y = from; y < to; y++) {
      out.push(this.terminal.buffer.active.getLine(y)?.translateToString(true) ?? '');
    }
    return out;
  }

  viewport(): string[] {
    const { baseY } = this.terminal.buffer.active;
    // Written blanks and never-written cells look the same to a user.
    const out = this.lines(baseY, baseY + this.terminal.rows).map((line) => line.trimEnd());
    while (out.at(-1) === '') out.pop();
    return out;
  }

  scrollback(): string[] {
    return this.lines(0, this.terminal.buffer.active.baseY);
  }

  cursor(): { x: number; y: number } {
    const { cursorX, cursorY } = this.terminal.buffer.active;
    return { x: cursorX, y: cursorY };
  }
}

/** A pipe: no TTY, no size. */
class FakePipe extends Writable {
  output = '';
  override _write(chunk: Buffer, _encoding: string, done: () => void): void {
    this.output += chunk.toString();
    done();
  }
}

@Component({
  selector: 'ink-test-hello',
  imports: [InkText],
  template: `<ink-text>hello {{ name() }}</ink-text>`,
})
class Hello {
  readonly name = input('world');
}

@Component({
  selector: 'ink-test-rows',
  imports: [InkBox, InkText],
  template: `
    <ink-box flexDirection="column">
      @for (row of rows(); track row) {
        <ink-text>row {{ row }}</ink-text>
      }
    </ink-box>
  `,
})
class Rows {
  readonly count = input(1);
  rows(): number[] {
    return Array.from({ length: this.count() }, (_, index) => index);
  }
}

@Component({
  selector: 'ink-test-tools',
  imports: [InkText],
  template: `<ink-text>{{ label() }} {{ size().columns }}x{{ size().rows }}</ink-text>`,
})
class Tools {
  static last: Tools;
  readonly label = signal('tools');
  readonly app = injectApp();
  readonly out = injectStdout();
  readonly err = injectStderr();
  readonly size = injectWindowSize();
  constructor() {
    Tools.last = this;
  }
}

const instances: Instance[] = [];

/** Renders and returns at once: the first frame may still be on its way to the stream. */
async function start(
  component: Parameters<typeof renderInk>[0],
  options: RenderOptions,
): Promise<Instance> {
  const instance = await renderInk(component, {
    interactive: true,
    stderr: new FakePipe(),
    ...options,
  });
  instances.push(instance);
  return instance;
}

/** Renders and waits until the first frame is on the screen. */
async function render(
  component: Parameters<typeof renderInk>[0],
  options: RenderOptions,
): Promise<Instance> {
  const instance = await start(component, options);
  await instance.waitUntilRenderFlush();
  return instance;
}

afterEach(() => {
  for (const instance of instances.splice(0)) instance.cleanup();
});

describe('renderInk', () => {
  describe('first frame', () => {
    it('shows the frame and hides the cursor', async () => {
      const stdout = new FakeTerminal();
      await render(Hello, { stdout });
      expect(stdout.viewport()).toEqual(['hello world']);
      expect(stdout.output.indexOf(HIDE_CURSOR)).toBeGreaterThanOrEqual(0);
      expect(stdout.output.indexOf(HIDE_CURSOR)).toBeLessThan(stdout.output.indexOf('hello'));
    });

    it('passes inputs to the root', async () => {
      const stdout = new FakeTerminal();
      await render(Hello, { stdout, inputs: { name: 'ana' } });
      expect(stdout.viewport()).toEqual(['hello ana']);
    });

    it('takes a stream as the second argument', async () => {
      const stdout = new FakeTerminal();
      vi.stubEnv('CI', 'false');
      const instance = await renderInk(Hello, stdout);
      instances.push(instance);
      await instance.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual(['hello world']);
    });

    it('starts on a fresh line after a partial line, keeping that line', async () => {
      const stdout = new FakeTerminal();
      await stdout.shell('$ prompt');
      await render(Hello, { stdout });
      expect(stdout.viewport()).toEqual(['$ prompt', 'hello world']);
    });

    it('keeps a partial line of one character', async () => {
      const stdout = new FakeTerminal();
      await stdout.shell('$');
      await render(Hello, { stdout });
      expect(stdout.viewport()).toEqual(['$', 'hello world']);
    });

    it('adds no blank line when the cursor is already on a fresh line', async () => {
      const stdout = new FakeTerminal();
      await stdout.shell('$ prompt\r\n');
      await render(Hello, { stdout });
      expect(stdout.viewport()).toEqual(['$ prompt', 'hello world']);
    });

    it('leaves no cells behind from finding the fresh line, so a reflow stays right', async () => {
      const stdout = new FakeTerminal(40, 10);
      const instance = await render(Hello, { stdout });
      stdout.resize(20, 10);
      await instance.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual(['hello world']);
    });
  });

  describe('size', () => {
    it('uses the columns of the stream', async () => {
      const stdout = new FakeTerminal(12);
      await render(Tools, { stdout });
      expect(Tools.last.size()).toEqual({ columns: 12, rows: 24 });
      expect(stdout.viewport()).toEqual(['tools 12x24']);
    });

    it('uses 80x24 with no size on the stream', async () => {
      const stdout = new FakePipe();
      const instance = await render(Tools, { stdout, interactive: false });
      expect(Tools.last.size()).toEqual({ columns: 80, rows: 24 });
      instance.unmount();
      await instance.waitUntilExit();
      expect(stdout.output).toBe('tools 80x24\n');
    });
  });

  describe('unmount', () => {
    it('shows the cursor, leaves the frame and puts the cursor below it', async () => {
      const stdout = new FakeTerminal();
      const instance = await render(Rows, { stdout, inputs: { count: 2 } });
      instance.unmount();
      await instance.waitUntilExit();
      expect(stdout.output.endsWith(PASTE_OFF + SHOW_CURSOR)).toBe(true);
      expect(stdout.viewport()).toEqual(['row 0', 'row 1']);
      expect(stdout.cursor()).toEqual({ x: 0, y: 2 });
    });

    it('draws what changed just before it', async () => {
      const stdout = new FakeTerminal();
      const instance = await render(Tools, { stdout });
      Tools.last.label.set('final');
      instance.unmount();
      await instance.waitUntilExit();
      expect(stdout.viewport()).toEqual(['final 40x24']);
    });

    it('resolves waitUntilExit and is idempotent', async () => {
      const stdout = new FakeTerminal();
      const instance = await render(Hello, { stdout });
      instance.unmount();
      await expect(instance.waitUntilExit()).resolves.toBeUndefined();
      const length = stdout.output.length;
      instance.unmount();
      await expect(instance.waitUntilExit()).resolves.toBeUndefined();
      expect(stdout.output.length).toBe(length);
      expect(stdout.output.split(SHOW_CURSOR)).toHaveLength(2);
    });

    it('runs ngOnDestroy', async () => {
      const destroyed = vi.fn();
      @Component({ selector: 'ink-test-destroy', template: '' })
      class Destroy implements OnDestroy {
        ngOnDestroy(): void {
          destroyed();
        }
      }
      const instance = await render(Destroy, { stdout: new FakeTerminal() });
      instance.unmount();
      expect(destroyed).toHaveBeenCalledTimes(1);
    });

    it('rejects waitUntilExit if ngOnDestroy throws, with the terminal restored', async () => {
      @Component({ selector: 'ink-test-bad-destroy', template: '' })
      class BadDestroy implements OnDestroy {
        ngOnDestroy(): void {
          throw new Error('teardown');
        }
      }
      const stdout = new FakeTerminal();
      const instance = await render(BadDestroy, { stdout });
      instance.unmount();
      await expect(instance.waitUntilExit()).rejects.toThrow('teardown');
      expect(stdout.output).toContain(SHOW_CURSOR);
    });
  });

  describe('exit', () => {
    it('resolves with undefined', async () => {
      const instance = await render(Tools, { stdout: new FakeTerminal() });
      Tools.last.app.exit();
      await expect(instance.waitUntilExit()).resolves.toBeUndefined();
    });

    it('resolves with a value', async () => {
      const instance = await render(Tools, { stdout: new FakeTerminal() });
      Tools.last.app.exit('x');
      await expect(instance.waitUntilExit()).resolves.toBe('x');
    });

    it('rejects with an error and keeps the frame, with no error overview', async () => {
      const stdout = new FakeTerminal();
      const instance = await render(Tools, { stdout });
      const error = new Error('e');
      Tools.last.app.exit(error);
      await expect(instance.waitUntilExit()).rejects.toBe(error);
      expect(stdout.viewport()).toEqual(['tools 40x24']);
    });

    it('keeps the first result', async () => {
      const instance = await render(Tools, { stdout: new FakeTerminal() });
      Tools.last.app.exit('first');
      Tools.last.app.exit('second');
      await expect(instance.waitUntilExit()).resolves.toBe('first');
    });

    it('works from ngOnInit, during the first change detection', async () => {
      @Component({
        selector: 'ink-test-early',
        imports: [InkText],
        template: '<ink-text>e</ink-text>',
      })
      class Early implements OnInit {
        readonly app = injectApp();
        ngOnInit(): void {
          this.app.exit('early');
        }
      }
      const stdout = new FakeTerminal();
      const instance = await render(Early, { stdout });
      await expect(instance.waitUntilExit()).resolves.toBe('early');
      expect(stdout.viewport()).toEqual(['e']);
    });

    it('does not raise an unhandled rejection when nobody waits', async () => {
      const seen = vi.fn();
      process.on('unhandledRejection', seen);
      await render(Tools, { stdout: new FakeTerminal() });
      Tools.last.app.exit(new Error('ignored'));
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      process.off('unhandledRejection', seen);
      expect(seen).not.toHaveBeenCalled();
    });
  });

  describe('one instance per stdout', () => {
    it('reuses the instance and swaps the inputs, with one warning in dev', async () => {
      const warn = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      const stdout = new FakeTerminal();
      const first = await render(Hello, { stdout, inputs: { name: 'one' } });
      const second = await renderInk(Hello, { stdout, inputs: { name: 'two' } });
      await second.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual(['hello two']);
      await renderInk(Hello, { stdout, inputs: { name: 'three' } });
      await first.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual(['hello three']);
      const warnings = warn.mock.calls.filter(([text]) => String(text).startsWith('angular-ink:'));
      expect(warnings).toHaveLength(1);
      expect(String(warnings[0]?.[0])).toContain('same stdout');
      second.unmount();
      await expect(first.waitUntilExit()).resolves.toBeUndefined();
    });

    it('replaces the tree when given another component', async () => {
      vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      const stdout = new FakeTerminal();
      await render(Hello, { stdout });
      const second = await renderInk(Rows, { stdout, inputs: { count: 2 } });
      await second.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual(['row 0', 'row 1']);
    });

    it('starts a new one after an unmount', async () => {
      const warn = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      const stdout = new FakeTerminal();
      const first = await render(Hello, { stdout, inputs: { name: 'one' } });
      first.unmount();
      await first.waitUntilExit();
      await render(Hello, { stdout, inputs: { name: 'two' } });
      expect(stdout.viewport()).toEqual(['hello one', 'hello two']);
      expect(warn).not.toHaveBeenCalled();
    });

    it('keeps two stdouts apart', async () => {
      const left = new FakeTerminal();
      const right = new FakeTerminal();
      await render(Hello, { stdout: left, inputs: { name: 'left' } });
      await render(Hello, { stdout: right, inputs: { name: 'right' } });
      expect(left.viewport()).toEqual(['hello left']);
      expect(right.viewport()).toEqual(['hello right']);
    });
  });

  describe('resize', () => {
    it('clears on a narrower terminal and redraws with no ghosts', async () => {
      const stdout = new FakeTerminal(30, 12);
      await stdout.shell('above\r\n');
      const instance = await render(Tools, { stdout });
      expect(stdout.viewport()).toEqual(['above', 'tools 30x12']);
      stdout.resize(8, 12);
      await instance.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual(['above', 'tools', '8x12']);
      expect(Tools.last.size()).toEqual({ columns: 8, rows: 12 });
    });

    it('draws no frame of the new size with what the app made of the old one', async () => {
      const stdout = new FakeTerminal(30, 12);
      const instance = await render(Tools, { stdout });
      const before = stdout.output.length;
      stdout.resize(20, 12);
      await instance.waitUntilRenderFlush();
      expect(stdout.output.slice(before)).not.toContain('30x12');
      expect(stdout.viewport()).toEqual(['tools 20x12']);
    });

    it('clears a frame of full-width rows, which reflow to the most rows', async () => {
      const stdout = new FakeTerminal(20, 20);
      @Component({
        selector: 'ink-test-wide',
        imports: [InkBox, InkText],
        template: `<ink-box flexDirection="column">
          <ink-text>{{ 'a'.repeat(20) }}</ink-text>
          <ink-text>{{ 'b'.repeat(20) }}</ink-text>
          <ink-text>{{ 'c'.repeat(20) }}</ink-text>
        </ink-box>`,
      })
      class Wide {}
      await stdout.shell('above\r\n');
      const instance = await render(Wide, { stdout });
      stdout.resize(10, 20);
      await instance.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual([
        'above',
        'a'.repeat(10),
        'a'.repeat(10),
        'b'.repeat(10),
        'b'.repeat(10),
        'c'.repeat(10),
        'c'.repeat(10),
      ]);
    });

    it('counts only what a shorter frame left on a row, after it got shorter', async () => {
      const stdout = new FakeTerminal(20, 12);
      await stdout.shell('above\r\n');
      const instance = await render(Hello, { stdout, inputs: { name: 'long name here' } });
      instance.rerender({ name: 'x' });
      await instance.waitUntilRenderFlush();
      stdout.resize(10, 12);
      await instance.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual(['above', 'hello x']);
    });

    it('redraws on a wider terminal and updates the size', async () => {
      const stdout = new FakeTerminal(20, 12);
      const instance = await render(Tools, { stdout });
      stdout.resize(30, 12);
      await instance.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual(['tools 30x12']);
    });

    it('redraws a frame that a shorter terminal cut, keeping the scrollback', async () => {
      const stdout = new FakeTerminal(20, 20);
      const instance = await render(Rows, { stdout, inputs: { count: 10 } });
      stdout.resize(20, 5);
      await instance.waitUntilRenderFlush();
      expect(stdout.viewport().at(-1)).toBe('row 9');
      expect(stdout.viewport().filter((row) => row === 'row 9')).toHaveLength(1);
    });

    it('stops listening after an unmount', async () => {
      const stdout = new FakeTerminal();
      const before = stdout.listenerCount('resize');
      const instance = await render(Hello, { stdout });
      expect(stdout.listenerCount('resize')).toBe(before + 1);
      instance.unmount();
      expect(stdout.listenerCount('resize')).toBe(before);
    });
  });

  describe('text above the frame', () => {
    it('puts injectStdout().write above the frame and keeps the frame', async () => {
      const stdout = new FakeTerminal();
      const instance = await render(Tools, { stdout });
      Tools.last.out.write('x\n');
      await instance.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual(['x', 'tools 40x24']);
      Tools.last.label.set('later');
      await instance.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual(['x', 'later 40x24']);
    });

    it('keeps text with no line end on a line of its own', async () => {
      const stdout = new FakeTerminal();
      const instance = await render(Tools, { stdout });
      Tools.last.out.write('a');
      Tools.last.out.write('b');
      await instance.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual(['a', 'b', 'tools 40x24']);
    });

    it('gives the stream through injectStdout', async () => {
      const stdout = new FakeTerminal();
      await render(Tools, { stdout });
      expect(Tools.last.out.stdout).toBe(stdout);
    });

    it('puts console.log above the frame', async () => {
      const stdout = new FakeTerminal();
      const instance = await render(Tools, { stdout });
      console.log('x');
      await instance.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual(['x', 'tools 40x24']);
    });

    it('sends console.error to stderr and keeps the frame', async () => {
      const stdout = new FakeTerminal();
      const stderr = new FakePipe();
      const instance = await render(Tools, { stdout, stderr });
      console.error('bad');
      await instance.waitUntilRenderFlush();
      expect(stderr.output).toBe('bad\n');
      expect(stdout.viewport()).toEqual(['tools 40x24']);
    });

    it('with patchConsole false leaves the console alone', async () => {
      const { log } = console;
      await render(Tools, { stdout: new FakeTerminal(), patchConsole: false });
      expect(console.log).toBe(log);
    });

    it('restores the console on unmount', async () => {
      const { log } = console;
      const instance = await render(Tools, { stdout: new FakeTerminal() });
      expect(console.log).not.toBe(log);
      instance.unmount();
      expect(console.log).toBe(log);
    });

    it('injectStderr().write goes to stderr and preserves the frame', async () => {
      const stdout = new FakeTerminal();
      const stderr = new FakePipe();
      const instance = await render(Tools, { stdout, stderr });
      Tools.last.err.write('warning\n');
      await instance.waitUntilRenderFlush();
      expect(Tools.last.err.stderr).toBe(stderr);
      expect(stderr.output).toBe('warning\n');
      expect(stdout.viewport()).toEqual(['tools 40x24']);
    });

    it('drops writes after the unmount', async () => {
      const stdout = new FakeTerminal();
      const stderr = new FakePipe();
      const instance = await render(Tools, { stdout, stderr });
      instance.unmount();
      await instance.waitUntilExit();
      const length = stdout.output.length;
      Tools.last.out.write('late');
      Tools.last.err.write('late');
      expect(stdout.output.length).toBe(length);
      expect(stderr.output).toBe('');
    });
  });

  describe('instance', () => {
    it('rerender changes the inputs of the root', async () => {
      const stdout = new FakeTerminal();
      const instance = await render(Hello, { stdout });
      instance.rerender({ name: 'ana' });
      await instance.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual(['hello ana']);
    });

    it('rerender does nothing after an unmount', async () => {
      const stdout = new FakeTerminal();
      const instance = await render(Hello, { stdout });
      instance.unmount();
      instance.rerender({ name: 'ana' });
      await instance.waitUntilExit();
      expect(stdout.viewport()).toEqual(['hello world']);
    });

    it('clear erases the output and keeps what came before', async () => {
      const stdout = new FakeTerminal();
      await stdout.shell('history\r\n');
      const instance = await render(Hello, { stdout });
      instance.clear();
      await instance.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual(['history']);
    });

    it('after clear the next render draws, even if nothing changed', async () => {
      const stdout = new FakeTerminal();
      const instance = await render(Hello, { stdout });
      instance.clear();
      instance.rerender({ name: 'world' });
      await instance.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual(['hello world']);
    });

    it('clear and then unmount leave the terminal clean', async () => {
      const stdout = new FakeTerminal();
      const instance = await render(Hello, { stdout });
      instance.clear();
      instance.unmount();
      await instance.waitUntilExit();
      expect(stdout.viewport()).toEqual([]);
    });

    it('text after clear draws the frame again, as Ink 8.0.0 does', async () => {
      const stdout = new FakeTerminal();
      const instance = await render(Tools, { stdout });
      instance.clear();
      Tools.last.out.write('x\n');
      await instance.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual(['x', 'tools 40x24']);
    });

    it('cleanup unmounts and forgets the stdout', async () => {
      const warn = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      const stdout = new FakeTerminal();
      const instance = await render(Hello, { stdout });
      instance.cleanup();
      await instance.waitUntilExit();
      expect(stdout.output).toContain(SHOW_CURSOR);
      await render(Hello, { stdout });
      expect(warn).not.toHaveBeenCalled();
    });

    it('waitUntilRenderFlush resolves only after the write', async () => {
      const held: (() => void)[] = [];
      const stdout = new FakePipe();
      stdout._write = (_chunk, _encoding, done) => {
        held.push(done);
      };
      const instance = await start(Hello, { stdout });
      let flushed = false;
      const flush = instance.waitUntilRenderFlush().then(() => {
        flushed = true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect(held).toHaveLength(1);
      expect(flushed).toBe(false);
      held.shift()?.();
      await flush;
      expect(flushed).toBe(true);
    });

    it('waitUntilRenderFlush waits for the frame that was held behind a write', async () => {
      const held: (() => void)[] = [];
      const stdout = new FakePipe();
      stdout._write = (_chunk, _encoding, done) => {
        held.push(done);
      };
      const instance = await start(Tools, { stdout, maxFps: 1000 });
      Tools.last.label.set('newest');
      let flushed = false;
      const flush = instance.waitUntilRenderFlush().then(() => {
        flushed = true;
      });
      // The first frame is still being written, and the throttle interval has passed.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(held).toHaveLength(1);
      held.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(held).toHaveLength(1);
      expect(flushed).toBe(false);
      held.shift()?.();
      await flush;
      expect(flushed).toBe(true);
    });

    it('injectApp().waitUntilRenderFlush includes the pending frame', async () => {
      const stdout = new FakeTerminal();
      await render(Tools, { stdout, maxFps: 1 });
      Tools.last.label.set('flushed');
      await Tools.last.app.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual(['flushed 40x24']);
    });

    it('waitUntilRenderFlush settles after an exit, even a failed one', async () => {
      const instance = await render(Tools, { stdout: new FakeTerminal() });
      Tools.last.app.exit(new Error('e'));
      await expect(instance.waitUntilRenderFlush()).resolves.toBeUndefined();
    });

    it('holds frames by maxFps', async () => {
      const stdout = new FakeTerminal();
      await render(Tools, { stdout, maxFps: 1 });
      Tools.last.label.set('held');
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(stdout.viewport()).toEqual(['tools 40x24']);
    });

    it('ends when the event loop empties while waiting for the exit', async () => {
      const instance = await render(Hello, { stdout: new FakeTerminal() });
      const once = vi.spyOn(process, 'once');
      const waiting = instance.waitUntilExit();
      const call = once.mock.calls.find(([event]) => event === 'beforeExit');
      expect(call).toBeDefined();
      (call![1] as () => void)();
      await expect(waiting).resolves.toBeUndefined();
    });
  });

  describe('errors', () => {
    const fixtureError = (): Error => {
      const error = new Error('it broke');
      error.stack = `Error: it broke\n    at boom (${import.meta.filename}:3:7)`;
      return error;
    };

    function expectOverview(stdout: FakeTerminal): void {
      const text = stdout.viewport().join('\n');
      expect(text).toContain(' ERROR  it broke');
      expect(text).toContain('render-ink.spec.ts:3:7');
      // The excerpt shows line 3 of this file, and the lines around it.
      expect(text).toMatch(/^ *3: /m);
      expect(stdout.output).toContain(SHOW_CURSOR);
    }

    it('shows the overview for a template error and rejects', async () => {
      @Component({
        selector: 'ink-test-template-error',
        imports: [InkText],
        template: `<ink-text>{{ read() }}</ink-text>`,
      })
      class TemplateError {
        readonly fail = input(false);
        read(): string {
          if (this.fail()) throw fixtureError();
          return 'fine';
        }
      }
      const stdout = new FakeTerminal(120, 40);
      const instance = await render(TemplateError, { stdout });
      expect(stdout.viewport()).toEqual(['fine']);
      instance.rerender({ fail: true });
      await expect(instance.waitUntilExit()).rejects.toThrow('it broke');
      expectOverview(stdout);
      expect(stdout.viewport()).not.toContain('fine');
    });

    it('shows the overview for an error in the first render, and renderInk still resolves', async () => {
      @Component({ selector: 'ink-test-first-error', template: '' })
      class FirstError {
        constructor() {
          throw fixtureError();
        }
      }
      const stdout = new FakeTerminal(120, 40);
      const instance = await render(FirstError, { stdout });
      await expect(instance.waitUntilExit()).rejects.toThrow('it broke');
      expectOverview(stdout);
    });

    it('shows the overview for an error in a handler', async () => {
      @Component({ selector: 'ink-test-handler-error', template: '' })
      class HandlerError {
        static ping: () => void;
        readonly ping = output();
        constructor() {
          this.ping.subscribe(() => {
            throw fixtureError();
          });
          HandlerError.ping = () => {
            this.ping.emit();
          };
        }
      }
      const stdout = new FakeTerminal(120, 40);
      const instance = await render(HandlerError, { stdout });
      HandlerError.ping();
      await expect(instance.waitUntilExit()).rejects.toThrow('it broke');
      expectOverview(stdout);
    });

    it('turns a thrown value that is not an Error into one', async () => {
      @Component({ selector: 'ink-test-not-error', template: '' })
      class NotError {
        constructor() {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'plain text';
        }
      }
      const stdout = new FakeTerminal(80, 40);
      const instance = await render(NotError, { stdout });
      const failure: unknown = await instance.waitUntilExit().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe('plain text');
      expect(stdout.viewport().join('\n')).toContain(' ERROR  plain text');
    });

    it('shows the overview for a tree the engine rejects', async () => {
      @Component({ selector: 'ink-test-bad-tree', template: 'loose text' })
      class BadTree {}
      const stdout = new FakeTerminal(120, 40);
      const instance = await render(BadTree, { stdout });
      await expect(instance.waitUntilExit()).rejects.toThrow(/^angular-ink: text "loose text"/);
      expect(stdout.viewport().join('\n')).toContain(' ERROR  angular-ink: text');
    });

    it('never draws the broken tree of a failed change detection', async () => {
      @Component({
        selector: 'ink-test-half',
        imports: [InkText],
        template: `<ink-text>first {{ value() }}</ink-text
          ><ink-text>{{ read() }}</ink-text>`,
      })
      class Half {
        readonly value = input('old');
        read(): string {
          if (this.value() === 'new') throw fixtureError();
          return '';
        }
      }
      const stdout = new FakeTerminal(120, 40);
      const instance = await render(Half, { stdout });
      instance.rerender({ value: 'new' });
      await expect(instance.waitUntilExit()).rejects.toThrow('it broke');
      expect(stdout.output).not.toContain('first new');
    });
  });

  describe('terminal restoration when the process dies', () => {
    const EVENTS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'uncaughtException', 'unhandledRejection'];

    function newListeners(event: string, before: readonly unknown[]): ((arg?: unknown) => void)[] {
      const target = process as unknown as { listeners(name: string): ((arg?: unknown) => void)[] };
      return target.listeners(event).filter((listener) => !before.includes(listener));
    }

    it.each([
      ['SIGINT', 130],
      ['SIGTERM', 143],
      ['SIGHUP', 129],
    ])('on %s shows the cursor, turns raw mode and paste off and exits %i', async (event, code) => {
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      const before = process.listeners(event as NodeJS.Signals);
      const setRawMode = vi.fn();
      const stdin = Object.assign(new FakePipe(), { isTTY: true, setRawMode });
      const stdout = new FakeTerminal();
      await render(Hello, { stdout, stdin: stdin as unknown as NodeJS.ReadableStream });
      newListeners(event, before)[0]?.();
      await vi.waitFor(() => {
        expect(stdout.output).toContain(SHOW_CURSOR);
      });
      expect(stdout.output).toContain(PASTE_OFF);
      expect(setRawMode).toHaveBeenCalledWith(false);
      expect(exit).toHaveBeenCalledWith(code);
    });

    it('removes its listeners on unmount', async () => {
      const count = (event: string): number =>
        (process as unknown as { listenerCount(name: string): number }).listenerCount(event);
      const before = [...EVENTS, 'exit'].map(count);
      const instance = await render(Hello, { stdout: new FakeTerminal() });
      expect([...EVENTS, 'exit'].map(count)).toEqual(before.map((value) => value + 1));
      instance.unmount();
      expect([...EVENTS, 'exit'].map(count)).toEqual(before);
    });

    it('prints the last frame in non-interactive mode, since the unmount never comes', async () => {
      const before = process.listeners('exit');
      const stdout = new FakePipe();
      await render(Hello, { stdout, interactive: false });
      newListeners('exit', before)[0]?.();
      await vi.waitFor(() => {
        expect(stdout.output).toBe('hello world\n');
      });
    });
  });

  describe('a closed stdout', () => {
    const epipe = (): Error =>
      Object.assign(new Error('write EPIPE'), { code: 'EPIPE', syscall: 'write' });

    it('ends the instance when a write fails, with no throw', async () => {
      const stdout = new FakeTerminal();
      const instance = await render(Tools, { stdout });
      stdout._write = (_chunk, _encoding, done) => {
        (done as (error: Error) => void)(epipe());
      };
      Tools.last.label.set('next');
      await expect(instance.waitUntilExit()).resolves.toBeUndefined();
      Tools.last.out.write('after');
      instance.unmount();
    });

    it('ends the instance when a write throws', async () => {
      const stdout = new FakeTerminal();
      const instance = await render(Tools, { stdout });
      stdout.write = (() => {
        throw epipe();
      }) as typeof stdout.write;
      Tools.last.label.set('next');
      await expect(instance.waitUntilExit()).resolves.toBeUndefined();
    });

    it('ends the instance when the very first write fails', async () => {
      const stdout = new FakeTerminal();
      stdout._write = (_chunk, _encoding, done) => {
        (done as (error: Error) => void)(epipe());
      };
      const instance = await start(Hello, { stdout });
      await expect(instance.waitUntilExit()).resolves.toBeUndefined();
    });

    it('survives an error on stderr too', async () => {
      const stderr = new FakePipe();
      stderr._write = (_chunk, _encoding, done) => {
        (done as (error: Error) => void)(epipe());
      };
      const stdout = new FakeTerminal();
      const instance = await render(Tools, { stdout, stderr });
      Tools.last.err.write('x\n');
      await new Promise((resolve) => setImmediate(resolve));
      await instance.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual(['tools 40x24']);
    });

    it('waits for a pending drain before the next frame and draws only the newest', async () => {
      class Slow extends FakeTerminal {
        readonly chunks: string[] = [];
        readonly blocked: (() => void)[] = [];
        override _write(chunk: string, encoding: string, done: () => void): void {
          this.chunks.push(chunk);
          this.blocked.push(() => {
            super._write(chunk, encoding, done);
          });
        }
      }
      const stdout = new Slow();
      const instance = await start(Tools, { stdout });
      // Everything so far got through, and the next write has the stream's full attention.
      while (stdout.blocked.length > 0) {
        stdout.blocked.shift()?.();
        await new Promise((resolve) => setImmediate(resolve));
      }
      stdout.chunks.length = 0;

      Tools.last.label.set('aaaaa');
      await vi.waitFor(() => {
        expect(stdout.chunks).toHaveLength(1);
      });
      Tools.last.label.set('bbbbb');
      await new Promise((resolve) => setTimeout(resolve, 60));
      Tools.last.label.set('ccccc');
      await new Promise((resolve) => setTimeout(resolve, 60));
      // Nothing more was sent while the first write is going.
      expect(stdout.chunks).toHaveLength(1);

      const flush = instance.waitUntilRenderFlush();
      await vi.waitFor(async () => {
        stdout.blocked.shift()?.();
        await new Promise((resolve) => setImmediate(resolve));
        expect(stdout.viewport()).toEqual(['ccccc 40x24']);
      });
      stdout.blocked.shift()?.();
      await flush;
      expect(stdout.chunks.join('')).not.toContain('bbbbb');
    });
  });

  describe('a frame taller than the screen', () => {
    it('going from 24 to 40 rows and back to 3 leaves the right screen', async () => {
      const stdout = new FakeTerminal(40, 24);
      await stdout.shell('above\r\n');
      const instance = await render(Rows, { stdout, inputs: { count: 24 } });
      expect(stdout.viewport().at(-1)).toBe('row 23');

      instance.rerender({ count: 40 });
      await instance.waitUntilRenderFlush();
      const tall = stdout.viewport();
      expect(tall.at(-1)).toBe('row 39');
      expect(new Set(tall).size).toBe(tall.length);

      const history = stdout.scrollback();
      instance.rerender({ count: 3 });
      await instance.waitUntilRenderFlush();
      expect(stdout.viewport()).toEqual(['row 0', 'row 1', 'row 2']);
      // What had scrolled off stays there.
      expect(stdout.scrollback().slice(0, history.length)).toEqual(history);
      expect(stdout.scrollback()).toContain('above');
      expect(stdout.cursor()).toEqual({ x: 0, y: 3 });
    });
  });

  describe('non-interactive mode', () => {
    function expectLastFrameOnly(stdout: FakeTerminal | FakePipe): void {
      expect(stdout.output).toBe('hello two\n');
    }

    it('with no TTY writes only the last frame, on unmount, with no cursor codes', async () => {
      const stdout = new FakePipe();
      const instance = await renderInk(Hello, { stdout, inputs: { name: 'one' } });
      instances.push(instance);
      instance.rerender({ name: 'two' });
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toBe('');
      instance.unmount();
      await instance.waitUntilExit();
      expectLastFrameOnly(stdout);
    });

    it('with CI=true does the same on a TTY', async () => {
      vi.stubEnv('CI', 'true');
      const stdout = new FakeTerminal();
      const instance = await renderInk(Hello, { stdout, inputs: { name: 'two' } });
      instances.push(instance);
      instance.unmount();
      await instance.waitUntilExit();
      expectLastFrameOnly(stdout);
    });

    it.each(['false', '0'])('with CI=%s is interactive on a TTY', async (value) => {
      vi.stubEnv('CI', value);
      const stdout = new FakeTerminal();
      const instance = await renderInk(Hello, { stdout });
      instances.push(instance);
      expect(stdout.output).toContain(HIDE_CURSOR);
    });

    it('lets the interactive option win over CI', async () => {
      vi.stubEnv('CI', 'true');
      const stdout = new FakeTerminal();
      await render(Hello, { stdout, interactive: true });
      expect(stdout.output).toContain(HIDE_CURSOR);
    });

    it('lets the interactive option win over a TTY', async () => {
      vi.stubEnv('CI', 'false');
      const stdout = new FakeTerminal();
      const instance = await render(Hello, { stdout, interactive: false, inputs: { name: 'two' } });
      expect(stdout.output).toBe('');
      instance.unmount();
      await instance.waitUntilExit();
      expectLastFrameOnly(stdout);
    });

    it('writes outside text straight through', async () => {
      const stdout = new FakePipe();
      const stderr = new FakePipe();
      const instance = await render(Tools, { stdout, stderr, interactive: false });
      Tools.last.out.write('x');
      Tools.last.err.write('y');
      console.log('z');
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toBe('xz\n');
      expect(stderr.output).toBe('y');
    });

    it('does not listen for resize', async () => {
      const stdout = new FakeTerminal();
      const before = stdout.listenerCount('resize');
      await render(Hello, { stdout, interactive: false });
      expect(stdout.listenerCount('resize')).toBe(before);
    });

    it('forced interactive on a pipe writes no cursor codes, as Ink does', async () => {
      const stdout = new FakePipe();
      const instance = await render(Hello, { stdout, interactive: true });
      instance.unmount();
      await instance.waitUntilExit();
      expect(stdout.output).not.toContain(HIDE_CURSOR);
      expect(stdout.output).not.toContain(SHOW_CURSOR);
      expect(stdout.output).toContain('world');
    });

    it('with color off writes plain text', async () => {
      vi.stubEnv('NO_COLOR', '1');
      vi.stubEnv('FORCE_COLOR', undefined);
      @Component({
        selector: 'ink-test-colored',
        imports: [InkText],
        template: `<ink-text color="red">red</ink-text>`,
      })
      class Colored {}
      const stdout = new FakePipe();
      const instance = await render(Colored, { stdout, interactive: false });
      instance.unmount();
      await instance.waitUntilExit();
      expect(stdout.output).toBe('red\n');
    });

    it('prints the overview as the last frame', async () => {
      @Component({ selector: 'ink-test-pipe-error', template: '' })
      class PipeError {
        constructor() {
          throw new Error('piped');
        }
      }
      const stdout = new FakePipe();
      const instance = await render(PipeError, { stdout, interactive: false });
      await expect(instance.waitUntilExit()).rejects.toThrow('piped');
      expect(stdout.output).toContain(' ERROR  piped');
    });
  });

  describe('frame sink', () => {
    it('gets the grids and the terminal gets no frame bytes', async () => {
      const stdout = new FakeTerminal();
      const sink = vi.fn();
      const instance = await render(Hello, { stdout, ɵframeSink: sink });
      expect(sink).toHaveBeenCalledTimes(1);
      instance.rerender({ name: 'ana' });
      await instance.waitUntilRenderFlush();
      instance.unmount();
      await instance.waitUntilExit();
      expect(sink.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(stdout.output).toBe('');
    });
  });

  it('gives providers to the app', async () => {
    @Component({
      selector: 'ink-test-provided',
      imports: [InkText],
      template: `<ink-text>{{ value }}</ink-text>`,
    })
    class Provided {
      readonly value = inject<string>('VALUE' as never);
    }
    const stdout = new FakeTerminal();
    await render(Provided, {
      stdout,
      providers: [{ provide: 'VALUE', useValue: 'from provider' }],
    });
    expect(stdout.viewport()).toEqual(['from provider']);
  });
});

describe('public API', () => {
  it('exports the runtime, the elements and the private exports for testing', async () => {
    const api = await import('../../public-api');
    expect(Object.keys(api).sort()).toEqual(
      [
        'INK_ELEMENTS',
        'InkBox',
        'InkFocus',
        'InkNewline',
        'InkSpacer',
        'InkStatic',
        'InkText',
        'InkTransform',
        'VERSION',
        'injectApp',
        'injectFocus',
        'injectFocusManager',
        'injectInput',
        'injectPaste',
        'injectStdin',
        'injectStderr',
        'injectStdout',
        'injectWindowSize',
        'renderInk',
        'renderInkToString',
        'ɵgridToString',
      ].sort(),
    );
  });
});

describe('renderInk when the process ends with the app still running', () => {
  it('draws the last frame on the way out, as an unmount would', async () => {
    const on = vi.spyOn(process, 'on');
    const stdout = new FakeTerminal(10, 3);
    const stdin = new PassThrough();
    @Component({
      imports: [InkText],
      template: `<ink-text>a{{ '\\n' }}b{{ '\\n' }}c</ink-text>`,
    })
    class Filling {}
    const app = await renderInk(Filling, { stdout, stdin, interactive: true, patchConsole: false });
    await app.waitUntilRenderFlush();
    const before = stdout.output.length;
    const onExit = on.mock.calls.find(([event]) => event === 'exit')?.[1] as () => void;
    onExit();
    await new Promise((resolve) => {
      stdout.write('', resolve);
    });
    expect(stdout.output.slice(before)).toContain('\x1b[1;1H\x1b[J');
    expect(stdout.output.endsWith('\x1b[?25h')).toBe(true);
    app.unmount();
  });
});
