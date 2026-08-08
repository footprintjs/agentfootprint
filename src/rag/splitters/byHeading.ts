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
 *
 * ── The floor, and why merging goes FORWARD (8.20.0) ────────────────────────
 * A section whose own body is tiny does not retrieve badly — it retrieves TOO
 * WELL. Similarity is a density measure: a heading plus one preamble sentence
 * concentrates its topic's vocabulary with none of its substance. Measured in
 * a production corpus, a 180-character heading-and-preamble chunk outranked
 * the 1,032-character body of its own section at 0.430 — and the model,
 * handed a passage that PROMISES findings and contains none, fabricated a
 * plausible file path to fill the gap.
 *
 * So a section whose body is under `minChars` is merged into the chunk that
 * FOLLOWS it, under its own heading — the preamble sentence survives, leading
 * the chunk it introduces, and the citation still names the section a reader
 * would look up. Merging it BACKWARD would append it to the previous section's
 * chunk, where it introduces nothing and its heading would be lost; merging
 * forward is the direction the author's own document flows. The last section
 * has no next, so a trailing short section merges backward — the one edge
 * where that is the only honest option. Nothing is ever dropped.
 *
 * Two special cases are unconditional, independent of `minChars`:
 *   - a section that is heading-plus-whitespace is NEVER emitted alone. It is
 *     a coordinate, not a passage — the same distinction `indexDocuments`
 *     enforces one layer up when it refuses a passage-less document.
 *   - a document that is NOTHING but headings and whitespace yields no chunks
 *     at all: there is no passage anywhere in it to retrieve.
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
  /**
   * The floor under a section's own body, in characters (8.20.0). A section
   * whose body is shorter is merged FORWARD into the next chunk under its own
   * heading — never dropped, never shipped alone. Default
   * `min(250, maxChars / 4)`; see `DEFAULT_MIN_CHARS` for the field
   * measurement behind the number (a 180-char heading-and-preamble chunk that
   * outranked its own section's 1,032-char body and drove a fabricated
   * citation).
   *
   * `0` disables the floor. A heading-plus-whitespace section is still never
   * emitted alone — that refusal is unconditional, because a chunk with no
   * body at all is a coordinate, not a passage.
   */
  readonly minChars?: number;
}

/** ATX headings only (`# Title`). Setext (`Title\n=====`) is rare in docs corpora. */
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*$/gm;

/** One section, classified for the floor pass. */
interface Section extends Span {
  /** Offset where the section's BODY starts — after the heading line, or `start` for a preamble. */
  readonly bodyStart: number;
}

export function byHeading(options: ByHeadingOptions = {}): Splitter {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  const maxLevel = options.maxLevel ?? 6;
  const minChars = resolveMinChars(options.minChars, maxChars);

  return {
    name: 'byHeading',
    split(doc: LoadedDocument): readonly SplitPiece[] {
      const text = doc.text;
      // Where each section starts, and what it is called.
      const starts: { offset: number; heading?: string; headingEnd: number }[] = [];
      HEADING.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = HEADING.exec(text)) !== null) {
        if ((match[1] ?? '').length > maxLevel) continue;
        starts.push({
          offset: match.index,
          heading: match[2],
          headingEnd: match.index + match[0].length,
        });
      }

      // A document with no headings at all is a paragraph document; say so by
      // doing the paragraph thing rather than returning one giant chunk.
      if (starts.length === 0) {
        const packed = packSpans(paragraphSpans(text), maxChars);
        const cut = packed.flatMap((s) =>
          s.end - s.start > maxChars ? hardCut(s, maxChars, overlapChars) : [s],
        );
        const floored = mergeShortSpansForward(foldRunts(cut), minChars);
        return toPieces(doc, applyOverlap(floored, overlapChars));
      }

      const sections: Section[] = [];
      // Preamble before the first heading — its own section, unnamed. Its
      // whole span IS its body.
      const firstStart = starts[0]?.offset ?? 0;
      if (firstStart > 0) sections.push({ start: 0, end: firstStart, bodyStart: 0 });
      for (let i = 0; i < starts.length; i++) {
        const start = starts[i]?.offset ?? 0;
        const end = starts[i + 1]?.offset ?? text.length;
        const heading = starts[i]?.heading;
        const bodyStart = Math.min(end, starts[i]?.headingEnd ?? start);
        sections.push({ start, end, bodyStart, ...(heading !== undefined && { heading }) });
      }

      // Sections that fit stay whole; the rest are packed by paragraph WITHIN
      // the section, so a boundary never merges two headings' content. Kept
      // GROUPED per section here, because the floor pass below must reach the
      // FIRST chunk of a section and only that one.
      const groups: Span[][] = sections.map((section) => {
        if (section.end - section.start <= maxChars) {
          return [
            {
              start: section.start,
              end: section.end,
              ...(section.heading !== undefined && { heading: section.heading }),
            },
          ];
        }
        // Paragraphs of the BODY, with the heading line glued onto the first
        // one. Splitting the section's own text used to make the heading line
        // its own paragraph unit — and when the first body paragraph was too
        // big to pack with it, the heading shipped as a chunk of its own. That
        // is the exact heading-only failure this release closes; the heading
        // is a label, never a unit.
        const inner: Span[] = paragraphSpans(text.slice(section.bodyStart, section.end)).map(
          (s) => ({
            start: section.bodyStart + s.start,
            end: section.bodyStart + s.end,
            ...(section.heading !== undefined && { heading: section.heading }),
          }),
        );
        const firstInner = inner[0];
        if (firstInner !== undefined && section.start < section.bodyStart) {
          inner[0] = {
            start: section.start,
            end: firstInner.end,
            ...(section.heading !== undefined && { heading: section.heading }),
          };
        }
        const spans: Span[] = [];
        for (const packedSpan of packSpans(inner, maxChars)) {
          if (packedSpan.end - packedSpan.start > maxChars) {
            spans.push(...hardCut(packedSpan, maxChars, overlapChars));
          } else {
            spans.push(packedSpan);
          }
        }
        return spans;
      });

      // ── The floor pass (8.20.0). ─────────────────────────────────────────
      // A short section is by construction a single span (its whole span is
      // under the floor, which is under maxChars), so merging it forward means
      // extending the FIRST span of the next full section back over it — the
      // rest of that section's spans keep their own heading. Consecutive short
      // sections accumulate; an accumulation that clears the floor and has a
      // real body is emitted as its own chunk rather than diluting a full
      // neighbour.
      const out: Span[] = [];
      let pending: { start: number; heading?: string; bodyChars: number } | undefined;
      for (let i = 0; i < sections.length; i++) {
        // sections and groups are built index-for-index above.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const section = sections[i]!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const group = groups[i]!;
        const bodyLength = text.slice(section.bodyStart, section.end).trim().length;
        const bare = bodyLength === 0; // heading-plus-whitespace: merged UNCONDITIONALLY
        const short = !bare && bodyLength < minChars;

        if (bare || short) {
          if (pending === undefined) {
            pending = {
              start: section.start,
              bodyChars: bodyLength,
              ...(section.heading !== undefined && { heading: section.heading }),
            };
          } else {
            pending.bodyChars += bodyLength;
          }
          // Adjacent shorts whose BODIES together clear the floor become their
          // own chunk — the same measure shortness is judged by, so a single
          // short section can never self-emit on the strength of its markup.
          if (minChars > 0 && pending.bodyChars >= minChars) {
            out.push({
              start: pending.start,
              end: section.end,
              ...(pending.heading !== undefined && { heading: pending.heading }),
            });
            pending = undefined;
          }
          continue;
        }

        if (pending !== undefined) {
          const first = group[0];
          if (first !== undefined) {
            // The merged chunk STARTS at the short section's heading, so the
            // short section's heading is the honest label. A heading-less
            // preamble keeps the chunk heading-less: a chunk is never labelled
            // with a heading its text only reaches later.
            group[0] = {
              start: pending.start,
              end: first.end,
              ...(pending.heading !== undefined && { heading: pending.heading }),
            };
          }
          pending = undefined;
        }
        out.push(...group);
      }

      if (pending !== undefined) {
        const lastSectionEnd = sections[sections.length - 1]?.end ?? text.length;
        const previous = out.pop();
        if (previous !== undefined) {
          // Trailing shorts have no next chunk — the one edge that merges
          // BACKWARD, extending the previous chunk under its own heading.
          out.push({
            start: previous.start,
            end: lastSectionEnd,
            ...(previous.heading !== undefined && { heading: previous.heading }),
          });
        } else if (pending.bodyChars > 0) {
          // The whole document is short sections. No neighbour exists, and
          // "never dropped" wins: one merged chunk.
          out.push({
            start: pending.start,
            end: lastSectionEnd,
            ...(pending.heading !== undefined && { heading: pending.heading }),
          });
        }
        // else: nothing but headings and whitespace — coordinates without a
        // passage anywhere. No chunk is emitted; `indexDocuments` makes the
        // same refusal one layer up for a passage-less document.
      }

      // Within-section tail runts still fold BACKWARD (same heading — the
      // direction that cannot mislabel), now up to the same floor.
      const runtFloor = minChars > 0 ? minChars : undefined;
      return toPieces(doc, applyOverlap(foldRunts(out, runtFloor), overlapChars));
    },
  };
}
