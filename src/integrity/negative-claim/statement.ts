/**
 * statement — the library's sentence for an established typed claim, written from the cited
 * reads' rows alone (design § 5.1): what was searched, every gap said out loud.
 *
 * Pattern: fixed templates; the template is chosen by the ROW's shape (an `among` miss reads
 *          "did not find … among N names"), then by the claim's kind. One clause per cited read,
 *          one line each, in ordinal order.
 *
 *          EVERY text taken from a row — the tool's name, the subject, the source, a fixed
 *          qualifier, a value sent, a gap's words, a row's identity — is QUOTED DATA attributed
 *          to the tool ("as the tool names them"), never woven in as the library's own prose:
 *          NFKC, control and format characters (bidi overrides, zero-width marks) removed,
 *          line breaks flattened, backticks turned into apostrophes, each value capped at
 *          64 characters plus "…". The quoting is the boundary; a declaration's phrase list is a
 *          heuristic. Only numbers and instants the library re-spells from parsed values stand
 *          outside quotes. Lists are capped (`STATEMENT_LIMITS`), so a clause has a stated
 *          maximum length.
 * Role:    integrity/ layer (L3), read by `judge.ts`. `complete` states the rows READ — their
 *          count and identities (a fact's `entity`, or the declared id column) — never a list
 *          the model wrote.
 */

import { readResultIdentity } from '../claim-binding/capture.js';
import { stableJson } from '../../lib/stableJson.js';
import type { ComposedSearchRow, SearchCheckedItem } from './searchRow.js';
import type { NegativeKind, NegativeStatement, TurnCall } from './types.js';
import { instantMs, msSpan, unheldOf, type MsSpan } from './window.js';
import { periodVerdict } from '../../semantics/coverage/period.js';

/** Bump with any change to a template or to how a value is rendered. */
export const STATEMENT_VERSION = '1';

const VALUE_CHARS = 64;
const LIST_ITEMS = 12;

/**
 * The stated bounds: each quoted value at most `valueChars` code points plus "…"; each list at
 * most `listItems` entries plus "and N more"; so a clause never exceeds `clauseChars` UTF-16
 * units (at most 80 quoted values of 2 × 64 + 3 units, with their labels and the template).
 */
export const STATEMENT_LIMITS = Object.freeze({
  valueChars: VALUE_CHARS,
  listItems: LIST_ITEMS,
  clauseChars: 12_000,
});

/** One value as quoted data. */
export function quoteValue(value: unknown): string {
  const raw =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : stableJson(value) ?? '';
  const clean = raw
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\p{Cf}/gu, '')
    .replace(/`/g, "'")
    .replace(/\s+/gu, ' ')
    .trim();
  const points = Array.from(clean);
  const capped = points.length > VALUE_CHARS ? `${points.slice(0, VALUE_CHARS).join('')}…` : clean;
  return `\`${capped}\``;
}

const list = (items: readonly string[]): string => {
  const shown = items.slice(0, LIST_ITEMS).join(', ');
  return items.length > LIST_ITEMS ? `${shown}, and ${items.length - LIST_ITEMS} more` : shown;
};

const pad = (n: number): string => String(n).padStart(2, '0');

function clockOf(ms: number): string {
  const d = new Date(ms);
  const base = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0
    ? base
    : `${base}:${pad(d.getUTCSeconds())}`;
}

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** A span as the statement writes it: `08:00–10:00Z`, or with dates across days. */
export function formatSpan(span: MsSpan): string {
  return dayOf(span.from) === dayOf(span.to)
    ? `${clockOf(span.from)}–${clockOf(span.to)}Z`
    : `${dayOf(span.from)} ${clockOf(span.from)}Z–${dayOf(span.to)} ${clockOf(span.to)}Z`;
}

/** An instant, with its date unless it falls on the leg clock's day. */
function formatInstant(ms: number, clock: string): string {
  const now = instantMs(clock);
  return now !== undefined && dayOf(now) === dayOf(ms)
    ? `${clockOf(ms)}Z`
    : `${dayOf(ms)} ${clockOf(ms)}Z`;
}

const HELD: Readonly<Record<string, string>> = {
  covered: 'held in full',
  'partly-held': 'held in part',
  'not-held': 'not held',
  unknown: 'held: unknown',
};

const items = (row: ComposedSearchRow, facet: SearchCheckedItem['facet']) =>
  row.checked.filter((item) => item.facet === facet);

/** The period part, and what it adds to "not checked". */
function periodParts(row: ComposedSearchRow): { window?: string; unchecked: string[] } {
  const period = row.period;
  const queried = period === undefined ? undefined : msSpan(period.queried);
  if (period !== undefined && queried !== undefined) {
    let verdict: string;
    try {
      verdict = periodVerdict(period);
    } catch {
      verdict = 'unknown';
    }
    const unchecked =
      verdict === 'unknown'
        ? [`${formatSpan(queried)} (held: unknown)`]
        : unheldOf(period).map((span) => `${formatSpan(span)} (not held)`);
    return {
      window: `window ${formatSpan(queried)} (${HELD[verdict] ?? 'held: unknown'})`,
      unchecked,
    };
  }
  const declared = items(row, 'period')[0];
  return declared === undefined
    ? { unchecked: [] }
    : { window: `window ${quoteValue(declared.what)} (held: undeclared)`, unchecked: [] };
}

/** The roles the tool named — subject, population, scope, names, source — as quoted data. */
function roles(row: ComposedSearchRow): string[] {
  const out: string[] = [];
  const subject = items(row, 'subject');
  if (subject.length > 0) out.push(`subject ${list(subject.map((i) => quoteValue(i.what)))}`);
  const population = items(row, 'population');
  if (population.length > 0) out.push(`for ${list(population.map((i) => quoteValue(i.what)))}`);
  const scope = items(row, 'filter').map((i) =>
    i.any === true ? `any ${quoteValue(i.argument ?? i.what)}` : quoteValue(i.what),
  );
  if (scope.length > 0) out.push(`scope ${list(scope)}`);
  const source = items(row, 'source');
  const sourceWhats = new Set(source.map((i) => i.what));
  for (const names of items(row, 'names')) {
    const where =
      names.source !== undefined && !sourceWhats.has(names.source)
        ? ` in ${quoteValue(names.source)}`
        : '';
    out.push(`names ${quoteValue(names.what)}${where}`);
  }
  if (source.length > 0) out.push(`source ${list(source.map((i) => quoteValue(i.what)))}`);
  return out;
}

/** The identities of the rows read, as quoted data. */
function identities(call: TurnCall): string[] {
  const column = call.idColumn ?? 'entity';
  return (call.rowsRead ?? []).flatMap((row) => {
    const id = Object.prototype.hasOwnProperty.call(row, column) ? row[column] : undefined;
    return typeof id === 'string' || typeof id === 'number' ? [quoteValue(id)] : [];
  });
}

/** One clause for one cited read. */
function clauseOf(
  kind: NegativeKind,
  call: TurnCall,
  row: ComposedSearchRow,
  clock: string,
): string {
  const tool = quoteValue(row.toolName);
  const names = items(row, 'names')[0];
  const among = names !== undefined;
  const rowsRead = call.rows ?? call.rowsRead?.length ?? 0;
  const head = among
    ? `${tool} did not find ${quoteValue(row.lookedFor ?? '')} among ${
        typeof names.count === 'number' && Number.isSafeInteger(names.count) ? names.count : 'the'
      } names`
    : kind === 'complete'
    ? `${tool} read ${rowsRead} rows`
    : `${tool} found none`;
  const { window, unchecked } = periodParts(row);
  const parts = roles(row);
  if (window !== undefined) parts.push(window);
  const measured = among ? instantMs(names.measuredAt) : undefined;
  if (measured !== undefined) parts.push(`read ${formatInstant(measured, clock)}`);
  if (!among && kind === 'complete') {
    const ids = identities(call);
    if (ids.length > 0) {
      const more = Math.max(0, rowsRead - Math.min(ids.length, LIST_ITEMS));
      const shown = ids.slice(0, LIST_ITEMS).join(', ');
      parts.push(`rows ${shown}${more > 0 ? `, and ${more} more` : ''}`);
    }
    parts.push('no cap reached, one page');
  }
  const gaps = row.gaps.filter((gap) => gap.kind !== 'period').map((gap) => quoteValue(gap.what));
  const notChecked = [...gaps, ...unchecked];
  if (notChecked.length > 0) parts.push(`not checked: ${list(notChecked)}`);
  return `${head} — as the tool names them: ${parts.join('; ')}.`;
}

const ordinalOf = (call: TurnCall): number => {
  try {
    return readResultIdentity(call.resultId).ordinal;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
};

/** The statement for an established claim: one clause per cited read, in ordinal order. */
export function composeStatement(
  kind: NegativeKind,
  reads: readonly { readonly call: TurnCall; readonly row: ComposedSearchRow }[],
  clock: string,
): NegativeStatement {
  const ordered = [...reads].sort((a, b) => ordinalOf(a.call) - ordinalOf(b.call));
  const clauses = ordered.map(({ call, row }) => clauseOf(kind, call, row, clock));
  return { text: clauses.join('\n'), clauses, version: STATEMENT_VERSION };
}
