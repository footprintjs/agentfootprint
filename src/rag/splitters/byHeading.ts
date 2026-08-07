/**
 * byHeading — cut where the author already said a section starts.
 *
 * Pattern: Strategy (one of `Splitter`).
 * Role:    rag/ layer. The default for Markdown, and the only splitter in this
 *          library that is **not a heuristic**.
 * Emits:   N/A.
 *
 * Every other strategy infers boundaries from typography. This one reads them:
 * a Markdown `#` line is the document telling you where a section begins, and
 * ignoring that in favour of a character count is throwing away the best
 * information in the file.
 *
 * Each chunk carries its heading, which flows through to the citation the
 * model sees — `<source id="refunds.md#3" heading="Refund timing">` — so a
 * reader can find the passage by name rather than by counting characters.
 *
 * A section longer than `maxChars` is packed by paragraph within the section
 * and, failing that, hard-cut; every piece keeps the heading it came from.
 * Text before the first heading (a preamble, a title block) is its own
 * heading-less section rather than being attached to a heading it precedes.
 */
import type { LoadedDocument, Splitter, SplitPiece } from '../types.js';
import { DEFAULT_MAX_CHARS, DEFAULT_OVERLAP_CHARS } from './constants.js';
import {
  applyOverlap,
  foldRunts,
  hardCut,
  packSpans,
  paragraphSpans,
  toPieces,
  type Span,
} from './shared.js';

export interface ByHeadingOptions {
  /** Target chunk size in characters. Default 1000. Sections longer than this are packed within. */
  readonly maxChars?: number;
  /** Backward overlap. Default 150. */
  readonly overlapChars?: number;
  /**
   * Deepest heading level that starts a new section (1 = `#` only, 6 = all).
   * Default 6 — every heading is a boundary. Lower it when a document uses
   * `####` for emphasis rather than structure.
   */
  readonly maxLevel?: number;
}

/** ATX headings only (`# Title`). Setext (`Title\n=====`) is rare in docs corpora. */
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*$/gm;

export function byHeading(options: ByHeadingOptions = {}): Splitter {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  const maxLevel = options.maxLevel ?? 6;

  return {
    name: 'byHeading',
    split(doc: LoadedDocument): readonly SplitPiece[] {
      const text = doc.text;
      // Where each section starts, and what it is called.
      const starts: { offset: number; heading?: string }[] = [];
      HEADING.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = HEADING.exec(text)) !== null) {
        if ((match[1] ?? '').length > maxLevel) continue;
        starts.push({ offset: match.index, heading: match[2] });
      }

      // A document with no headings at all is a paragraph document; say so by
      // doing the paragraph thing rather than returning one giant chunk.
      if (starts.length === 0) {
        const packed = packSpans(paragraphSpans(text), maxChars);
        const cut = packed.flatMap((s) =>
          s.end - s.start > maxChars ? hardCut(s, maxChars, overlapChars) : [s],
        );
        return toPieces(doc, applyOverlap(foldRunts(cut), overlapChars));
      }

      const sections: Span[] = [];
      // Preamble before the first heading — its own section, unnamed.
      const firstStart = starts[0]?.offset ?? 0;
      if (firstStart > 0) sections.push({ start: 0, end: firstStart });
      for (let i = 0; i < starts.length; i++) {
        const start = starts[i]?.offset ?? 0;
        const end = starts[i + 1]?.offset ?? text.length;
        const heading = starts[i]?.heading;
        sections.push({ start, end, ...(heading !== undefined && { heading }) });
      }

      // Sections that fit stay whole; the rest are packed by paragraph WITHIN
      // the section, so a boundary never merges two headings' content.
      const spans: Span[] = [];
      for (const section of sections) {
        if (section.end - section.start <= maxChars) {
          spans.push(section);
          continue;
        }
        const inner = paragraphSpans(text.slice(section.start, section.end)).map((s) => ({
          start: section.start + s.start,
          end: section.start + s.end,
          ...(section.heading !== undefined && { heading: section.heading }),
        }));
        for (const packedSpan of packSpans(inner, maxChars)) {
          if (packedSpan.end - packedSpan.start > maxChars) {
            spans.push(...hardCut(packedSpan, maxChars, overlapChars));
          } else {
            spans.push(packedSpan);
          }
        }
      }

      return toPieces(doc, applyOverlap(foldRunts(spans), overlapChars));
    },
  };
}
