import { Box, render, Text, useFocus } from 'ink';
import React from 'react';

const h = React.createElement;

function Item({ label }) {
  const { isFocused } = useFocus();
  return h(Text, null, `${label} `, isFocused ? h(Text, { color: 'green' }, '(focused)') : null);
}

function Focus() {
  return h(
    Box,
    { flexDirection: 'column', padding: 1 },
    h(
      Box,
      { marginBottom: 1 },
      h(
        Text,
        null,
        'Press Tab to focus next element, Shift+Tab to focus previous element, Esc to reset focus.',
      ),
    ),
    h(Item, { label: 'First' }),
    h(Item, { label: 'Second' }),
    h(Item, { label: 'Third' }),
  );
}

render(h(Focus));
