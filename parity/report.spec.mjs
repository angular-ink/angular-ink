import { describe, expect, it } from 'vitest';
import { expectedDivergences, parityReport, problemsOf } from './report.mjs';

const README = [
  '# Title',
  '- `not-here`: another section',
  '## Expected divergences',
  'Some words.',
  '- `known` (resized: viewport char fg; after the end: scrollback rows): why it differs',
  '## Next',
  '- `not-here-either`: another section',
].join('\n');

describe('expectedDivergences', () => {
  it('reads what each entry of its section permits', () => {
    expect([...expectedDivergences(README)]).toEqual([
      [
        'known',
        {
          permits: [
            'resized: viewport char',
            'resized: viewport fg',
            'after the end: scrollback rows',
          ],
          reason: 'why it differs',
        },
      ],
    ]);
  });

  it('stops at a subsection, whose list has no entries', () => {
    const readme = '## Expected divergences\n### Pending\n- something else';
    expect(expectedDivergences(readme).size).toBe(0);
  });

  it('gives nothing for a README without the section', () => {
    expect(expectedDivergences('# Title').size).toBe(0);
  });

  it('refuses an entry that does not say what it permits', () => {
    expect(() => expectedDivergences('## Expected divergences\n- `known`: why')).toThrow(
      /no moment, scope and field/,
    );
  });
});

describe('problemsOf', () => {
  const char = { moment: 'resized', scope: 'viewport', field: 'char' };
  const rows = { moment: 'after the end', scope: 'scrollback', field: 'rows' };
  const none = new Map();
  const listed = new Map([['a', { permits: ['after the end: scrollback rows'], reason: 'why' }]]);
  const result = (...differences) => ({ name: 'a', differences });

  it('has none for a same scenario, or a listed one that differs as it says', () => {
    expect(problemsOf([result()], none, ['a'])).toEqual([]);
    expect(problemsOf([result(rows)], listed, ['a'])).toEqual([]);
  });

  it('fails on a difference that is not listed', () => {
    expect(problemsOf([result(char)], none, ['a'])).toEqual([
      'a: differs at resized: viewport char',
    ]);
  });

  it('fails on a new difference in a listed scenario', () => {
    expect(problemsOf([result(rows, char)], listed, ['a'])).toEqual([
      'a: differs at resized: viewport char',
    ]);
  });

  it('fails when a scrollback entry also differs on the viewport, at the same moment', () => {
    const viewport = { ...rows, scope: 'viewport', field: 'char' };
    expect(problemsOf([result(rows, viewport)], listed, ['a'])).toEqual([
      'a: differs at after the end: viewport char',
    ]);
  });

  it('fails on a listed difference that went away', () => {
    expect(problemsOf([result()], listed, ['a'])).toEqual([
      'a: listed at after the end: scrollback rows, but same',
    ]);
  });

  it('fails on a listed scenario that crashed, as the list covers only differences', () => {
    const crashed = { ...result(rows), failed: true };
    expect(problemsOf([crashed], listed, ['a'])).toEqual(['a: the run itself failed']);
  });

  it('fails on an entry for a scenario that does not exist', () => {
    expect(problemsOf([], listed, ['b'])).toEqual(['a: listed, but no such scenario']);
  });

  it('leaves alone an entry whose scenario this run skipped', () => {
    expect(problemsOf([], listed, ['a'])).toEqual([]);
  });
});

describe('parityReport', () => {
  it('counts the identical scenarios and gives the reason of a listed one', () => {
    const { summary, text } = parityReport([
      { name: 'a', differences: [] },
      {
        name: 'b',
        differences: [{ moment: 'resized', scope: 'viewport', field: 'char' }],
        reason: 'why',
      },
    ]);
    expect(summary).toBe('1/2 scenarios identical to Ink 8.0.0');
    expect(text).toContain('**1/2 scenarios');
    expect(text).toContain('| `a` | identical |');
    expect(text).toContain('| `b` | differs: why |');
  });
});
