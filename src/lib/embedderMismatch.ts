/**
 * EmbedderMismatchError — one class, for every store that can tell.
 *
 * Pattern: shared refusal type (the `SqliteUnavailableError` precedent).
 * Role:    lib/, so no store adapter owns it and none has to import another.
 * Emits:   N/A.
 *
 * It lived inside `sqliteVector.ts` from 8.9.0 until 9.3.0, when a second and
 * a third store learned to make the same check. A duplicate class of the same
 * name would mean `catch (e) { if (e instanceof EmbedderMismatchError) }`
 * quietly depended on WHICH store threw — so there is exactly one, here, and
 * the stores import it.
 */

/**
 * Raised when a vector meets an index built by a different embedder.
 *
 * **This is the refusal that keeps a vector store honest.** Cosine similarity
 * between two different embedding spaces is not a weak signal — it is not a
 * signal at all, and it comes back as a confident number in the same 0-to-1
 * range as a real one. There is no threshold that separates them, and nothing
 * downstream can tell them apart. So the mismatch is refused where it happens,
 * on both sides:
 *
 *  - at **write**, so a second embedder's vectors never enter a namespace;
 *  - at **query**, so a swapped embedder never scores against the old ones.
 *
 * The named fix is an explicit re-index — delete the namespace and build it
 * again with one embedder, or point the retriever somewhere else. It is never a
 * fallback: silently ignoring the mismatch is the failure, and silently
 * re-embedding somebody's corpus is a bill they did not agree to.
 *
 * `problem` says which half is wrong. `'dimensions'` is arithmetically
 * impossible to score at all; `'model'` would score, and lie.
 */
export class EmbedderMismatchError extends Error {
  readonly code = 'ERR_EMBEDDER_MISMATCH' as const;
  /** The fingerprint the namespace was built with, `'<id>@<dims>'`. */
  readonly indexed: string;
  /** The fingerprint that just arrived. */
  readonly incoming: string;
  /** Which half disagrees. */
  readonly problem: 'dimensions' | 'model';

  /**
   * @param alternative the store-specific second way out, named in the
   *   message. A file-backed store says "point this store at a different
   *   file"; a service-backed one names its own unit of separation.
   */
  constructor(
    namespace: string,
    indexed: string,
    incoming: string,
    problem: EmbedderMismatchError['problem'],
    operation: 'write to' | 'search',
    alternative = 'point this store at a different index',
  ) {
    super(
      `[memory] cannot ${operation} the namespace '${namespace}': it was indexed by ` +
        `'${indexed}' and this vector is from '${incoming}'. ` +
        (problem === 'dimensions'
          ? `Vectors of different lengths cannot be compared at all. `
          : `Cosine similarity between two embedding spaces is not a weak signal — it is ` +
            `not a signal, and it comes back as a confident number in the same range as a ` +
            `real one, which no threshold can separate. `) +
        `Re-index this namespace with one embedder (delete it and build it again), or ` +
        `${alternative}. This refuses rather than re-embedding ` +
        `your corpus on your behalf — that is a bill you did not agree to — and rather ` +
        `than mixing the two, which would silently corrupt every ranking it touched.`,
    );
    this.name = 'EmbedderMismatchError';
    this.indexed = indexed;
    this.incoming = incoming;
    this.problem = problem;
  }
}

/** An embedder fingerprint, split into the two halves that decide separately. */
export interface Fingerprint {
  readonly id?: string;
  readonly dims: number;
}

/** `'<id>@<dims>'`, with `'?'` for an embedder that did not name itself. */
export function fingerprintText(fp: Fingerprint): string {
  return `${fp.id ?? '?'}@${fp.dims}`;
}

/** Parse the `'<id>@<dims>'` form back into its halves. */
export function parseFingerprint(text: string): Fingerprint {
  const at = text.lastIndexOf('@');
  const id = at === -1 ? '?' : text.slice(0, at);
  const dims = at === -1 ? 0 : Number(text.slice(at + 1));
  return {
    ...(id !== '?' && id !== '' && { id }),
    dims: Number.isFinite(dims) ? dims : 0,
  };
}

/**
 * What, if anything, makes these two incompatible.
 *
 * Dimensions always decide: two lengths cannot be compared at all. Model ids
 * decide only when BOTH sides named themselves — an anonymous vector is not
 * evidence of a different embedder, and refusing on absence would break every
 * caller who never passed an `embedderId`, which is most of them.
 */
export function fingerprintConflict(
  stored: Fingerprint,
  incoming: Fingerprint,
): 'dimensions' | 'model' | null {
  if (stored.dims !== incoming.dims) return 'dimensions';
  if (stored.id !== undefined && incoming.id !== undefined && stored.id !== incoming.id) {
    return 'model';
  }
  return null;
}
