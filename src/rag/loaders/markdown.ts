/**
 * markdownLoader — Markdown, kept as Markdown.
 *
 * Pattern: Adapter behind `DocumentLoader`.
 * Role:    rag/ layer. Zero dependency, and it deliberately does NOT parse.
 * Emits:   N/A.
 *
 * ── Why the markup stays ────────────────────────────────────────────────────
 * The obvious thing to do here is strip the syntax and hand over prose. It is
 * the wrong thing, twice over:
 *
 *  1. **The headings are the document's own structure.** `byHeading` cuts on
 *     `#` lines, which is the one splitting rule in this library that is not a
 *     heuristic — the author already told us where the sections are. Stripping
 *     `#` throws that away and leaves us guessing at boundaries we were handed.
 *  2. **Stripping shifts every offset.** `text.slice(charStart, charEnd)` has to
 *     equal the chunk, against the text that was stored. A loader that rewrites
 *     text and then reports offsets into the original is reporting fiction.
 *
 * Models read Markdown perfectly well; a table that survives as a table is
 * more useful in a prompt than the same table flattened into a word salad.
 *
 * What it DOES do is the same normalisation `textLoader` does, for the same
 * reason: line endings, before any offset exists.
 */
import type { DocumentInput, DocumentLoader, LoadedDocumentDraft } from '../types.js';
import { decodeText } from './text.js';

export function markdownLoader(): DocumentLoader {
  return {
    name: 'markdown',
    extensions: ['.md', '.markdown', '.mdx'],
    // eslint-disable-next-line @typescript-eslint/require-await
    async load(input: DocumentInput): Promise<LoadedDocumentDraft> {
      return { text: decodeText(input.bytes) };
    },
  };
}
