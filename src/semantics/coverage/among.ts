/**
 * among — a name that resolves to nothing is a named miss over the names the
 * tool read, never "it does not exist".
 *
 * Pattern: one rule set, two doors — `absent()` mints by it
 *          ({@link mintAmong}), and the dispatch door reads the names facet and
 *          the names channel by it ({@link namesFacetOf}, {@link knownNamesFor},
 *          {@link withKnownNames}).
 * Role:    core/ layer (L1), pure but for one module-private `WeakMap` (the
 *          names channel). The spelling the names are ranked in is the
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
 * ## What the model may know of the list — and why it is never in the result
 *
 * Only when the tool read the list under the caller's own identity
 * (`visible: 'caller'` — no default) does the model see the count and the
 * {@link KNOWN_NAMES_SHOWN} names nearest the looked-for value. Names come
 * from the tool's data and may carry injection text or another principal's
 * names, so a name outside one plain printable line or over
 * {@link MAX_NAME_CHARS} characters is dropped and counted, and the shown list
 * is capped.
 *
 * The names are NEVER part of the result. A filter that strips them on the
 * way to an event loses to the first rule that reshapes the result — JSON
 * text, a wrapper, a truncated head — so the mint does not put them in the
 * envelope at all: it keeps them on a library-owned channel keyed by the
 * envelope object it returns ({@link knownNamesFor}). They stay under the
 * app's rules all the same: each after-tool rule is handed them BESIDE the
 * result (`call.knownNames`) and decides what goes on — a pass-through keeps
 * them, a rewrite drops them unless the rule hands them back, a denial ends
 * them, and a block a rule hands back is held to this file's rules
 * ({@link ruleKnownNames}). What the chain lets through is attached in ONE
 * place, the model-bound message (`stages/toolCalls.ts` · `messageTextOf`,
 * through {@link withKnownNames}), and it counts against
 * `maxToolResultChars`: the list is trimmed, never the result
 * ({@link fitKnownNames}). Every event, the ledger, the decision rows and the
 * coverage rows see a result that never held them; the conversation — what the
 * model read, under the run's redaction policy like the result — is where
 * they live.
 *
 * A copy of the envelope (`{ ...absent(…) }`, a JSON round trip, a value a
 * non-JavaScript tool minted) carries no channel, so its names are not served
 * — the safe direction.
 *
 * Ranking is bounded, because both inputs are untrusted: a looked-for value
 * over {@link MAX_NAME_CHARS} code points, or a list over
 * {@link MAX_NAMES_RANKED} names, ranks nothing and serves the count alone;
 * otherwise one comparison is at most 128 × 128 cells.
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

/** The longest name a model is shown, in characters (code points). A looked-for
 *  value longer than this ranks nothing: the count is served alone. */
export const MAX_NAME_CHARS = 128;

/** The longest list whose names are ranked. A longer list is counted and
 *  never ranked — the count is served alone — so a mint's cost is bounded
 *  whatever the tool hands it. */
export const MAX_NAMES_RANKED = 10_000;

/** The code a count that disagrees with its names is refused under. */
export const NAMES_COUNT_MISMATCH = 'names-count-mismatch';

/** The key the names are served under in the model-bound message. */
export const KNOWN_NAMES_KEY = 'known_names';

/** The line a model-bound TEXT result carries its names on, after the text. */
export const KNOWN_NAMES_LINE = '\n\nknown_names: ';

/**
 * The names channel: envelope object → the block the model may be served.
 * Weak, so a result the run drops takes its names with it; module-private, so
 * nothing but this file writes or reads it.
 */
const NAMES_CHANNEL = new WeakMap<object, KnownNames>();

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
  /** The names the model may be served — only under `visible: 'caller'`.
   *  `absent()` puts it on the names channel, never in the envelope. */
  readonly knownNames?: KnownNames;
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
  return {
    facet,
    ...(authoritative === undefined && {
      gap: { what: `names outside ${source}`, kind: 'scope', relevance: 'bears', bears: 'source' },
    }),
    provenance: { measuredAt, source },
    ...(visible === 'caller' &&
      names !== undefined && { knownNames: { count, ...nearestNames(lookedFor, names) } }),
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

/** A spelling as code points, at most `MAX_NAME_CHARS` of them — or
 *  `undefined` when it is longer (lowercasing can lengthen a spelling). */
function codePointsOf(spelling: string): Int32Array | undefined {
  // A code point is at most two UTF-16 units: past this length, it is longer.
  if (spelling.length > 2 * MAX_NAME_CHARS) return undefined;
  const points = Array.from(spelling, (ch) => ch.codePointAt(0) ?? 0);
  return points.length > MAX_NAME_CHARS ? undefined : Int32Array.from(points);
}

/**
 * The edit distance between two spellings, or `Infinity` once it is past
 * `cutoff`: a name that cannot beat the k-th best is abandoned at the first
 * row that proves it. Both sides are at most `MAX_NAME_CHARS` code points, so
 * one call costs at most 128 × 128 cell updates.
 */
function distanceWithin(a: Int32Array, b: Int32Array, cutoff: number): number {
  if (Math.abs(a.length - b.length) > cutoff) return Infinity;
  let previous = new Int32Array(b.length + 1).map((_, j) => j);
  let current = new Int32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowBest = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      current[j] = value;
      if (value < rowBest) rowBest = value;
    }
    if (rowBest > cutoff) return Infinity;
    [previous, current] = [current, previous];
  }
  return previous[b.length] ?? Infinity;
}

/**
 * The {@link KNOWN_NAMES_SHOWN} names nearest `lookedFor` under the one
 * spelling, nearest first — ties in list order, each name once — and how many
 * were dropped as unshowable (`dropped` is omitted when none were).
 *
 * BOUNDED, because both inputs are untrusted: `lookedFor` is the model's
 * argument and `names` is the tool's data. A looked-for spelling over
 * {@link MAX_NAME_CHARS} code points, or a list over {@link MAX_NAMES_RANKED}
 * names, ranks nothing — the count is served alone (`{}` here). Otherwise
 * every comparison is at most 128 × 128 cells, so one mint costs at most
 * `MAX_NAMES_RANKED` × 128² cell updates (≈ 164 million) — about 0.4 s measured
 * on a laptop for 10,000 random 128-character names.
 */
function nearestNames(
  lookedFor: string,
  names: readonly unknown[],
): { readonly nearest?: readonly string[]; readonly dropped?: number } {
  if (names.length > MAX_NAMES_RANKED) return {};
  const target = codePointsOf(normalizeToken(lookedFor));
  if (target === undefined) return {};
  const best: { readonly name: string; readonly distance: number }[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const raw of names) {
    const name = showable(raw);
    const spelling = name === undefined ? undefined : codePointsOf(normalizeToken(name));
    if (name === undefined || spelling === undefined) {
      dropped += 1;
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    const worst = best.length === KNOWN_NAMES_SHOWN ? best[best.length - 1] : undefined;
    // Full: only a strictly nearer name gets in — an earlier name wins a tie.
    const cutoff = worst === undefined ? MAX_NAME_CHARS : worst.distance - 1;
    const distance = distanceWithin(target, spelling, cutoff);
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
 * Put `names` on the names channel of `envelope` — the object `absent()` is
 * about to return. Called by the mint only.
 */
export function keepKnownNames(envelope: ToolAbsence, names: KnownNames): void {
  NAMES_CHANNEL.set(envelope, names);
}

/**
 * The names a tool's OWN returned value carries on the channel — a bare
 * absence `absent()` minted, or one a `coverage()` ledger bounds, to any
 * depth — or `undefined`. Asked with the value the tool returned, before any
 * rule saw it; a copy of the envelope carries no channel.
 */
export function knownNamesFor(value: unknown): KnownNames | undefined {
  const seen = new Set<unknown>();
  let at: unknown = value;
  while (typeof at === 'object' && at !== null && !seen.has(at)) {
    seen.add(at);
    const names = NAMES_CHANNEL.get(at);
    if (names !== undefined) return names;
    const covered = readCoverageLedger(at);
    if (covered === undefined) return undefined;
    at = covered.result;
  }
  return undefined;
}

/**
 * The model-bound value with `names` attached — the ONE attaching rule,
 * applied by the dispatch door after every rule, the placement and the cap:
 *
 *   • an absence, bare or bounded by a ledger to any depth, gains
 *     `known_names` beside its own fields (where the evidence projection reads
 *     an absence's tool-authored keys);
 *   • any other plain object gains `known_names` at its top level;
 *   • anything else — text, a list, a number — is returned as found, and the
 *     caller appends {@link KNOWN_NAMES_LINE} and the block to its text.
 *
 * Never mutates `value`.
 */
export function withKnownNames(value: unknown, names: KnownNames): unknown {
  if (!isPlainObject(value)) return value;
  if (readAbsence(value) !== undefined) return { ...value, [KNOWN_NAMES_KEY]: names };
  const covered = readCoverageLedger(value);
  if (covered !== undefined && isPlainObject(covered.result)) {
    const inner = withKnownNames(covered.result, names);
    return { ...covered, result: inner };
  }
  return { ...value, [KNOWN_NAMES_KEY]: names };
}

// ── A names block a rule hands back ──────────────────────────────────────

const isWhole = (raw: unknown): raw is number =>
  typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0;

/**
 * What is wrong with a names block an after-tool rule hands back
 * (`allow(value, why, { knownNames })`), or `undefined` when it is the shape
 * the rule was handed: `{ count, nearest?, dropped?, omitted? }`.
 */
export function knownNamesProblem(raw: unknown): string | undefined {
  if (!isPlainObject(raw)) return 'a names block is { count, nearest? } — or null to drop them';
  const unknownKey = Object.keys(raw).find(
    (key) => !['count', 'nearest', 'dropped', 'omitted'].includes(key),
  );
  if (unknownKey !== undefined) return `a names block has no field '${unknownKey}'`;
  if (!isWhole(raw.count)) return 'a names block needs `count`, a whole number';
  if (raw.nearest !== undefined && !Array.isArray(raw.nearest)) {
    return '`nearest` is a list of names';
  }
  for (const key of ['dropped', 'omitted'] as const) {
    if (raw[key] !== undefined && !isWhole(raw[key])) return `\`${key}\` is a whole number`;
  }
  return undefined;
}

/**
 * A rule's names block held to the mint's own rules, so a rule cannot widen
 * what the model is shown past them: each name re-filtered (one plain
 * printable line, at most {@link MAX_NAME_CHARS}), each once, at most
 * {@link KNOWN_NAMES_SHOWN} and never more than `count`. A name the filter
 * refuses is counted in `dropped`. `undefined` for a block
 * {@link knownNamesProblem} refuses — no names, the safe direction.
 */
export function ruleKnownNames(raw: unknown): KnownNames | undefined {
  if (knownNamesProblem(raw) !== undefined) return undefined;
  const block = raw as KnownNames;
  const nearest: string[] = [];
  let dropped = block.dropped ?? 0;
  for (const candidate of block.nearest ?? []) {
    const name = showable(candidate);
    if (name === undefined) dropped += 1;
    else if (!nearest.includes(name)) nearest.push(name);
  }
  const shown = nearest.slice(0, Math.min(KNOWN_NAMES_SHOWN, block.count));
  return {
    count: block.count,
    ...(block.nearest !== undefined && { nearest: shown }),
    ...(dropped > 0 && { dropped }),
  };
}

/**
 * The names block trimmed until the message holding it `fits` — the
 * farthest names leave first, and `omitted` says how many left. The RESULT
 * is never cut for the names. `undefined` when not even the block with no
 * names fits: then nothing is attached.
 */
export function fitKnownNames(
  names: KnownNames,
  fits: (block: KnownNames) => boolean,
): KnownNames | undefined {
  if (fits(names)) return names;
  const nearest = names.nearest ?? [];
  for (let keep = nearest.length - 1; keep >= 0; keep--) {
    const block: KnownNames = {
      ...names,
      nearest: nearest.slice(0, keep),
      omitted: (names.omitted ?? 0) + (nearest.length - keep),
    };
    if (fits(block)) return block;
  }
  return undefined;
}
