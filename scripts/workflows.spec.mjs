import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const DIRECTORY = '.github/workflows';
const files = readdirSync(DIRECTORY).filter((name) => name.endsWith('.yml'));

describe.each(files)('%s', (name) => {
  const source = readFileSync(`${DIRECTORY}/${name}`, 'utf8');

  it('parses and has jobs with a timeout', () => {
    const { jobs } = parse(source);
    expect(Object.keys(jobs).length).toBeGreaterThan(0);
    for (const [id, job] of Object.entries(jobs)) {
      expect(job['timeout-minutes'], `${id} has timeout-minutes`).toBeTypeOf('number');
    }
  });

  it('uses ${{ }} for expressions, never a single brace that Actions does not evaluate', () => {
    expect(source.match(/\$\{ [^}]*\}(?!\})/g) ?? []).toEqual([]);
  });
});

describe('ci.yml', () => {
  const { jobs } = parse(readFileSync(`${DIRECTORY}/ci.yml`, 'utf8'));

  it('has the required jobs', () => {
    expect(Object.keys(jobs)).toEqual([
      'format',
      'lint',
      'typecheck',
      'test',
      'audit',
      'osv-scanner',
      'startup-budget',
      'build',
      'e2e',
      'parity',
      'pack-install',
    ]);
  });

  it('lets no required job pass while failing', () => {
    for (const [id, job] of Object.entries(jobs)) {
      expect(JSON.stringify(job), `${id} has continue-on-error`).not.toContain('continue-on-error');
    }
  });

  it('tests the CLI floor of Node in pack-install', () => {
    expect(jobs['pack-install'].strategy.matrix['node-version']).toContain('22.18.0');
  });
});
