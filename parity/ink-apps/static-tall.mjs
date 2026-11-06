// Not an Ink example: permanent output above a frame that overflows the screen.
import { Box, render, Static, Text } from 'ink';
import React from 'react';

const h = React.createElement;

function StaticTall() {
  const [lines, setLines] = React.useState([]);

  React.useEffect(() => {
    let timer;
    const run = () => {
      if (lines.length >= 3) return;
      setLines((previous) => {
        if (previous.length >= 3) return previous;
        timer = setTimeout(run, 100);
        return [...previous, `permanent ${String(previous.length + 1)}`];
      });
    };
    run();
    return () => {
      clearTimeout(timer);
    };
  }, []);

  return h(
    React.Fragment,
    null,
    h(Static, { items: lines }, (line) => h(Text, { key: line, color: 'green' }, line)),
    h(
      Box,
      { flexDirection: 'column' },
      Array.from({ length: 12 }, (_, index) =>
        h(Text, { key: index }, `row ${String(index + 1)} of ${String(lines.length)}`),
      ),
    ),
  );
}

render(h(StaticTall));
