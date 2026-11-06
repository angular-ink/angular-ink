import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { main, parseBuildArgs } from './cli.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

describe('parseBuildArgs', () => {
  it('reads the entry and --out, with minifying on and the source map off', () => {
    expect(parseBuildArgs(['build', 'src/main.ts', '--out', 'dist/cli.mjs'])).toEqual({
      entry: 'src/main.ts',
      out: 'dist/cli.mjs',
      sourcemap: false,
      minify: true,
    });
  });

  it('reads every flag', () => {
    expect(
      parseBuildArgs([
        'build',
        'main.ts',
        '--out',
        'cli.mjs',
        '--tsconfig',
        'tsconfig.app.json',
        '--sourcemap',
        '--no-minify',
      ]),
    ).toEqual({
      entry: 'main.ts',
      out: 'cli.mjs',
      tsconfig: 'tsconfig.app.json',
      sourcemap: true,
      minify: false,
    });
  });

  it.each([
    ['no command', []],
    ['another command', ['serve', 'main.ts', '--out', 'cli.mjs']],
    ['no entry', ['build', '--out', 'cli.mjs']],
    ['two entries', ['build', 'a.ts', 'b.ts', '--out', 'cli.mjs']],
    ['no --out', ['build', 'main.ts']],
    ['an unknown flag', ['build', 'main.ts', '--out', 'cli.mjs', '--sea']],
  ])('rejects %s with the usage', (_name, argv) => {
    expect(() => parseBuildArgs(argv)).toThrow(/^angular-ink: usage: angular-ink build <entry>/);
  });
});

describe('main', () => {
  it('prints the warnings of a build on stderr', async () => {
    await mkdir(join(REPO, 'out-tsc'), { recursive: true });
    const folder = await mkdtemp(join(REPO, 'out-tsc/cli-main-'));
    try {
      const entry = join(folder, 'main.ts');
      await writeFile(entry, 'export const isZero = (v: number) => v === -0;\n');
      await writeFile(join(folder, 'tsconfig.json'), '{"files":[]}');
      vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      const code = await main([
        'build',
        entry,
        '--out',
        join(folder, 'cli.mjs'),
        '--tsconfig',
        join(folder, 'tsconfig.json'),
      ]);
      expect(code).toBe(0);
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Comparison with -0'));
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }, 120_000);

  it('prints an error on stderr and returns 1', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await expect(main(['build', 'nope.ts', '--out', 'cli.mjs'])).resolves.toBe(1);
    expect(stderr).toHaveBeenCalledWith('angular-ink: cannot find entry "nope.ts"\n');
  });

  it('builds an app without Angular and reports the size', async () => {
    await mkdir(join(REPO, 'out-tsc'), { recursive: true });
    const folder = await mkdtemp(join(REPO, 'out-tsc/cli-main-'));
    try {
      const entry = join(folder, 'main.ts');
      const out = join(folder, 'cli.mjs');
      await writeFile(entry, 'export const answer: number = 42;\n');
      await writeFile(join(folder, 'tsconfig.json'), '{"files":[]}');
      const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      const code = await main([
        'build',
        entry,
        '--out',
        out,
        '--tsconfig',
        join(folder, 'tsconfig.json'),
      ]);
      expect(code).toBe(0);
      const { size } = await stat(out);
      expect(stdout).toHaveBeenCalledWith(`${out}: ${String(size)} bytes\n`);
      expect(await readFile(out, 'utf8')).toMatch(/^#!\/usr\/bin\/env node\n/);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }, 120_000);
});
