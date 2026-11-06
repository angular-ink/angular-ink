import { describe, expect, it } from 'vitest';
import { checkPackFiles, PACKAGES } from './check-pack.mjs';

const core = [
  'LICENSE',
  'README.md',
  'package.json',
  'fesm2022/angular-ink-core.mjs',
  'fesm2022/angular-ink-core.mjs.map',
  'types/angular-ink-core.d.ts',
];
const testing = core.map((path) => path.replace('-core', '-testing'));
const cli = [
  'LICENSE',
  'README.md',
  'package.json',
  'cli.js',
  'cli.d.ts',
  'build.js',
  'build.d.ts',
  'linker-plugin.js',
];

describe('checkPackFiles', () => {
  it('knows the three packages', () => {
    expect(Object.keys(PACKAGES)).toEqual(['core', 'testing', 'cli']);
  });

  it('accepts each package with its files and no test files', () => {
    expect(checkPackFiles('core', core)).toEqual([]);
    expect(checkPackFiles('testing', testing)).toEqual([]);
    expect(checkPackFiles('cli', cli)).toEqual([]);
  });

  it('reports the files a package lacks', () => {
    expect(checkPackFiles('core', ['package.json'])).toEqual([
      'LICENSE is missing',
      'README.md is missing',
      'fesm2022/angular-ink-core.mjs is missing',
      'types/angular-ink-core.d.ts is missing',
    ]);
    expect(
      checkPackFiles(
        'cli',
        cli.filter((path) => path !== 'cli.js'),
      ),
    ).toEqual(['cli.js is missing']);
    // The testing package is not satisfied by the core's files.
    expect(checkPackFiles('testing', core)).toEqual([
      'fesm2022/angular-ink-testing.mjs is missing',
      'types/angular-ink-testing.d.ts is missing',
    ]);
  });

  it('reports specs, benches and test helpers', () => {
    expect(
      checkPackFiles('cli', [
        ...cli,
        'build.spec.js',
        'src/lib/engine/style.spec.ts',
        'lib/engine/layout.bench.js',
        'fesm2022/x.spec.mjs.map',
        'testing/setup.js',
      ]),
    ).toEqual([
      'test file in the package: build.spec.js',
      'test file in the package: src/lib/engine/style.spec.ts',
      'test file in the package: lib/engine/layout.bench.js',
      'test file in the package: fesm2022/x.spec.mjs.map',
      'test file in the package: testing/setup.js',
    ]);
  });

  it('reports a package name it does not know', () => {
    expect(checkPackFiles('site', cli)).toEqual(['no file list for the package "site"']);
  });
});
