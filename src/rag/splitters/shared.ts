/**
 * Shared machinery for the splitter family.
 *
 * Pattern: internal helpers, not exported from the door.
 * Role:    rag/ layer. The offset arithmetic lives here ONCE, because it is the
 *          part every splitter must get exactly right and the part that is
 *          easy to get subtly wrong per-strategy.
 * Emits:   N/A.
 *
 * **The invariant, stated once:** for every piece produced,
 * `doc.text.slice(charStart, charEnd) === piece.text`. Every helper here
 * derives its text BY SLICING rather than by concatenating what it read, which
 * is what makes the invariant true by construction rather than by care.
 */
import type { LoadedDocument, SplitPiece } from '../types.js';
import { MIN_CHUNK_CHARS } from './constants.js';

/** A half-open span of the source text. */
export interface Span {
  readonly start: number;
  readonly end: number;
  readonly heading?: string;
  /**
   * Where this span's OWN content begins, before overlap was prepended.
   *
   * Overlap deliberately reaches backward into the previous chunk, which means
   * `start` can sit on the previous PAGE. Attributing the chunk to that page
   * would cite a page whose text is only the borrowed run-up — so page lookup
   * uses this instead, and it is set only when the two differ.
   */
  readonly contentStart?: number;
}

/**
 * Which page an offset falls on, 1-based, or `undefined` when the document is
 * not paginated.
 *
 * Pages were joined with `'\n\n'` by the loader, so the boundaries are
 * reconstructible exactly. A chunk that straddles a page break is attributed
 * to the page it STARTS on — one number, the one you would turn to first.
 */
export function pageLocator(doc: LoadedDocument): (offset: number) => number | undefined {
  const pages = doc.pages;
  if (!pages || pages.length === 0) return () => undefined;
  const bounds: number[] = [];
  let cursor = 0;
  for (const page of pages) {
    bounds.push(cursor);
    cursor += page.length + 2; // the '\n\n' the loader joined with
  }
  return (offset: number): number | undefined => {
    let page = 1;
    for (let i = 0; i < bounds.length; i++) {
      if (offset >= (bounds[i] ?? 0)) page = i + 1;
      else break;
    }
    return page;
  };
}

/**
 * Trim a span inward past leading/trailing whitespace, keeping the offsets
 * honest.
 *
 * The naive version — `slice().trim()` — produces text that no longer matches
 * its own offsets. This moves the offsets instead, so the invariant holds.
 * Returns `undefined` when the span is entirely whitespace.
 */
export function trimSpan(text: string, span: Span): Span | undefined {
  let start = span.start;
  let end = span.end;
  while (start < end && /\s/.test(text[start] ?? '')) start += 1;
  while (end > start && /\s/.test(text[end - 1] ?? '')) end -= 1;
  if (start >= end) return undefined;
  return {
    start,
    end,
    ...(span.heading !== undefined && { heading: span.heading }),
    ...(span.contentStart !== undefined && { contentStart: span.contentStart }),
  };
}

/**
 * Pack consecutive units (paragraphs, lines) into spans of at most `maxChars`,
 * then apply `overlapChars` of backward overlap.
 *
 * Units are never split by this function — a single unit longer than `maxChars`
 * becomes its own oversized span, and the caller decides whether to hard-cut
 * it. That separation matters: a 4,000-character paragraph is a real thing in
 * real documents, and silently slicing it mid-word is a different decision from
 * packing.
 */
export function packSpans(units: readonly Span[], maxChars: number): Span[] {
  const out: Span[] = [];
  let current: Span | undefined;

  for (const unit of units) {
    if (current === undefined) {
      current = unit;
      continue;
    }
    // Same heading, and the merged span still fits.
    const fits = unit.end - current.start <= maxChars;
    const sameSection = current.heading === unit.heading;
    if (fits && sameSection) {
      current = {
        start: current.start,
        end: unit.end,
        ...(current.heading !== undefined && { heading: current.heading }),
      };
      continue;
    }
    out.push(current);
    current = unit;
  }
  if (current !== undefined) out.push(current);
  return out;
}

/**
 * Extend each span backward by `overlapChars`, without crossing the previous
 * span's start.
 *
 * Backward rather than forward so a chunk always ENDS on the boundary its
 * strategy chose — a heading section that ends mid-sentence because of overlap
 * would be a section that lies about where it ends.
 */
export function applyOverlap(spans: readonly Span[], overlapChars: number): Span[] {
  if (overlapChars <= 0) return [...spans];
  return spans.map((span, i) => {
    if (i === 0) return span;
    const floor = spans[i - 1]?.start ?? 0;
    const start = Math.max(floor, span.start - overlapChars);
    // Remember where the chunk's own content starts, so the page it is
    // attributed to is the page it is ABOUT, not the page its run-up borrowed
    // from.
    return start === span.start ? span : { ...span, start, contentStart: span.start };
  });
}

/**
 * Fold a too-small span back into its predecessor.
 *
 * A fragment of a few characters — a stray heading, a signature line — embeds
 * to noise and then competes for a top-K slot with real passages.
 *
 * **It never folds across a heading boundary.** A merged chunk carries the
 * FIRST span's heading, so folding a short section into the one before it
 * would produce a chunk labelled `heading="Alpha"` whose text is Beta's — a
 * citation that names the wrong section, which is worse than a small chunk.
 * Two spans merge only when they are already the same section.
 */
export function foldRunts(spans: readonly Span[], minChars: number = MIN_CHUNK_CHARS): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    const previous = out[out.length - 1];
    const sameSection = previous !== undefined && previous.heading === span.heading;
    if (previous !== undefined && sameSection && span.end - span.start < minChars) {
      out[out.length - 1] = {
        start: previous.start,
        end: span.end,
        ...(previous.heading !== undefined && { heading: previous.heading }),
      };
      continue;
    }
    out.push(span);
  }
  return out;
}

/** Turn spans into pieces, slicing the text so the invariant holds by construction. */
export function toPieces(doc: LoadedDocument, spans: readonly Span[]): SplitPiece[] {
  const pageAt = pageLocator(doc);
  const pieces: SplitPiece[] = [];
  for (const span of spans) {
    const trimmed = trimSpan(doc.text, span);
    if (trimmed === undefined) continue;
    // See `Span.contentStart`: the page is the one this chunk is about.
    const page = pageAt(span.contentStart ?? trimmed.start);
    pieces.push({
      // Sliced, never concatenated. This is the invariant.
      text: doc.text.slice(trimmed.start, trimmed.end),
      charStart: trimmed.start,
      charEnd: trimmed.end,
      ...(trimmed.heading !== undefined && { heading: trimmed.heading }),
      ...(page !== undefined && { page }),
    });
  }
  return pieces;
}

/** Hard-cut a span that no packing could fit, at `maxChars` with overlap. */
export function hardCut(span: Span, maxChars: number, overlapChars: number): Span[] {
  const out: Span[] = [];
  const stride = Math.max(1, maxChars - overlapChars);
  for (let start = span.start; start < span.end; start += stride) {
    const end = Math.min(span.end, start + maxChars);
    out.push({ start, end, ...(span.heading !== undefined && { heading: span.heading }) });
    if (end >= span.end) break;
  }
  return out;
}

/** Split into paragraph spans on blank lines, keeping offsets. */
export function paragraphSpans(text: string): Span[] {
  const spans: Span[] = [];
  const separator = /\n[ \t]*\n/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = separator.exec(text)) !== null) {
    spans.push({ start: cursor, end: match.index });
    cursor = match.index + match[0].length;
  }
  spans.push({ start: cursor, end: text.length });
  return spans.filter((s) => s.end > s.start);
}
