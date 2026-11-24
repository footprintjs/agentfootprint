/** The exact tool names the host selected to share a turn's confirmed interval. */
export interface ComparisonIntent {
  readonly tools: readonly string[];
}

/** Read the same closed shape at run admission and when checking saved evidence. */
export function comparisonIntentOf(value: unknown): ComparisonIntent | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== 'tools') return undefined;
  const property = Object.getOwnPropertyDescriptor(value, 'tools');
  const tools = property?.value as unknown;
  if (!Array.isArray(tools)) return undefined;
  const count = tools.length;
  if (!Number.isInteger(count) || count < 2 || count > 256) return undefined;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    const entry = Object.getOwnPropertyDescriptor(tools, i);
    const name = entry?.value as unknown;
    if (typeof name !== 'string' || name.length > 256 || name.trim().length === 0) return undefined;
    if (names.has(name)) return undefined;
    names.add(name);
  }
  return Object.freeze({ tools: Object.freeze([...names]) });
}
