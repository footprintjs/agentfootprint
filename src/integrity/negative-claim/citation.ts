/**
 * citation — the typed door's rules (design § 5.1, § 5.4): a typed negative claim CITES the
 * reads it rests on by their library-minted result identity, and is established only from
 * those reads themselves.
 *
 * Pattern: one verdict per cited read, then the first code by a fixed precedence. A read must
 *          resolve in THIS turn of this recording (a pause between legs of one turn does not make
 *          it stale; an earlier turn does), have run and returned, carry a local composed row,
 *          and fit the claim's kind (a `none` on a read with a next page proves nothing about the
 *          other pages). Then the monotone withholds, read off the call sequence: rows on the
 *          same or a narrower search (`contradicted-by-rows`); rows on a wider search not
 *          provably outside the cited filters (`wider-search-has-rows`); for `complete`, a read
 *          of the same search with more rows, or a row provably inside the cited scope that the
 *          list does not hold; a same-search call that failed after the read
 *          (`later-read-failed`); and any dispatched call the caller does not classify as a
 *          read after it — or in its batch, where order is unknown (`superseded-by-write`). A
 *          gap never withholds: the statement says it.
 * Role:    integrity/ layer (L3), read by `judge.ts`. Pure; another call never establishes a
 *          claim, and nothing here binds by a provider call id or by an entity's name.
 */

import { readResultIdentity } from '../claim-binding/capture.js';
import type { ResultIdentity } from '../claim-binding/types.js';
import {
  isAmongRow,
  isRead,
  readingKey,
  returnedReading,
  scopeRelation,
  type ScopeRelation,
} from './readings.js';
import type { NegativeKind, StaleSince, TurnCall, TurnRecord, TypedVerdict } from './types.js';
import { sameValue } from './words.js';

/** The verdict on one citation, with the reads it rests on when established. */
export interface CitationVerdict {
  readonly kind: NegativeKind | 'unknown';
  readonly code: TypedVerdict;
  readonly results: readonly string[];
  readonly tools: readonly string[];
  readonly staleSince?: StaleSince;
  readonly reads: readonly TurnCall[];
}

/** The order a claim's codes are reported in when several of its reads fail. */
const PRECEDENCE: readonly TypedVerdict[] = [
  'too-many-claims',
  'citation-unresolved',
  'stale-turn',
  'record-incomplete',
  'cited-call-undeclared',
  'call-not-read',
  'coverage-unverified',
  'kind-mismatch',
  'contradicted-by-rows',
  'wider-search-has-rows',
  'search-incomplete',
  'later-read-failed',
  'superseded-by-write',
  'about-mismatch',
];

const KINDS: readonly NegativeKind[] = ['none', 'not-found', 'complete'];

/** At most this many distinct reads in one claim; beyond it the claim is `too-many-claims`. */
export const MAX_CITED_READS = 16;
const COMPLETENESS_GAPS = new Set(['cap-reached', 'paged', 'partial']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function identityOf(raw: string): ResultIdentity | undefined {
  try {
    return readResultIdentity(raw);
  } catch {
    return undefined;
  }
}

/**
 * The calls of the answer's own turn, in this recording: keyed on namespace and turn, never on
 * the run id — a read made before a pause in the same turn is this turn's read.
 */
function turnCallsOf(record: TurnRecord): TurnCall[] {
  return record.calls.filter((call) => {
    const identity = identityOf(call.resultId);
    return (
      identity !== undefined &&
      identity.namespace === record.leg.namespace &&
      call.turn === record.turn
    );
  });
}

const fieldOf = (row: Readonly<Record<string, unknown>>, argument: string): unknown =>
  Object.prototype.hasOwnProperty.call(row, argument) ? row[argument] : undefined;

/** Where one row of a wider search sits against the cited filters. */
function placeRow(
  row: Readonly<Record<string, unknown>>,
  relation: ScopeRelation,
): 'outside' | 'inside' | 'undecided' {
  const outside = relation.narrowed.some((n) => {
    const value = fieldOf(row, n.argument);
    return value !== undefined && !n.values.some((v) => sameValue(v, value));
  });
  if (outside) return 'outside';
  const inside =
    relation.narrowed.length > 0 &&
    !relation.windowNarrowed &&
    relation.narrowed.every((n) => {
      const value = fieldOf(row, n.argument);
      return value !== undefined && n.values.some((v) => sameValue(v, value));
    });
  return inside ? 'inside' : 'undecided';
}

/** Rows of a wider search against a `none`: provably outside, contradicting, or undecided. */
function widerRowsVerdict(
  wider: TurnCall,
  relation: ScopeRelation,
): 'contradicted-by-rows' | 'wider-search-has-rows' | undefined {
  const rows = wider.rowsRead;
  const count = wider.rows ?? rows?.length ?? 0;
  if (rows === undefined || rows.length < count) return 'wider-search-has-rows';
  const places = rows.map((row) => placeRow(row, relation));
  if (places.includes('inside')) return 'contradicted-by-rows';
  return places.includes('undecided') ? 'wider-search-has-rows' : undefined;
}

/** The identities of a read's rows (a fact's `entity`, or the declared id column). */
function identitiesOf(call: TurnCall): Set<string> | undefined {
  const column = call.idColumn ?? 'entity';
  const rows = call.rowsRead ?? [];
  const ids = rows.map((row) => fieldOf(row, column));
  if (ids.length < (call.rows ?? ids.length) || ids.some((id) => id === undefined))
    return undefined;
  return new Set(ids.map((id) => sameKeyOf(id)));
}

const sameKeyOf = (value: unknown): string => JSON.stringify(String(value).normalize('NFC'));

/**
 * Other reads against a `complete` claim: a read of the same or a narrower search with MORE rows
 * than the cited list contradicts it, as does a row provably inside the cited scope (from a
 * narrower or wider search) that the cited list does not hold. A row whose identity cannot be
 * compared cannot be ruled out.
 */
function completeVerdict(
  other: TurnCall,
  call: TurnCall,
  relation: ScopeRelation,
): 'contradicted-by-rows' | 'wider-search-has-rows' | undefined {
  const listed = call.rows ?? call.rowsRead?.length ?? 0;
  if (relation.relation === 'same') {
    return (other.rows ?? other.rowsRead?.length ?? 0) > listed
      ? 'contradicted-by-rows'
      : undefined;
  }
  let inside: readonly Readonly<Record<string, unknown>>[];
  if (relation.relation === 'narrower') {
    if ((other.rows ?? other.rowsRead?.length ?? 0) > listed) return 'contradicted-by-rows';
    inside = other.rowsRead ?? [];
  } else if (relation.relation === 'wider') {
    inside = (other.rowsRead ?? []).filter((row) => placeRow(row, relation) === 'inside');
  } else {
    return undefined;
  }
  if (inside.length === 0) return undefined;
  const ids = identitiesOf(call);
  const column = other.idColumn ?? 'entity';
  for (const row of inside) {
    const id = fieldOf(row, column);
    if (ids === undefined || id === undefined) return 'wider-search-has-rows';
    if (!ids.has(sameKeyOf(id))) return 'contradicted-by-rows';
  }
  return undefined;
}

/** The kind's own rule over one cited read's row. */
function kindVerdict(kind: NegativeKind, call: TurnCall): TypedVerdict | undefined {
  const row = call.row;
  if (row === undefined) return 'cited-call-undeclared';
  if (kind === 'complete') {
    const incomplete = !row.complete || row.gaps.some((gap) => COMPLETENESS_GAPS.has(gap.kind));
    return incomplete ? 'search-incomplete' : undefined;
  }
  const among = isAmongRow(call);
  if (kind === 'none' && among) return 'kind-mismatch';
  if (kind === 'not-found' && !among) return 'kind-mismatch';
  if (call.emptiness === 'non-empty') return 'contradicted-by-rows';
  if (call.emptiness !== 'declared-absent') return 'kind-mismatch';
  // One page proves nothing about the pages not read.
  return row.gaps.some((gap) => gap.kind === 'paged') ? 'search-incomplete' : undefined;
}

/** The sequence rules for one established-so-far read. */
function sequenceVerdict(
  kind: NegativeKind,
  call: TurnCall,
  record: TurnRecord,
  peers: readonly TurnCall[],
): TypedVerdict | undefined {
  const tool = record.tools[call.toolName];
  const at = peers.indexOf(call);
  const after = (other: TurnCall) => peers.indexOf(other) > at || other.batch === call.batch;
  const codes: TypedVerdict[] = [];
  const key = readingKey(call, tool, record.clock);
  for (const other of peers) {
    if (other === call) continue;
    if (returnedReading(other) && other.emptiness === 'non-empty') {
      const relation = scopeRelation(other, call, tool, record.clock);
      if (kind === 'complete') {
        const verdict = completeVerdict(other, call, relation);
        if (verdict !== undefined) codes.push(verdict);
      } else if (relation.relation === 'same' || relation.relation === 'narrower') {
        codes.push('contradicted-by-rows');
      } else if (relation.relation === 'wider' && kind === 'none') {
        const verdict = widerRowsVerdict(other, relation);
        if (verdict !== undefined) codes.push(verdict);
      }
    }
    if (!after(other) || !other.dispatched) continue;
    const otherKey = readingKey(other, tool, record.clock);
    const sameSearch = otherKey === undefined ? other.toolName === call.toolName : otherKey === key;
    if (sameSearch && other.outcome !== 'ok') codes.push('later-read-failed');
    if (!isRead(other)) codes.push('superseded-by-write');
  }
  return PRECEDENCE.find((code) => codes.includes(code));
}

/** One cited read: resolve it, then its row, its kind and what ran around it. */
function readVerdict(
  raw: string,
  kind: NegativeKind,
  record: TurnRecord,
  peers: readonly TurnCall[],
  citable: readonly string[] | undefined,
): { code?: TypedVerdict; call?: TurnCall; staleSince?: StaleSince } {
  const identity = identityOf(raw);
  if (identity === undefined || identity.namespace !== record.leg.namespace) {
    return { code: 'citation-unresolved' };
  }
  // Resolved by the identity alone; an unknown run id resolves nothing.
  const call = record.calls.find((c) => c.resultId === raw);
  if (call === undefined || call.turn > record.turn) return { code: 'citation-unresolved' };
  if (call.turn < record.turn) {
    const staleSince = {
      turn: call.turn,
      ...(call.readAt === undefined ? {} : { readAt: call.readAt }),
    };
    return { code: 'stale-turn', call, staleSince };
  }
  if (call.keptOut === true) return { code: 'record-incomplete', call };
  if (citable !== undefined && !citable.includes(call.toolName)) {
    return { code: 'cited-call-undeclared', call };
  }
  if (!returnedReading(call)) return { code: 'call-not-read', call };
  if (call.row === undefined) return { code: 'cited-call-undeclared', call };
  if (call.row.composed !== 'local') return { code: 'coverage-unverified', call };
  const code = kindVerdict(kind, call) ?? sequenceVerdict(kind, call, record, peers);
  return code === undefined ? { call } : { code, call };
}

/** `about` as given: a non-empty string or a number; `null`, `""` and absent are no `about`. */
const aboutOf = (about: unknown): string | number | undefined | 'invalid' =>
  about === undefined || about === null || about === ''
    ? undefined
    : typeof about === 'string' || typeof about === 'number'
    ? about
    : 'invalid';

/** Whether `about` names the entity a cited read was sent for: its value, resolved id, name or alias. */
function aboutFits(about: string | number, reads: readonly TurnCall[]): boolean {
  return reads.some((call) =>
    (call.row?.checked ?? []).some((item) => {
      if (item.facet !== 'population') return false;
      const names = [
        item.value,
        item.resolved?.id,
        item.resolved?.name,
        ...(item.resolved?.aliases ?? []),
      ];
      return names.some((name) => name !== undefined && sameValue(name, about));
    }),
  );
}

/** Judge one entry of the typed field. */
export function judgeCitation(
  entry: unknown,
  record: TurnRecord,
  citable?: readonly string[],
): CitationVerdict {
  const unresolved = (kind: NegativeKind | 'unknown'): CitationVerdict => ({
    kind,
    code: 'citation-unresolved',
    results: [],
    tools: [],
    reads: [],
  });
  if (!isRecord(entry)) return unresolved('unknown');
  const kind = KINDS.find((k) => k === entry.kind);
  const cited = Array.isArray(entry.restsOn) ? entry.restsOn : [];
  const raws = [...new Set(cited.filter((v): v is string => typeof v === 'string'))];
  const results = raws.filter((raw) => identityOf(raw) !== undefined);
  if (raws.length === 0 || !cited.every((v) => typeof v === 'string')) {
    return { ...unresolved(kind ?? 'unknown'), results };
  }
  if (raws.length > MAX_CITED_READS) {
    return { kind: kind ?? 'unknown', code: 'too-many-claims', results: [], tools: [], reads: [] };
  }
  if (kind === undefined) {
    return { kind: 'unknown', code: 'kind-mismatch', results, tools: [], reads: [] };
  }
  if (!record.ledgerComplete) {
    return { kind, code: 'record-incomplete', results, tools: [], reads: [] };
  }
  const peers = turnCallsOf(record);
  const verdicts = raws.map((raw) => readVerdict(raw, kind, record, peers, citable));
  const reads = verdicts.flatMap((v) => (v.call === undefined ? [] : [v.call]));
  const tools = [...new Set(reads.map((call) => call.toolName))].sort();
  const failed = PRECEDENCE.find((code) => verdicts.some((v) => v.code === code));
  if (failed !== undefined) {
    const staleSince = verdicts.find((v) => v.code === failed)?.staleSince;
    return {
      kind,
      code: failed,
      results,
      tools,
      reads: [],
      ...(staleSince === undefined ? {} : { staleSince }),
    };
  }
  const about = aboutOf(entry.about);
  if (about === 'invalid' || (about !== undefined && !aboutFits(about, reads))) {
    return { kind, code: 'about-mismatch', results, tools, reads: [] };
  }
  return { kind, code: 'established', results, tools, reads };
}
