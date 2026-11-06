// Asks the terminal it runs in how wide it draws each kind of character: writes it, then reads the
// column with a cursor position report. Run it in a real terminal:
//
//   node parity/width-probe.mjs
import stringWidth from 'string-width';

const ANSWER_MS = 1000;

const CASES = [
  ['ascii', 'a'],
  ['combining mark', 'é'],
  ['emoji', '😀'],
  ['ZWJ sequence', '👩‍💻'],
  ['flag', '🇧🇷'],
  ['VS16', '❤️'],
  ['CJK', '日本'],
];

/** The column the terminal reports, from 0, or null if it does not answer. */
function askColumn() {
  return new Promise((resolve) => {
    let answer = '';
    const finish = (column) => {
      clearTimeout(timer);
      process.stdin.off('data', listen);
      resolve(column);
    };
    const listen = (chunk) => {
      answer += chunk.toString('latin1');
      const end = answer.indexOf('R');
      if (end === -1) return;
      const column = Number(answer.slice(answer.lastIndexOf(';', end) + 1, end));
      finish(Number.isInteger(column) && column > 0 ? column - 1 : null);
    };
    const timer = setTimeout(() => {
      finish(null);
    }, ANSWER_MS);
    process.stdin.on('data', listen);
    process.stdout.write('\x1b[6n');
  });
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('width-probe needs a terminal on stdin and stdout');
    process.exitCode = 1;
    return;
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  const results = [];
  try {
    for (const [name, text] of CASES) {
      process.stdout.write(`\r\x1b[K${text}`);
      results.push({ name, expected: stringWidth(text), measured: await askColumn() });
      process.stdout.write('\r\x1b[K');
    }
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
  for (const { name, expected, measured } of results) {
    const verdict = measured === null ? 'NO ANSWER' : measured === expected ? 'ok' : 'DIFFERS';
    const shown = measured === null ? '-' : String(measured);
    console.log(
      `${name.padEnd(15)} string-width ${String(expected)}  terminal ${shown.padEnd(2)} ${verdict}`,
    );
  }
}

await main();
