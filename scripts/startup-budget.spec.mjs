import { describe, expect, it } from 'vitest';
import { judge, median } from './startup-budget.mjs';

const WITHIN = { medianMs: 70, bytes: 552_000, hasCompiler: false };

describe('judge', () => {
  it('passes a bundle within the budget', () => {
    expect(judge(WITHIN)).toEqual({ ok: true, problems: [] });
  });

  it('accepts exactly 150 ms and 1 MB', () => {
    expect(judge({ ...WITHIN, medianMs: 150, bytes: 1_000_000 }).ok).toBe(true);
  });

  it('fails above 150 ms', () => {
    const { ok, problems } = judge({ ...WITHIN, medianMs: 150.5 });
    expect(ok).toBe(false);
    expect(problems).toEqual(['median startup 150.5 ms is over 150 ms']);
  });

  it('fails above 1 MB', () => {
    const { ok, problems } = judge({ ...WITHIN, bytes: 1_000_001 });
    expect(ok).toBe(false);
    expect(problems).toEqual(['bundle of 1000001 bytes is over 1000000 bytes']);
  });

  it('fails when @angular/compiler is in the bundle', () => {
    const { ok, problems } = judge({ ...WITHIN, hasCompiler: true });
    expect(ok).toBe(false);
    expect(problems).toEqual(['@angular/compiler is in the bundle']);
  });

  it('reports every problem at once', () => {
    expect(judge({ medianMs: 200, bytes: 2_000_000, hasCompiler: true }).problems).toHaveLength(3);
  });
});

describe('median', () => {
  it('takes the middle of an odd count, in any order', () => {
    expect(median([9, 1, 5])).toBe(5);
  });

  it('averages the two middle values of an even count', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
