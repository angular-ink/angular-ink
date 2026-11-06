import { Box, render, Text, useInput } from 'ink';
import React from 'react';

const h = React.createElement;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function ChatApp() {
  const [chat, setChat] = React.useState({ input: '', messages: [] });

  useInput((character, key) => {
    setChat((previousChat) => {
      if (key.return) {
        if (previousChat.input !== '') {
          return {
            input: '',
            messages: [
              ...previousChat.messages,
              { id: previousChat.messages.length, text: `User: ${previousChat.input}` },
            ],
          };
        }
      } else if (key.backspace || key.delete) {
        const lastGrapheme = segmenter
          .segment(previousChat.input)
          .containing(previousChat.input.length - 1);
        return {
          ...previousChat,
          input: previousChat.input.slice(0, lastGrapheme?.index ?? 0),
        };
      } else if (!key.ctrl && !key.meta) {
        return { ...previousChat, input: previousChat.input + character };
      }
      return previousChat;
    });
  });

  return h(
    Box,
    { flexDirection: 'column', padding: 1 },
    h(
      Box,
      { flexDirection: 'column' },
      chat.messages.map((message) => h(Text, { key: message.id }, message.text)),
    ),
    h(Box, { marginTop: 1 }, h(Text, null, `Enter your message: ${chat.input}`)),
  );
}

render(h(ChatApp));
