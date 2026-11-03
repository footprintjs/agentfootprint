/** Describe a response by shape, never by content — it may carry customer text. */
export function describeShape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    return keys.length === 0 ? 'an object with no keys' : `an object with keys: ${keys.join(', ')}`;
  }
  return typeof value;
}
