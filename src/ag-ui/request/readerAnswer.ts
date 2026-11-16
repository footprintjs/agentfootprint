const isThenable = (value: unknown): boolean =>
  typeof (value as { then?: unknown } | null | undefined)?.then === 'function';

/**
 * A custom reader's answer as plain JSON — every value read ONCE, here: a
 * getter, a proxy or a `toJSON` cannot answer the core's check one way and its
 * plan another. JSON's own rules apply (a non-finite number becomes `null`); a
 * value JSON cannot hold (a cycle, a BigInt, nesting too deep to write) is
 * refused as a malformed request.
 */
function plainJson(value: unknown): unknown {
  const text = JSON.stringify(value);
  return text === undefined ? undefined : (JSON.parse(text) as unknown);
}

export { isThenable, plainJson };
