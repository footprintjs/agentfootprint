/**
 * Count the text-reading work one synchronous call does — a count, never a
 * clock.
 *
 * WHY THIS EXISTS
 * -----------------------------------------------------------------------
 * A ReDoS fix has to show that its cost grows with its input and not with the
 * input's square. A timer cannot show that on a shared runner
 * (`test/helpers/perf.ts` explains why), and `expect(ms).toBeLessThan(n)` is a
 * timeout by another name. So the scanners that replaced quadratic regexes read
 * text only through `String.prototype.charCodeAt` and `indexOf`, and this
 * wraps both for the length of ONE call:
 *   - each `charCodeAt` counts 1;
 *   - each `indexOf` counts the characters it could have examined — from where
 *     it started to the end of its match, or to the end of the string on a miss.
 *
 * WHAT IS NOT COUNTED
 * -----------------------------------------------------------------------
 * Regular expressions, `slice`, `split`, `trim`, `endsWith`, `includes`: native
 * work that never enters those two methods. A test using this names what its
 * subject still does through them, and why each is linear (a regex that is
 * linear by construction, a slice of the output).
 *
 * HOW A TEST USES IT
 * -----------------------------------------------------------------------
 * Two bounds on one crafted input of length n. The UPPER bound (a small
 * multiple of n) fails on a scanner that re-reads its input. The LOWER bound
 * (at least the run the scanner had to read) proves the counter saw the scan:
 * a subject that went back to a regex reads nothing through these two methods
 * and fails it — so a green run cannot come from a blind counter.
 *
 * The call must be synchronous (or an async function's synchronous prefix):
 * the methods are restored when it returns, before anything else runs.
 */
export function countTextWork<T>(call: () => T): { readonly result: T; readonly work: number } {
  const proto = String.prototype;
  const charCodeAt = proto.charCodeAt;
  const indexOf = proto.indexOf;
  let work = 0;
  proto.charCodeAt = function countedCharCodeAt(this: string, index: number): number {
    work += 1;
    return charCodeAt.call(this, index);
  };
  proto.indexOf = function countedIndexOf(this: string, search: string, position?: number): number {
    const text = String(this);
    const from = Math.min(Math.max(Math.trunc(Number(position ?? 0)) || 0, 0), text.length);
    const found = indexOf.call(text, search, from);
    work += (found === -1 ? text.length : found + String(search).length) - from;
    return found;
  };
  try {
    const result = call();
    return { result, work };
  } finally {
    proto.charCodeAt = charCodeAt;
    proto.indexOf = indexOf;
  }
}
