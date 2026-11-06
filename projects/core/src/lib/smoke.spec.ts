import { describe, expect, it } from 'vitest';
import { VERSION } from '@angular-ink/core';

describe('workspace', () => {
  it('exposes the core version through the package name', () => {
    expect(VERSION.major).toBe('0');
  });
});
