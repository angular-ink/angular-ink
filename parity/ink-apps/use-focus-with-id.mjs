import { Box, render, Text, useFocus, useFocusManager, useInput } from 'ink';
import React from 'react';

const h = React.createElement;

function Item({ id, label }) {
  const { isFocused } = useFocus({ id });
  return h(Text, null, `${label} `, isFocused ? h(Text, { color: 'green' }, '(focused)') : null);
}

function Focus() {
  const { focus } = useFocusManager();

  useInput((input) => {
    if (['1', '2', '3'].includes(input)) focus(input);
  });

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
    h(Item, { id: '1', label: 'Press 1 to focus' }),
    h(Item, { id: '2', label: 'Press 2 to focus' }),
    h(Item, { id: '3', label: 'Press 3 to focus' }),
  );
}

render(h(Focus));
