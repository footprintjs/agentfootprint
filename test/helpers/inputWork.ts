/** Count indexed reads of one input array, without a clock or prototype hooks.
 * This sees admissions from the caller's array, not work on later derived
 * copies or native string algorithms. Each caller names that narrower claim.
 */
export function countArrayReads<T>(rows: T[]): { input: T[]; reads: () => number } {
  let count = 0;
  const input = new Proxy(rows, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key)) count += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  return { input, reads: () => count };
}
