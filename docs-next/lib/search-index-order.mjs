/**
 * Canonical input order for the static search index (pure, non-mutating).
 * File discovery is asynchronous; Orama's numeric IDs and postings depend on
 * insertion order. Sort stable URLs/IDs, not locale-dependent titles, before
 * indexing. Preserve every record and its contents; tied search scores may
 * now resolve in this deterministic order instead of filesystem order.
 *
 * @template {{ url: string, id: string }} T
 * @param {readonly T[]} indexes Unique page indexes, including homepage chapters.
 * @returns {T[]}
 */
export function orderSearchIndexes(indexes) {
  return [...indexes].sort((a, b) => {
    if (a.url !== b.url) return a.url < b.url ? -1 : 1;
    return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
  });
}
