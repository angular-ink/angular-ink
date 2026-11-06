import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inkIssue, inventoriedInkVersion } from './check-ink-version.mjs';

describe('inventoriedInkVersion', () => {
  it('reads the exact version of the ink devDependency', () => {
    expect(inventoriedInkVersion({ devDependencies: { ink: '8.0.0' } })).toBe('8.0.0');
  });

  it('is the version the repository pins', () => {
    expect(inventoriedInkVersion(JSON.parse(readFileSync('package.json', 'utf8')))).toBe('8.0.0');
  });

  it('refuses a range, since the parity count is for one version', () => {
    expect(() => inventoriedInkVersion({ devDependencies: { ink: '^8.0.0' } })).toThrow(
      'check-ink-version: ink must be pinned to one version, found "^8.0.0"',
    );
    expect(() => inventoriedInkVersion({ devDependencies: {} })).toThrow(
      'check-ink-version: ink must be pinned to one version, found "undefined"',
    );
  });
});

describe('inkIssue', () => {
  it('opens nothing while npm has the inventoried version', () => {
    expect(inkIssue('8.0.0', '8.0.0')).toBeNull();
  });

  it('opens nothing for an older version on npm', () => {
    expect(inkIssue('8.0.0', '7.9.9')).toBeNull();
  });

  it('opens an issue titled with the new version when npm has a newer one', () => {
    const issue = inkIssue('8.0.0', '8.1.0');
    expect(issue?.title).toBe(
      'Ink 8.1.0 is out: add its changes to the inventory and the parity harness',
    );
    expect(issue?.body).toContain('8.0.0');
    expect(issue?.body).toContain('https://github.com/vadimdemedes/ink/releases/tag/v8.1.0');
  });

  it('compares numbers, not strings', () => {
    expect(inkIssue('8.9.0', '8.10.0')).not.toBeNull();
    expect(inkIssue('8.10.0', '8.9.0')).toBeNull();
  });

  it('ignores a prerelease of the version it already has', () => {
    expect(inkIssue('8.0.0', '8.0.0-beta.1')).toBeNull();
  });
});
