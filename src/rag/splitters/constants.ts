/**
 * The two numbers every splitter defaults to, in one place so they cannot
 * drift apart between strategies.
 *
 * See `splitters/index.ts` for the measurement they come from: `localEmbedder`
 * truncates at 512 wordpiece tokens (~1,800–2,000 characters), silently, and
 * 1,000 characters is ~250 tokens — comfortably inside it.
 */

/** Target chunk size in characters. ~250 wordpiece tokens of English. */
export const DEFAULT_MAX_CHARS = 1000;

/** Overlap between adjacent chunks, so a boundary-spanning sentence is whole somewhere. */
export const DEFAULT_OVERLAP_CHARS = 150;

/**
 * Below this, a trailing fragment is folded back into the previous chunk
 * rather than shipped on its own. A 12-character chunk consisting of one
 * heading and no body embeds to noise and takes a top-K slot from a real
 * passage.
 */
export const MIN_CHUNK_CHARS = 50;
