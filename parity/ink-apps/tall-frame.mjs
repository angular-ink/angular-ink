// Not an Ink example: a frame of the height in argv, for the edges of the screen.
import { Box, render, Text, useInput } from 'ink';
import React from 'react';

const h = React.createElement;

const INNER_ROWS = Number(process.argv[2]) - 2;

function TallFrame() {
  const [presses, setPresses] = React.useState(0);

  useInput((input) => {
    if (input === 'n') setPresses((previous) => previous + 1);
  });

  return h(
    Box,
    { flexDirection: 'column', borderStyle: 'round', borderColor: 'cyan' },
    Array.from({ length: INNER_ROWS }, (_, index) =>
      h(
        Text,
        { key: index, color: index === 0 ? 'green' : undefined },
        `row ${String(index + 1)} seen ${String(presses)}`,
      ),
    ),
  );
}

render(h(TallFrame));
