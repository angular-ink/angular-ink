// Not an Ink example: props where a value can be read in more than one way.
import { Box, render, Text } from 'ink';
import React from 'react';

const h = React.createElement;

function ValueEdges() {
  return h(
    Box,
    { flexDirection: 'column', width: 60 },
    h(Text, null, 'tab\tstop'),
    h(Text, null, 'abcdefgh\tnext'),
    h(Text, null, 'a\tb\tc'),
    h(Text, { color: 'rgb(256,0,0)' }, 'clamped foreground'),
    h(Text, { backgroundColor: 'rgb(300, 10, 999)' }, 'clamped background'),
    h(Text, { color: 'rgb(-1,0,0)' }, 'negative channel'),
    h(Text, { color: 'rgb(1.5,0,0)' }, 'fractional channel'),
    h(Text, { color: 'ansi256(300)' }, 'large palette index'),
    h(Text, { color: 'nope' }, 'unknown color'),
    h(Text, { color: '#12' }, 'hex too short'),
    h(Text, { color: '#abcd' }, 'hex with four digits'),
    h(Text, { color: 'ansi256(  1)' }, 'palette with two spaces'),
    h(Box, { width: '50%', backgroundColor: 'blue' }, h(Text, null, 'percent width')),
    h(Box, { width: '50x', backgroundColor: 'red' }, h(Text, null, 'width with a unit')),
    h(Box, { width: 'wide', backgroundColor: 'green' }, h(Text, null, 'width with no number')),
    h(Box, { height: '2x' }, h(Text, null, 'height with a unit')),
    h(Text, null, 'end'),
  );
}

render(h(ValueEdges));
