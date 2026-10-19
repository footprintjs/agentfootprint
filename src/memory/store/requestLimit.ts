/**
 * Private MemoryStore boundary rule. Capture once so the checked number is the
 * one the adapter uses; defaults and provider-specific upper caps stay local.
 */
export function storeRequestLimit(
  value: number | undefined,
  option: 'limit' | 'k',
): number | undefined {
  if (value === undefined || (Number.isInteger(value) && value > 0)) return value;
  const method = option === 'limit' ? 'list' : 'search';
  throw new RangeError(
    `MemoryStore.${method}(): \`${option}\` must be a positive integer when provided.`,
  );
}
