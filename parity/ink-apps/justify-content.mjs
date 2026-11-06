import { Box, render, Text } from 'ink';
import React from 'react';

const h = React.createElement;

const row = (justifyContent) =>
  h(
    Box,
    { key: justifyContent },
    h(Text, null, '['),
    h(Box, { justifyContent, width: 20, height: 1 }, h(Text, null, 'X'), h(Text, null, 'Y')),
    h(Text, null, `] ${justifyContent}`),
  );

function JustifyContent() {
  return h(
    Box,
    { flexDirection: 'column' },
    ['flex-start', 'flex-end', 'center', 'space-around', 'space-between', 'space-evenly'].map(row),
  );
}

render(h(JustifyContent));
