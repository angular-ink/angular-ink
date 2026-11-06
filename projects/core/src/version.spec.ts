import { readFileSync } from 'node:fs';
import { Version } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { VERSION } from './public-api';

// Relative to the repository root, where vitest runs.
const versionOf = (name: string): string =>
  (JSON.parse(readFileSync(`projects/${name}/package.json`, 'utf8')) as { version: string })
    .version;

describe('VERSION', () => {
  it('is an Angular Version with the version of projects/core/package.json', () => {
    // Fails when the version was bumped without `npm run changeset:version`, which rewrites it.
    expect(VERSION).toBeInstanceOf(Version);
    expect(VERSION.full).toBe(versionOf('core'));
    const [major, minor, ...patch] = versionOf('core').split('.');
    expect([VERSION.major, VERSION.minor, VERSION.patch]).toEqual([major, minor, patch.join('.')]);
  });

  it('is the version of all three packages, which release together', () => {
    expect(versionOf('testing')).toBe(versionOf('core'));
    expect(versionOf('cli')).toBe(versionOf('core'));
  });
});
