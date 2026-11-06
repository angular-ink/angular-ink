import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadYoga, type Yoga } from 'yoga-layout/load';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CellStyle } from '../engine/ansi';
import { parseColor } from '../engine/color';
import { gridToString, type CellGrid } from '../engine/grid';
import { describeError, paintErrorOverview, parseStackLine } from './error-overview';

let yoga: Yoga;
let dir: string;
let sourcePath: string;

const SOURCE = ['one', 'two', 'three', 'four', '\tfive()', 'six', 'seven', 'eight', 'nine'].join(
  '\n',
);

beforeAll(async () => {
  yoga = await loadYoga();
  dir = mkdtempSync(join(tmpdir(), 'ink-overview-'));
  sourcePath = join(dir, 'app.js');
  writeFileSync(sourcePath, SOURCE);
});

afterAll(() => {
  rmSync(dir, { recursive: true });
});

function errorAt(file: string, line: number, column: number): Error {
  const error = new Error('boom');
  error.stack = `Error: boom\n    at run (${file}:${String(line)}:${String(column)})\n    at node:internal/main:1:2`;
  return error;
}

describe('parseStackLine', () => {
  it.each([
    ['    at run (/a/b.js:3:4)', { fn: 'run', file: '/a/b.js', line: 3, column: 4 }],
    ['    at Foo.bar (/a/b.js:3:4)', { fn: 'Foo.bar', file: '/a/b.js', line: 3, column: 4 }],
    ['    at new Foo (/a/b.js:3:4)', { fn: 'Foo', file: '/a/b.js', line: 3, column: 4 }],
    ['    at async run (/a/b.js:3:4)', { fn: 'run', file: '/a/b.js', line: 3, column: 4 }],
    ['    at /a/b.js:3:4', { fn: '', file: '/a/b.js', line: 3, column: 4 }],
    ['    at file:///a/b.js:3:4', { fn: '', file: 'file:///a/b.js', line: 3, column: 4 }],
    ['    at C:\\a\\b.js:3:4', { fn: '', file: 'C:\\a\\b.js', line: 3, column: 4 }],
  ])('parses %s', (line, frame) => {
    expect(parseStackLine(line)).toEqual(frame);
  });

  it.each([
    'at native',
    'not a frame',
    '    at run (native)',
    '    at run (/a/b.js:x:4)',
    '    at run (/a/b.js:0:0)',
    '',
  ])('leaves %j unparsed', (line) => {
    expect(parseStackLine(line)).toBeNull();
  });

  it('takes linear time on a hostile line', () => {
    const started = performance.now();
    parseStackLine(`    at ${'( '.repeat(200_000)}`);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('describeError', () => {
  it('finds the origin and an excerpt of three lines each way, with tabs as spaces', () => {
    const view = describeError(errorAt(sourcePath, 5, 2), '/nowhere');
    expect(view.message).toBe('boom');
    expect(view.origin).toBe(`${sourcePath}:5:2`);
    expect(view.excerpt?.map((row) => row.line)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(view.excerpt?.find((row) => row.isOrigin)).toMatchObject({ line: 5, value: '  five()' });
    expect(view.gutterWidth).toBe(1);
  });

  it('shows a path inside the working directory relative to it', () => {
    expect(describeError(errorAt(sourcePath, 1, 1), dir).origin).toBe('app.js:1:1');
  });

  it('shows a file URL as a relative path', () => {
    const url = pathToFileURL(sourcePath).href;
    const view = describeError(errorAt(url, 1, 1), dir);
    expect(view.origin).toBe('app.js:1:1');
    expect(view.excerpt).not.toBeNull();
  });

  it('has no excerpt when the file cannot be read or the line is past its end', () => {
    expect(describeError(errorAt('/no/such/file.js', 1, 1), dir).excerpt).toBeNull();
    expect(describeError(errorAt(sourcePath, 999, 1), dir).excerpt).toBeNull();
  });

  it('cuts a very long source line, so the excerpt stays inside the text limit', () => {
    const minified = join(dir, 'min.js');
    writeFileSync(minified, 'x'.repeat(2_000_000));
    const view = describeError(errorAt(minified, 1, 1), dir);
    expect(view.excerpt?.[0]?.value.length).toBeLessThan(1000);
  });

  it('lists the stack, with parsed frames tidied and the others left as they are', () => {
    const error = new Error('boom');
    error.stack = `Error: boom\n    at run (${dir}/app.js:1:2)\n    at ${dir}/app.js:3:4\n    at native`;
    expect(describeError(error, dir).stack).toEqual([
      { name: 'run', place: '(app.js:1:2)' },
      { name: '', place: '(app.js:3:4)' },
      { name: '    at native', place: null },
    ]);
  });

  it('skips every line of a message with many', () => {
    const error = new Error('one\ntwo');
    error.stack = `Error: one\ntwo\n    at run (${sourcePath}:1:1)`;
    expect(describeError(error, '/nowhere').origin).toBe(`${sourcePath}:1:1`);
  });

  it('copes with no stack at all', () => {
    const error = new Error('boom');
    delete error.stack;
    expect(describeError(error, dir)).toMatchObject({
      message: 'boom',
      origin: null,
      excerpt: null,
      stack: [],
    });
  });
});

describe('paintErrorOverview', () => {
  it('paints the label, the message, the location, the excerpt and the stack', () => {
    const text = gridToString(paintErrorOverview(errorAt(sourcePath, 5, 2), 120, yoga), {
      ansi: false,
    });
    expect(text).toContain(' ERROR  boom');
    expect(text).toContain(`${sourcePath}:5:2`);
    expect(text).toContain('5:   five()');
    expect(text).toContain(`- run (${sourcePath}:5:2)`);
  });

  describe('stack rows, as Ink 8.0.0 draws them', () => {
    const stackError = (): Error => {
      const error = new Error('boom');
      error.stack = 'Error: boom\n    at run (/a/b.js:1:2)\n    at /a/c.js:3:4\n    at native';
      return error;
    };

    /** The style of the first cell of `text` on the row that holds it. */
    function styleAt(grid: CellGrid, text: string): CellStyle {
      const rows = gridToString(grid, { ansi: false }).split('\n');
      const y = rows.findIndex((row) => row.includes(text));
      const x = rows[y]?.indexOf(text) ?? -1;
      const style = grid.styles[y * grid.columns + x];
      if (style === undefined) throw new Error(`no cell for ${text}`);
      return style;
    }

    it('have two spaces after the dash of an anonymous frame', () => {
      const text = gridToString(paintErrorOverview(stackError(), 80, yoga), { ansi: false });
      expect(text).toContain('- run (/a/b.js:1:2)');
      expect(text).toContain('-  (/a/c.js:3:4)');
      expect(text).toContain('-     at native');
    });

    it('draw the dash dim, the name dim and bold, and the place dim and gray', () => {
      const grid = paintErrorOverview(stackError(), 80, yoga);
      expect(styleAt(grid, '- run')).toMatchObject({ dim: true, bold: false, fg: null });
      expect(styleAt(grid, 'run (')).toMatchObject({ dim: true, bold: true, fg: null });
      expect(styleAt(grid, '(/a/b.js')).toMatchObject({
        dim: true,
        bold: false,
        fg: parseColor('gray'),
      });
    });

    it('draw an unparsed line dim and bold', () => {
      const grid = paintErrorOverview(stackError(), 80, yoga);
      expect(styleAt(grid, 'at native')).toMatchObject({ dim: true, bold: true });
    });
  });

  it('paints the label white on red, as Ink does', () => {
    const text = gridToString(paintErrorOverview(new Error('boom'), 80, yoga), { ansi: true });
    expect(text).toContain('\x1b[37;41m ERROR ');
  });

  it('cannot be driven by control sequences in the message', () => {
    const grid = paintErrorOverview(new Error('a\x1b[2Jb'), 80, yoga);
    expect(gridToString(grid, { ansi: false })).not.toContain('\x1b');
  });
});
