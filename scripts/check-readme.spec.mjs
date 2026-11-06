import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkParityBadge, checkReadme, SYNCED_SECTIONS } from './check-readme.mjs';

const doc = (sections) =>
  `# Title\n\nIntro.\n\n${sections.map(([h, body]) => `## ${h}\n\n${body}\n`).join('\n')}`;

describe('checkReadme', () => {
  it('accepts the repository READMEs', () => {
    const root = readFileSync('README.md', 'utf8');
    for (const [path, prefixes] of Object.entries(SYNCED_SECTIONS)) {
      expect(checkReadme(root, readFileSync(path, 'utf8'), path, prefixes)).toEqual([]);
    }
  });

  it('syncs the usage sections into the core and the CLI READMEs', () => {
    expect(SYNCED_SECTIONS).toEqual({
      'projects/core/README.md': ['Install', 'Example', 'Build', 'v0.1 limits'],
      'projects/cli/README.md': ['Build', 'v0.1 limits'],
    });
  });

  it('reports a missing section and a section whose text differs', () => {
    const root = doc([
      ['Install', 'npm i'],
      ['Example: one', 'code'],
      ['Limits', '- a'],
    ]);
    const copy = doc([
      ['Install', 'npm i'],
      ['Limits', '- b'],
    ]);
    expect(checkReadme(root, copy, 'pkg/README.md', ['Install', 'Example', 'Limits'])).toEqual([
      'pkg/README.md has no "## Example: one" section',
      'pkg/README.md "## Limits" differs from README.md',
    ]);
  });

  it('reports a synced section missing from the root README', () => {
    expect(
      checkReadme(doc([['Install', 'x']]), doc([['Install', 'x']]), 'pkg/README.md', [
        'Install',
        'Example',
      ]),
    ).toEqual(['README.md has no section starting "## Example"']);
  });
});

describe('checkParityBadge', () => {
  const parity = '**18/20 scenarios identical to Ink 8.0.0.** Each scenario runs...';
  const badge = (count) =>
    `[![Parity with Ink 8.0.0](https://img.shields.io/badge/parity%20with%20Ink%208.0.0-${count}%20scenarios-blue)](docs/parity.md)`;
  const prose = (count) => `**${count} of 20 scenarios give the same screen as Ink 8.0.0.**`;

  it('accepts the repository README against docs/parity.md', () => {
    expect(
      checkParityBadge(readFileSync('README.md', 'utf8'), readFileSync('docs/parity.md', 'utf8')),
    ).toEqual([]);
  });

  it('accepts a badge and a sentence with the count of the report', () => {
    expect(checkParityBadge(`${badge('18%2F20')}\n${prose(18)}`, parity)).toEqual([]);
  });

  it('reports a badge and a sentence that disagree with the report', () => {
    expect(checkParityBadge(`${badge('19%2F20')}\n${prose(19)}`, parity)).toEqual([
      'README.md: the parity badge says 19/20, docs/parity.md says 18/20',
      'README.md: the parity sentence says 19 of 20, docs/parity.md says 18/20',
    ]);
  });

  it('reports a README without a badge or a sentence, and a report without a count', () => {
    expect(checkParityBadge('# x', parity)).toEqual([
      'README.md has no parity badge',
      'README.md has no parity sentence',
    ]);
    expect(checkParityBadge('# x', 'nothing')).toEqual(['docs/parity.md has no scenario count']);
  });
});
