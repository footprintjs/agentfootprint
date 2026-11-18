/** Plain argument data and placeholder construction shared by approval and browser views. */
import { copyJson, ownData } from './boundedJson.js';

export const ARGUMENT_PLACEHOLDER = 'REDACTED';

export type ArgumentRecord = Readonly<Record<string, unknown>>;

/** Read a detached display record without calling any of its fields as code. */
export function copyArgumentDisplay(value: unknown): ArgumentRecord | undefined {
  try {
    return copyJson(ownData(value), Infinity, true) as ArgumentRecord;
  } catch {
    return undefined;
  }
}

/** Use only own enumerable names. Reading fallback keys never reads a value. */
export function argumentNames(value: unknown): readonly string[] {
  try {
    return typeof value === 'object' && value !== null ? Object.keys(value) : [];
  } catch {
    return [];
  }
}

export function maskArguments(names: readonly string[]): ArgumentRecord {
  return Object.freeze(Object.fromEntries(names.map((name) => [name, ARGUMENT_PLACEHOLDER])));
}
