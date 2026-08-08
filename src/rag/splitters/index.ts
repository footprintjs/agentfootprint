/**
 * rag/splitters — where a document gets cut, and why there.
 *
 * Pattern: Strategy family (factory functions), the same shape as the window
 *          and retrieval families. Not a `{ kind }` union: a splitter you write
 *          yourself is the same shape as these, unused ones stay out of a
 *          bundle, and adding one needs no switch edited anywhere.
 * Role:    rag/ layer.
 * Emits:   N/A.
 *
 * ── The defaults, and the measurement behind them ───────────────────────────
 *
 * `maxChars: 1000`, `overlapChars: 150`. Those numbers are chosen by
 * CONSTRAINT, not by fashion, and the constraint is measurable:
 *
 * **`localEmbedder`'s default model silently truncates at 512 wordpiece
 * tokens.** Measured directly — embed a long text, embed the same text with an
 * unrelated tail appended, and compare. At 508 base tokens the tail still
 * moves the vector (cosine 0.9965). At 596 it does not (cosine 0.999999): the
 * tail was discarded and nothing said so. 512 wordpiece tokens is roughly
 * 1,800–2,000 characters of English.
 *
 * A chunk of 1,000 characters is about 250 tokens. That sits comfortably
 * inside that cliff, inside the 256-token length the sentence-transformer
 * family was actually trained at, and trivially inside `openaiEmbedder`'s
 * 8,191. Raise it and you approach a limit whose failure mode is silence —
 * half your chunk embedded, full score reported.
 *
 * The 150-character overlap (15%) exists so a sentence spanning a boundary is
 * whole in one of the two neighbours. It is the smallest overlap that reliably
 * does that for English prose; there is nothing deeper claimed for it.
 *
 * **`minChars` (8.20.0): the floor, from a different measurement.** Short
 * chunks retrieve too WELL, not too badly — similarity is a density measure,
 * and a heading plus a preamble sentence concentrates a topic's vocabulary
 * with none of its substance. Measured in a production corpus: a 180-char
 * heading-and-preamble chunk outranked its own section's 1,032-char body, and
 * the model fabricated a citation to fill the promise the empty chunk made.
 * `byHeading` and `byParagraph` therefore merge sub-floor chunks FORWARD into
 * the next chunk (default floor `min(250, maxChars / 4)`; nothing is ever
 * dropped, and a heading with no body is never emitted alone regardless of
 * the floor). `fixedWithOverlap` does not have the failure shape — its chunks
 * are uniformly `chars` long BY REQUEST, and its only runt (the file tail) has
 * always folded backward — and `wholeDocument` is one-chunk-per-document by
 * definition, so neither takes the option.
 *
 * ── Which one to use ────────────────────────────────────────────────────────
 *
 * | splitter | cuts on | use when |
 * |---|---|---|
 * | `byHeading()` | Markdown `#` lines | the document declares its own sections — **not a heuristic** |
 * | `byParagraph()` | blank lines | prose with no headings |
 * | `fixedWithOverlap()` | character count | text with no structure at all (transcripts, OCR) |
 * | `wholeDocument()` | nothing | short documents that are already one idea |
 *
 * `byHeading` is the only one that is not guessing. The author already marked
 * where the sections are; the others are inferring boundaries from typography.
 * That is why it is the default for Markdown.
 */
export { byParagraph, type ByParagraphOptions } from './byParagraph.js';
export { byHeading, type ByHeadingOptions } from './byHeading.js';
export { fixedWithOverlap, type FixedWithOverlapOptions } from './fixedWithOverlap.js';
export { wholeDocument } from './wholeDocument.js';
export { DEFAULT_MAX_CHARS, DEFAULT_OVERLAP_CHARS, DEFAULT_MIN_CHARS } from './constants.js';
