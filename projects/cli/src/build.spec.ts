import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildCli } from './build.js';
import { linkerPlugin } from './linker-plugin.js';

const exec = promisify(execFile);
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const BUILD_TIMEOUT = 180_000;

const appSource = (template: string): string => `
import { Component } from '@angular/core';
import { InkBox, InkText, renderInk } from '@angular-ink/core';

@Component({
  selector: 'ink-hello',
  imports: [InkBox, InkText],
  template: \`${template}\`,
})
class Hello {
  readonly documentType = typeof (globalThis as Record<string, unknown>)['document'];
}

const app = await renderInk(Hello);
app.unmount();
await app.waitUntilExit();
`;

const HELLO = appSource(
  '<ink-box borderStyle="round" [width]="20"><ink-text>hello {{ documentType }}</ink-text></ink-box>',
);
// Passes only when the strict template checks are off.
const WRONG_INPUT_TYPE = appSource(
  '<ink-box><ink-text [color]="1">hello {{ documentType }}</ink-text></ink-box>',
);

describe('buildCli', () => {
  let fixture: string;
  let caseCount = 0;

  /** A folder of the fixture project, which resolves the packed core from its node_modules. */
  async function makeCase(files: Record<string, string>): Promise<string> {
    const cwd = join(fixture, `case-${String(caseCount++)}`);
    await mkdir(cwd);
    await Promise.all(
      Object.entries(files).map(([name, content]) => writeFile(join(cwd, name), content)),
    );
    return cwd;
  }

  beforeAll(async () => {
    if (!existsSync(join(REPO, 'dist/core/package.json'))) {
      await exec('npm', ['run', 'build:core'], { cwd: REPO });
    }
    // Inside the repo, so everything but the core resolves from the workspace's node_modules.
    await mkdir(join(REPO, 'out-tsc'), { recursive: true });
    fixture = await mkdtemp(join(REPO, 'out-tsc/cli-fixture-'));
    await exec('npm', ['pack', join(REPO, 'dist/core'), '--pack-destination', fixture], {
      cwd: fixture,
    });
    const [tarball] = (await readdir(fixture)).filter((name) => name.endsWith('.tgz'));
    const installed = join(fixture, 'node_modules/@angular-ink/core');
    await mkdir(installed, { recursive: true });
    await exec('tar', ['-xzf', join(fixture, tarball!), '-C', installed, '--strip-components=1']);
    const packed = await readFile(join(installed, 'fesm2022/angular-ink-core.mjs'), 'utf8');
    // The fixture proves the linker only while the library is really partial-Ivy.
    expect(packed).toContain('ɵɵngDeclareComponent');
  }, BUILD_TIMEOUT);

  afterAll(async () => {
    await rm(fixture, { recursive: true, force: true });
  });

  describe('a hello app on the packed core, without a tsconfig', () => {
    let cwd: string;
    let out: string;
    let result: { bytes: number; hasCompiler: boolean };

    beforeAll(async () => {
      cwd = await makeCase({ 'main.ts': HELLO });
      out = join(cwd, 'dist/hello.mjs');
      result = await buildCli({ entry: 'main.ts', out: 'dist/hello.mjs', cwd });
    }, BUILD_TIMEOUT);

    it('writes one executable file that starts with the shebang', async () => {
      const text = await readFile(out, 'utf8');
      expect(text.startsWith('#!/usr/bin/env node\n')).toBe(true);
      expect((await stat(out)).mode & 0o111).toBe(0o111);
      expect(await readdir(join(cwd, 'dist'))).toEqual(['hello.mjs']);
      expect(result.bytes).toBe((await stat(out)).size);
    });

    it('leaves the compiler and the partial declarations out of the bundle', async () => {
      const text = await readFile(out, 'utf8');
      expect(result.hasCompiler).toBe(false);
      expect(text).not.toContain('@angular/compiler/');
      expect(text).not.toContain('ngDeclareComponent');
    });

    it('prints the frame without a TTY and exits with 0, with no document global', async () => {
      const { stdout, stderr } = await exec('node', [out], { cwd, timeout: 30_000 });
      expect(stdout).toBe(
        ['╭──────────────────╮', '│hello undefined   │', '╰──────────────────╯', ''].join('\n'),
      );
      expect(stderr).toBe('');
    });

    it('removes its temporary folder', async () => {
      const left = (await readdir(cwd)).filter((name) => name.startsWith('.angular-ink'));
      expect(left).toEqual([]);
    });
  });

  it(
    'rejects with the compiler message on a template error and cleans up',
    async () => {
      const cwd = await makeCase({
        'main.ts': appSource('<ink-box><ink-text [nope]="1">hello</ink-text></ink-box>'),
      });
      const build = buildCli({ entry: 'main.ts', out: 'cli.mjs', cwd });
      await expect(build).rejects.toThrow(/^angular-ink: [\s\S]*Can't bind to 'nope'/);
      const names = await readdir(cwd);
      expect(names).toEqual(['main.ts']);
    },
    BUILD_TIMEOUT,
  );

  it('rejects when the entry does not exist', async () => {
    const cwd = await makeCase({});
    await expect(buildCli({ entry: 'src/nope.ts', out: 'cli.mjs', cwd })).rejects.toThrow(
      'angular-ink: cannot find entry "src/nope.ts"',
    );
  });

  it('rejects when the given tsconfig does not exist', async () => {
    const cwd = await makeCase({ 'main.ts': HELLO });
    await expect(
      buildCli({ entry: 'main.ts', out: 'cli.mjs', tsconfig: 'nope.json', cwd }),
    ).rejects.toThrow('angular-ink: cannot find tsconfig "nope.json"');
  });

  describe('tsconfig lookup', () => {
    const looseConfig = JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ES2022',
        moduleResolution: 'bundler',
        skipLibCheck: true,
      },
      // A project's own list must not stop the entry from being the only root.
      files: [],
      angularCompilerOptions: { strictTemplates: false },
    });

    it(
      'uses the strict internal default without a tsconfig in the cwd',
      async () => {
        const cwd = await makeCase({ 'main.ts': WRONG_INPUT_TYPE });
        await expect(buildCli({ entry: 'main.ts', out: 'cli.mjs', cwd })).rejects.toThrow(
          /^angular-ink: [\s\S]*not assignable/,
        );
      },
      BUILD_TIMEOUT,
    );

    it(
      'finds tsconfig.json in the cwd',
      async () => {
        const cwd = await makeCase({ 'main.ts': WRONG_INPUT_TYPE, 'tsconfig.json': looseConfig });
        const { hasCompiler } = await buildCli({ entry: 'main.ts', out: 'cli.mjs', cwd });
        expect(hasCompiler).toBe(false);
      },
      BUILD_TIMEOUT,
    );

    it(
      'prefers the given tsconfig',
      async () => {
        const cwd = await makeCase({ 'main.ts': WRONG_INPUT_TYPE, 'loose.json': looseConfig });
        await buildCli({ entry: 'main.ts', out: 'cli.mjs', tsconfig: 'loose.json', cwd });
        expect(existsSync(join(cwd, 'cli.mjs'))).toBe(true);
      },
      BUILD_TIMEOUT,
    );
  });

  it(
    'writes a source map that names the app when asked, and can skip minifying',
    async () => {
      const cwd = await makeCase({ 'main.ts': HELLO });
      const { bytes } = await buildCli({
        entry: 'main.ts',
        out: 'cli.mjs',
        sourcemap: true,
        minify: false,
        cwd,
      });
      const minified = await buildCli({ entry: 'main.ts', out: 'min.mjs', cwd });
      expect(bytes).toBeGreaterThan(minified.bytes);
      const map = JSON.parse(await readFile(join(cwd, 'cli.mjs.map'), 'utf8')) as {
        sources: string[];
      };
      expect(map.sources).toContain('main.ts');
      expect(existsSync(join(cwd, 'min.mjs.map'))).toBe(false);
      const { stdout } = await exec('node', [join(cwd, 'cli.mjs')], { cwd, timeout: 30_000 });
      expect(stdout).toContain('hello undefined');
    },
    BUILD_TIMEOUT,
  );

  it(
    'reports a compiler that ends up in the bundle',
    async () => {
      const cwd = await makeCase({ 'main.ts': `import '@angular/compiler';\n${HELLO}` });
      const { hasCompiler } = await buildCli({ entry: 'main.ts', out: 'cli.mjs', cwd });
      expect(hasCompiler).toBe(true);
    },
    BUILD_TIMEOUT,
  );
});

describe('linkerPlugin', () => {
  type OnLoad = (args: {
    path: string;
  }) => Promise<{ contents?: string; loader?: string } | undefined>;

  function loadHook(): OnLoad {
    let hook: OnLoad | undefined;
    const onLoad = vi.fn((_filter: unknown, callback: OnLoad) => {
      hook = callback;
    });
    void linkerPlugin({ sourcemap: false }).setup({ onLoad } as never);
    return hook!;
  }

  it('leaves a file without partial declarations to esbuild', async () => {
    const folder = await mkdtemp(join(REPO, 'out-tsc/linker-'));
    try {
      const path = join(folder, 'plain.mjs');
      await writeFile(path, 'export const answer = 42;\n');
      await expect(loadHook()({ path })).resolves.toBeUndefined();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('links a file with partial declarations', async () => {
    const folder = await mkdtemp(join(REPO, 'out-tsc/linker-'));
    try {
      const path = join(folder, 'declared.mjs');
      await writeFile(
        path,
        `import * as i0 from '@angular/core';
export class Thing {
  static ɵfac = i0.ɵɵngDeclareFactory({ minVersion: '12.0.0', version: '22.0.0', ngImport: i0, type: Thing, deps: [], target: i0.ɵɵFactoryTarget.Injectable });
}
`,
      );
      const loaded = await loadHook()({ path });
      expect(loaded?.loader).toBe('js');
      expect(loaded?.contents).not.toContain('ɵɵngDeclare');
      expect(loaded?.contents).toContain('Thing');
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
