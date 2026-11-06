import { Box, render, Text } from 'ink';
import React from 'react';

const h = React.createElement;

const bordered = (borderStyle, marginRight) =>
  h(Box, { borderStyle, marginRight }, h(Text, null, borderStyle));

function Borders() {
  return h(
    Box,
    { flexDirection: 'column', padding: 2 },
    h(
      Box,
      null,
      bordered('single', 2),
      bordered('double', 2),
      bordered('round', 2),
      bordered('bold'),
    ),
    h(
      Box,
      { marginTop: 1 },
      bordered('singleDouble', 2),
      bordered('doubleSingle', 2),
      bordered('classic'),
    ),
  );
}

render(h(Borders));
