/**
 * statement — the library's sentence for an established typed claim, written from the cited
 * reads' rows alone (design § 5.1): what was searched, and every gap said out loud.
 *
 * Pattern: fixed templates; the template is chosen by the ROW's shape (an `among` miss reads
 *          "did not find … among N names"), then by the claim's kind. One clause per cited read,
 *          one line each, in ordinal order.
 *
 *          The library's own voice states ONLY what the record shows ("no cap reached"). Every
 *          other text is QUOTED and ATTRIBUTED to where it came from: "(declared by the tool)",
 *          "(fixed by the tool)", "(the tool's declared default)", "(as sent by the model)",
 *          "(as the tool's result says)", "(the caller's identity)". A declared fact is said as
 *          the tool's ("the tool declares no server cap", "the tool declares one page"). An
 *          unsent argument is said with calibrated words: the tool may have applied its own
 *          default, so this may cover only part.
 *
 *          Quoting is the boundary: NFKC, control and format characters (bidi overrides,
 *          zero-width marks) removed, line breaks flattened, backticks turned into apostrophes.
 *          A value is capped at 64 characters plus "…"; a gap's text at the 120 its declaration
 *          may hold. EVERY gap is listed, never cut short in number; other lists are capped and
 *          counted ("and N more"), so a clause stays within `clauseLimit(gaps)`.
 * Role:    integrity/ layer (L3), read by `judge.ts`. `complete` states the rows READ — their
 *          count and identities (a fact's `entity`, or the declared id column) — never a list
 *          the model wrote.
 */

import { readResultIdentity } from '../claim-binding/capture.js';
import { stableJson } from '../../lib/stableJson.js';
import type { ComposedCoverage, ComposedItem } from '../../semantics/coverage/composedCoverage.js';
import { periodVerdict } from '../../semantics/coverage/period.js';
import { resultSpan } from '../../semantics/coverage/search/span.js';
import { instantOf } from '../../time/instant.js';
import { parseRange, type TimeRange } from '../../time/range.js';
import { unheldRanges } from './readings.js';
import type { NegativeKind, NegativeStatement, SearchTool, TurnCall } from './types.js';

type ComposedSearchRow = ComposedCoverage;
type SearchCheckedItem = ComposedItem;
type DeclaredTool = SearchTool;

const instantMs = (value: unknown): number | undefined => instantOf(value, 'lenient')?.ms;

/** Bump with any change to a template or to how a value is rendered. */
export const STATEMENT_VERSION = '7';

const VALUE_CHARS = 64;
const GAP_CHARS = 120;
const LIST_ITEMS = 12;
const SCOPE_ITEMS = 24;

/** The stated bounds of one value, one gap's text, and the capped lists. */
export const STATEMENT_LIMITS = Object.freeze({
  valueChars: VALUE_CHARS,
  gapChars: GAP_CHARS,
  listItems: LIST_ITEMS,
  scopeItems: SCOPE_ITEMS,
});

/**
 * The most UTF-16 units a clause can hold for a row with `gaps` gaps: the head and at most ~60
 * capped parts (each quoted value ≤ 2 × 64 + 3 units, with its label and attribution), plus
 * each gap (≤ 2 × 120 + 3 units, with its attribution).
 */
export function clauseLimit(gaps: number): number {
  return 12_000 + gaps * 300;
}

/** One text as quoted data, capped at `cap` code points. */
function quote(value: unknown, cap: number): string {
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
  const capped = points.length > cap ? `${points.slice(0, cap).join('')}…` : clean;
  return `\`${capped}\``;
}

/** One value as quoted data (64 code points). */
export const quoteValue = (value: unknown): string => quote(value, VALUE_CHARS);

/** One gap's text as quoted data (its declared 120). */
const quoteGap = (value: unknown): string => quote(value, GAP_CHARS);

const capped = (items: readonly string[], cap: number, more: (n: number) => string): string[] =>
  items.length > cap ? [...items.slice(0, cap), more(items.length - cap)] : [...items];

const ATTRIBUTION: Readonly<Record<string, string>> = {
  call: 'as sent by the model',
  default: "the tool's declared default",
  fixed: 'fixed by the tool',
  tool: 'declared by the tool',
  result: "as the tool's result says",
  host: "the caller's identity",
};

const attributed = (text: string, from: string | undefined): string =>
  `${text} (${ATTRIBUTION[from ?? 'tool'] ?? ATTRIBUTION.tool})`;

const pad = (n: number): string => String(n).padStart(2, '0');

function clockOf(ms: number): string {
  const d = new Date(ms);
  const base = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  // Seconds when they are not zero; never milliseconds — a half-open span's end one
  // millisecond past a minute is that minute.
  return d.getUTCSeconds() === 0 ? base : `${base}:${pad(d.getUTCSeconds())}`;
}

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * A span (`time/range.ts`) as the statement writes it — always with its date, so a historical
 * window is never read as today's: `2026-10-01 08:00–10:00Z`, or a date on each bound across
 * days (`2026-10-15 10:00Z–2026-10-22 10:00Z`); undefined when it is not a pair of instants.
 */
export function formatSpan(span: TimeRange): string | undefined {
  const from = instantMs(span.from);
  const to = instantMs(span.to);
  if (from === undefined || to === undefined) return undefined;
  return dayOf(from) === dayOf(to)
    ? `${dayOf(from)} ${clockOf(from)}–${clockOf(to)}Z`
    : `${dayOf(from)} ${clockOf(from)}Z–${dayOf(to)} ${clockOf(to)}Z`;
}

/** An absolute window as sent (`<from>..<to>` or `<from>/<to>`), read by the time layer's parser. */
const sentRange = (value: unknown): TimeRange | undefined =>
  parseRange(value, '..') ?? parseRange(value, '/');

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

/**
 * The period part — the span the call RAN with (its period item's dispatch-time span, else the
 * result's `queried`) and how much of the read the store held — and what it adds to "not
 * checked".
 */
function periodParts(row: ComposedSearchRow): { window?: string; unchecked: string[] } {
  const declared = items(row, 'period')[0];
  const period = row.period;
  // The window the call ran with: a relative one's dispatch-time span; an absolute one as sent;
  // else the result's own `queried`.
  const ran =
    declared?.span ??
    sentRange(declared?.value) ??
    (period === undefined ? undefined : resultSpan(period));
  const shown = ran === undefined ? undefined : formatSpan(ran);
  const windowText =
    shown ?? (declared === undefined ? undefined : quoteValue(declared.value ?? declared.what));
  if (windowText === undefined) return { unchecked: [] };
  if (period === undefined)
    return { window: `window ${windowText} (held: undeclared)`, unchecked: [] };
  let verdict: string;
  try {
    verdict = periodVerdict(period);
  } catch {
    verdict = 'unknown';
  }
  const queried = resultSpan(period);
  const unchecked =
    verdict === 'unknown'
      ? queried === undefined
        ? []
        : [`${formatSpan(queried) ?? quoteValue(period.queried.from)} (held: unknown)`]
      : unheldRanges(period).flatMap((span) => {
          const text = formatSpan(span);
          return text === undefined ? [] : [`${text} (not held)`];
        });
  return { window: `window ${windowText} (${HELD[verdict] ?? 'held: unknown'})`, unchecked };
}

/** One scope item, quoted and attributed. */
function itemPart(item: SearchCheckedItem): string {
  const argument = item.argument === undefined ? undefined : quoteValue(item.argument);
  if (item.facet === 'subject') return attributed(`subject ${quoteValue(item.what)}`, item.from);
  if (item.facet === 'source') {
    const named = item.from === 'call' && item.value !== undefined ? item.value : item.what;
    return attributed(`source ${quoteValue(named)}`, item.from);
  }
  if (item.facet === 'names') return attributed(`names ${quoteValue(item.what)}`, 'result');
  if (item.any === true && argument !== undefined) return attributed(`any ${argument}`, item.from);
  if (item.from === 'host' && argument !== undefined) return attributed(argument, 'host');
  if (argument !== undefined && item.value !== undefined) {
    return attributed(`${argument} ${quoteValue(item.value)}`, item.from);
  }
  return attributed(quoteValue(item.what), item.from);
}

/** The scope the row records, in a fixed facet order. */
function scopeParts(row: ComposedSearchRow, among: boolean): string[] {
  const subject = items(row, 'subject').map(itemPart);
  const population = among
    ? []
    : capped(items(row, 'population').map(itemPart), LIST_ITEMS, (n) => `and ${n} more values`);
  const filters = [
    ...items(row, 'filter').filter((i) => i.from === 'fixed'),
    ...items(row, 'filter').filter((i) => i.from !== 'fixed'),
  ].map(itemPart);
  const names = items(row, 'names').map(itemPart);
  const source = items(row, 'source').map(itemPart);
  return [
    ...subject,
    ...population,
    ...capped(filters, SCOPE_ITEMS, (n) => `and ${n} more qualifiers`),
    ...names,
    ...source,
  ];
}

/** Every gap, said out loud — none dropped. */
function gapParts(row: ComposedSearchRow): string[] {
  return row.gaps.flatMap((gap): string[] => {
    switch (gap.kind) {
      case 'period':
        return [];
      case 'argument-unsent':
        return [
          `${quoteValue(gap.argument ?? gap.what)} was not sent, so the tool may have applied ` +
            'its own default and this may cover only part',
        ];
      case 'partial':
        return ['what the partial result left out'];
      case 'credential-limited':
        return ["what the caller's credential may not see"];
      case 'match':
        return [`${quoteGap(gap.what)} (by the tool's own match rule)`];
      case 'ranking':
        return ['the rows an approximate ranking may have left out'];
      case 'prose':
        return [`${quoteGap(gap.what)} (as the tool wrote it)`];
      case 'scope':
        return [`${quoteGap(gap.what)} (declared by the tool)`];
      default:
        return [`${quoteGap(gap.what)} (as the tool's result says)`];
    }
  });
}

/** The identities of the rows read, as quoted data. */
function identities(call: TurnCall): string[] {
  if (call.rowsMayDisplay !== true) return [];
  const column = call.idColumn ?? 'entity';
  return (call.rowsRead ?? []).flatMap((row) => {
    const id = Object.prototype.hasOwnProperty.call(row, column) ? row[column] : undefined;
    return typeof id === 'string' || typeof id === 'number' ? [quoteValue(id)] : [];
  });
}

/** Display only unchanged native rows admitted at the final tool-result boundary.
 * An arbitrary id/key field has no identity contract, so its row is quoted as
 * data instead of guessing a business identity. Both values and row lists cap. */
function returnedValues(call: TurnCall): string | undefined {
  if (call.rowsMayDisplay !== true || !call.rowsRead?.length) return undefined;
  const column = call.idColumn ?? 'entity';
  const values = call.rowsRead.slice(0, LIST_ITEMS).map((row) => {
    const id = Object.hasOwn(row, column) ? row[column] : undefined;
    return quoteValue(typeof id === 'string' || typeof id === 'number' ? id : row);
  });
  const more = Math.max(0, (call.rows ?? call.rowsRead.length) - values.length);
  return attributed(
    `returned ${values.join(', ')}${more > 0 ? `, and ${more} more rows` : ''}`,
    'result',
  );
}

/** What the tool declares about a server cap — said only when the declaration is in hand. */
function serverCapPart(tool: DeclaredTool | undefined): string[] {
  if (tool?.search === undefined) return [];
  const cap = tool.search.limits?.cap;
  if (cap === undefined) return ['the tool declares no server cap'];
  return typeof cap === 'number' && Number.isSafeInteger(cap)
    ? [`the tool declares a server cap of ${cap}`]
    : [];
}

/** One clause for one cited read. */
function clauseOf(
  kind: NegativeKind,
  read: { readonly call: TurnCall; readonly row: ComposedSearchRow; readonly tool?: DeclaredTool },
  clock: string,
  recorded = false,
): string {
  const { call, row, tool } = read;
  const toolName = quoteValue(row.toolName);
  const names = items(row, 'names')[0];
  const among = names !== undefined;
  const rowsRead = call.rows ?? call.rowsRead?.length ?? 0;
  const count =
    among && typeof names.count === 'number' && Number.isSafeInteger(names.count)
      ? String(names.count)
      : 'the';
  const head = recorded
    ? call.outcome !== 'ok'
      ? `${toolName} did not establish a completed read`
      : call.emptiness === 'declared-absent'
      ? `${toolName} returned no matching rows`
      : call.rows !== undefined || call.rowsRead !== undefined
      ? `${toolName} read ${rowsRead} ${rowsRead === 1 ? 'row' : 'rows'}`
      : call.emptiness === 'non-empty'
      ? `${toolName} returned matching rows whose count is undetermined`
      : `${toolName} returned a result whose row count is undetermined`
    : among
    ? `${toolName} did not find ${attributed(
        quoteValue(row.lookedFor ?? ''),
        'call',
      )} among ${count} names`
    : kind === 'complete'
    ? `${toolName} read ${rowsRead} rows`
    : `${toolName} found none`;
  const { window, unchecked } = periodParts(row);
  const parts = scopeParts(row, among);
  if (recorded && call.emptiness === 'non-empty') {
    const values = returnedValues(call);
    if (values !== undefined) parts.push(values);
  }
  if (window !== undefined) parts.push(window);
  const measured = among ? instantMs(names.measuredAt) : undefined;
  if (measured !== undefined) parts.push(`read ${formatInstant(measured, clock)}`);
  if (!recorded && !among && kind === 'complete') {
    const ids = identities(call);
    if (ids.length > 0) {
      const more = Math.max(0, rowsRead - Math.min(ids.length, LIST_ITEMS));
      const shown = ids.slice(0, LIST_ITEMS).join(', ');
      parts.push(attributed(`rows ${shown}${more > 0 ? `, and ${more} more` : ''}`, 'result'));
    }
    parts.push('no cap reached', ...serverCapPart(tool), 'the tool declares one page');
  }
  const notChecked = [...gapParts(row), ...unchecked];
  if (notChecked.length > 0) parts.push(`not checked: ${notChecked.join('; ')}`);
  return `${head} — ${parts.join('; ')}.`;
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
  reads: readonly {
    readonly call: TurnCall;
    readonly row: ComposedSearchRow;
    readonly tool?: DeclaredTool;
  }[],
  clock: string,
): NegativeStatement {
  const ordered = [...reads].sort((a, b) => ordinalOf(a.call) - ordinalOf(b.call));
  const clauses = ordered.map((read) => clauseOf(kind, read, clock));
  return { text: clauses.join('\n'), clauses, version: STATEMENT_VERSION };
}

/** State only the admitted read and all its limits, without asserting completeness. */
export function composeRecordedStatement(
  reads: readonly {
    readonly call: TurnCall;
    readonly row: ComposedSearchRow;
    readonly tool?: DeclaredTool;
  }[],
  clock: string,
  explanation?: {
    /** Authored by the delivery boundary from the check's code, never model text. */
    readonly refusal: string;
    /** Only caller-scoped local observations admitted by the delivery boundary. */
    readonly contraryReads: readonly {
      readonly call: TurnCall;
      readonly row?: ComposedSearchRow;
      readonly tool?: DeclaredTool;
    }[];
  },
): NegativeStatement {
  const clauses = explanation === undefined ? [] : [explanation.refusal];
  const contrary = explanation?.contraryReads ?? [];
  for (const read of contrary.slice(0, LIST_ITEMS)) {
    const handle = quoteValue(read.call.row?.handle ?? `r${ordinalOf(read.call)}`);
    if (read.row !== undefined) {
      clauses.push(
        `Contrary recorded evidence (read ${handle}): ${clauseOf(
          'complete',
          { ...read, row: read.row },
          clock,
          true,
        )}`,
      );
    } else {
      const count = read.call.rows ?? read.call.rowsRead?.length;
      const parts = [
        `${quoteValue(read.call.toolName)} returned ${
          count === undefined
            ? 'matching rows with an undetermined count'
            : `${count} ${count === 1 ? 'row' : 'rows'}`
        }`,
        returnedValues(read.call),
        'coverage not declared for this result',
      ].filter((part) => part !== undefined);
      clauses.push(`Contrary recorded evidence (read ${handle}): ${parts.join('; ')}.`);
    }
  }
  if (contrary.length > LIST_ITEMS)
    clauses.push(
      `The record contains ${
        contrary.length - LIST_ITEMS
      } additional positive reads for this subject.`,
    );
  clauses.push(
    ...[...reads]
      .sort((a, b) => ordinalOf(a.call) - ordinalOf(b.call))
      .map((read) => clauseOf('complete', read, clock, true)),
  );
  if (explanation === undefined)
    clauses.push('The requested negative claim is not established by these recorded searches.');
  return { text: clauses.join('\n'), clauses, version: STATEMENT_VERSION };
}
