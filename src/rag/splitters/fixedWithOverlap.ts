/**
 * fixedWithOverlap — cut every `chars` characters, overlapping by `overlapChars`.
 *
 * Pattern: Strategy (one of `Splitter`).
 * Role:    rag/ layer. The fallback for text with no structure to read:
 *          transcripts, OCR output, scraped bodies with the markup gone.
 * Emits:   N/A.
 *
 * It is the least informed strategy and it is honest about that: it cuts where
 * the counter says, which will sometimes be mid-sentence. The overlap is what
 * makes that survivable — a sentence broken at a boundary is whole in the next
 * chunk. Prefer `byHeading` or `byParagraph` whenever the document gives you
 * anything to work with.
 *
 * Cuts are nudged to the nearest word boundary within a small window, so the
 * common case does not split a word in half. The offsets move with the nudge;
 * they always index the source.
 */
import type { LoadedDocument, Splitter, SplitPiece } from '../types.js';
import { DEFAULT_MAX_CHARS, DEFAULT_OVERLAP_CHARS } from './constants.js';
import { applyOverlap, foldRunts, toPieces, type Span } from './shared.js';

export interface FixedWithOverlapOptions {
  /** Characters per chunk. Default 1000. */
  readonly chars?: number;
  /** Backward overlap. Default 150. */
  readonly overlapChars?: number;
  /**
   * How far to look for a word boundary before accepting a mid-word cut.
   * Default 40 characters. Set 0 to cut exactly on the count.
   */
  readonly wordWindow?: number;
}

export function fixedWithOverlap(options: FixedWithOverlapOptions = {}): Splitter {
  const chars = options.chars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  const wordWindow = options.wordWindow ?? 40;

  return {
    name: 'fixedWithOverlap',
    split(doc: LoadedDocument): readonly SplitPiece[] {
      const text = doc.text;
      const spans: Span[] = [];
      let start = 0;
      while (start < text.length) {
        let end = Math.min(text.length, start + chars);
        // Nudge back to whitespace, but never past the window and never so far
        // that the chunk collapses.
        if (end < text.length && wordWindow > 0) {
          const floor = Math.max(start + 1, end - wordWindow);
          let candidate = end;
          while (candidate > floor && !/\s/.test(text[candidate] ?? '')) candidate -= 1;
          if (candidate > floor) end = candidate;
        }
        spans.push({ start, end });
        if (end >= text.length) break;
        start = end;
      }
      return toPieces(doc, applyOverlap(foldRunts(spans), overlapChars));
    },
  };
}
