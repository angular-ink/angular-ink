// What both implementations go through. A drive presses keys and marks the screens to compare; the
// screen after the app ended is always compared, so an app with no keys needs no drive.
const CTRL_C = '\x03';
const ENTER = '\r';
const TAB = '\t';
const SHIFT_TAB = '\x1b[Z';
const ESC = '\x1b';
const UP = '\x1b[A';
const DOWN = '\x1b[B';
const BACKSPACE = '\x7f';

async function driveFocus({ session, mark, gone }, keys) {
  await session.waitForText(keys.first);
  await mark('first frame');
  session.sendKeys(TAB);
  await session.waitForText(`${keys.first} (focused)`);
  await mark('Tab');
  session.sendKeys(TAB);
  await session.waitForText(`${keys.second} (focused)`);
  await mark('Tab again');
  session.sendKeys(SHIFT_TAB);
  await session.waitForText(`${keys.first} (focused)`);
  await mark('Shift+Tab');
  session.sendKeys(ESC);
  await gone('(focused)');
  await mark('Esc');
  session.sendKeys(CTRL_C);
}

async function driveTallFrame({ session, mark }) {
  await session.waitForText('seen 0');
  await mark('first frame');
  session.sendKeys('n');
  await session.waitForText('seen 1');
  await mark('redrawn');
  session.sendKeys('n');
  await session.waitForText('seen 2');
  await mark('redrawn again');
  session.sendKeys(CTRL_C);
}

/** The eleven examples of Ink's repository, then the edges no example reaches. */
export const SCENARIOS = [
  { name: 'borders', app: 'borders' },
  { name: 'border-backgrounds', app: 'border-backgrounds' },
  // Taller than the screen: the rows above it have to be the same in the scrollback.
  { name: 'box-backgrounds', app: 'box-backgrounds' },
  { name: 'justify-content', app: 'justify-content' },
  { name: 'static', app: 'static' },
  { name: 'table', app: 'table' },
  {
    name: 'counter',
    app: 'counter',
    drive: async ({ session, mark }) => {
      await session.waitForText('10 tests passed');
      await mark('last count');
    },
  },
  {
    name: 'select-input',
    app: 'select-input',
    drive: async ({ session, mark }) => {
      await session.waitForText('> Red');
      await mark('first frame');
      session.sendKeys(DOWN);
      await session.waitForText('> Green');
      await mark('down');
      session.sendKeys(UP);
      await session.waitForText('> Red');
      session.sendKeys(UP);
      await session.waitForText('> Cyan');
      await mark('up past the top');
      session.sendKeys(CTRL_C);
    },
  },
  {
    name: 'use-focus',
    app: 'use-focus',
    drive: (tools) => driveFocus(tools, { first: 'First', second: 'Second' }),
  },
  {
    name: 'use-focus-with-id',
    app: 'use-focus-with-id',
    drive: async (tools) => {
      const { session, mark } = tools;
      await session.waitForText('Press 3 to focus');
      await mark('first frame');
      session.sendKeys('2');
      await session.waitForText('Press 2 to focus (focused)');
      await mark('2');
      session.sendKeys(TAB);
      await session.waitForText('Press 3 to focus (focused)');
      await mark('Tab');
      session.sendKeys('1');
      await session.waitForText('Press 1 to focus (focused)');
      await mark('1');
      session.sendKeys(ESC);
      await tools.gone('(focused)');
      await mark('Esc');
      session.sendKeys(CTRL_C);
    },
  },
  {
    name: 'chat',
    app: 'chat',
    drive: async ({ session, mark }) => {
      await session.waitForText('Enter your message:');
      await mark('first frame');
      session.sendKeys('hello');
      await session.waitForText('message: hello');
      session.sendKeys(ENTER);
      await session.waitForText('User: hello');
      await mark('one message');
      session.sendKeys('日本語 ok');
      await session.waitForText('ok');
      await mark('wide characters');
      session.sendKeys(BACKSPACE);
      session.sendKeys(BACKSPACE);
      session.sendKeys(BACKSPACE);
      session.sendKeys(BACKSPACE);
      await session.waitForText('message: 日本');
      await mark('backspace over a wide character');
      session.sendKeys(ENTER);
      await session.waitForText('User: 日本');
      await mark('two messages');
      session.sendKeys(CTRL_C);
    },
  },
  // The twelfth: a frame exactly as tall as the terminal (see e2e/expected/status-shrink-40x10.txt).
  {
    name: 'frame-as-tall-as-the-screen',
    app: 'tall-frame',
    args: ['10'],
    columns: 40,
    rows: 10,
    drive: driveTallFrame,
  },
  {
    name: 'frame-one-row-shorter-than-the-screen',
    app: 'tall-frame',
    args: ['9'],
    columns: 40,
    rows: 10,
    drive: driveTallFrame,
  },
  {
    name: 'frame-taller-than-the-screen',
    app: 'tall-frame',
    args: ['15'],
    columns: 40,
    rows: 10,
    drive: driveTallFrame,
  },
  {
    name: 'screen-shrinks-to-the-frame-height',
    app: 'tall-frame',
    args: ['10'],
    columns: 40,
    rows: 24,
    drive: async ({ session, mark }) => {
      await session.waitForText('seen 0');
      await mark('first frame');
      session.resize(40, 10);
      await mark('resized');
      session.sendKeys('n');
      await session.waitForText('seen 1');
      await mark('redrawn');
      session.sendKeys(CTRL_C);
    },
  },
  // The frame of `e2e/expected/status-shrink-40x10.txt`: narrower and as tall as the new screen.
  {
    name: 'screen-narrows-to-the-frame-height',
    app: 'tall-frame',
    args: ['10'],
    columns: 60,
    rows: 24,
    drive: async ({ session, mark }) => {
      await session.waitForText('seen 0');
      await mark('first frame');
      session.resize(40, 10);
      await mark('resized');
      session.sendKeys('n');
      await session.waitForText('seen 1');
      await mark('redrawn');
      session.sendKeys(CTRL_C);
    },
  },
  // Each row of the frame reflows into two, which Ink's erase does not count.
  {
    name: 'screen-narrows-with-a-short-frame',
    app: 'tall-frame',
    args: ['5'],
    columns: 60,
    rows: 24,
    drive: async ({ session, mark }) => {
      await session.waitForText('seen 0');
      await mark('first frame');
      session.resize(40, 24);
      await mark('resized');
      session.sendKeys(CTRL_C);
    },
  },
  {
    name: 'static-above-a-frame-taller-than-the-screen',
    app: 'static-tall',
    columns: 40,
    rows: 10,
  },
  { name: 'value-edges', app: 'value-edges' },
  { name: 'error-excerpt', app: 'error-excerpt' },
];
