import { Box, render, Text, useInput } from 'ink';
import React from 'react';

const h = React.createElement;

const items = ['Red', 'Green', 'Blue', 'Yellow', 'Magenta', 'Cyan'];

function SelectInput() {
  const [selectedIndex, setSelectedIndex] = React.useState(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedIndex((previousIndex) => (previousIndex - 1 + items.length) % items.length);
    }
    if (key.downArrow) {
      setSelectedIndex((previousIndex) => (previousIndex + 1) % items.length);
    }
  });

  return h(
    Box,
    { flexDirection: 'column' },
    h(Text, null, 'Select a color:'),
    items.map((item, index) => {
      const isSelected = index === selectedIndex;
      const label = isSelected ? `> ${item}` : `  ${item}`;
      return h(Box, { key: item }, h(Text, { color: isSelected ? 'blue' : undefined }, label));
    }),
  );
}

render(h(SelectInput));
