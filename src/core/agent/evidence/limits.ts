/**
 * The evidence gate's reporting limits — a leaf, no imports.
 *
 * Split out of `gate.ts` so a post-hoc reader (the answer account, which must
 * know that an event's `unsupported` list is sliced at this cap and say "at
 * least") can read the number without loading the extractor and its corpus.
 * `gate.ts` re-exports it, so every existing import keeps working.
 */

/** Most values named in one message, one event payload or one error. */
export const MAX_REPORTED_VALUES = 12;
