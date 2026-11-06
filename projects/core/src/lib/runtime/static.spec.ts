import { Component, input } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InkBox, InkStatic, InkText, type InkBoxStyle } from '../elements';
import { renderInk } from './render-ink';
import { cleanup, FakeStderr, FakeStdout, renderForTest } from '../../../../testing/src/public-api';

const SYNC = /\x1b\[\?2026[hl]/g; // eslint-disable-line no-control-regex

@Component({
  selector: 'ink-test-log',
  imports: [InkStatic, InkText],
  template: `
    <ink-static [items]="items()">
      <ng-template let-item let-index="index">
        <ink-text>{{ index }}:{{ item }}</ink-text>
      </ng-template>
    </ink-static>
    <ink-text>{{ live() }}</ink-text>
  `,
})
class Log {
  readonly items = input<readonly string[]>([]);
  readonly live = input('live');
}

@Component({
  selector: 'ink-test-styled',
  imports: [InkStatic, InkText],
  template: `
    <ink-static [items]="items()" [style]="look()">
      <ng-template let-item>
        <ink-text>{{ item }}</ink-text>
      </ng-template>
    </ink-static>
  `,
})
class Styled {
  readonly items = input<readonly string[]>(['a', 'b']);
  readonly look = input<InkBoxStyle | undefined>(undefined);
}

@Component({
  selector: 'ink-test-inherited',
  imports: [InkBox, InkStatic, InkText],
  template: `
    <ink-box backgroundColor="red">
      <ink-static [items]="['a']">
        <ng-template let-item>
          <ink-text>{{ item }}</ink-text>
        </ng-template>
      </ink-static>
    </ink-box>
  `,
})
class Inherited {}

@Component({
  selector: 'ink-test-spaced',
  imports: [InkBox, InkStatic, InkText],
  template: `
    <ink-static [items]="['a']">
      <ng-template let-item>
        <ink-box marginBottom="1">
          <ink-text>{{ item }}</ink-text>
        </ink-box>
      </ng-template>
    </ink-static>
    <ink-text>live</ink-text>
  `,
})
class Spaced {}

@Component({
  selector: 'ink-test-two',
  imports: [InkStatic, InkText],
  template: `
    <ink-static [items]="['first']">
      <ng-template let-item>
        <ink-text>{{ item }}</ink-text>
      </ng-template>
    </ink-static>
    <ink-static [items]="['second']">
      <ng-template let-item>
        <ink-text>{{ item }}</ink-text>
      </ng-template>
    </ink-static>
    <ink-text>live</ink-text>
  `,
})
class Two {}

@Component({
  selector: 'ink-test-hidden',
  imports: [InkBox, InkStatic, InkText],
  template: `
    <ink-box display="none">
      <ink-static [items]="['hidden']">
        <ng-template let-item>
          <ink-text>{{ item }}</ink-text>
        </ng-template>
      </ink-static>
    </ink-box>
    <ink-static [items]="['second']">
      <ng-template let-item>
        <ink-text>{{ item }}</ink-text>
      </ng-template>
    </ink-static>
    <ink-text>live</ink-text>
  `,
})
class Hidden {}

@Component({
  selector: 'ink-test-self-hidden',
  imports: [InkStatic, InkText],
  template: `
    <ink-static [items]="['hidden']" [style]="{ display: 'none' }">
      <ng-template let-item>
        <ink-text>{{ item }}</ink-text>
      </ng-template>
    </ink-static>
    <ink-text>live</ink-text>
  `,
})
class SelfHidden {}

@Component({
  selector: 'ink-test-bad-item',
  imports: [InkStatic],
  template: `
    <ink-static [items]="['a']">
      <ng-template let-item>{{ item }}</ng-template>
    </ink-static>
  `,
})
class BadItem {}

const occurrences = (text: string, part: string): number => text.split(part).length - 1;

function fakeStreams(isTty: boolean): { stdout: FakeStdout; stderr: FakeStderr } {
  return { stdout: new FakeStdout(20, 5, isTty), stderr: new FakeStderr() };
}

const written = (stdout: FakeStdout): string => stdout.writes.join('');

afterEach(() => {
  cleanup();
});

describe('ink-static', () => {
  it('shows new items once above the live frame (INK-COMP-03)', async () => {
    const test = await renderForTest(Log, { inputs: { items: ['a', 'b'] } });
    expect(test.lastFrame()).toBe('0:a\n1:b\nlive');
    await test.rerender({ items: ['a', 'b', 'c'] });
    expect(test.lastFrame()).toBe('0:a\n1:b\n2:c\nlive');
  });

  it('never repaints an item while the live frame changes (INK-COMP-04)', async () => {
    const test = await renderForTest(Log, { inputs: { items: ['a'] } });
    await test.rerender({ live: 'two' });
    await test.rerender({ live: 'three' });
    expect(test.lastFrame()).toBe('0:a\nthree');
    for (const frame of test.frames) expect(occurrences(frame, '0:a')).toBe(1);
  });

  it('ignores a change to an item it has shown (INK-COMP-04)', async () => {
    const test = await renderForTest(Log, { inputs: { items: ['a'] } });
    await test.rerender({ items: ['changed'] });
    expect(test.lastFrame()).toBe('0:a\nlive');
  });

  it('takes no room in the live frame (INK-COMP-04)', async () => {
    const test = await renderForTest(Log, { inputs: { items: ['a'], live: '' } });
    expect(test.lastFrame()).toBe('0:a\n');
  });

  it('stacks items in a column, and its style can change that (INK-COMP-03)', async () => {
    const column = await renderForTest(Styled);
    expect(column.lastFrame()).toBe('a\nb\n');
    const row = await renderForTest(Styled, { inputs: { look: { flexDirection: 'row' } } });
    expect(row.lastFrame()).toBe('ab\n');
    const padded = await renderForTest(Styled, { inputs: { look: { paddingLeft: 2 } } });
    expect(padded.lastFrame()).toBe('  a\n  b\n');
  });

  it('takes the background of its style (INK-COMP-05)', async () => {
    const test = await renderForTest(Styled, {
      inputs: { items: ['a'], look: { backgroundColor: 'blue', width: 3 } },
    });
    expect(test.lastFrame({ ansi: true })).toBe('\x1b[44ma  \x1b[0m\n');
  });

  it('inherits the background of its parent (INK-COMP-05)', async () => {
    const test = await renderForTest(Inherited);
    expect(test.lastFrame({ ansi: true })).toBe('\x1b[41ma\x1b[0m\n');
  });

  it('keeps the blank rows an item asks for', async () => {
    const test = await renderForTest(Spaced);
    expect(test.lastFrame()).toBe('a\n\nlive');
  });

  it('counts only the first one of a tree and warns once (INK-COMP-06)', async () => {
    const test = await renderForTest(Two);
    await test.rerender({});
    expect(test.lastFrame()).toBe('first\nlive');
    const warnings = test.stderr.writes.filter((chunk) => chunk.includes('ink-static'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^angular-ink: /);
  });

  it('does not warn about a single one', async () => {
    const test = await renderForTest(Log, { inputs: { items: ['a'] } });
    expect(test.stderr.writes).toEqual([]);
  });

  it('writes nothing from inside display none, nor from a later one (INK-COMP-06)', async () => {
    const test = await renderForTest(Hidden);
    expect(test.lastFrame()).toBe('live');
  });

  it('writes nothing when it has display none itself (INK-COMP-06)', async () => {
    const test = await renderForTest(SelfHidden);
    expect(test.lastFrame()).toBe('live');
  });

  it('ends the app with the error of an item it cannot lay out', async () => {
    const test = await renderForTest(BadItem);
    await expect(test.waitUntilExit()).rejects.toThrow('must be inside <ink-text>');
  });

  it('does not repeat its output on unmount (INK-COMP-07)', async () => {
    const test = await renderForTest(Log, { inputs: { items: ['a'] } });
    test.unmount();
    await test.waitUntilExit();
    expect(test.lastFrame()).toBe('0:a\nlive');
  });
});

describe('ink-static on a terminal', () => {
  it('writes above the frame and draws the frame again below', async () => {
    const { stdout, stderr } = fakeStreams(true);
    const app = await renderInk(Log, {
      stdout,
      stderr,
      interactive: true,
      patchConsole: false,
      inputs: { items: ['a'] },
    });
    await app.waitUntilRenderFlush();
    const first = written(stdout);
    expect(first.indexOf('0:a')).toBeLessThan(first.indexOf('live'));

    stdout.writes.length = 0;
    app.rerender({ items: ['a', 'b'] });
    await app.waitUntilRenderFlush();
    const second = written(stdout).replace(SYNC, '');
    // Up over the frame, the erase, the item, then the frame again.
    expect(second).toContain('\x1b[1A\r\x1b[J1:b\n\r');
    expect(second.indexOf('1:b')).toBeLessThan(second.indexOf('live'));
    expect(second).not.toContain('0:a');

    stdout.writes.length = 0;
    app.unmount();
    await app.waitUntilExit();
    expect(written(stdout)).not.toContain(':');
  });

  it('is not lost when the frame of its commit is throttled', async () => {
    const { stdout, stderr } = fakeStreams(true);
    const app = await renderInk(Log, {
      stdout,
      stderr,
      interactive: true,
      patchConsole: false,
      maxFps: 1,
      inputs: { items: [], live: 'one' },
    });
    // The first frame opened the one second interval, so the next one is held.
    app.rerender({ items: ['a'], live: 'two' });
    await vi.waitFor(() => {
      expect(written(stdout)).toContain('0:a');
    });
    expect(written(stdout)).not.toContain('two');
    app.unmount();
    await app.waitUntilExit();
    expect(written(stdout)).toContain('two');
    expect(occurrences(written(stdout), '0:a')).toBe(1);
  });

  it('writes at once without a TTY and the frame only at the end (INK-RENDER-15)', async () => {
    const { stdout, stderr } = fakeStreams(false);
    const app = await renderInk(Log, {
      stdout,
      stderr,
      interactive: false,
      patchConsole: false,
      inputs: { items: ['a'] },
    });
    await app.waitUntilRenderFlush();
    expect(written(stdout)).toBe('0:a\n');
    app.rerender({ items: ['a', 'b'], live: 'end' });
    await app.waitUntilRenderFlush();
    expect(written(stdout)).toBe('0:a\n1:b\n');
    app.unmount();
    await app.waitUntilExit();
    expect(written(stdout)).toBe('0:a\n1:b\nend\n');
  });
});
