/**
 * splitDocuments — documents become chunks that know where they came from.
 *
 * Pattern: application of the `Splitter` strategy, plus identity and hashing.
 * Role:    rag/ layer. Step two of the pipeline.
 * Emits:   N/A — `indexCorpus` wraps this in a stage and records what it did.
 *
 * The splitter decides WHERE to cut; this decides what a cut is CALLED and how
 * a later run recognises it:
 *
 *  - **id** is `'<docUri>#<index>'` — stable across runs for an unchanged
 *    document, human-readable, and the string the model is asked to cite.
 *  - **contentHash** is sha-256 of the chunk text. Two runs over an unchanged
 *    document produce identical hashes, which is what makes "skip this one"
 *    a fact rather than a guess about mtimes.
 *
 * The invariant every splitter must hold — `doc.text.slice(charStart, charEnd)
 * === chunk.text` — is CHECKED here rather than trusted, because a custom
 * splitter is a supported thing to write and a silently wrong offset produces
 * citations that point at the wrong words.
 */
import { sha256 } from './hash.js';
import type { Chunk, LoadedDocument, Splitter } from './types.js';

export interface SplitDocumentsOptions {
  /**
   * Verify each piece against its own offsets and throw on a mismatch.
   * Default true. There is no good reason to turn it off except a splitter
   * that deliberately rewrites text, in which case its citations cannot be
   * checked against the source and you should know that.
   */
  readonly verifyOffsets?: boolean;
}

/**
 * Cut documents into chunks.
 *
 * @throws when a splitter returns a piece whose offsets do not match its text.
 *
 * @example
 * ```ts
 * const chunks = splitDocuments(documents, byHeading());
 * ```
 */
export function splitDocuments(
  documents: readonly LoadedDocument[],
  splitter: Splitter,
  options: SplitDocumentsOptions = {},
): readonly Chunk[] {
  const verify = options.verifyOffsets ?? true;
  const chunks: Chunk[] = [];

  for (const doc of documents) {
    const pieces = splitter.split(doc);
    let index = 0;
    for (const piece of pieces) {
      if (verify && doc.text.slice(piece.charStart, piece.charEnd) !== piece.text) {
        throw new Error(
          `splitter '${splitter.name}' produced a chunk of '${doc.uri}' whose offsets do not ` +
            `match its text (chars ${piece.charStart}–${piece.charEnd}). A chunk that cannot be ` +
            `located in its own document produces citations that point at the wrong words, so ` +
            `this refuses rather than indexing it. Splitters must slice the document rather ` +
            `than rebuild the text.`,
        );
      }
      if (piece.text.length === 0) continue;
      chunks.push({
        id: `${doc.uri}#${index}`,
        docUri: doc.uri,
        index,
        text: piece.text,
        charStart: piece.charStart,
        charEnd: piece.charEnd,
        ...(piece.page !== undefined && { page: piece.page }),
        ...(piece.heading !== undefined && { heading: piece.heading }),
        contentHash: sha256(piece.text),
      });
      index += 1;
    }
  }

  return chunks;
}
