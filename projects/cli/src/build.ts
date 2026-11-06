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
import { existsSync, rmSync } from 'node:fs';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
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
  /** Warnings of the compiler, the linker and esbuild, for the caller to show. */
  warnings: string[];
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

/**
 * ESM has no `require`, and a bundled CJS dependency calls it. It goes on `globalThis` because
 * esbuild does not read the banner: a top-level `const require` would clash with a bundled module
 * that declares its own, which esbuild leaves unrenamed unless something uses the global.
 */
const BANNER = [
  '#!/usr/bin/env node',
  'import { createRequire as __angularInkCreateRequire } from "node:module";',
  'globalThis.require ??= __angularInkCreateRequire(import.meta.url);',
].join('\n');

// The entry replaces the root files of the tsconfig, so a config that lists none is fine.
const IGNORED_CONFIG_ERRORS = new Set([18002, 18003]);

/** Throws on an error and returns the text of the warnings, if any. */
function checkDiagnostics(diagnostics: readonly ts.Diagnostic[]): string[] {
  const errors = diagnostics.filter(({ category }) => category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) throw new Error(`angular-ink: ${formatDiagnostics(errors)}`);
  return diagnostics.length > 0 ? [formatDiagnostics(diagnostics).trimEnd()] : [];
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
  checkDiagnostics(config.errors.filter(({ code }) => !IGNORED_CONFIG_ERRORS.has(code)));
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

// `baseUrl` is deprecated in TypeScript 6, but a project with `ignoreDeprecations` can still set it.
interface AliasOptions {
  baseUrl?: string;
  paths?: Record<string, string[]>;
  pathsBasePath?: string;
}

/**
 * esbuild resolves the project's aliases again, now from the emitted JS. An alias left as written
 * reaches the original `.ts`, whose decorators would need the JIT compiler at run time. So a target
 * inside `rootDir` points at the emitted file first, with the original as the fallback for what
 * was not compiled, like a vendored `.js`. A target in `node_modules` stays as it is.
 */
function emittedAliases(
  { baseUrl, paths, pathsBasePath }: AliasOptions,
  tsconfig: string,
  rootDir: string,
  outDir: string,
): Record<string, string[]> {
  const base = baseUrl ?? pathsBasePath ?? dirname(tsconfig);
  // A bare import through baseUrl is the alias `*`. The longer aliases win over it in esbuild.
  const aliases = { ...(baseUrl === undefined ? {} : { '*': ['*'] }), ...paths };
  return Object.fromEntries(
    Object.entries(aliases).map(([alias, targets]) => [
      alias,
      targets.flatMap((target) => {
        const original = resolve(base, target);
        const fromRoot = relative(rootDir, original);
        const compiled =
          !fromRoot.startsWith('..') && !fromRoot.split(sep).includes('node_modules');
        return compiled ? [emittedPath(join(outDir, fromRoot)), original] : [original];
      }),
    ]),
  );
}

/** Keeps esbuild from finding a tsconfig above the temporary folder on its own. */
async function esbuildTsconfig(
  options: AliasOptions,
  tsconfig: string | undefined,
  rootDir: string,
  outDir: string,
): Promise<{ tsconfig: string } | { tsconfigRaw: string }> {
  if (tsconfig === undefined || (options.baseUrl === undefined && options.paths === undefined)) {
    return { tsconfigRaw: '{}' };
  }
  const path = join(outDir, 'tsconfig.esbuild.json');
  const paths = emittedAliases(options, tsconfig, rootDir, outDir);
  await writeFile(path, JSON.stringify({ compilerOptions: { paths } }));
  return { tsconfig: path };
}

const SIGNAL_EXIT_CODES: Readonly<Record<string, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
};

/**
 * Removes `folder` if a signal ends the build, and returns how to stop watching. The compiler runs
 * synchronously, so a signal that arrives during it takes effect when it finishes. A process with
 * its own listener decides when it ends.
 */
function removeOnSignal(folder: string): () => void {
  const listeners = Object.entries(SIGNAL_EXIT_CODES).map(([signal, code]) => {
    const listener = (): void => {
      rmSync(folder, { recursive: true, force: true });
      if (process.listenerCount(signal) === 1) process.exit(code);
    };
    process.prependListener(signal, listener);
    return { signal, listener };
  });
  return () => {
    for (const { signal, listener } of listeners) process.off(signal, listener);
  };
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
  const stopWatchingSignals = removeOnSignal(outDir);
  try {
    const projectOptions = config?.options ?? DEFAULT_COMPILER_OPTIONS;
    const { diagnostics } = performCompilation({
      // Ambient declarations of the project still apply, but its other sources stay out.
      rootNames: [entry, ...(config?.rootNames ?? []).filter((name) => name.endsWith('.d.ts'))],
      options: {
        ...projectOptions,
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
    const warnings = checkDiagnostics(diagnostics);

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
      banner: { js: BANNER },
      plugins: [
        linkerPlugin({
          sourcemap,
          onWarning: (message) => {
            warnings.push(message);
          },
        }),
      ],
      ...(await esbuildTsconfig(projectOptions as AliasOptions, tsconfig, rootDir, outDir)),
    }).catch((error: unknown) => {
      throw new Error(`angular-ink: ${error instanceof Error ? error.message : String(error)}`);
    });
    const bundleWarnings = await formatMessages(bundled.warnings, { kind: 'warning' });
    warnings.push(...bundleWarnings.map((warning) => warning.trimEnd()));

    await chmod(out, 0o755);
    const hasCompiler = Object.keys(bundled.metafile.inputs).some((path) =>
      path.includes('@angular/compiler/'),
    );
    return { bytes: (await stat(out)).size, hasCompiler, warnings };
  } finally {
    stopWatchingSignals();
    await rm(outDir, { recursive: true, force: true });
  }
}
