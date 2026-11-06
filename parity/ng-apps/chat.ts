import { Component, signal } from '@angular/core';
import { InkBox, InkText, injectInput, renderInk } from '@angular-ink/core';

interface Chat {
  readonly input: string;
  readonly messages: readonly { readonly id: number; readonly text: string }[];
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

@Component({
  selector: 'parity-chat',
  imports: [InkBox, InkText],
  template: `
    <ink-box flexDirection="column" padding="1">
      <ink-box flexDirection="column">
        @for (message of chat().messages; track message.id) {
          <ink-text>{{ message.text }}</ink-text>
        }
      </ink-box>
      <ink-box marginTop="1">
        <ink-text>Enter your message: {{ chat().input }}</ink-text>
      </ink-box>
    </ink-box>
  `,
})
class ChatApp {
  protected readonly chat = signal<Chat>({ input: '', messages: [] });

  constructor() {
    injectInput((character, key) => {
      this.chat.update((previous) => {
        if (key.return) {
          if (previous.input !== '') {
            return {
              input: '',
              messages: [
                ...previous.messages,
                { id: previous.messages.length, text: `User: ${previous.input}` },
              ],
            };
          }
        } else if (key.backspace || key.delete) {
          const lastGrapheme = segmenter
            .segment(previous.input)
            .containing(previous.input.length - 1);
          return { ...previous, input: previous.input.slice(0, lastGrapheme?.index ?? 0) };
        } else if (!key.ctrl && !key.meta) {
          return { ...previous, input: previous.input + character };
        }
        return previous;
      });
    });
  }
}

void renderInk(ChatApp);
