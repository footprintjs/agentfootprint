/**
 * byParagraph — cut on blank lines, pack up to `maxChars`.
 *
 * Pattern: Strategy (one of `Splitter`).
 * Role:    rag/ layer. The right default for prose that carries no headings.
 * Emits:   N/A.
 *
 * A blank line is the weakest structural signal a document reliably has, and
 * unlike a character count it at least falls where the author paused. Adjacent
 * paragraphs are packed together until the next one would exceed `maxChars`,
 * so a document of short paragraphs yields whole chunks rather than one chunk
 * per line.
 *
 * A single paragraph longer than `maxChars` is hard-cut — see the note in
 * `shared.ts` on why packing and cutting are separate decisions.
 */
import type { LoadedDocument, Splitter, SplitPiece } from '../types.js';
import { DEFAULT_MAX_CHARS, DEFAULT_OVERLAP_CHARS } from './constants.js';
import { applyOverlap, foldRunts, hardCut, packSpans, paragraphSpans, toPieces } from './shared.js';

export interface ByParagraphOptions {
  /** Target chunk size in characters. Default 1000 — see the family docstring. */
  readonly maxChars?: number;
  /** Backward overlap between adjacent chunks. Default 150. */
  readonly overlapChars?: number;
}

export function byParagraph(options: ByParagraphOptions = {}): Splitter {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  return {
    name: 'byParagraph',
    split(doc: LoadedDocument): readonly SplitPiece[] {
      const paragraphs = paragraphSpans(doc.text);
      const packed = packSpans(paragraphs, maxChars);
      const cut = packed.flatMap((span) =>
        span.end - span.start > maxChars ? hardCut(span, maxChars, overlapChars) : [span],
      );
      return toPieces(doc, applyOverlap(foldRunts(cut), overlapChars));
    },
  };
}
