/**
 * wholeDocument — one chunk per document, no cutting at all.
 *
 * Pattern: Strategy (one of `Splitter`).
 * Role:    rag/ layer. For corpora whose documents are already one idea each —
 *          FAQ entries, product records, support macros, changelog entries.
 * Emits:   N/A.
 *
 * The honest caveat: an embedder truncates, so a document past the model's
 * input ceiling is embedded from its opening only, and the rest is invisible
 * to retrieval while still being injected if it is retrieved. `indexCorpus`
 * records exactly that as `truncated[]` rather than letting it pass — but the
 * fix is a real splitter, not a bigger number.
 */
import type { LoadedDocument, Splitter, SplitPiece } from '../types.js';
import { toPieces } from './shared.js';

export function wholeDocument(): Splitter {
  return {
    name: 'wholeDocument',
    split(doc: LoadedDocument): readonly SplitPiece[] {
      return toPieces(doc, [{ start: 0, end: doc.text.length }]);
    },
  };
}
