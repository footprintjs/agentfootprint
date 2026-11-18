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

/** Use own enumerable names or the fixed name for a whole value. */
export function argumentNames(value: unknown): readonly string[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object') return [WHOLE_ARGUMENT_NAME];
  try {
    return Object.keys(value);
  } catch {
    return [];
  }
}

export function maskArguments(names: readonly string[]): ArgumentRecord {
  return Object.freeze(Object.fromEntries(names.map((name) => [name, ARGUMENT_PLACEHOLDER])));
}
