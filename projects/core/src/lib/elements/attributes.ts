import { booleanAttribute, numberAttribute } from '@angular/core';

/** A size in cells, or a percentage of the parent such as `'50%'`. */
export type InkSize = number | `${number}%`;

// These keep `undefined` as "not set": the engine leaves the Yoga default alone then.
// A bare `numberAttribute(undefined)` would give NaN and `booleanAttribute(undefined)` false.

export function optionalNumber(value: unknown): number | undefined {
  return value === undefined || value === null ? undefined : numberAttribute(value);
}

export function optionalBoolean(value: unknown): boolean | undefined {
  return value === undefined || value === null ? undefined : booleanAttribute(value);
}

/** Static attributes arrive as strings: `"4"` becomes 4 and `"50%"` stays as it is. */
export function sizeAttribute(value: unknown): InkSize | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && value.endsWith('%')) return value as InkSize;
  return numberAttribute(value);
}

/** The props whose value is defined, so a style left unset never shows up as `undefined`. */
export function definedProps(readers: Record<string, () => unknown>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [name, read] of Object.entries(readers)) {
    const value = read();
    if (value !== undefined) props[name] = value;
  }
  return props;
}
