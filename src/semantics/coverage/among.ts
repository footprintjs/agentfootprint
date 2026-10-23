/**
 * among — a name that resolves to nothing is a named miss over the names the
 * tool read, never "it does not exist".
 *
 * Pattern: one rule set, two doors — `absent()` mints by it
 *          ({@link mintAmong}), and readers find the names facet by it
 *          ({@link namesFacetOf}).
 * Role:    core/ layer (L1), pure.
 * Emits:   N/A.
 *
 * ## The failure this file answers
 *
 * A lookup checked a name against an inventory export, found nothing, and
 * refused with "No array matches 'X'. Known arrays: … a wrong identifier, not
 * missing data". Models then told users "X is not in your estate" — when the
 * tool had only failed to find X in ONE export. A pre-check over a known list
 * IS a search, and a declaration is itself a claim. So the miss is an absence
 * over the names actually read, and the mint ADDS a gap the author cannot
 * remove: `{ kind: 'scope', what: 'names outside <source>', relevance:
 * 'bears', bears: 'source' }`. The only opt-out is `authoritative: { why }`,
 * and `check:semantics` lists every use of it. A read that did not see the
 * whole list (`partial: true` — a truncated or paged inventory) checked even
 * less, so it ALSO gets a completeness gap, `{ kind: 'scope', what: 'not every
 * name in <source> was read', relevance: 'bears', bears: 'completeness' }`,
 * which `authoritative` never removes.
 *
 * The gap holds only where `among` is declared: a plain `absent({ what })`, or
 * a refusal the tool throws, never passes through here. `count`,
 * `authoritative.why` and `partial` are the TOOL's claims, said out loud and
 * not verified by this library.
 *
 * ## The names themselves are not served
 *
 * `among.names` is read for one thing: that `count` agrees with it
 * (`names-count-mismatch`). No name reaches the model, an event or a record
 * beyond what the absence already carries. Two reviews found that a short
 * list of "nearest" names acts as an inventory listing rather than a "did you
 * mean?", invites an answer about a different name, and carries whatever
 * text the inventory holds — and the study's harmful refusal listed names
 * too. Serving names waits on a bench arm that measures count-only against a
 * near-match "did you mean?".
 */

import { plainLineProblem } from '../../lib/plainLine.js';
import { instantOf } from '../../time/instant.js';

import { refusal, refuseUnknownKeys } from './refusal.js';
import type {
  AmongDeclaration,
  CompletenessGapItem,
  NamesFacetItem,
  SourceGapItem,
  ToolAbsence,
} from './types.js';

/** The code a count that disagrees with its names is refused under. */
export const NAMES_COUNT_MISMATCH = 'names-count-mismatch';

/** The declaration's keys, tied to {@link AmongDeclaration} in BOTH directions. */
const AMONG_KEYS: readonly string[] = Object.keys({
  argument: true,
  source: true,
  measuredAt: true,
  count: true,
  names: true,
  partial: true,
  authoritative: true,
} satisfies Record<keyof AmongDeclaration, true>);

/** What the mint composes from one `among`, for `absent()` to place. */
export interface MintedAmong {
  /** The first `checked` item. */
  readonly facet: NamesFacetItem;
  /**
   * The first `not_checked` items, in order: the source gap (unless
   * `authoritative`), then the completeness gap (when `partial`). Empty only
   * for an authoritative whole read.
   */
  readonly gaps: readonly (SourceGapItem | CompletenessGapItem)[];
  /** The absence's provenance, in the declaration's camelCase form. */
  readonly provenance: { readonly measuredAt: string; readonly source: string };
}

const isPlainObject = (raw: unknown): raw is Record<string, unknown> => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const prototype: unknown = Object.getPrototypeOf(raw);
  return prototype === Object.prototype || prototype === null;
};

/** A non-empty, one-line string, trimmed — or a refusal naming `field`. */
function lineOf(raw: unknown, field: string, fix: string): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') throw refusal(`\`${field}\` must ${fix}`);
  const notPlain = plainLineProblem(`\`${field}\``, text);
  if (notPlain !== undefined) throw refusal(notPlain);
  return text;
}

function readAuthoritative(raw: unknown): { readonly why: string } | undefined {
  if (raw === undefined || raw === null) return undefined;
  const fix =
    'take { why } — why the names in `among.source` are every name there is. Without it, ' +
    'names outside the source stay a gap the model is told about.';
  if (!isPlainObject(raw)) throw refusal(`\`among.authoritative\` must ${fix}`);
  refuseUnknownKeys(raw, ['why'], 'among.authoritative');
  return { why: lineOf(raw.why, 'among.authoritative.why', 'say why the source is complete.') };
}

/** `partial`: `true` composes the completeness gap; `false` or omitted, nothing. */
function readPartial(raw: unknown): boolean {
  if (raw === undefined || raw === null || raw === false) return false;
  if (raw === true) return true;
  throw refusal(
    '`among.partial` is `true` when the read did not see every name in the source (a ' +
      'truncated or paged inventory) — or omit it.',
  );
}

/**
 * Mint one `among` declaration, refusing (throwing, where `absent()` is
 * called) anything it cannot honour. Nothing of the looked-for value is
 * written into what it composes.
 */
export function mintAmong(raw: unknown): MintedAmong {
  if (!isPlainObject(raw)) {
    throw refusal(
      '`among` takes { argument, source, measuredAt, count, names?, partial?, authoritative? } ' +
        '— the list the missed name was looked up in.',
    );
  }
  refuseUnknownKeys(raw, AMONG_KEYS, 'among');
  const argument = lineOf(
    raw.argument,
    'among.argument',
    "name the input argument whose value was looked up (e.g. 'array_id').",
  );
  const source = lineOf(
    raw.source,
    'among.source',
    "name the list the names were read from (e.g. 'the PowerStore inventory export').",
  );
  const measuredAt = lineOf(
    raw.measuredAt,
    'among.measuredAt',
    "say when that list was read — the tool's own words.",
  );
  const count = raw.count;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw refusal('`among.count` must be a whole number — how many names the list holds.');
  }
  checkNames(raw.names, count);
  const partial = readPartial(raw.partial);
  const authoritative = readAuthoritative(raw.authoritative);
  // A dated note when `measuredAt` is an instant this library can read — the
  // date as the tool wrote it, and no judgement of whether it is old.
  const asOf = instantOf(measuredAt, 'lenient') === undefined ? undefined : measuredAt;
  const names = `${count} ${argument} name${count === 1 ? '' : 's'}`;
  const facet: NamesFacetItem = {
    what: partial ? `the ${names} read from ${source}` : `the ${names} listed in ${source}`,
    ...(asOf !== undefined && { why: `names as of ${asOf}` }),
    facet: 'names',
    argument,
    count,
    source,
    from: 'result',
    ...(authoritative !== undefined && { authoritative }),
  };
  // `authoritative` speaks for the SOURCE (every name there is), so it drops
  // only the source gap; it cannot vouch for a read that did not see it all.
  const gaps: (SourceGapItem | CompletenessGapItem)[] = [];
  if (authoritative === undefined) {
    gaps.push({
      what: `names outside ${source}`,
      kind: 'scope',
      relevance: 'bears',
      bears: 'source',
    });
  }
  if (partial) {
    gaps.push({
      what: `not every name in ${source} was read`,
      kind: 'scope',
      relevance: 'bears',
      bears: 'completeness',
    });
  }
  return { facet, gaps, provenance: { measuredAt, source } };
}

/** `names`, when given, must be the list `count` counts — read for that check only. */
function checkNames(raw: unknown, count: number): void {
  if (raw === undefined || raw === null) return;
  if (!Array.isArray(raw)) {
    throw refusal(
      '`among.names` must be an array — the names the list holds, read only to check `count`. ' +
        'Omit it to declare the count alone.',
    );
  }
  if (raw.length !== count) {
    throw refusal(
      `\`among.count\` is ${count} but \`among.names\` holds ${raw.length} — the count is the ` +
        'size of the list the tool read, and the names, when given, are that list ' +
        `(${NAMES_COUNT_MISMATCH}).`,
    );
  }
}

/**
 * The names facet of an absence minted with `among` — its `checked` item with
 * `facet: 'names'` — or `undefined`. An envelope minted elsewhere is read as
 * found, never repaired.
 */
export function namesFacetOf(absence: ToolAbsence): NamesFacetItem | undefined {
  const facet = absence.checked.find(
    (item: unknown) => isPlainObject(item) && item.facet === 'names',
  );
  return facet as NamesFacetItem | undefined;
}
