/** Plain argument data and placeholder construction shared by approval and browser views. */
import { copyJson, ownData } from './boundedJson.js';

export const ARGUMENT_PLACEHOLDER = 'REDACTED';
const WHOLE_ARGUMENT_NAME = 'arguments';

export type ArgumentRecord = Readonly<Record<string, unknown>>;

/** Read own data fields from a plain record. */
export function readArgumentRecord(value: unknown): ArgumentRecord | undefined {
  try {
    return ownData(value);
  } catch {
    return undefined;
  }
}

/** Read a detached display record without calling any of its fields as code. */
export function copyArgumentDisplay(value: unknown): ArgumentRecord | undefined {
  try {
    return copyJson(ownData(value), Infinity, true) as ArgumentRecord;
  } catch {
    return undefined;
  }
}

/** A whole value without argument names. Null and undefined represent absence here. */
export function hasWholeArgumentValue(value: unknown): boolean {
  return value !== undefined && value !== null && typeof value !== 'object';
}

/** This marker applies to the scalar itself, even when a record has a field named "arguments". */
export function hidesWholeArgumentValue(value: unknown, names: unknown): boolean {
  return (
    hasWholeArgumentValue(value) &&
    Array.isArray(names) &&
    names.length === 1 &&
    names[0] === WHOLE_ARGUMENT_NAME
  );
}

/** Use own enumerable names or the fixed name for a whole value. */
export function argumentNames(value: unknown): readonly string[] {
  if (hasWholeArgumentValue(value)) return [WHOLE_ARGUMENT_NAME];
  try {
    return typeof value === 'object' && value !== null ? Object.keys(value) : [];
  } catch {
    return [];
  }
}

export function maskArguments(names: readonly string[]): ArgumentRecord {
  return Object.freeze(Object.fromEntries(names.map((name) => [name, ARGUMENT_PLACEHOLDER])));
}
