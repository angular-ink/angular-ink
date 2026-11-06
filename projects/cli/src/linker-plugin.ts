import { transformAsync, type PluginItem } from '@babel/core';
import { LogLevel, NodeJSFileSystem } from '@angular/compiler-cli';
import { createEs2015LinkerPlugin } from '@angular/compiler-cli/linker/babel';
import type { Plugin } from 'esbuild';
import { readFile } from 'node:fs/promises';

/**
 * Compiles the partial-Ivy declarations of Angular libraries, so the bundle does not need
 * `@angular/compiler` at run time. Files without them load through esbuild, untouched.
 */
export function linkerPlugin(options: {
  sourcemap: boolean;
  onWarning: (message: string) => void;
}): Plugin {
  const report = (...messages: string[]): void => {
    options.onWarning(messages.join(' '));
  };
  // compiler-cli pins its own @babel/core, whose plugin type does not match this one's by name.
  const linker = createEs2015LinkerPlugin({
    fileSystem: new NodeJSFileSystem(),
    logger: {
      level: LogLevel.warn,
      debug: () => undefined,
      info: () => undefined,
      warn: report,
      error: report,
    },
    linkerJitMode: false,
  }) as unknown as PluginItem;
  return {
    name: 'angular-ink-linker',
    setup(build) {
      build.onLoad({ filter: /\.m?js$/ }, async ({ path }) => {
        const code = await readFile(path, 'utf8');
        if (!code.includes('ɵɵngDeclare')) return undefined;
        const linked = await transformAsync(code, {
          filename: path,
          compact: false,
          babelrc: false,
          configFile: false,
          sourceMaps: options.sourcemap ? 'inline' : false,
          plugins: [linker],
        });
        if (typeof linked?.code !== 'string') {
          throw new Error(`angular-ink: the linker returned no code for "${path}"`);
        }
        return { contents: linked.code, loader: 'js' };
      });
    },
  };
}
