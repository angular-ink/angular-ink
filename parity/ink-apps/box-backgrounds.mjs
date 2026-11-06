import { Box, render, Text } from 'ink';
import React from 'react';

const h = React.createElement;

const title = (text) => h(Box, null, h(Text, null, text));
const start = { alignSelf: 'flex-start' };

function BoxBackgrounds() {
  return h(
    Box,
    { flexDirection: 'column', gap: 1 },
    h(Text, { bold: true }, 'Box Background Examples:'),

    title('1. Standard red background (10x3):'),
    h(Box, { backgroundColor: 'red', width: 10, height: 3, ...start }, h(Text, null, 'Hello')),

    title('2. Blue background with border (12x4):'),
    h(
      Box,
      { backgroundColor: 'blue', borderStyle: 'round', width: 12, height: 4, ...start },
      h(Text, null, 'Border'),
    ),

    title('3. Green background with padding (14x4):'),
    h(
      Box,
      { backgroundColor: 'green', padding: 1, width: 14, height: 4, ...start },
      h(Text, null, 'Padding'),
    ),

    title('4. Yellow background with center alignment (16x3):'),
    h(
      Box,
      { backgroundColor: 'yellow', width: 16, height: 3, justifyContent: 'center', ...start },
      h(Text, null, 'Centered'),
    ),

    title('5. Magenta background, column layout (12x5):'),
    h(
      Box,
      { backgroundColor: 'magenta', flexDirection: 'column', width: 12, height: 5, ...start },
      h(Text, null, 'Line 1'),
      h(Text, null, 'Line 2'),
    ),

    title('6. Hex color background #FF8800 (10x3):'),
    h(Box, { backgroundColor: '#FF8800', width: 10, height: 3, ...start }, h(Text, null, 'Hex')),

    title('7. RGB background rgb(0,255,0) (10x3):'),
    h(
      Box,
      { backgroundColor: 'rgb(0,255,0)', width: 10, height: 3, ...start },
      h(Text, null, 'RGB'),
    ),

    title('8. Text inheritance test:'),
    h(
      Box,
      { backgroundColor: 'cyan', ...start },
      h(Text, null, 'Inherited '),
      h(Text, { backgroundColor: 'red' }, 'Override '),
      h(Text, null, 'Back to inherited'),
    ),

    title('9. Nested background inheritance:'),
    h(
      Box,
      { backgroundColor: 'blue', ...start },
      h(Text, null, 'Outer: '),
      h(
        Box,
        { backgroundColor: 'yellow' },
        h(Text, null, 'Inner: '),
        h(Text, { backgroundColor: 'red' }, 'Deep'),
      ),
    ),

    h(Box, { marginTop: 1 }, h(Text, null, 'Press Ctrl+C to exit')),
  );
}

render(h(BoxBackgrounds));
