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
 *
 * Packing already merges neighbours that FIT — but a short paragraph whose
 * next neighbour is near `maxChars` cannot pack and used to ship alone, where
 * its density outranks real passages (the same failure `byHeading` measured;
 * see `DEFAULT_MIN_CHARS`). Since 8.20.0 a chunk under `minChars` merges
 * FORWARD into the next chunk instead — never dropped, never alone.
 */
import type { LoadedDocument, Splitter, SplitPiece } from '../types.js';
import { DEFAULT_MAX_CHARS, DEFAULT_OVERLAP_CHARS } from './constants.js';
import {
  applyOverlap,
  foldRunts,
  hardCut,
  mergeShortSpansForward,
  packSpans,
  paragraphSpans,
  resolveMinChars,
  toPieces,
} from './shared.js';

export interface ByParagraphOptions {
  /** Target chunk size in characters. Default 1000 — see the family docstring. */
  readonly maxChars?: number;
  /** Backward overlap between adjacent chunks. Default 150. */
  readonly overlapChars?: number;
  /**
   * The floor under a chunk, in characters (8.20.0). A packed chunk that
   * remains shorter — a stray short paragraph that could not pack with its
   * full-sized neighbour — merges FORWARD into the next chunk rather than
   * shipping alone. Default `min(250, maxChars / 4)`; `0` disables. See
   * `DEFAULT_MIN_CHARS` for the measured failure behind the number.
   */
  readonly minChars?: number;
}

export function byParagraph(options: ByParagraphOptions = {}): Splitter {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  const minChars = resolveMinChars(options.minChars, maxChars);

  return {
    name: 'byParagraph',
    split(doc: LoadedDocument): readonly SplitPiece[] {
      const paragraphs = paragraphSpans(doc.text);
      const packed = packSpans(paragraphs, maxChars);
      const cut = packed.flatMap((span) =>
        span.end - span.start > maxChars ? hardCut(span, maxChars, overlapChars) : [span],
      );
      const floored = mergeShortSpansForward(foldRunts(cut), minChars);
      return toPieces(doc, applyOverlap(floored, overlapChars));
    },
  };
}
