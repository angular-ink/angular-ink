import { ApplicationRef, Component, computed, input } from '@angular/core';
import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Yoga } from 'yoga-layout/load';
import { InkBox, InkText } from '../elements';
import type { CellGrid } from '../engine/grid';
import { layoutTree } from '../engine/layout';
import { paintTree } from '../engine/paint';
import { mountTree } from '../platform/mount';

export interface StackFrame {
  readonly fn: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export interface ExcerptLine {
  readonly line: number;
  readonly value: string;
  readonly isOrigin: boolean;
}

export interface StackEntry {
  /** The function of a parsed frame, or the whole line of one that could not be parsed. */
  readonly name: string;
  /** `(file:line:column)`, for a parsed frame. */
  readonly place: string | null;
}

export interface ErrorView {
  readonly message: string;
  /** `file:line:column` of the top of the stack. */
  readonly origin: string | null;
  readonly excerpt: readonly ExcerptLine[] | null;
  readonly gutterWidth: number;
  readonly stack: readonly StackEntry[];
}

const EXCERPT_AROUND = 3;
// A line over this is taken for a minified bundle, whose source is no use to a reader.
const EXCERPT_MAX_LINE = 500;

/** Parses `at fn (file:line:column)` or `at file:line:column`, or returns null for anything else. */
export function parseStackLine(raw: string): StackFrame | null {
  const text = raw.trim();
  if (!text.startsWith('at ')) return null;
  const body = text.slice(3);
  let fn = '';
  let location = body;
  if (body.endsWith(')')) {
    const open = body.lastIndexOf(' (');
    if (open < 0) return null;
    fn = body.slice(0, open);
    location = body.slice(open + 2, -1);
  }
  const columnAt = location.lastIndexOf(':');
  const lineAt = location.lastIndexOf(':', columnAt - 1);
  if (columnAt <= 0 || lineAt <= 0) return null;
  const line = Number(location.slice(lineAt + 1, columnAt));
  const column = Number(location.slice(columnAt + 1));
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) return null;
  for (const prefix of ['async ', 'new ']) {
    if (fn.startsWith(prefix)) fn = fn.slice(prefix.length);
  }
  return { fn, file: location.slice(0, lineAt), line, column };
}

/** What the overview shows for `error`, with paths relative to `cwd` where that is shorter. */
export function describeError(error: Error, cwd: string = process.cwd()): ErrorView {
  const stackLines = error.stack?.split('\n').slice(error.message.split('\n').length) ?? [];
  const top = stackLines[0] === undefined ? null : parseStackLine(stackLines[0]);
  const file = top === null ? '' : displayPath(top.file, cwd);
  const excerpt = top === null || file === '' ? null : readExcerpt(top, cwd);
  return {
    message: error.message,
    origin: top === null || file === '' ? null : `${file}:${locationOf(top)}`,
    excerpt,
    gutterWidth: excerpt?.reduce((most, row) => Math.max(most, String(row.line).length), 0) ?? 0,
    stack: stackLines.map((line) => stackEntry(line, cwd)),
  };
}

const locationOf = (frame: StackFrame): string => `${String(frame.line)}:${String(frame.column)}`;

function displayPath(file: string, cwd: string): string {
  if (file.startsWith('file://')) {
    try {
      return relative(cwd, fileURLToPath(file));
    } catch {
      return file;
    }
  }
  const prefix = cwd.endsWith(sep) ? cwd : cwd + sep;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

function readExcerpt(frame: StackFrame, cwd: string): readonly ExcerptLine[] | null {
  const path = frame.file.startsWith('file://') ? safeFilePath(frame.file) : frame.file;
  if (path === null) return null;
  let source: string;
  try {
    source = readFileSync(path.startsWith(sep) ? path : `${cwd}${sep}${path}`, 'utf8');
  } catch {
    // An excerpt is a courtesy: it must not hide the error it belongs to.
    return null;
  }
  const lines = source.split('\n');
  if (frame.line > lines.length) return null;
  const first = Math.max(frame.line - EXCERPT_AROUND - 1, 0);
  const last = Math.min(frame.line + EXCERPT_AROUND, lines.length);
  const around = lines.slice(first, last);
  if (around.some((value) => value.length > EXCERPT_MAX_LINE)) return null;
  return around.map((value, index) => ({
    line: first + index + 1,
    value: value.replaceAll('\t', '  '),
    isOrigin: first + index + 1 === frame.line,
  }));
}

function safeFilePath(url: string): string | null {
  try {
    return fileURLToPath(url);
  } catch {
    return null;
  }
}

function stackEntry(line: string, cwd: string): StackEntry {
  const frame = parseStackLine(line);
  if (frame === null) return { name: line, place: null };
  return { name: frame.fn, place: `(${displayPath(frame.file, cwd)}:${locationOf(frame)})` };
}

@Component({
  selector: 'ink-error-overview',
  imports: [InkBox, InkText],
  template: `
    <ink-box flexDirection="column" [padding]="1">
      <ink-box>
        <ink-text backgroundColor="red" color="white">{{ ' ERROR ' }}</ink-text>
        <ink-text>{{ ' ' + view().message }}</ink-text>
      </ink-box>
      @if (view().origin; as origin) {
        <ink-box [marginTop]="1">
          <ink-text dimColor>{{ origin }}</ink-text>
        </ink-box>
      }
      @if (view().excerpt; as excerpt) {
        <ink-box [marginTop]="1" flexDirection="column">
          @for (row of excerpt; track row.line) {
            <ink-box>
              <ink-box [width]="view().gutterWidth + 1">
                <ink-text
                  [dimColor]="!row.isOrigin"
                  [backgroundColor]="row.isOrigin ? 'red' : undefined"
                  [color]="row.isOrigin ? 'white' : undefined"
                  >{{ gutter(row.line) }}</ink-text
                >
              </ink-box>
              <ink-text
                wrap="truncate-end"
                [backgroundColor]="row.isOrigin ? 'red' : undefined"
                [color]="row.isOrigin ? 'white' : undefined"
                >{{ ' ' + row.value }}</ink-text
              >
            </ink-box>
          }
        </ink-box>
      }
      @if (view().stack.length > 0) {
        <ink-box [marginTop]="1" flexDirection="column">
          @for (entry of view().stack; track $index) {
            <ink-box>
              <ink-text dimColor>{{ '- ' }}</ink-text>
              <ink-text dimColor bold>{{ entry.name }}</ink-text>
              @if (entry.place; as place) {
                <ink-text dimColor color="gray">{{ ' ' + place }}</ink-text>
              }
            </ink-box>
          }
        </ink-box>
      }
    </ink-box>
  `,
})
export class InkErrorOverview {
  readonly error = input.required<Error>();
  protected readonly view = computed(() => describeError(this.error()));

  protected gutter(line: number): string {
    return `${String(line).padStart(this.view().gutterWidth, ' ')}:`;
  }
}

/** Paints the overview on a tree of its own: the tree of the app is what just failed. */
export function paintErrorOverview(error: Error, columns: number, yoga: Yoga): CellGrid {
  const ignore = (): void => undefined;
  const tree = mountTree(InkErrorOverview, {
    inputs: { error },
    onCommit: ignore,
    warn: ignore,
    errorHandler: { handleError: ignore },
  });
  try {
    tree.injector.get(ApplicationRef).tick();
    return paintTree(layoutTree(tree.root, columns, yoga));
  } finally {
    tree.destroy();
  }
}
