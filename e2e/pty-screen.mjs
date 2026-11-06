// Runs a command in a real pty and keeps the screen a terminal would show for its output.
import pty from '@lydell/node-pty';
import xterm from '@xterm/headless';
import { readdirSync, readFileSync } from 'node:fs';

const COLUMNS = 80;
const ROWS = 24;
const WAIT_MS = 10_000;
const DEFAULT_LIMIT_MS = 30_000;

/** What a wrapped command prints when the app ended, with the exit code after it. */
export const DONE_MARKER = '__E2E_DONE__';

/** Without this the apps would see the container's `CI`, and stop drawing in place. */
function terminalEnv(extra) {
  const inherited = Object.entries(process.env).filter(
    ([name]) => name !== 'CI' && name !== 'CONTINUOUS_INTEGRATION' && !name.startsWith('CI_'),
  );
  return {
    ...Object.fromEntries(inherited),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    ...extra,
  };
}

function bufferLines(buffer, from, to) {
  const lines = [];
  for (let y = from; y < to; y++) {
    lines.push(buffer.getLine(y)?.translateToString(true) ?? '');
  }
  return lines;
}

const joinScreen = (lines) => lines.join('\n').trimEnd();

/** The pids of the processes whose parent is `parent`. Reads `/proc`, so Linux only. */
function childrenOf(parent) {
  const children = [];
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      // The name of the command, in parentheses, can hold anything.
      const ppid = Number(
        stat
          .slice(stat.lastIndexOf(')') + 2)
          .split(' ')
          .at(1),
      );
      if (ppid === parent) children.push(Number(name));
    } catch {
      // The process ended while this looked.
    }
  }
  return children;
}

/** Opens `file` in a pty of `columns`×`rows` and feeds a headless xterm with its output. */
export function openScreen({ file, args = [], columns = COLUMNS, rows = ROWS, env = {}, cwd }) {
  const terminal = new xterm.Terminal({
    cols: columns,
    rows,
    allowProposedApi: true,
    scrollback: 10_000,
  });
  const child = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols: columns,
    rows,
    cwd: cwd ?? process.cwd(),
    env: terminalEnv(env),
  });

  let raw = '';
  let parsed = Promise.resolve();
  const watchers = new Set();
  const notify = () => {
    for (const watcher of [...watchers]) watcher();
  };

  child.onData((data) => {
    raw += data;
    parsed = parsed.then(
      () =>
        new Promise((resolve) => {
          terminal.write(data, resolve);
        }),
    );
    void parsed.then(notify);
  });
  const exited = new Promise((resolve) => {
    child.onExit(({ exitCode, signal }) => {
      resolve({ exitCode, signal });
    });
  });

  const screen = () => {
    const { active } = terminal.buffer;
    return joinScreen(bufferLines(active, active.baseY, active.baseY + terminal.rows));
  };

  return {
    /** The headless terminal, for what the helpers here do not show. Gone after `stop`. */
    terminal,
    /** The visible rows, without trailing blanks. */
    screen,
    /** Everything the terminal holds, scrollback included. */
    history: () => {
      const { active } = terminal.buffer;
      return joinScreen(bufferLines(active, 0, active.baseY + terminal.rows));
    },
    /** The columns where `char` sits on each visible row, counted in cells. */
    columnsOf: (char) => {
      const { active } = terminal.buffer;
      const found = [];
      for (let y = active.baseY; y < active.baseY + terminal.rows; y++) {
        const line = active.getLine(y);
        const columns = [];
        for (let x = 0; x < terminal.cols; x++) {
          if (line?.getCell(x)?.getChars() === char) columns.push(x);
        }
        found.push(columns);
      }
      return found;
    },
    raw: () => raw,
    sendKeys: (keys) => {
      child.write(keys);
    },
    resize: (nextColumns, nextRows) => {
      // In this order, as a real terminal has reflowed before the app hears of the new size.
      terminal.resize(nextColumns, nextRows);
      child.resize(nextColumns, nextRows);
    },
    /** Sends `signal` to the first process under the pty, or to the pty's own if it has none. */
    kill: (signal) => {
      process.kill(childrenOf(child.pid)[0] ?? child.pid, signal);
    },
    waitForText: (text, ms = WAIT_MS) =>
      new Promise((resolve, reject) => {
        let timer;
        const check = () => {
          if (!screen().includes(text)) return;
          clearTimeout(timer);
          watchers.delete(check);
          resolve();
        };
        timer = setTimeout(() => {
          watchers.delete(check);
          reject(new Error(`no "${text}" within ${String(ms)} ms. Screen:\n${screen()}`));
        }, ms);
        watchers.add(check);
        check();
      }),
    waitForExit: async () => {
      const result = await exited;
      await parsed;
      return result;
    },
    stop: () => {
      try {
        child.kill('SIGKILL');
      } catch {
        // It already ended.
      }
      terminal.dispose();
    },
  };
}

/**
 * Runs one scenario and returns the screen it left, its exit code and the bytes it wrote. For a
 * command wrapped to print `DONE_MARKER`, these cover the app only, and `after` has the rest.
 */
export async function runScenario(scenario) {
  const session = openScreen(scenario);
  const limitMs = scenario.limitMs ?? DEFAULT_LIMIT_MS;
  let timer;
  const limit = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`still running after ${String(limitMs)} ms. Screen:\n${session.screen()}`));
    }, limitMs);
  });
  const run = async () => {
    await scenario.drive?.(session);
    return session.waitForExit();
  };
  try {
    const { exitCode } = await Promise.race([run(), limit]);
    const raw = session.raw();
    const marked = raw.indexOf(DONE_MARKER);
    const after = marked === -1 ? '' : raw.slice(marked + DONE_MARKER.length);
    return {
      screen: session.screen().split(DONE_MARKER)[0].trimEnd(),
      history: session.history(),
      columnsOf: session.columnsOf,
      exitCode: marked === -1 ? exitCode : Number.parseInt(after, 10),
      raw: marked === -1 ? raw : raw.slice(0, marked),
      after,
    };
  } finally {
    clearTimeout(timer);
    session.stop();
  }
}
