import { render, Text } from 'ink';
import React from 'react';

const h = React.createElement;

// The example counts for ever. This one stops, so that both end on the same frame.
const LAST = 10;

function Counter() {
  const [counter, setCounter] = React.useState(0);

  React.useEffect(() => {
    let reached = 0;
    const timer = setInterval(() => {
      setCounter((previousCounter) => previousCounter + 1);
      reached += 1;
      if (reached === LAST) clearInterval(timer);
    }, 100);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return h(Text, { color: 'green' }, `${String(counter)} tests passed`);
}

render(h(Counter));
