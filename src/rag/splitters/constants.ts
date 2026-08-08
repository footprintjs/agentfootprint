/**
 * The numbers every splitter defaults to, in one place so they cannot
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

/**
 * The default `minChars` floor for the structural splitters (`byHeading`,
 * `byParagraph`), at the default `maxChars`. A section or paragraph whose own
 * text is under the floor is merged FORWARD into the next chunk rather than
 * shipped alone (8.20.0).
 *
 * Why a floor at all, and why this number: short chunks do not merely retrieve
 * badly — they retrieve TOO WELL. Similarity is a density measure, and a
 * heading plus one preamble sentence concentrates its topic's vocabulary with
 * none of its substance. Measured in a production corpus: a 180-character
 * heading-and-preamble chunk outscored the 1,032-character body of its own
 * section, 0.430 against lower — so the model was handed a passage that
 * PROMISES findings, contains none, and fabricated a plausible file path to
 * fill the gap. 250 characters (~60 tokens) sits comfortably above that
 * measured failure, is a quarter of the default target, and keeps a
 * floor-merged chunk (short section + a full neighbour ≤ ~1,250 chars ≈ 310
 * tokens) far inside the 512-wordpiece-token embedder cliff.
 *
 * The effective default scales with the caller's own target: it is
 * `min(250, maxChars / 4)`, so `byHeading({ maxChars: 400 })` gets a 100-char
 * floor rather than one bigger than half its chunks.
 */
export const DEFAULT_MIN_CHARS = 250;
