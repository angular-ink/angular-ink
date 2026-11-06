import {
  formatDiagnostics,
  NodeJSFileSystem,
  performCompilation,
  readConfiguration,
  setFileSystem,
  type CompilerOptions,
  type ParsedConfiguration,
} from '@angular/compiler-cli';
import { build, formatMessages } from 'esbuild';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { linkerPlugin } from './linker-plugin.js';

export interface BuildCliOptions {
  entry: string;
  out: string;
  /** Defaults to `tsconfig.json` in `cwd`, and to an internal strict config without one. */
  tsconfig?: string;
  sourcemap?: boolean;
  /** Defaults to true. */
  minify?: boolean;
  /** Defaults to `process.cwd()`. */
  cwd?: string;
}

export interface BuildCliResult {
  bytes: number;
  hasCompiler: boolean;
}

const DEFAULT_COMPILER_OPTIONS: CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ES2022,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  experimentalDecorators: true,
  useDefineForClassFields: false,
  skipLibCheck: true,
  types: [],
  strictTemplates: true,
};

// The entry replaces the root files of the tsconfig, so a config that lists none is fine.
const IGNORED_CONFIG_ERRORS = new Set([18002, 18003]);

function failWithDiagnostics(diagnostics: readonly ts.Diagnostic[]): void {
  const errors = diagnostics.filter(({ category }) => category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) throw new Error(`angular-ink: ${formatDiagnostics(errors)}`);
  if (diagnostics.length > 0) process.stderr.write(formatDiagnostics(diagnostics));
}

function findTsconfig(cwd: string, given: string | undefined): string | undefined {
  if (given !== undefined) {
    const path = resolve(cwd, given);
    if (!existsSync(path)) throw new Error(`angular-ink: cannot find tsconfig "${given}"`);
    return path;
  }
  const path = join(cwd, 'tsconfig.json');
  return existsSync(path) ? path : undefined;
}

function readProjectConfig(tsconfig: string): ParsedConfiguration {
  const config = readConfiguration(tsconfig);
  failWithDiagnostics(config.errors.filter(({ code }) => !IGNORED_CONFIG_ERRORS.has(code)));
  return config;
}

/** The nearest folder above both, because TypeScript requires every source inside `rootDir`. */
function commonFolder(folder: string, file: string): string {
  let common = folder;
  while (relative(common, file).startsWith('..')) common = dirname(common);
  return common;
}

function emittedPath(sourcePath: string): string {
  return sourcePath.replace(/\.ts$/, '.js').replace(/\.mts$/, '.mjs');
}

/** Compiles a terminal app ahead of time and bundles it into one executable file. */
export async function buildCli(options: BuildCliOptions): Promise<BuildCliResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const entry = resolve(cwd, options.entry);
  const out = resolve(cwd, options.out);
  const sourcemap = options.sourcemap ?? false;
  if (!existsSync(entry)) throw new Error(`angular-ink: cannot find entry "${options.entry}"`);

  setFileSystem(new NodeJSFileSystem());
  const tsconfig = findTsconfig(cwd, options.tsconfig);
  const config = tsconfig === undefined ? undefined : readProjectConfig(tsconfig);
  const rootDir =
    config?.options.rootDir ??
    commonFolder(tsconfig === undefined ? cwd : dirname(tsconfig), entry);

  // Under the cwd, so the emitted files find the same node_modules as their sources.
  const outDir = await mkdtemp(join(cwd, '.angular-ink-build-'));
  try {
    const { diagnostics } = performCompilation({
      // Ambient declarations of the project still apply, but its other sources stay out.
      rootNames: [entry, ...(config?.rootNames ?? []).filter((name) => name.endsWith('.d.ts'))],
      options: {
        ...(config?.options ?? DEFAULT_COMPILER_OPTIONS),
        compilationMode: 'full',
        basePath: rootDir,
        rootDir,
        outDir,
        noEmit: false,
        declaration: false,
        declarationMap: false,
        composite: false,
        incremental: false,
        sourceMap: sourcemap,
        inlineSourceMap: false,
        inlineSources: sourcemap,
      },
    });
    failWithDiagnostics(diagnostics);

    const bundled = await build({
      absWorkingDir: cwd,
      entryPoints: [join(outDir, emittedPath(relative(rootDir, entry)))],
      outfile: out,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      minify: options.minify ?? true,
      sourcemap: sourcemap ? 'linked' : false,
      legalComments: 'none',
      metafile: true,
      logLevel: 'silent',
      define: { ngDevMode: 'false', ngJitMode: 'false', ngI18nClosureMode: 'false' },
      banner: { js: '#!/usr/bin/env node' },
      plugins: [linkerPlugin({ sourcemap })],
      // Without this, esbuild looks for a tsconfig above the temporary folder on its own.
      ...(tsconfig === undefined ? { tsconfigRaw: '{}' } : { tsconfig }),
    }).catch((error: unknown) => {
      throw new Error(`angular-ink: ${error instanceof Error ? error.message : String(error)}`);
    });
    const warnings = await formatMessages(bundled.warnings, { kind: 'warning' });
    if (warnings.length > 0) process.stderr.write(warnings.join(''));

    await chmod(out, 0o755);
    const hasCompiler = Object.keys(bundled.metafile.inputs).some((path) =>
      path.includes('@angular/compiler/'),
    );
    return { bytes: (await stat(out)).size, hasCompiler };
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}
