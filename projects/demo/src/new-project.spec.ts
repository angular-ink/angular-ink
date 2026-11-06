import { cleanup, renderForTest, type InkTestInstance } from '@angular-ink/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { NewProject } from './new-project';

const fieldLine = (test: InkTestInstance, label: string): string =>
  test
    .lastFrame()
    ?.split('\n')
    .find((line) => line.includes(label)) ?? '';

const paste = (text: string): string => `\x1b[200~${text}\x1b[201~`;

afterEach(() => {
  cleanup();
});

describe('new-project', () => {
  it('starts with the focus on the name', async () => {
    const test = await renderForTest(NewProject);
    await test.stdin.write('abc');
    expect(fieldLine(test, 'Name')).toContain('abc');
    expect(fieldLine(test, 'Description')).not.toContain('abc');
  });

  it('moves between the fields with Tab and Shift+Tab', async () => {
    const test = await renderForTest(NewProject);
    await test.stdin.press('tab');
    await test.stdin.write('second');
    expect(fieldLine(test, 'Description')).toContain('second');
    expect(fieldLine(test, 'Name')).not.toContain('second');

    await test.stdin.press('tab');
    await test.stdin.write('first');
    expect(fieldLine(test, 'Name')).toContain('first');

    await test.stdin.press('shift+tab');
    await test.stdin.write('!');
    expect(fieldLine(test, 'Description')).toContain('second!');
  });

  it('erases with Backspace, in the focused field only', async () => {
    const test = await renderForTest(NewProject);
    await test.stdin.write('abc');
    await test.stdin.press('tab');
    await test.stdin.write('xyz');
    await test.stdin.press('backspace');
    expect(fieldLine(test, 'Description')).toContain('xy');
    expect(fieldLine(test, 'Description')).not.toContain('xyz');
    expect(fieldLine(test, 'Name')).toContain('abc');
  });

  it('fails Olá Mundo with use kebab-case and keeps running', async () => {
    const test = await renderForTest(NewProject);
    await test.stdin.write('Olá Mundo');
    await test.stdin.press('enter');
    expect(test.lastFrame()).toContain('use kebab-case');
    expect(fieldLine(test, 'Name')).toContain('Olá Mundo');

    await test.stdin.press('backspace');
    await test.stdin.write('x');
    expect(test.lastFrame()).toContain('use kebab-case');
  });

  it('fails an empty name', async () => {
    const test = await renderForTest(NewProject);
    await test.stdin.press('enter');
    expect(test.lastFrame()).toContain('use kebab-case');
  });

  it('takes the error away once the name is valid', async () => {
    const test = await renderForTest(NewProject);
    await test.stdin.write('Bad');
    await test.stdin.press('enter');
    expect(test.lastFrame()).toContain('use kebab-case');
    await test.stdin.press('backspace', 'backspace', 'backspace');
    await test.stdin.write('good');
    expect(test.lastFrame()).not.toContain('use kebab-case');
  });

  it('fills the focused field with a paste', async () => {
    const test = await renderForTest(NewProject);
    await test.stdin.write(paste('pasted-name'));
    expect(fieldLine(test, 'Name')).toContain('pasted-name');

    await test.stdin.press('tab');
    await test.stdin.write(paste('line one\nline two'));
    expect(fieldLine(test, 'Description')).toContain('line one line two');
    expect(fieldLine(test, 'Name')).not.toContain('line one');
  });

  it('says it needs a terminal and fails where no key can come', async () => {
    const test = await renderForTest(NewProject, { isTty: false });
    await expect(test.waitUntilExit()).rejects.toThrow('new-project needs a terminal');
    expect(test.lastFrame()).toContain('new-project needs a terminal');
    expect(test.lastFrame()).not.toContain('Description');
  });

  it('erases a whole character with Backspace', async () => {
    const test = await renderForTest(NewProject);
    await test.stdin.write('a👨‍👩‍👧');
    await test.stdin.press('backspace');
    expect(fieldLine(test, 'Name')).toContain('a');
    expect(fieldLine(test, 'Name')).not.toContain('👧');
  });

  it('prints the result and exits on Enter with valid data', async () => {
    const test = await renderForTest(NewProject);
    await test.stdin.write('my-app');
    await test.stdin.press('tab');
    await test.stdin.write('A small tool');
    await test.stdin.press('enter');

    await expect(test.waitUntilExit()).resolves.toEqual({
      name: 'my-app',
      description: 'A small tool',
    });
    expect(test.lastFrame()).toContain('Created my-app: A small tool');
    expect(test.lastFrame()).not.toContain('Description');
  });
});
