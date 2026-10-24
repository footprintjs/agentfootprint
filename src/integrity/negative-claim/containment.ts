/**
 * containment — the prose door's notes (design § 5.2, § 5.3): what a typed citation would have
 * made exact, said about a prose claim against the reads it rests on. A note never withholds.
 *
 * Pattern: the reads of one entity are grouped by search (`readings.ts · readingKey`) and each
 *          search's reads merged. Each search gets its OWN notes: how it read (`call-not-read`,
 *          `empty-undeclared`, `clarify-open`, the rows rule), its row (`coverage-unverified`,
 *          `declaration-overclaimed`), its gaps by facet (`coverage-gap`, `cap-reached`, `paged`,
 *          `partial`, `gap-relevance-unknown`), its period (`period-*` where the unheld time
 *          overlaps the claim's window), containment (`scope-wider`: a fixed qualifier or a
 *          filter in effect the claim does not name through the declared words, no window over
 *          a search with one, a window wider than the one read, an unbounded word), and the
 *          sequence (`later-read-failed`, `superseded-by-write`).
 *
 *          A search with no note ESTABLISHES the claim; the claim is then noted only by what the
 *          other searches BEAR — rows that contradict it, reads that disagree, unheld time over
 *          its window. With no establishing search, every search's notes stand. So an extra
 *          read clears no other read's objection.
 * Role:    integrity/ layer (L3), read by `prose.ts`.
 *
 * Words decide only through declared `said` lists; a hedge never scopes; a host-filled identity
 * filter is the caller's own view and is never asked of a prose claim.
 */

import type { ComposedItem, GapFacet } from '../../semantics/coverage/composedCoverage.js';
import { periodVerdict } from '../../semantics/coverage/period.js';
import { valueWords } from '../../semantics/coverage/search/valueWords.js';
import { lookbackRange, type TimeRange } from '../../time/range.js';
import type { DetectedClaim } from './detect.js';
import { firstHit, holdsAnySaid, numberOf, type Token } from './matcher.js';
import { NEGATIVE_CLAIM_PHRASES } from './phrases.js';
import {
  holdsRange,
  isRead,
  meets,
  mergeKeyReadings,
  readingKey,
  returnedReading,
  sameValue,
  scopeOf,
  searchWindow,
  unheldRanges,
} from './readings.js';
import type { ProseNote, SearchTool, TurnCall, TurnRecord } from './types.js';
import type { ProseWorkBudget } from './work.js';

type SearchCheckedItem = ComposedItem;
type DeclaredTool = SearchTool;

/** The notes a sibling search BEARS on a claim another search established. */
const BEARING: ReadonlySet<ProseNote> = new Set([
  'contradicted-by-rows',
  'readings-disagree',
  'period-not-held',
  'period-partly-held',
  'period-unknown',
]);

/** What the unit says, read once. */
interface ClaimWords {
  readonly claim: DetectedClaim;
  readonly text: string;
  readonly window: TimeRange | undefined;
  readonly unbounded: boolean;
  readonly sourceMarker: boolean;
  readonly work?: ProseWorkBudget;
}

export function claimWordsOf(
  claim: DetectedClaim,
  text: string,
  clock: string,
  work?: ProseWorkBudget,
): ClaimWords {
  return {
    claim,
    text,
    window: claimWindowOf(text, claim.tokens, clock),
    unbounded: firstHit(text, claim.tokens, NEGATIVE_CLAIM_PHRASES.unbounded) !== undefined,
    sourceMarker: firstHit(text, claim.tokens, NEGATIVE_CLAIM_PHRASES.source) !== undefined,
    work,
  };
}

const UNIT_LETTER: Readonly<Record<string, string>> = {
  minute: 'm',
  minutes: 'm',
  hour: 'h',
  hours: 'h',
  day: 'd',
  days: 'd',
  week: 'w',
  weeks: 'w',
};

/**
 * The window a unit names ("in the last 2 hours") as the time layer's half-open look-back at the
 * turn's clock (`time/range.ts` · `lookbackRange`), or undefined when it names none or it cannot
 * be placed.
 */
function claimWindowOf(
  text: string,
  tokens: readonly Token[],
  clock: string,
): TimeRange | undefined {
  const hit = firstHit(text, tokens, NEGATIVE_CLAIM_PHRASES.window);
  if (hit === undefined) return undefined;
  const words = tokens.slice(hit.first, hit.last + 1).map((t) => t.text);
  const last = words[words.length - 1] ?? '';
  const unit = UNIT_LETTER[last];
  const spelled =
    unit === undefined ? last : `${numberOf(words[words.length - 2] ?? '') ?? 1}${unit}`;
  try {
    return lookbackRange(clock, spelled, 'mhdw');
  } catch {
    return undefined;
  }
}

/** The value of a filter the claim names through the filter's declared words. */
function namedValue(
  words: ClaimWords,
  tool: DeclaredTool | undefined,
  argument: string,
): string | undefined {
  const said = tool?.search?.arguments.find((a) => a.name === argument)?.said;
  for (const value of said === undefined ? [] : Object.keys(said)) {
    if (holdsAnySaid(words.claim.tokens, valueWords(said, value), words.work)) return value;
  }
  return undefined;
}

const namesFixed = (words: ClaimWords, tool: DeclaredTool | undefined, name: string): boolean =>
  holdsAnySaid(
    words.claim.tokens,
    tool?.search?.fixed?.find((f) => f.name === name)?.said,
    words.work,
  );

/** Whether the source is the declared one the claim names, or a marker puts it on the lookup. */
function sourceScoped(
  words: ClaimWords,
  items: readonly SearchCheckedItem[],
  tool: DeclaredTool | undefined,
): boolean {
  if (words.sourceMarker) return true;
  const sent = items.some((item) => item.facet === 'source' && item.from === 'call');
  return !sent && holdsAnySaid(words.claim.tokens, tool?.search?.source.said, words.work);
}

/** Whether a gap bears on the claim: on a facet it leaves open, or on a value it names. */
function bears(
  bearsOn: GapFacet | undefined,
  words: ClaimWords,
  items: readonly SearchCheckedItem[],
  tool: DeclaredTool | undefined,
): boolean {
  if (bearsOn === undefined) return true;
  if (typeof bearsOn === 'object') {
    // A filter gap concerns its `values` (none listed = every value). It bears when the claim
    // names one of them, or leaves the filter open — an open claim covers every value; it does
    // not bear only when the claim names a value the gap does not concern.
    const values = bearsOn.values;
    const value = namedValue(words, tool, bearsOn.filter);
    if (value === undefined || values === undefined) return true;
    return values.some((v: unknown) => sameValue(v, value));
  }
  if (bearsOn === 'source') return !sourceScoped(words, items, tool);
  // Missing coverage also limits absence: an unread part of the source may contain a match.
  return true;
}

/** The rows rule: rows contradict only a claim whose every named qualifier the search applied. */
function rowsContradict(
  words: ClaimWords,
  items: readonly SearchCheckedItem[],
  window: TimeRange | undefined,
  tool: DeclaredTool | undefined,
): boolean {
  for (const fixed of tool?.search?.fixed ?? []) {
    if (
      namesFixed(words, tool, fixed.name) &&
      !items.some((i) => i.from === 'fixed' && i.argument === fixed.name)
    )
      return false;
  }
  for (const argument of tool?.search?.arguments ?? []) {
    if (argument.role !== 'filter') continue;
    const value = namedValue(words, tool, argument.name);
    if (value === undefined) continue;
    const applied = items.find((i) => i.facet === 'filter' && i.argument === argument.name);
    if (applied === undefined || applied.any === true || !sameValue(applied.value, value))
      return false;
  }
  if (words.window !== undefined) return window !== undefined && holdsRange(words.window, window);
  return true;
}

/** The scope notes: every qualifier in effect named, a window that fits, no unbounded word. */
function scopeNotes(
  words: ClaimWords,
  items: readonly SearchCheckedItem[],
  window: TimeRange | undefined,
  tool: DeclaredTool | undefined,
): ProseNote[] {
  let wider = words.unbounded;
  for (const item of items) {
    if (item.facet !== 'filter' || item.any === true || item.from === 'host') continue;
    const argument = item.argument ?? '';
    const named =
      item.from === 'fixed'
        ? namesFixed(words, tool, argument)
        : sameValue(namedValue(words, tool, argument), item.value);
    if (!named) wider = true;
  }
  const hasPeriod = items.some((item) => item.facet === 'period');
  if (
    hasPeriod &&
    (words.window === undefined || window === undefined || !holdsRange(window, words.window))
  ) {
    wider = true;
  }
  return wider ? ['scope-wider'] : [];
}

/** The period notes: a verdict short of covered, where its unheld time meets the claim's window. */
function periodNotes(
  call: TurnCall,
  items: readonly SearchCheckedItem[],
  words: ClaimWords,
): ProseNote[] {
  const period = call.row?.period;
  if (period === undefined) {
    return items.some((item) => item.facet === 'period') ? ['period-undeclared'] : [];
  }
  let verdict: string;
  try {
    verdict = periodVerdict(period);
  } catch {
    verdict = 'unknown';
  }
  if (verdict === 'covered') return [];
  const unheld = unheldRanges(period);
  const bearing =
    words.window === undefined
      ? unheld.length > 0
      : unheld.some((s) => meets(s, words.window as TimeRange));
  return bearing ? [`period-${verdict}` as ProseNote] : [];
}

/** One search's own notes, from its merged reading. */
function readingNotes(reading: TurnCall, words: ClaimWords, record: TurnRecord): ProseNote[] {
  const tool = record.tools[reading.toolName];
  const items = scopeOf(reading) ?? [];
  const row = reading.row;
  if (reading.emptiness === 'clarify') return ['clarify-open'];
  if (!returnedReading(reading)) return ['call-not-read'];
  const window = searchWindow(reading);
  const notes: ProseNote[] = [];
  if (reading.emptiness === 'non-empty' && words.claim.kind === 'none') {
    notes.push(
      row !== undefined && rowsContradict(words, items, window, tool)
        ? 'contradicted-by-rows'
        : 'rows-undecided',
    );
  }
  if (row === undefined) {
    if (reading.emptiness !== 'non-empty') notes.push('empty-undeclared');
    return notes;
  }
  if (row.composed !== 'local') notes.push('coverage-unverified');
  if ((row.overclaim ?? []).length > 0) notes.push('declaration-overclaimed');
  if (reading.emptiness === 'undeclared-empty') notes.push('empty-undeclared');
  for (const gap of row.gaps) {
    if (gap.kind === 'prose') notes.push('gap-relevance-unknown');
    else if (
      gap.kind === 'cap-reached' ||
      gap.kind === 'paged' ||
      gap.kind === 'partial' ||
      gap.kind === 'ranking'
    )
      notes.push(gap.kind);
    else if (gap.kind !== 'period' && bears(gap.bears, words, items, tool))
      notes.push('coverage-gap');
  }
  if (words.claim.kind === 'complete' && !row.complete) notes.push('search-incomplete');
  notes.push(...scopeNotes(words, items, window, tool), ...periodNotes(reading, items, words));
  return notes;
}

/** The sequence notes of one search: a failure of it, or a write, after its read. */
function sequenceNotes(
  reading: TurnCall,
  key: string | undefined,
  record: TurnRecord,
  peers: readonly TurnCall[],
): ProseNote[] {
  const at = peers.indexOf(reading);
  const notes: ProseNote[] = [];
  for (const other of peers) {
    if (other === reading || !other.dispatched) continue;
    if (!(peers.indexOf(other) > at || other.batch === reading.batch)) continue;
    const otherKey = readingKey(other, record.tools[other.toolName], record.clock);
    const same = otherKey === undefined ? other.toolName === reading.toolName : otherKey === key;
    if (same && other.outcome !== 'ok') notes.push('later-read-failed');
    if (!isRead(other)) notes.push('superseded-by-write');
  }
  return notes;
}

/** The notes of one entity's reads: establishing searches clear all but what siblings bear. */
export function entityNotes(
  calls: readonly TurnCall[],
  words: ClaimWords,
  record: TurnRecord,
  peers: readonly TurnCall[],
): ProseNote[] {
  const byKey = new Map<string, TurnCall[]>();
  for (const call of calls) {
    const key =
      readingKey(call, record.tools[call.toolName], record.clock) ?? `\u{1}${call.resultId}`;
    byKey.set(key, [...(byKey.get(key) ?? []), call]);
  }
  const perKey = [...byKey.entries()].map(([key, group]) => {
    const { reading, disagree } = mergeKeyReadings(group);
    if (disagree) return ['readings-disagree'] as ProseNote[];
    if (reading === undefined) return ['call-not-read'] as ProseNote[];
    return [...readingNotes(reading, words, record), ...sequenceNotes(reading, key, record, peers)];
  });
  const establishing = perKey.some((notes) => notes.length === 0);
  return establishing
    ? perKey.flatMap((notes) => notes.filter((note) => BEARING.has(note)))
    : perKey.flat();
}
