import { Component, input } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InkBox, InkStatic, InkText, InkTransform } from '../elements';
import { cleanup, renderForTest } from '../../../../testing/src/public-api';

type LineTransform = (line: string, index: number) => string;

const upper: LineTransform = (line) => line.toUpperCase();
const numbered: LineTransform = (line, index) => `${String(index)} ${line}`;

@Component({
  selector: 'ink-test-transformed',
  imports: [InkText, InkTransform],
  template: `
    <ink-transform [transform]="transform()">
      <ink-text [color]="color()">{{ text() }}</ink-text>
    </ink-transform>
  `,
})
class Transformed {
  readonly transform = input<LineTransform>(upper);
  readonly text = input('hello');
  readonly color = input<string | undefined>(undefined);
}

@Component({
  selector: 'ink-test-bare',
  imports: [InkTransform],
  template: `<ink-transform [transform]="transform">hello</ink-transform>`,
})
class Bare {
  readonly transform = upper;
}

@Component({
  selector: 'ink-test-nested',
  imports: [InkText, InkTransform],
  template: `
    <ink-transform [transform]="outer()">
      <ink-transform [transform]="inner()">
        <ink-text>{{ text() }}</ink-text>
      </ink-transform>
    </ink-transform>
  `,
})
class Nested {
  readonly outer = input<LineTransform>((line) => `[${line}]`);
  readonly inner = input<LineTransform>(upper);
  readonly text = input('hi');
}

@Component({
  selector: 'ink-test-beside',
  imports: [InkBox, InkText, InkTransform],
  template: `
    <ink-box>
      <ink-transform [transform]="grow">
        <ink-text>ab</ink-text>
      </ink-transform>
      <ink-text>cd</ink-text>
    </ink-box>
  `,
})
class Beside {
  readonly grow: LineTransform = (line) => line.toUpperCase();
}

@Component({
  selector: 'ink-test-with-box',
  imports: [InkBox, InkTransform],
  template: `<ink-transform [transform]="transform"><ink-box /></ink-transform>`,
})
class WithBox {
  readonly transform = upper;
}

@Component({
  selector: 'ink-test-permanent',
  imports: [InkStatic, InkText, InkTransform],
  template: `
    <ink-static [items]="['a']">
      <ng-template let-item>
        <ink-transform [transform]="transform">
          <ink-text>{{ item }}</ink-text>
        </ink-transform>
      </ng-template>
    </ink-static>
    <ink-text>live</ink-text>
  `,
})
class Permanent {
  readonly transform = upper;
}

afterEach(() => {
  cleanup();
});

describe('ink-transform', () => {
  it('applies the transform to its ink-text (INK-COMP-08)', async () => {
    const test = await renderForTest(Transformed);
    expect(test.lastFrame()).toBe('HELLO');
  });

  it('takes text with no ink-text in between, as Ink does', async () => {
    const test = await renderForTest(Bare);
    expect(test.lastFrame()).toBe('HELLO');
  });

  it('calls it once per line with the line number (INK-COMP-08)', async () => {
    const test = await renderForTest(Transformed, {
      inputs: { transform: numbered, text: 'one\ntwo' },
    });
    expect(test.lastFrame()).toBe('0 one\n1 two');
  });

  it('calls it on the lines after wrapping (INK-COMP-08)', async () => {
    const test = await renderForTest(Transformed, {
      columns: 5,
      inputs: {
        transform: (line: string, index: number) => `${line}${String(index)}`,
        text: 'aaa bbb',
      },
    });
    expect(test.lastFrame()).toBe('aaa 0\nbbb1');
  });

  it('hands over the line with its ANSI (INK-COMP-10)', async () => {
    const seen: string[] = [];
    const transform: LineTransform = (line) => {
      seen.push(line);
      return line;
    };
    const test = await renderForTest(Transformed, { inputs: { transform, color: 'green' } });
    expect(seen.at(-1)).toContain('\x1b[32m');
    expect(seen.at(-1)).toContain('hello');
    expect(test.lastFrame({ ansi: true })).toBe('\x1b[32mhello\x1b[0m');
  });

  it('keeps the color on every wrapped line it hands over (INK-COMP-10)', async () => {
    const seen: string[] = [];
    const transform: LineTransform = (line) => {
      seen.push(line);
      return line;
    };
    await renderForTest(Transformed, {
      columns: 3,
      inputs: { transform, color: 'green', text: 'aaa bbb' },
    });
    for (const line of seen) expect(line).toContain('\x1b[32m');
  });

  it('accumulates nested transforms from the inside out (INK-COMP-10)', async () => {
    const test = await renderForTest(Nested);
    expect(test.lastFrame()).toBe('[HI]');
  });

  it('runs a nested transform on the lines of its text (INK-COMP-10)', async () => {
    const test = await renderForTest(Nested, {
      inputs: { outer: numbered, inner: numbered, text: 'a\nb' },
    });
    expect(test.lastFrame()).toBe('0 0 a\n1 1 b');
  });

  it('sizes the text before the transform (INK-COMP-10)', async () => {
    const test = await renderForTest(Beside);
    expect(test.lastFrame()).toBe('ABcd');
    const widened = await renderForTest(Transformed, {
      inputs: { transform: (line: string) => `${line}!!`, text: 'ab' },
    });
    expect(widened.lastFrame()).toBe('ab!!');
  });

  it('is not called for empty text', async () => {
    const transform = vi.fn(upper);
    await renderForTest(Transformed, { inputs: { transform, text: '' } });
    expect(transform).not.toHaveBeenCalled();
  });

  it('cannot move the cursor through what it returns', async () => {
    const hostile: LineTransform = (line) => `\x1b[2A\x1b]0;x\x07${line}`;
    const direct = await renderForTest(Transformed, { inputs: { transform: hostile } });
    expect(direct.lastFrame({ ansi: true })).toBe('hello');
    const nested = await renderForTest(Nested, { inputs: { inner: hostile, outer: upper } });
    expect(nested.lastFrame({ ansi: true })).toBe('HI');
  });

  it("can't hold an ink-box, like an ink-text", async () => {
    const test = await renderForTest(WithBox);
    await expect(test.waitUntilExit()).rejects.toThrow("<ink-box> can't be inside <ink-transform>");
  });

  it('works inside ink-static', async () => {
    const test = await renderForTest(Permanent);
    expect(test.lastFrame()).toBe('A\nlive');
  });
});
