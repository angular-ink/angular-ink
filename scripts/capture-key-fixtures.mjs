#!/usr/bin/env node
// Writes e2e/fixtures/keys/<terminal>-<key>.bin: the sequences each terminal documents for a key,
// as they come out of a real pty. The terminals themselves are not run, so GNOME Terminal and
// VS Code are captured by hand (see docs/ENGINEERING.md).
//
//   ./scripts/dev node scripts/capture-key-fixtures.mjs
import pty from '@lydell/node-pty';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const folder = fileURLToPath(new URL('../e2e/fixtures/keys/', import.meta.url));

// Without the kitty protocol, kitty sends the legacy xterm sequences.
const xterm = {
  up: '\x1b[A',
  down: '\x1b[B',
  left: '\x1b[D',
  right: '\x1b[C',
  'app-up': '\x1bOA',
  'app-down': '\x1bOB',
  home: '\x1b[H',
  end: '\x1b[F',
  pageup: '\x1b[5~',
  pagedown: '\x1b[6~',
  insert: '\x1b[2~',
  delete: '\x1b[3~',
  f1: '\x1bOP',
  f5: '\x1b[15~',
  f12: '\x1b[24~',
  return: '\r',
  tab: '\t',
  'shift-tab': '\x1b[Z',
  backspace: '\x7f',
  'ctrl-a': '\x01',
  'ctrl-c': '\x03',
  'ctrl-up': '\x1b[1;5A',
  'shift-up': '\x1b[1;2A',
  'alt-up': '\x1b[1;3A',
  'alt-a': '\x1ba',
  'alt-return': '\x1b\r',
};

const terminals = {
  xterm,
  kitty: xterm,
  // tmux with its default TERM sends the VT220 forms of Home and End.
  tmux: { ...xterm, home: '\x1b[1~', end: '\x1b[4~' },
};

const octal = (text) =>
  [...text].map((char) => `\\${char.charCodeAt(0).toString(8).padStart(3, '0')}`).join('');

function capture(sequence) {
  return new Promise((resolve, reject) => {
    const child = pty.spawn('sh', ['-c', `stty raw -echo; printf '${octal(sequence)}'`], {
      cols: 80,
      rows: 24,
    });
    let output = '';
    child.onData((data) => {
      output += data;
    });
    child.onExit(({ exitCode }) => {
      if (exitCode === 0) resolve(output);
      else reject(new Error(`printf exited with ${String(exitCode)}`));
    });
  });
}

mkdirSync(folder, { recursive: true });
for (const [terminal, keys] of Object.entries(terminals)) {
  for (const [key, sequence] of Object.entries(keys)) {
    const output = await capture(sequence);
    if (output !== sequence) {
      throw new Error(
        `${terminal} ${key}: wrote ${JSON.stringify(sequence)}, read ${JSON.stringify(output)}`,
      );
    }
    writeFileSync(`${folder}${terminal}-${key}.bin`, output, 'latin1');
  }
}
