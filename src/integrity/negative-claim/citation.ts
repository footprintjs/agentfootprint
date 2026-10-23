/**
 * citation — the typed door's rules (design § 5.1, § 5.4): a typed negative claim CITES the
 * reads it rests on by their library-minted result identity, and is established only from
 * those reads themselves.
 *
 * Pattern: one verdict per cited read, then the first code by a fixed precedence. A read must
 *          resolve in THIS run leg and turn, have run and returned, carry a local composed row,
 *          and fit the claim's kind. Then four monotone withholds, all read off the call
 *          sequence: rows on the same or a narrower search (`contradicted-by-rows`), rows on a
 *          wider search that are not provably outside the cited filters
 *          (`wider-search-has-rows`), a same-search call that failed after the read
 *          (`later-read-failed`), and any dispatched call that is not a read after it — or in
 *          its batch, where order is unknown (`superseded-by-write`). A gap never withholds: the
 *          statement says it.
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

/** The calls of the answer's own leg and turn, with their place in the sequence. */
function legCallsOf(record: TurnRecord): TurnCall[] {
  return record.calls.filter((call) => {
    const identity = identityOf(call.resultId);
    return (
      identity !== undefined &&
      identity.namespace === record.leg.namespace &&
      identity.runId === record.leg.runId &&
      call.turn === record.turn
    );
  });
}

/** Rows of a wider search: provably outside the cited filters, contradicting, or undecided. */
function widerRowsVerdict(
  wider: TurnCall,
  relation: ScopeRelation,
): 'contradicted-by-rows' | 'wider-search-has-rows' | undefined {
  const rows = wider.rowsRead;
  const count = wider.rows ?? rows?.length ?? 0;
  if (rows === undefined || rows.length < count) return 'wider-search-has-rows';
  let undecided = false;
  for (const row of rows) {
    const field = (argument: string) =>
      Object.prototype.hasOwnProperty.call(row, argument) ? row[argument] : undefined;
    const outside = relation.narrowed.some((n) => {
      const value = field(n.argument);
      return value !== undefined && !n.values.some((v) => sameValue(v, value));
    });
    if (outside) continue;
    const inside =
      relation.narrowed.length > 0 &&
      !relation.windowNarrowed &&
      relation.narrowed.every((n) => {
        const value = field(n.argument);
        return value !== undefined && n.values.some((v) => sameValue(v, value));
      });
    if (inside) return 'contradicted-by-rows';
    undecided = true;
  }
  return undecided ? 'wider-search-has-rows' : undefined;
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
  return call.emptiness === 'declared-absent' ? undefined : 'kind-mismatch';
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
    if (kind !== 'complete' && returnedReading(other) && other.emptiness === 'non-empty') {
      const relation = scopeRelation(other, call, tool, record.clock);
      if (relation.relation === 'same' || relation.relation === 'narrower') {
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
    if (!isRead(other, record.tools)) codes.push('superseded-by-write');
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
  const call = record.calls.find((c) => c.resultId === raw);
  const since =
    call === undefined
      ? undefined
      : { turn: call.turn, ...(call.readAt === undefined ? {} : { readAt: call.readAt }) };
  if (identity.runId !== record.leg.runId)
    return { code: 'stale-turn', ...(since === undefined ? {} : { staleSince: since }) };
  if (call === undefined) return { code: 'citation-unresolved' };
  if (call.turn !== record.turn)
    return { code: 'stale-turn', call, ...(since === undefined ? {} : { staleSince: since }) };
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

/** Whether `about` is a population value a cited read was sent for. */
function aboutFits(about: unknown, reads: readonly TurnCall[]): boolean {
  if (typeof about !== 'string' && typeof about !== 'number') return false;
  return reads.some((call) =>
    (call.row?.checked ?? []).some(
      (item) =>
        item.facet === 'population' &&
        (sameValue(item.value, about) ||
          (item.resolved !== undefined && sameValue(item.resolved.id, about))),
    ),
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
  if (kind === undefined) {
    return { kind: 'unknown', code: 'kind-mismatch', results, tools: [], reads: [] };
  }
  if (!record.ledgerComplete) {
    return { kind, code: 'record-incomplete', results, tools: [], reads: [] };
  }
  const peers = legCallsOf(record);
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
  if (entry.about !== undefined && !aboutFits(entry.about, reads)) {
    return { kind, code: 'about-mismatch', results, tools, reads: [] };
  }
  return { kind, code: 'established', results, tools, reads };
}
