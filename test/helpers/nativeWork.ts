/**
 * Count native text admissions during ONE synchronous call, never elapsed time.
 * These are search windows / split input volumes, not V8 backtracking steps.
 * Native matching and allocation costs remain unobserved; a linear admission
 * bound is not a theorem about an arbitrary regular expression's complexity.
 */
export function countRegexInputWork<T>(call: () => T): {
  readonly result: T;
  readonly work: number;
  readonly calls: number;
} {
  const original = RegExp.prototype.exec;
  const global = Object.getOwnPropertyDescriptor(RegExp.prototype, 'global')!.get!;
  const sticky = Object.getOwnPropertyDescriptor(RegExp.prototype, 'sticky')!.get!;
  let work = 0;
  let calls = 0;
  RegExp.prototype.exec = function countedExec(this: RegExp, input: string) {
    // Native flag getters bypass author-defined properties. An invalid native
    // receiver delegates unchanged, without reading an author's lastIndex.
    let resumes: boolean;
    try {
      resumes = global.call(this) || sticky.call(this);
    } catch {
      return original.call(this, input);
    }
    const before = this.lastIndex;
    calls++;
    const result = original.call(this, input);
    // Do not coerce an input/lastIndex twice: their native coercions may have
    // effects. Only already-string inputs and numeric cursors are counted.
    if (typeof input === 'string' && (!resumes || typeof before === 'number')) {
      const from = resumes ? Math.min(input.length, Math.max(0, Math.trunc(before) || 0)) : 0;
      const end = result === null ? input.length : result.index + result[0].length;
      work += Math.max(0, end - from);
    }
    return result;
  };
  try {
    return { result: call(), work, calls };
  } finally {
    RegExp.prototype.exec = original;
  }
}

/** Count each primitive string handed to split; native splitting remains opaque. */
export function countSplitInputWork<T>(call: () => T): {
  readonly result: T;
  readonly work: number;
  readonly calls: number;
} {
  const original = String.prototype.split;
  let work = 0;
  let calls = 0;
  String.prototype.split = function countedSplit(
    this: string,
    separator?: string | RegExp | { [Symbol.split](text: string, limit?: number): string[] },
    limit?: number,
  ) {
    calls++;
    if (typeof this === 'string') work += this.length;
    return (original as (this: string, separator: unknown, limit?: number) => string[]).call(
      this,
      separator,
      limit,
    );
  };
  try {
    return { result: call(), work, calls };
  } finally {
    String.prototype.split = original;
  }
}
