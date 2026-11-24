import { unitsOf, type TextSpan } from '../../../../../../integrity/negative-claim/units.js';
import { MAX_CITATION_PROSE_CHARS, MAX_CITATION_REFERENCES } from '../bounds.js';

interface Marker {
  readonly offer: string;
  readonly slot: number;
}

export interface CiteSpan {
  readonly start: number;
  readonly end: number;
  readonly references: readonly { readonly marker: Marker; readonly resolvedSlot?: number }[];
}

interface OfferedSlots {
  readonly offer: string;
  readonly results: readonly { readonly slot: number }[];
}

const MAX_MARKER_CHARS = 74;
const MARKER = /\[c:([A-Za-z0-9_-]{1,64}):([1-9]\d{0,2})\]/u;
const BLOCK_BREAK = /\r?\n[ \t]*\r?\n/gu;
const MARKER_REFERENCE_DEFINITION = new RegExp(`^[ \\t]{0,3}${MARKER.source}:`, 'imu');

const INLINE_CONTENT = 1;
const INLINE_OPEN = 2;
const INLINE_CLOSE = 3;

/** Keep the prose scanner's original offsets, including the edges of its code spans. */
function inlineCodeMask(answer: string, spans: readonly TextSpan[]): Uint8Array {
  const mask = new Uint8Array(answer.length);
  for (const { start, end } of spans) {
    let left = start;
    let right = end;
    while (answer[left - 1] === '`') left--;
    while (answer[right] === '`') right++;
    mask.fill(INLINE_OPEN, left, start);
    mask.fill(INLINE_CONTENT, start, end);
    mask.fill(INLINE_CLOSE, end, right);
  }
  return mask;
}

/** The slice deliberately admits only unambiguous prose. Link labels can span lines. */
function plainBlocks(answer: string, code: Uint8Array): readonly TextSpan[] {
  const spans: { start: number; end: number }[] = [];
  const retain = (start: number, end: number): void => {
    const text = answer.slice(start, end);
    if (/^(?:[ \t]*[>|<#]| {4}|\t)/mu.test(text) || /<!--/u.test(text)) return;
    // The shared inline-code spans are line-local. If they do not account for
    // the delimiters, keep this block literal and still admit other paragraphs.
    for (const tick of text.matchAll(/`/gu)) {
      const index = start + tick.index;
      if (code[index] === 0 || (code[index] !== INLINE_CONTENT && answer[index - 1] === '\\'))
        return;
    }
    const mark = new RegExp(MARKER.source, 'gu');
    const remaining = text.replace(mark, '');
    if (
      text.includes('](') ||
      text.includes('][') ||
      remaining.includes('[') ||
      remaining.includes(']')
    )
      return;
    spans.push({ start, end });
  };
  let start = 0;
  for (const split of answer.matchAll(BLOCK_BREAK)) {
    retain(start, split.index);
    start = split.index + split[0].length;
  }
  retain(start, answer.length);
  return spans;
}

function suffix(answer: string, start: number, end: number, code: Uint8Array) {
  let cursor = end;
  if (/[.!?]/u.test(answer[cursor - 1] ?? '')) cursor--;
  const markers = new Map<string, Marker>();
  let count = 0;
  while (cursor > start && answer[cursor - 1] === ']') {
    const left = Math.max(start, cursor - MAX_MARKER_CHARS);
    const tail = answer.slice(left, cursor);
    const open = tail.lastIndexOf('[');
    if (open === -1) break;
    const at = left + open;
    const match = MARKER.exec(tail.slice(open));
    if (
      match === null ||
      match[0].length !== cursor - at ||
      at === start ||
      code[at] !== 0 ||
      !/[ \t]/u.test(answer[at - 1])
    )
      break;
    const slot = Number(match[2]);
    if (slot > MAX_CITATION_REFERENCES) break;
    markers.set(match[0], { offer: match[1], slot });
    count++;
    cursor = at;
    while (cursor > start && /[ \t]/u.test(answer[cursor - 1])) cursor--;
  }
  return { end: cursor, count, markers: [...markers.values()].reverse() };
}

/** Collect only whole-answer, bounded suffix associations. A limit yields no partial verdicts. */
export function collectCitations(answer: string, offer: OfferedSlots | undefined) {
  if (answer.length > MAX_CITATION_PROSE_CHARS) return { complete: false, spans: [] } as const;
  if (MARKER_REFERENCE_DEFINITION.test(answer)) return { complete: false, spans: [] } as const;
  const { units, inlineCode } = unitsOf(answer);
  const code = inlineCodeMask(answer, inlineCode);
  const safe = plainBlocks(answer, code);
  const slots = new Set(offer?.results.map(({ slot }) => slot));
  const spans: CiteSpan[] = [];
  let block = 0;
  let references = 0;
  for (const unit of units) {
    while (block < safe.length && safe[block].end < unit.end) block++;
    if (
      unit.fenced ||
      block === safe.length ||
      unit.start < safe[block].start ||
      code[unit.start] === INLINE_CONTENT ||
      code[unit.start] === INLINE_CLOSE
    )
      continue;
    const found = suffix(answer, unit.start, unit.end, code);
    if (found.end <= unit.start || found.count === 0) continue;
    references += found.count;
    if (references > MAX_CITATION_REFERENCES) return { complete: false, spans: [] } as const;
    spans.push({
      start: unit.start,
      end: found.end,
      references: found.markers.map((marker) => ({
        marker,
        ...(marker.offer === offer?.offer &&
          slots.has(marker.slot) && { resolvedSlot: marker.slot }),
      })),
    });
  }
  return { complete: true, spans } as const;
}

/** An earlier marker in the prose is ambiguous. Keep the link and decline to check the claim. */
export function citationClaimText(answer: string, span: CiteSpan): string | undefined {
  const text = answer.slice(span.start, span.end);
  return MARKER.test(text) ? undefined : text;
}
