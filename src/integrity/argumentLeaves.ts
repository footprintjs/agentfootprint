/**
 * argumentLeaves — what "a string argument" MEANS, in one place.
 *
 * Pattern: a pure generator leaf, zero imports.
 * Role:    two checks now read the arguments of a tool call — the choice
 *          seam's `unsupported-argument` (did the value come from what the run
 *          served?) and the write seam's `empty-lookup` (the run produced this
 *          value, and the lookup for it came back empty). They must agree,
 *          exactly, about which leaves of an arguments object are candidates
 *          and what their dot-paths are: the second check's whole job is to
 *          notice something about a value the first one already excused, and
 *          two spellings of "every string leaf" would eventually disagree
 *          about which value that was.
 *
 * The dot-path is the finding's `predicate` on both sides (`machine`,
 * `filter.hosts.0`), so it is identity-bearing and not a convenience.
 */

/** Every string leaf of an arguments object, with its dot-path. */
export function* stringLeaves(
  node: unknown,
  path: string,
): Generator<{ path: string; value: string }> {
  if (typeof node === 'string') {
    yield { path, value: node };
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      yield* stringLeaves(node[i], path === '' ? String(i) : `${path}.${String(i)}`);
    }
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      yield* stringLeaves(value, path === '' ? key : `${path}.${key}`);
    }
  }
}

/**
 * Below this, substring matching says nothing. Shared for the same reason the
 * walk is: 'up' and 'a1' land inside unrelated words in any corpus, and a
 * fence that moved on one check and not the other would leave a value one
 * check judges and the other silently skips.
 */
export const MIN_CHECKED_LENGTH = 4;

/** Longest a single value is quoted at inside a finding's message. */
export const MAX_QUOTED_CHARS = 80;

/** One value, clipped to quoting length. */
export function clipValue(value: string): string {
  return value.length <= MAX_QUOTED_CHARS ? value : `${value.slice(0, MAX_QUOTED_CHARS - 1)}…`;
}
