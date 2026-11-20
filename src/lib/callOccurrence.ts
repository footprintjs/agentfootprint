/**
 * Library-owned recording address: four random unsigned 32-bit words followed
 * by the call's position in the accepted batch.
 *
 * The values are independent of caller data, provider IDs and tool arguments.
 * Numeric fields work with the existing served-record redaction rules.
 */
export type CallOccurrenceKey = readonly [number, number, number, number, number];

/** Copy the address at a record boundary so an event listener cannot change its owner. */
export function callOccurrenceField(key: CallOccurrenceKey | undefined) {
  return key === undefined ? {} : { callOccurrenceKey: Object.freeze([...key] as const) };
}

/** Read the canonical comparison value from stored data. Null marks a field
 * present but unreadable. An absent field is the legacy record case. */
export function readCallOccurrenceKey(record: object): string | null | undefined {
  const field = Object.getOwnPropertyDescriptor(record, 'callOccurrenceKey');
  if (field === undefined) return undefined;
  const key: unknown = field.value;
  if (!Array.isArray(key) || key.length !== 5) return null;
  const words: number[] = [];
  for (let index = 0; index < 5; index++) {
    const value: unknown = Object.getOwnPropertyDescriptor(key, String(index))?.value;
    const limit = index < 4 ? 0xffffffff : Number.MAX_SAFE_INTEGER;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > limit)
      return null;
    words.push(value);
  }
  return words.join('.');
}

/** Copy an address that has passed the stored-data shape check. */
export function storedCallOccurrenceField(record: object) {
  const key = Object.getOwnPropertyDescriptor(record, 'callOccurrenceKey')?.value as
    | CallOccurrenceKey
    | undefined;
  return callOccurrenceField(typeof readCallOccurrenceKey(record) === 'string' ? key : undefined);
}
