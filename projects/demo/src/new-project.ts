import {
  Component,
  HostAttributeToken,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import {
  InkBox,
  InkText,
  injectApp,
  injectFocus,
  injectInput,
  injectPaste,
  injectStdin,
  renderInk,
} from '@angular-ink/core';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const LINE_BREAK = /\r?\n|\r/g;

function withoutLastCharacter(text: string): string {
  const last = [...new Intl.Segmenter().segment(text)].at(-1);
  return last === undefined ? text : text.slice(0, last.index);
}

/** A one-line text field: types, erases and takes pastes while it has the focus. */
@Component({
  selector: 'demo-text-field',
  imports: [InkBox, InkText],
  template: `
    <ink-box>
      <ink-box width="13">
        <ink-text [color]="focus.isFocused() ? 'cyan' : undefined">{{ label() }}</ink-text>
      </ink-box>
      <ink-text>{{ value() }}</ink-text>
      @if (focus.isFocused()) {
        <ink-text inverse> </ink-text>
      }
    </ink-box>
  `,
})
class TextField {
  readonly label = input.required<string>();
  readonly value = model('');

  // Read from the host attribute: inputs are not set yet when injectFocus runs.
  protected readonly focus = injectFocus({
    autoFocus: inject(new HostAttributeToken('autoFocus'), { optional: true }) !== null,
  });

  constructor() {
    const isActive = this.focus.isFocused;
    injectInput(
      (text, key) => {
        if (key.backspace || key.delete) this.value.update(withoutLastCharacter);
        else if (!key.ctrl && !key.meta) this.append(text);
      },
      { isActive },
    );
    injectPaste(
      (text) => {
        this.append(text.replace(LINE_BREAK, ' '));
      },
      { isActive },
    );
  }

  private append(text: string): void {
    this.value.update((value) => value + text.replace(CONTROL_CHARACTERS, ''));
  }
}

export interface ProjectInfo {
  readonly name: string;
  readonly description: string;
}

/** A form with two fields. Enter confirms it once the name is valid. */
@Component({
  selector: 'demo-new-project',
  imports: [InkBox, InkText, TextField],
  template: `
    <ink-box flexDirection="column">
      @if (!canType) {
        <ink-text color="red">{{ noTerminal.message }}</ink-text>
      } @else if (created(); as project) {
        <ink-text color="green">Created {{ project.name }}: {{ project.description }}</ink-text>
      } @else {
        <ink-text bold>New project</ink-text>
        <demo-text-field label="Name" autoFocus [(value)]="name" />
        <demo-text-field label="Description" [(value)]="description" />
        @if (nameError(); as error) {
          <ink-text color="red">{{ error }}</ink-text>
        }
        <ink-text dimColor>Tab moves, Enter confirms</ink-text>
      }
    </ink-box>
  `,
})
export class NewProject {
  protected readonly canType = injectStdin().isRawModeSupported;
  protected readonly noTerminal = new Error('new-project needs a terminal');
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly created = signal<ProjectInfo | null>(null);
  protected readonly nameError = computed(() =>
    this.attempted() && !KEBAB_CASE.test(this.name()) ? 'use kebab-case' : null,
  );

  private readonly attempted = signal(false);
  private readonly app = injectApp();

  constructor() {
    injectInput((_text, key) => {
      if (key.return) this.confirm();
    });
    // No key will ever come to fill the form in, so it ends here and says why.
    if (!this.canType) this.app.exit(this.noTerminal);
  }

  private confirm(): void {
    this.attempted.set(true);
    if (this.nameError() !== null) return;
    const project = { name: this.name(), description: this.description() };
    this.created.set(project);
    this.app.exit(project);
  }
}

async function main(): Promise<void> {
  const app = await renderInk(NewProject);
  await app.waitUntilExit().catch(() => {
    process.exitCode = 1;
  });
}

// Through a symlink, as npm runs a command, argv[1] is the link.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && realpathSync(invokedPath) === fileURLToPath(import.meta.url)) {
  await main();
}
