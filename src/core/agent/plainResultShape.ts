import type { ResultShapeCapture } from '../../semantics/resultShape.js';
import { readPlacement } from './placedTickets.js';
import { declaredByValue, parseMaybeJson, readEmptiness } from './emptiness.js';

const MAX_KEYS = 64;
const MAX_KEY_CHARS = 512;
const MAX_RESULT_CHARS = 1024 * 1024;

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function addKeys(target: Set<string>, source: Readonly<Record<string, unknown>>): boolean {
  for (const key in source) {
    if (!Object.hasOwn(source, key)) continue;
    target.add(key);
    if (target.size > MAX_KEYS || key.length > MAX_KEY_CHARS) return false;
  }
  return true;
}

/** Prepare declaration-independent readings using the existing emptiness reader. */
export function capturePlainResultShape(value: unknown): ResultShapeCapture {
  if (typeof value === 'string' && value.length > MAX_RESULT_CHARS) return { kind: 'tool-results' };
  const data = parseMaybeJson(value);
  // These result families need additional evidence before a projected view can judge them.
  if (
    declaredByValue(data) !== undefined ||
    readPlacement(undefined, value, undefined) !== undefined
  )
    return { kind: 'tool-results' };
  const top = record(data);
  const read = (rowsAt?: string) =>
    readEmptiness(data, {
      door: { absent: false, bounded: false },
      ...(rowsAt !== undefined && { rowsAt }),
    });
  const defaultReading = read();
  if (top === undefined) return { kind: 'ready', shape: { defaultReading, keys: [] } };

  const names = new Set<string>();
  const tickets = record(top.datasets);
  const principal = record(top.dataset)?.sourceField;
  if (typeof principal === 'string') names.add(principal);
  if (
    (typeof principal === 'string' && principal.length > MAX_KEY_CHARS) ||
    !addKeys(names, top) ||
    (tickets !== undefined && !addKeys(names, tickets))
  )
    return { kind: 'tool-result-key-limit' };
  let absent = 'absent';
  while (names.has(absent)) absent += '_';
  return {
    kind: 'ready',
    shape: {
      defaultReading,
      absentKeyReading: read(absent),
      keys: [...names].map((key) => [key, read(key)] as const),
    },
  };
}
