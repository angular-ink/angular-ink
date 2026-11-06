// What the three apps must do in a real terminal. A scenario with `expected` is also compared with
// `e2e/expected/<name>.txt`, and `check` has the rest. Each item of the review focus has some here.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DONE_MARKER } from './pty-screen.mjs';

const SHOW_CURSOR = '\x1b[?25h';
const HIDE_CURSOR = '\x1b[?25l';
const PASTE_ON = '\x1b[?2004h';
const PASTE_OFF = '\x1b[?2004l';
const ENTER = '\r';
const TAB = '\t';
const DOWN = '\x1b[B';
const CTRL_C = '\x03';

/** Preloaded, so that the app fails on `SIGUSR2` with no code for it in the app itself. */
const failOnSignal = (how) => `data:text/javascript,process.on('SIGUSR2',()=>{${how}})`;
const THROW = failOnSignal("throw new Error('forced failure')");
const REJECT = failOnSignal("void Promise.reject(new Error('forced failure'))");

const quote = (text) => `'${text.replaceAll("'", "'\\''")}'`;
const shellLine = (args) => args.map(quote).join(' ');

/**
 * Hands the app the pty with stderr apart, so that its output ends where its restore ends. The
 * shell then reports its exit code and the state of the terminal, which outlives the app.
 */
function observed(args, stderr) {
  const app = shellLine([process.execPath, ...args]);
  return {
    file: 'sh',
    args: ['-c', `${app} 2>${quote(stderr)}; echo "${DONE_MARKER}$?"; stty -a`],
  };
}

/** Runs a pipeline in bash, which can tell the exit code of its first command. */
function piped(args, tail, stderr) {
  const app = shellLine([process.execPath, ...args]);
  return {
    file: 'bash',
    args: ['-c', `${app} 2>${quote(stderr)} | ${tail}; echo "${DONE_MARKER}\${PIPESTATUS[0]}"`],
  };
}

function assertRestored({ raw, after }) {
  assert.ok(
    raw.endsWith(SHOW_CURSOR),
    `the output ends with ${JSON.stringify(raw.slice(-30))}, not with the cursor back on`,
  );
  assert.ok(raw.lastIndexOf(HIDE_CURSOR) < raw.lastIndexOf(SHOW_CURSOR));
  assert.ok(raw.includes(PASTE_ON), 'the form never turned bracketed paste on');
  assert.ok(raw.lastIndexOf(PASTE_ON) < raw.lastIndexOf(PASTE_OFF), 'bracketed paste stayed on');
  // `stty -a` writes `-echo` for a flag that is off.
  assert.match(after, /(?<![-\w])echo(?!\w)/, 'echo is off after the app');
  assert.match(after, /(?<![-\w])icanon(?!\w)/, 'icanon is off after the app');
}

function fileReader(path) {
  return () => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return '';
    }
  };
}

function hostileServices() {
  return [
    { name: 'clear\x1b[2Jscreen', region: 'eu-west', state: 'ok', latencyMs: 1 },
    { name: 'clip\x1b]52;c;ZXZpbA==\x07board', region: 'eu-west', state: 'ok', latencyMs: 2 },
    { name: 'home\x1b[Hrow', region: 'us-east', state: 'ok', latencyMs: 3 },
    { name: 'return\rcarriage', region: 'us-east', state: 'degraded', latencyMs: 4 },
    { name: 'zero​width', region: 'ap-south', state: 'ok', latencyMs: 5 },
    {
      name: '決済サービスの長い長い長い長い長い長い長い長い長い長い名前',
      region: '東京',
      state: 'down',
      latencyMs: 0,
    },
  ];
}

function manyServices(count) {
  return Array.from({ length: count }, (_item, index) => ({
    name: `service-${String(index)}`,
    region: 'eu-west',
    state: 'ok',
    latencyMs: index,
  }));
}

/** The numbers of `seq`, in order, as they must stay above whatever an app draws. */
function assertNumbersKept(history, count) {
  const lines = history.split('\n');
  const numbers = Array.from({ length: count }, (_item, index) => String(index + 1));
  assert.deepEqual(lines.slice(0, count), numbers, 'the scrollback changed');
}

function assertOneFrame(screen, columns, rows) {
  const lines = screen.split('\n');
  assert.ok(lines.length <= rows, `${String(lines.length)} lines on a screen of ${String(rows)}`);
  for (const line of lines) {
    assert.ok([...line].length <= columns, `"${line}" is wider than ${String(columns)}`);
  }
  const count = (text) => lines.filter((line) => line.includes(text)).length;
  assert.equal(count('q to quit'), 1, `a stale footer is on the screen:\n${screen}`);
  assert.equal(count(`${String(columns)}x${String(rows)} `), 1, `no new size:\n${screen}`);
  assert.ok(count('Service') <= 1, `a stale header is on the screen:\n${screen}`);
  assert.ok(count('╰') <= 1, `a stale bottom border is on the screen:\n${screen}`);
  assert.ok(count('╭') <= 1, `a stale top border is on the screen:\n${screen}`);
  // The table was 80 wide: what is left of it would show as the region column.
  if (columns < 60) assert.ok(count('eu-west') === 0, `a stale row is on the screen:\n${screen}`);
}

/** `bundles` has the path of each app, and `folder` is where scenarios may keep files. */
export function createScenarios(bundles, folder) {
  const stderrOf = (name) => join(folder, `${name}.stderr`);
  const dataFile = (name, services) => {
    const path = join(folder, `${name}.json`);
    writeFileSync(path, JSON.stringify(services));
    return path;
  };

  const shrink = (name, columns, rows, ...statusArgs) => ({
    name,
    expected: true,
    file: 'sh',
    args: ['-c', `seq 1 30; exec ${shellLine([process.execPath, bundles.status, ...statusArgs])}`],
    drive: async (session) => {
      await session.waitForText('80x24');
      session.resize(columns, rows);
      await session.waitForText(`${String(columns)}x${String(rows)} `);
      assertOneFrame(session.screen(), columns, rows);
      session.sendKeys('q');
    },
    check: ({ exitCode, history }) => {
      assert.equal(exitCode, 0);
      assertNumbersKept(history, 30);
      // What the resize itself pushed up, and the one redraw. Nothing can take either back.
      const copies = history.split('\n').filter((line) => line.startsWith('╭')).length;
      assert.ok(
        copies <= 2,
        `${String(copies)} copies of the frame in the scrollback:\n${history}`,
      );
    },
  });

  const interrupted = (name, nodeArgs, interrupt, exitCode, checkStderr) => {
    const stderr = stderrOf(name);
    const readStderr = fileReader(stderr);
    return {
      name,
      ...observed([...nodeArgs, bundles.newProject], stderr),
      drive: async (session) => {
        await session.waitForText('New project');
        session.sendKeys('half-typed');
        await session.waitForText('half-typed');
        interrupt(session);
      },
      check: (result) => {
        assert.equal(result.exitCode, exitCode);
        assertRestored(result);
        checkStderr(readStderr());
      },
    };
  };
  const quiet = (stderr) => {
    assert.equal(stderr, '');
  };
  const forced = (stderr) => {
    assert.match(stderr, /forced failure/);
  };

  const pipeStderr = stderrOf('status-cat');
  const headStderr = stderrOf('status-head');
  const bigHeadStderr = stderrOf('status-head-big');
  const closedStdinStderr = stderrOf('new-project-stdin-closed');
  const readFile = (path) => fileReader(path)();

  return [
    {
      name: 'deploy',
      expected: true,
      file: process.execPath,
      args: [bundles.deploy],
      drive: async (session) => {
        await session.waitForText('Deploy to which environment?');
        session.sendKeys(DOWN);
        await session.waitForText('> prod');
        session.sendKeys(ENTER);
        await session.waitForText('Deploying to prod');
        await session.waitForText('✔ Build image');
      },
      check: ({ exitCode, raw, screen }) => {
        assert.equal(exitCode, 0);
        assert.ok(raw.endsWith(SHOW_CURSOR));
        assert.match(raw, /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u, 'the spinner never drew');
        assert.doesNotMatch(screen, /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u, 'the spinner stayed');
      },
    },
    {
      name: 'deploy-fail',
      file: process.execPath,
      args: [bundles.deploy, '--fail'],
      drive: async (session) => {
        await session.waitForText('> staging');
        session.sendKeys(ENTER);
      },
      check: ({ exitCode, raw, screen }) => {
        assert.equal(exitCode, 1);
        assert.ok(raw.endsWith(SHOW_CURSOR));
        assert.match(screen, /✔ Build image/);
        assert.match(screen, /ERROR/);
        assert.match(screen, /Run migrations failed on staging/);
      },
    },
    {
      name: 'new-project',
      expected: true,
      file: process.execPath,
      args: [bundles.newProject],
      drive: async (session) => {
        await session.waitForText('New project');
        session.sendKeys('Olá Mundo');
        await session.waitForText('Olá Mundo');
        session.sendKeys(ENTER);
        await session.waitForText('use kebab-case');
        session.sendKeys('\x7f'.repeat('Olá Mundo'.length));
        await session.waitForText('Name');
        session.sendKeys('my-app');
        await session.waitForText('my-app');
        session.sendKeys(TAB);
        session.sendKeys('\x1b[200~A small\ntool\x1b[201~');
        await session.waitForText('A small tool');
        session.sendKeys(ENTER);
      },
      check: ({ exitCode, raw }) => {
        assert.equal(exitCode, 0);
        assert.ok(raw.endsWith(SHOW_CURSOR));
      },
    },
    {
      name: 'status',
      expected: true,
      file: process.execPath,
      args: [bundles.status],
      drive: async (session) => {
        await session.waitForText('q to quit');
        session.sendKeys('q');
      },
      check: ({ exitCode, raw, columnsOf }) => {
        assert.equal(exitCode, 0);
        assert.ok(raw.endsWith(SHOW_CURSOR));
        assert.ok(raw.includes('\x1b[31m'), 'the state of a service has no color');
        const separators = columnsOf('│').filter((columns) => columns.length > 0);
        assert.ok(separators.length >= 7);
        for (const columns of separators) assert.deepEqual(columns, separators[0]);
      },
    },
    {
      name: 'status-cat',
      expected: true,
      ...piped([bundles.status], 'cat', pipeStderr),
      check: ({ exitCode, raw }) => {
        assert.equal(exitCode, 0);
        assert.ok(!raw.includes('\x1b'), 'a pipe got escape sequences');
        assert.match(raw, /api-gateway/);
        assert.equal(readFile(pipeStderr), '');
      },
    },
    {
      name: 'status-head',
      ...piped([bundles.status], 'head -1', headStderr),
      check: ({ exitCode, raw }) => {
        assert.ok(exitCode === 0 || exitCode === 141, `exit code ${String(exitCode)}`);
        assert.match(raw, /^╭─+╮\r?\n?$/u);
        assert.equal(readFile(headStderr), '');
      },
    },
    {
      // Larger than a pipe holds, so the app is still writing when `head` goes away.
      name: 'status-head-big',
      ...piped(
        [bundles.status, '--data', dataFile('status-head-big', manyServices(3000))],
        'head -1',
        bigHeadStderr,
      ),
      check: ({ exitCode, raw }) => {
        assert.ok(exitCode === 0 || exitCode === 141, `exit code ${String(exitCode)}`);
        assert.match(raw, /^╭─+╮\r?\n?$/u);
        assert.equal(readFile(bigHeadStderr), '');
      },
    },
    {
      name: 'new-project-stdin-pipe',
      limitMs: 5000,
      file: 'bash',
      args: ['-c', `echo oi | ${shellLine([process.execPath, bundles.newProject])}`],
      check: ({ exitCode, raw, screen }) => {
        assert.equal(exitCode, 0);
        assert.match(screen, /New project/);
        assert.doesNotMatch(screen, /^\s+at /m);
        assert.ok(raw.endsWith(SHOW_CURSOR));
      },
    },
    {
      name: 'new-project-stdin-closed',
      limitMs: 5000,
      file: 'bash',
      args: [
        '-c',
        `${shellLine([process.execPath, bundles.newProject])} <&- 2>${quote(closedStdinStderr)}`,
      ],
      check: ({ exitCode, screen }) => {
        assert.equal(exitCode, 0);
        assert.match(screen, /New project/);
        assert.equal(readFile(closedStdinStderr), '');
      },
    },
    {
      // Stays open and silent, so an app that listened to it would never end.
      name: 'new-project-stdin-open',
      limitMs: 5000,
      file: 'bash',
      args: ['-c', `${shellLine([process.execPath, bundles.newProject])} < <(sleep 10)`],
      check: ({ exitCode, screen }) => {
        assert.equal(exitCode, 0);
        assert.match(screen, /New project/);
      },
    },
    {
      // Nothing can restore after this one, which shows that the checks above can see a raw pty.
      name: 'new-project-sigkill-leaves-raw',
      ...observed([bundles.newProject], stderrOf('new-project-sigkill')),
      drive: async (session) => {
        await session.waitForText('New project');
        session.kill('SIGKILL');
      },
      check: ({ exitCode, raw, after }) => {
        assert.equal(exitCode, 137);
        assert.ok(!raw.endsWith(SHOW_CURSOR));
        assert.match(after, /-icanon/);
        assert.match(after, /-echo/);
      },
    },
    interrupted(
      'new-project-sigint',
      [],
      (session) => {
        session.kill('SIGINT');
      },
      130,
      quiet,
    ),
    interrupted(
      'new-project-sigterm',
      [],
      (session) => {
        session.kill('SIGTERM');
      },
      143,
      quiet,
    ),
    interrupted(
      'new-project-sighup',
      [],
      (session) => {
        session.kill('SIGHUP');
      },
      129,
      quiet,
    ),
    interrupted(
      'new-project-exception',
      ['--import', THROW],
      (session) => {
        session.kill('SIGUSR2');
      },
      1,
      forced,
    ),
    interrupted(
      'new-project-rejection',
      ['--import', REJECT],
      (session) => {
        session.kill('SIGUSR2');
      },
      1,
      forced,
    ),
    interrupted(
      'new-project-ctrl-c',
      [],
      (session) => {
        session.sendKeys(CTRL_C);
      },
      0,
      quiet,
    ),
    {
      name: 'status-hostile-data',
      expected: true,
      file: 'sh',
      args: [
        '-c',
        `seq 1 40; exec ${shellLine([
          process.execPath,
          bundles.status,
          '--data',
          dataFile('status-hostile-data', hostileServices()),
        ])}`,
      ],
      drive: async (session) => {
        await session.waitForText('q to quit');
        session.sendKeys('q');
      },
      check: ({ exitCode, raw, history, screen, columnsOf }) => {
        assert.equal(exitCode, 0);
        assert.ok(!raw.includes('\x1b[2J'), 'the erase reached the terminal');
        assert.ok(!raw.includes('\x1b]52'), 'the clipboard write reached the terminal');
        assertNumbersKept(history, 40);
        for (const clean of ['clearscreen', 'clipboard', 'homerow', 'zerowidth']) {
          assert.ok(screen.replaceAll('​', '').includes(clean), `no ${clean}:\n${screen}`);
        }
        const separators = columnsOf('│').filter((columns) => columns.length > 0);
        assert.equal(separators.length, 7);
        for (const columns of separators) assert.deepEqual(columns, separators[0]);
      },
    },
    shrink('status-shrink-40x10', 40, 10),
    // This one still fits, so nothing scrolls the leftovers of the old frame out of sight.
    shrink(
      'status-shrink-40x10-short',
      40,
      10,
      '--data',
      dataFile('status-shrink-short', manyServices(3)),
    ),
    shrink('status-shrink-80x8', 80, 8),
  ];
}
