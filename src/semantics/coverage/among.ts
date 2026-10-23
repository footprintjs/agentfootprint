/**
 * among — a name that resolves to nothing is a named miss over the names the
 * tool read, never "it does not exist".
 *
 * Pattern: one rule set, two doors — `absent()` mints by it
 *          ({@link mintAmong}), and the dispatch door reads the names facet by
 *          it ({@link namesFacetOf}, {@link withoutKnownNames}).
 * Role:    core/ layer (L1), pure. The spelling the names are ranked in is the
 *          evidence gate's own (`lib/normalize.ts` · `normalizeToken`).
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
 * and `check:semantics` lists every use of it.
 *
 * ## What the model may know of the list
 *
 * `known_names` serves the count always and, only when the tool read the list
 * under the caller's own identity (`visible: 'caller'` — no default), the
 * {@link KNOWN_NAMES_SHOWN} names nearest the looked-for value. Names come from
 * the tool's data and may carry injection text or another principal's names,
 * so a name outside one plain printable line or over {@link MAX_NAME_CHARS}
 * characters is dropped and counted, the shown list is capped, and the whole
 * block is MODEL-ONLY: it rides the served value and so the conversation, and
 * {@link withoutKnownNames} takes it off `stream.tool_end` — no event field
 * carries it.
 */

import { normalizeToken } from '../../lib/normalize.js';
import { plainLineProblem } from '../../lib/plainLine.js';

import { readAbsence, readCoverageLedger } from './recognize.js';
import { refusal, refuseUnknownKeys } from './refusal.js';
import type {
  AmongDeclaration,
  KnownNames,
  NamesFacetItem,
  SourceGapItem,
  ToolAbsence,
} from './types.js';

/** The most names a model is shown from one list — the k nearest. */
export const KNOWN_NAMES_SHOWN = 20;

/** The longest name a model is shown, in characters (code points). */
export const MAX_NAME_CHARS = 128;

/** The code a count that disagrees with its names is refused under. */
export const NAMES_COUNT_MISMATCH = 'names-count-mismatch';

/** The wire key of the model-only block. */
const KNOWN_NAMES_KEY = 'known_names';

/** The declaration's keys, tied to {@link AmongDeclaration} in BOTH directions. */
const AMONG_KEYS: readonly string[] = Object.keys({
  argument: true,
  source: true,
  measuredAt: true,
  count: true,
  names: true,
  visible: true,
  authoritative: true,
} satisfies Record<keyof AmongDeclaration, true>);

/** What the mint composes from one `among`, for `absent()` to place. */
export interface MintedAmong {
  /** The first `checked` item. */
  readonly facet: NamesFacetItem;
  /** The first `not_checked` item — absent only under `authoritative`. */
  readonly gap?: SourceGapItem;
  /** The absence's provenance, in the declaration's camelCase form. */
  readonly provenance: { readonly measuredAt: string; readonly source: string };
  /** The model-only block. */
  readonly knownNames: KnownNames;
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

/**
 * Mint one `among` declaration, refusing (throwing, where `absent()` is
 * called) anything it cannot honour. `lookedFor` is the absence's own `what`
 * — the value the names are ranked against, never written into the facet.
 */
export function mintAmong(raw: unknown, lookedFor: string): MintedAmong {
  if (!isPlainObject(raw)) {
    throw refusal(
      '`among` takes { argument, source, measuredAt, count, names?, visible?, authoritative? } ' +
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
    "say when that list was read — the tool's own words, never parsed.",
  );
  const count = raw.count;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw refusal('`among.count` must be a whole number — how many names the list holds.');
  }
  const names = readNames(raw.names, count);
  const visible = raw.visible ?? undefined;
  if (visible !== undefined && visible !== 'caller') {
    throw refusal(
      "`among.visible` takes one value, 'caller' — say it only when the tool read the list " +
        "under the caller's own identity. Omit it and the model is served the count only.",
    );
  }
  if (visible === 'caller' && names === undefined) {
    throw refusal(
      "`among.visible: 'caller'` serves names, and `among.names` was not given — give the " +
        'list the tool read, or omit `visible`.',
    );
  }
  const authoritative = readAuthoritative(raw.authoritative);
  const facet: NamesFacetItem = {
    what: `the ${count} ${argument} name${count === 1 ? '' : 's'} listed in ${source}`,
    facet: 'names',
    argument,
    count,
    source,
    from: 'result',
    ...(authoritative !== undefined && { authoritative }),
  };
  const shown = visible === 'caller' && names !== undefined ? nearestNames(lookedFor, names) : {};
  return {
    facet,
    ...(authoritative === undefined && {
      gap: { what: `names outside ${source}`, kind: 'scope', relevance: 'bears', bears: 'source' },
    }),
    provenance: { measuredAt, source },
    knownNames: { count, ...shown },
  };
}

/** `names`, checked against `count` — `undefined` when none were given. */
function readNames(raw: unknown, count: number): readonly unknown[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw refusal(
      '`among.names` must be an array — the names the list holds. Omit it and the model is ' +
        'served the count only.',
    );
  }
  if (raw.length !== count) {
    throw refusal(
      `\`among.count\` is ${count} but \`among.names\` holds ${raw.length} — the count is the ` +
        'size of the list the tool read, and the names, when given, are that list; up to ' +
        `${KNOWN_NAMES_SHOWN} shown must never outnumber the count (${NAMES_COUNT_MISMATCH}).`,
    );
  }
  return raw;
}

// ── The names a model may be shown ──────────────────────────────────────

/** Characters a shown name may not carry beyond the plain-line rule: lone
 *  surrogates and private-use code points, which render as nothing a person
 *  can read. */
const NOT_PRINTABLE = /[\p{Cs}\p{Co}]/u;

/** The trimmed name when it may be shown, or `undefined`. */
function showable(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const name = raw.trim();
  if (name === '' || [...name].length > MAX_NAME_CHARS) return undefined;
  if (plainLineProblem('name', name) !== undefined || NOT_PRINTABLE.test(name)) return undefined;
  return name;
}

/**
 * The edit distance between two spellings, or `Infinity` once it is past
 * `cutoff` — so ranking a long list stays linear in practice: a name that
 * cannot beat the k-th best is abandoned at the first row that proves it.
 */
function distanceWithin(a: readonly string[], b: readonly string[], cutoff: number): number {
  if (Math.abs(a.length - b.length) > cutoff) return Infinity;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowBest = i;
    let left = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const up = previous[j] ?? Infinity;
      const diagonal = previous[j - 1] ?? Infinity;
      left = Math.min(up + 1, left + 1, diagonal + cost);
      current.push(left);
      if (left < rowBest) rowBest = left;
    }
    if (rowBest > cutoff) return Infinity;
    previous = current;
  }
  return previous[b.length] ?? Infinity;
}

/**
 * The {@link KNOWN_NAMES_SHOWN} names nearest `lookedFor` under the one
 * spelling, nearest first — ties in list order, each name once — and how many
 * were dropped as unshowable (`dropped` is omitted when none were).
 */
function nearestNames(
  lookedFor: string,
  names: readonly unknown[],
): { readonly nearest: readonly string[]; readonly dropped?: number } {
  const target = [...normalizeToken(lookedFor)];
  const best: { readonly name: string; readonly distance: number }[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const raw of names) {
    const name = showable(raw);
    if (name === undefined) {
      dropped += 1;
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    const worst = best.length === KNOWN_NAMES_SHOWN ? best[best.length - 1] : undefined;
    // Full: only a strictly nearer name gets in — an earlier name wins a tie.
    const cutoff = worst === undefined ? Infinity : worst.distance - 1;
    const distance = distanceWithin(target, [...normalizeToken(name)], cutoff);
    if (distance > cutoff) continue;
    // After every entry at the same distance: an earlier name wins a tie.
    const at = best.findIndex((entry) => entry.distance > distance);
    best.splice(at === -1 ? best.length : at, 0, { name, distance });
    if (best.length > KNOWN_NAMES_SHOWN) best.pop();
  }
  return {
    nearest: best.map((entry) => entry.name),
    ...(dropped > 0 && { dropped }),
  };
}

// ── Reading an envelope ─────────────────────────────────────────────────

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

/**
 * `value` without the model-only `known_names` block — asked where a tool's
 * result becomes an EVENT field (`stages/toolCalls.ts` · `emitToolEnd`, for
 * `result` and `modelResult`). It walks the shapes the serve door walks: a
 * bare absence, and a ledger's `result` to any depth.
 *
 * Only an absence that carries the names facet loses the key: a tool that
 * attached its own `known_names` to an absence minted WITHOUT `among` keeps
 * the bytes it always had. Every other value — and an among absence with no
 * block — comes back as the SAME reference.
 */
export function withoutKnownNames(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  const absence = readAbsence(value);
  if (absence !== undefined) {
    if (!Object.hasOwn(absence, KNOWN_NAMES_KEY) || namesFacetOf(absence) === undefined) {
      return value;
    }
    return Object.fromEntries(Object.entries(absence).filter(([key]) => key !== KNOWN_NAMES_KEY));
  }
  const covered = readCoverageLedger(value);
  if (covered === undefined) return value;
  const result = withoutKnownNames(covered.result, seen);
  return result === covered.result ? value : { ...covered, result };
}
