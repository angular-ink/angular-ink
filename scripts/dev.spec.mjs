import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DEV = fileURLToPath(new URL('./dev', import.meta.url));

describe('scripts/dev', () => {
  let bin;

  beforeAll(() => {
    // A docker that prints its arguments, one per line.
    bin = mkdtempSync(join(tmpdir(), 'dev-spec-'));
    writeFileSync(join(bin, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(join(bin, 'docker'), 0o755);
  });

  afterAll(() => {
    rmSync(bin, { recursive: true, force: true });
  });

  function dockerArgs(env) {
    const base = { ...process.env, PATH: `${bin}:${String(process.env.PATH)}` };
    delete base.CI;
    const output = execFileSync('bash', [DEV, 'true'], {
      encoding: 'utf8',
      env: { ...base, ...env },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    return output.split('\n');
  }

  // is-in-ci reads a CI that is set at all as CI, even an empty one.
  it('does not set CI in the container when it is not set here', () => {
    expect(dockerArgs({}).filter((arg) => arg.startsWith('CI'))).toEqual([]);
  });

  it.each(['1', 'false'])('forwards CI=%s by name', (value) => {
    const args = dockerArgs({ CI: value });
    expect(args[args.indexOf('CI') - 1]).toBe('-e');
  });
});
