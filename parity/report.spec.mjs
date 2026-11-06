import { describe, expect, it } from 'vitest';
import { expectedDivergences, parityReport, problemsOf } from './report.mjs';

const README = [
  '# Title',
  '- `not-here`: another section',
  '## Expected divergences',
  'Some words.',
  '- `known`: why it differs',
  '- `other`: why that differs',
  '## Next',
  '- `not-here-either`: another section',
].join('\n');

describe('expectedDivergences', () => {
  it('reads only the entries of its section', () => {
    expect([...expectedDivergences(README)]).toEqual([
      ['known', 'why it differs'],
      ['other', 'why that differs'],
    ]);
  });

  it('gives nothing for a README without the section', () => {
    expect(expectedDivergences('# Title').size).toBe(0);
  });
});

describe('problemsOf', () => {
  const same = { name: 'a', difference: null };
  const differs = { name: 'a', difference: 'char at 0,0' };
  const none = new Map();
  const listed = new Map([['a', 'why']]);

  it('has none for a same scenario, or a listed one that differs', () => {
    expect(problemsOf([same], none, ['a'])).toEqual([]);
    expect(problemsOf([{ ...differs, reason: 'why' }], listed, ['a'])).toEqual([]);
  });

  it('fails on a difference that is not listed', () => {
    expect(problemsOf([differs], none, ['a'])).toEqual(['a: differs']);
  });

  it('fails on a listed difference that went away', () => {
    expect(problemsOf([{ ...same, reason: 'why' }], listed, ['a'])).toEqual([
      'a: listed, but same',
    ]);
  });

  it('fails on a listed scenario that crashed, as the list covers only differences', () => {
    const crashed = { ...differs, reason: 'why', failed: true };
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
      { name: 'a', difference: null },
      { name: 'b', difference: 'char at 0,0', reason: 'why' },
    ]);
    expect(summary).toBe('1/2 scenarios identical to Ink 8.0.0');
    expect(text).toContain('**1/2 scenarios');
    expect(text).toContain('| `a` | identical |');
    expect(text).toContain('| `b` | differs: why |');
  });
});
