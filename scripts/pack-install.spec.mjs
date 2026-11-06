import { describe, expect, it } from 'vitest';
import { angularPackages, parseAngularFlag } from './pack-install.mjs';

describe('parseAngularFlag', () => {
  it('is null without the flag', () => {
    expect(parseAngularFlag([])).toBeNull();
  });

  it('reads the version after --angular', () => {
    expect(parseAngularFlag(['--angular', '22.0.0'])).toBe('22.0.0');
  });

  it('refuses a missing or malformed version', () => {
    expect(() => parseAngularFlag(['--angular'])).toThrow(
      'pack-install: --angular needs a version',
    );
    expect(() => parseAngularFlag(['--angular', 'latest'])).toThrow(
      'pack-install: --angular needs a version',
    );
  });
});

describe('angularPackages', () => {
  it('pins the three Angular packages that must share a version', () => {
    expect(angularPackages('22.0.0')).toEqual([
      '@angular/core@22.0.0',
      '@angular/compiler@22.0.0',
      '@angular/compiler-cli@22.0.0',
    ]);
  });
});
