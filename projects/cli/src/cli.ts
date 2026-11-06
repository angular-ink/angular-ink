#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildCli, type BuildCliOptions } from './build.js';

const USAGE =
  'usage: angular-ink build <entry> --out <file> [--tsconfig <file>] [--sourcemap] [--no-minify]';

function readArgs(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      tsconfig: { type: 'string' },
      sourcemap: { type: 'boolean', default: false },
      'no-minify': { type: 'boolean', default: false },
    },
  });
}

/** Turns the command line into the options of `buildCli`, or throws with the usage. */
export function parseBuildArgs(argv: readonly string[]): BuildCliOptions {
  const usageError = new Error(`angular-ink: ${USAGE}`);
  let args: ReturnType<typeof readArgs>;
  try {
    args = readArgs(argv);
  } catch {
    throw usageError;
  }
  const [command, entry, ...rest] = args.positionals;
  const { out, tsconfig, sourcemap } = args.values;
  if (command !== 'build' || entry === undefined || rest.length > 0 || out === undefined) {
    throw usageError;
  }
  return {
    entry,
    out,
    ...(tsconfig === undefined ? {} : { tsconfig }),
    sourcemap,
    minify: !args.values['no-minify'],
  };
}

/** Runs the command and returns the exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  try {
    const options = parseBuildArgs(argv);
    const { bytes } = await buildCli(options);
    process.stdout.write(`${options.out}: ${String(bytes)} bytes\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1];
// npm runs the command through a symlink.
if (invokedPath !== undefined && realpathSync(invokedPath) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
