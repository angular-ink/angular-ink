import { Box, render, Text } from 'ink';
import React from 'react';

const h = React.createElement;

// Fixed names in place of the example's faker, so that both apps show the same data.
const users = Array.from({ length: 10 }, (_, index) => ({
  id: index,
  name: `user_${String(index)}_name`,
  email: `user${String(index)}@example.com`,
}));

const row = (key, id, name, email) =>
  h(
    Box,
    { key },
    h(Box, { width: '10%' }, h(Text, null, id)),
    h(Box, { width: '50%' }, h(Text, null, name)),
    h(Box, { width: '40%' }, h(Text, null, email)),
  );

function Table() {
  return h(
    Box,
    { flexDirection: 'column', width: '100%', maxWidth: 80 },
    row('head', 'ID', 'Name', 'Email'),
    users.map((user) => row(user.id, user.id, user.name, user.email)),
  );
}

render(h(Table));
