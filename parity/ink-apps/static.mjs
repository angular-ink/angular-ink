import { Box, render, Static, Text } from 'ink';
import React from 'react';

const h = React.createElement;

function Example() {
  const [tests, setTests] = React.useState([]);

  React.useEffect(() => {
    let completedTests = 0;
    let timer;

    const run = () => {
      if (completedTests++ >= 10) return;
      setTests((previousTests) => [
        ...previousTests,
        { id: previousTests.length, title: `Test #${String(previousTests.length + 1)}` },
      ]);
      timer = setTimeout(run, 100);
    };

    run();
    return () => {
      clearTimeout(timer);
    };
  }, []);

  return h(
    React.Fragment,
    null,
    h(Static, { items: tests }, (test) =>
      h(Box, { key: test.id }, h(Text, { color: 'green' }, `✔ ${test.title}`)),
    ),
    h(
      Box,
      { marginTop: 1 },
      h(Text, { dimColor: true }, `Completed tests: ${String(tests.length)}`),
    ),
  );
}

render(h(Example));
