import { COVERAGE_MARKER } from '../../semantics/coverage/recognize.js';
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

type ShapeGap = Exclude<ResultShapeCapture, { kind: 'ready' }>['kind'];

function hasPlainPrototype(source: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(source);
  return prototype === Object.prototype || prototype === null;
}

function hasDataProperty(source: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor !== undefined && 'value' in descriptor;
}

/** The whole reader can select any own string key, irrespective of JSON visibility. */
function addKeys(
  target: Set<string>,
  source: Readonly<Record<string, unknown>>,
): ShapeGap | undefined {
  if (!hasPlainPrototype(source)) return 'tool-results';
  const keys = Object.getOwnPropertyNames(source);
  if (keys.length > MAX_KEYS) return 'tool-result-key-limit';
  for (const key of keys) {
    if (!hasDataProperty(source, key)) return 'tool-results';
    target.add(key);
    if (target.size > MAX_KEYS || key.length > MAX_KEY_CHARS) return 'tool-result-key-limit';
  }
  return undefined;
}

/** The ordinary reader only consults these three leaves of a dataset ticket. */
function hasStableTicketFields(value: unknown): boolean {
  const ticket = record(value);
  return (
    ticket === undefined ||
    (hasPlainPrototype(ticket) &&
      ['ref', 'sourceField', 'rows'].every(
        (key) => !(key in ticket) || hasDataProperty(ticket, key),
      ))
  );
}

/** Prepare declaration-independent readings using the existing emptiness reader. */
export function capturePlainResultShape(value: unknown): ResultShapeCapture {
  if (typeof value === 'string' && value.length > MAX_RESULT_CHARS) return { kind: 'tool-results' };
  const data = parseMaybeJson(value);
  const top = record(data);
  const names = new Set<string>();
  if (top !== undefined) {
    const gap = addKeys(names, top);
    if (gap !== undefined) return { kind: gap };
  }
  // Coverage envelopes and placement tickets need their own admitted evidence.
  if (
    (top !== undefined && COVERAGE_MARKER in top) ||
    declaredByValue(data) !== undefined ||
    readPlacement(undefined, value, undefined) !== undefined
  )
    return { kind: 'tool-results' };

  const read = (rowsAt?: string) =>
    readEmptiness(data, {
      door: { absent: false, bounded: false },
      ...(rowsAt !== undefined && { rowsAt }),
    });
  const defaultReading = read();
  if (top === undefined) return { kind: 'ready', shape: { defaultReading, keys: [] } };

  const tickets = record(top.datasets);
  const principal = record(top.dataset);
  if (!hasStableTicketFields(principal)) return { kind: 'tool-results' };
  const principalKey = principal?.sourceField;
  if (typeof principalKey === 'string') {
    names.add(principalKey);
    if (names.size > MAX_KEYS || principalKey.length > MAX_KEY_CHARS)
      return { kind: 'tool-result-key-limit' };
  }
  if (tickets !== undefined) {
    const gap = addKeys(names, tickets);
    if (gap !== undefined) return { kind: gap };
    if (
      [...names].some((key) => Object.hasOwn(tickets, key) && !hasStableTicketFields(tickets[key]))
    )
      return { kind: 'tool-results' };
  }
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
