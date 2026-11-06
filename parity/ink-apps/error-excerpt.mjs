// Not an Ink example: the overview of an error, with a stack made up so both apps show the same one.
import { join } from 'node:path';
import { render, Text } from 'ink';
import React from 'react';

const h = React.createElement;

function Failing() {
  const error = new Error('parity failure');
  error.stack = [
    'Error: parity failure',
    `    at fail (${join(process.cwd(), 'parity/fixtures/long-lines.txt')}:5:3)`,
    '    at /not/a/file.js:2:1',
    '    at native',
  ].join('\n');
  throw error;
}

function App() {
  return h(Text, null, 'unused', h(Failing));
}

render(h(App));
