import { Box, render, Text } from 'ink';
import React from 'react';

const h = React.createElement;

function BorderBackgrounds() {
  return h(
    Box,
    { flexDirection: 'column', gap: 1 },
    h(
      Box,
      { borderStyle: 'round', borderColor: 'white', borderBackgroundColor: 'blue', padding: 1 },
      h(Text, null, 'Box with blue background on white border'),
    ),
    h(
      Box,
      { borderStyle: 'single', borderColor: 'black', borderBackgroundColor: 'yellow', padding: 1 },
      h(Text, null, 'Box with yellow background on black border'),
    ),
    h(
      Box,
      {
        borderStyle: 'double',
        borderTopColor: 'red',
        borderTopBackgroundColor: 'green',
        borderBottomColor: 'blue',
        borderBottomBackgroundColor: 'yellow',
        borderLeftColor: 'cyan',
        borderLeftBackgroundColor: 'magenta',
        borderRightColor: 'white',
        borderRightBackgroundColor: 'red',
        padding: 1,
      },
      h(Text, null, 'Box with different colors per side'),
    ),
    h(
      Box,
      {
        borderDimColor: true,
        borderBackgroundColor: 'rgb(128, 0, 128)',
        borderStyle: 'classic',
        borderColor: 'white',
        padding: 1,
      },
      h(Text, null, 'Box with dimmed RGB purple background on border'),
    ),
    h(
      Box,
      { borderStyle: 'bold', borderColor: '#FF00FF', borderBackgroundColor: '#00FF00', padding: 1 },
      h(Text, null, 'Box with hex color backgrounds'),
    ),
  );
}

render(h(BorderBackgrounds));
