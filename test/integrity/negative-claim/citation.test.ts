/**
 * negative-claim — the TYPED door: a negative claim is a CITATION (design § 5.1, § 5.4).
 *
 * The model fills `{ kind, restsOn: [resultId, …], about? }` and writes no scope word. A result
 * id is the LIBRARY-minted identity of one read (`claim-result/<ns>/<runId>/<ordinal>`), never a
 * provider call id — those are reused across iterations, branches, resume legs and turns. The
 * claim binds to the cited reads by that identity and nothing else; only the cited read itself
 * can establish it. A gap never withholds a typed claim — the library states it.
 *
 * Test types: unit (each verdict, one by one) · contract (the row's shape and disposition; no
 * value and no sentence on it) · negative (siblings, other turns and legs, other tools,
 * malformed citations, provider ids) · scenario (a 503 then a retry; a read then a failure; a
 * write after the read; a wider search that returned rows).
 */
import { describe, expect, it } from 'vitest';

import { judgeTypedNegatives } from '../../../src/integrity/negative-claim/judge.js';
import type { TurnCall } from '../../../src/integrity/negative-claim/types.js';
import {
  CLOCK,
  amongCall,
  changesCall,
  incidentCall,
  rid,
  turnRecord,
  writeCall,
} from './fixtures.js';

interface Options {
  readonly turn?: number;
  readonly runId?: string;
  readonly ledgerComplete?: boolean;
  readonly citable?: readonly string[];
}

const judge = (negatives: unknown, calls: readonly TurnCall[], options: Options = {}) =>
  judgeTypedNegatives({
    field: 'negatives',
    negatives,
    record: turnRecord(calls, options),
    ...(options.citable === undefined ? {} : { citable: options.citable }),
  });

const codeOf = (negatives: unknown, calls: readonly TurnCall[], options?: Options) =>
  judge(negatives, calls, options).map((j) => j.row.code);

const none = (...ids: string[]) => [{ kind: 'none', restsOn: ids.map((id) => rid(id)) }];
const complete = (...ids: string[]) => [{ kind: 'complete', restsOn: ids.map((id) => rid(id)) }];

describe('established — the cited read itself, and the kind fits its row', () => {
  it('`none` citing a declared absence is established, with a statement', () => {
    const [j] = judge(none('c1'), [incidentCall()]);
    expect(j?.row).toMatchObject({
      id: 'agent:negative-claims:negatives#0',
      path: 'negatives[0]',
      index: 0,
      kind: 'none',
      code: 'established',
      disposition: 'not-applicable',
      tools: ['list_incidents'],
      results: [rid('c1')],
    });
    expect(j?.statement?.text).toContain('`list_incidents` found none — as the tool names them:');
  });

  it('`not-found` citing an `among` absence is established', () => {
    expect(codeOf([{ kind: 'not-found', restsOn: [rid('c4')] }], [amongCall()])).toEqual([
      'established',
    ]);
  });

  it('`complete` citing a complete search that returned rows is established', () => {
    const call = incidentCall({ emptiness: 'non-empty', rows: 3 });
    expect(codeOf(complete('c1'), [call])).toEqual(['established']);
  });

  it('`complete` citing a complete search that came back empty is established', () => {
    expect(codeOf(complete('c1'), [incidentCall()])).toEqual(['established']);
  });

  it('a gap never withholds a typed claim — the email gap and a partly-held period are stated', () => {
    const call = incidentCall({ held: { from: '2026-10-22T09:00:00Z', to: CLOCK } });
    const [j] = judge(none('c1'), [call]);
    expect(j?.row.code).toBe('established');
    expect(j?.statement?.text).toContain('not checked: ');
    expect(j?.statement?.text).toContain('`incidents filed by email`');
  });

  it('`about` equal to a cited population value is a passing check, never a binding', () => {
    expect(codeOf([{ ...none('c1')[0], about: 'payments' }], [incidentCall()])).toEqual([
      'established',
    ]);
  });
});

describe('checked-fail — contradicted-by-rows and search-incomplete', () => {
  it('a cited `none` whose read returned rows is contradicted', () => {
    const [j] = judge(none('c1'), [incidentCall({ emptiness: 'non-empty', rows: 2 })]);
    expect(j?.row).toMatchObject({ code: 'contradicted-by-rows', disposition: 'checked-fail' });
    expect(j?.statement).toBeUndefined();
  });

  it('a cited `not-found` whose read returned rows is contradicted', () => {
    const rows: TurnCall = { ...amongCall(), emptiness: 'non-empty', rows: 1 };
    expect(codeOf([{ kind: 'not-found', restsOn: [rid('c4')] }], [rows])).toEqual([
      'contradicted-by-rows',
    ]);
  });

  it('two reads of the cited key that disagree contradict a claim citing the empty one', () => {
    const calls = [
      incidentCall({ id: 'c1' }),
      incidentCall({ id: 'c2', emptiness: 'non-empty', rows: 1 }),
    ];
    expect(codeOf(none('c1'), calls)).toEqual(['contradicted-by-rows']);
  });

  it('a default composed as if sent keys the same: rows on `window` omitted, `2h` sent', () => {
    const calls = [
      incidentCall({ id: 'c1', emptiness: 'non-empty', rows: 1 }),
      incidentCall({ id: 'c2', window: '2h' }),
    ];
    expect(codeOf(none('c2'), calls)).toEqual(['contradicted-by-rows']);
  });

  it('`complete` on a search that is not complete is search-incomplete', () => {
    const call = incidentCall({ emptiness: 'non-empty', rows: 3, complete: false });
    const [j] = judge(complete('c1'), [call]);
    expect(j?.row).toMatchObject({ code: 'search-incomplete', disposition: 'checked-fail' });
  });

  it('`complete` on a search that reached a cap is search-incomplete', () => {
    const call = incidentCall({
      emptiness: 'non-empty',
      rows: 200,
      gaps: [{ kind: 'cap-reached', what: 'limit: 200 reached', bears: 'completeness' }],
    });
    expect(codeOf(complete('c1'), [call])).toEqual(['search-incomplete']);
  });

  it('`complete` on a search with a next page is search-incomplete', () => {
    const call = incidentCall({
      emptiness: 'non-empty',
      rows: 50,
      gaps: [{ kind: 'paged', what: 'later pages', bears: 'completeness' }],
    });
    expect(codeOf(complete('c1'), [call])).toEqual(['search-incomplete']);
  });

  it('`complete` on a `partial` result is search-incomplete; a `none` on it is stated', () => {
    const partial = {
      kind: 'partial' as const,
      what: 'the rest of a partial result',
      bears: 'completeness' as const,
    };
    const call = incidentCall({ emptiness: 'non-empty', rows: 3, gaps: [partial] });
    expect(codeOf(complete('c1'), [call])).toEqual(['search-incomplete']);
    const [j] = judge(none('c1'), [incidentCall({ gaps: [partial] })]);
    expect(j?.row.code).toBe('established');
    expect(j?.statement?.text).toContain('not checked: `the rest of a partial result`');
  });
});

describe('a wider search this run leg that returned rows', () => {
  const critical = incidentCall({ id: 'c1', severity: 'critical' });

  it('withholds a typed `none`: wider-search-has-rows', () => {
    const wide = incidentCall({ id: 'c2', emptiness: 'non-empty', rows: 2 });
    const [j] = judge(none('c1'), [critical, wide]);
    expect(j?.row).toMatchObject({ code: 'wider-search-has-rows', disposition: 'checked-fail' });
  });

  it('unless every row carries the filtered field with a different value', () => {
    const wide = incidentCall({
      id: 'c2',
      emptiness: 'non-empty',
      rows: 2,
      rowsRead: [
        { entity: 'INC-1', severity: 'minor' },
        { entity: 'INC-2', severity: 'major' },
      ],
    });
    expect(codeOf(none('c1'), [critical, wide])).toEqual(['established']);
  });

  it('a row that carries the filtered field with the SAME value contradicts the claim', () => {
    const wide = incidentCall({
      id: 'c2',
      emptiness: 'non-empty',
      rows: 2,
      rowsRead: [
        { entity: 'INC-1', severity: 'minor' },
        { entity: 'INC-2', severity: 'critical' },
      ],
    });
    expect(codeOf(none('c1'), [critical, wide])).toEqual(['contradicted-by-rows']);
  });

  it('a row with no such field cannot be ruled out', () => {
    const wide = incidentCall({
      id: 'c2',
      emptiness: 'non-empty',
      rows: 1,
      rowsRead: [{ entity: 'INC-1' }],
    });
    expect(codeOf(none('c1'), [critical, wide])).toEqual(['wider-search-has-rows']);
  });

  it('a search on another population is not wider', () => {
    const other = incidentCall({ id: 'c2', service: 'checkout', emptiness: 'non-empty', rows: 2 });
    expect(codeOf(none('c1'), [critical, other])).toEqual(['established']);
  });

  it('a search narrower than the cited one is not wider', () => {
    const plain = incidentCall({ id: 'c1' });
    const narrower = incidentCall({
      id: 'c2',
      severity: 'critical',
      emptiness: 'non-empty',
      rows: 1,
    });
    expect(codeOf(none('c1'), [plain, narrower])).toEqual(['contradicted-by-rows']);
  });

  it('another tool on the same entity is never pulled in: list_changes(payments) rows', () => {
    expect(codeOf(none('c1'), [incidentCall({ id: 'c1' }), changesCall('k1')])).toEqual([
      'established',
    ]);
  });
});

describe('unreachable — the claim cannot be judged, so it is withheld with a reason', () => {
  it('citation-unresolved: an empty `restsOn`, or an identity the run never minted', () => {
    expect(codeOf([{ kind: 'none', restsOn: [] }], [incidentCall()])).toEqual([
      'citation-unresolved',
    ]);
    expect(codeOf(none('c9'), [incidentCall()])).toEqual(['citation-unresolved']);
  });

  it('citation-unresolved: a provider call id is not a result identity', () => {
    expect(codeOf([{ kind: 'none', restsOn: ['c1'] }], [incidentCall()])).toEqual([
      'citation-unresolved',
    ]);
  });

  it('citation-unresolved: an identity from another recording namespace', () => {
    const foreign = rid('c1').replace('bench-ns', 'other-ns');
    expect(codeOf([{ kind: 'none', restsOn: [foreign] }], [incidentCall()])).toEqual([
      'citation-unresolved',
    ]);
  });

  it('a result identity cited twice is one citation, not a malformed one', () => {
    const [j] = judge([{ kind: 'none', restsOn: [rid('c1'), rid('c1')] }], [incidentCall()]);
    expect(j?.row).toMatchObject({ code: 'established', results: [rid('c1')] });
  });

  it('citation-unresolved: a field that holds no citation at all', () => {
    expect(codeOf('there are none', [incidentCall()])).toEqual(['citation-unresolved']);
    expect(codeOf([{ kind: 'none' }], [incidentCall()])).toEqual(['citation-unresolved']);
  });

  it('no field, no claim: nothing to judge', () => {
    expect(judge(undefined, [incidentCall()])).toEqual([]);
    expect(judge([], [incidentCall()])).toEqual([]);
  });

  it('cited-call-undeclared: the cited read has no composed row', () => {
    expect(codeOf(none('c1'), [incidentCall({ noRow: true })])).toEqual(['cited-call-undeclared']);
  });

  it('cited-call-undeclared: the cited tool is not one the app lets a claim cite', () => {
    expect(codeOf(none('c1'), [incidentCall()], { citable: ['get_capacity'] })).toEqual([
      'cited-call-undeclared',
    ]);
  });

  it('coverage-unverified: a `composed: remote` row establishes nothing', () => {
    expect(codeOf(none('c1'), [incidentCall({ composed: 'remote' })])).toEqual([
      'coverage-unverified',
    ]);
  });

  it.each([
    ['an error', { outcome: 'error' as const }],
    ['not run', { outcome: 'not-run' as const }],
    ['a clarify answer', { emptiness: 'clarify' as const }],
    ['an unknown shape', { emptiness: 'unknown' as const }],
  ])('call-not-read: %s', (_name, options) => {
    const [j] = judge(none('c1'), [incidentCall(options)]);
    expect(j?.row).toMatchObject({ code: 'call-not-read', disposition: 'unreachable' });
  });

  it('kind-mismatch: `not-found` on a read that is not an `among` absence', () => {
    expect(codeOf([{ kind: 'not-found', restsOn: [rid('c1')] }], [incidentCall()])).toEqual([
      'kind-mismatch',
    ]);
  });

  it('kind-mismatch: `none` on an `among` miss — the template is chosen by the row', () => {
    expect(codeOf([{ kind: 'none', restsOn: [rid('c4')] }], [amongCall()])).toEqual([
      'kind-mismatch',
    ]);
  });

  it('kind-mismatch: `none` on an empty result that is not a declared absence', () => {
    expect(codeOf(none('c1'), [incidentCall({ emptiness: 'undeclared-empty' })])).toEqual([
      'kind-mismatch',
    ]);
  });

  it('kind-mismatch: a kind the citation grammar does not have', () => {
    expect(codeOf([{ kind: 'never', restsOn: [rid('c1')] }], [incidentCall()])).toEqual([
      'kind-mismatch',
    ]);
  });

  it('about-mismatch: `about` names an entity no cited read was sent for', () => {
    const [j] = judge([{ ...none('c1')[0], about: 'checkout' }], [incidentCall()]);
    expect(j?.row).toMatchObject({ code: 'about-mismatch', disposition: 'unreachable' });
  });

  it('record-incomplete: the tool-call ledger is incomplete', () => {
    expect(codeOf(none('c1'), [incidentCall()], { ledgerComplete: false })).toEqual([
      'record-incomplete',
    ]);
  });

  it('record-incomplete: the cited read is kept out by redaction', () => {
    expect(codeOf(none('c1'), [incidentCall({ keptOut: true })])).toEqual(['record-incomplete']);
  });

  it('stale-turn: the cited read was made on an earlier turn', () => {
    const call = incidentCall({ turn: 1, readAt: '2026-10-22T09:14:00Z' });
    const [j] = judge(none('c1'), [call], { turn: 2 });
    expect(j?.row).toMatchObject({
      code: 'stale-turn',
      disposition: 'unreachable',
      staleSince: { turn: 1, readAt: '2026-10-22T09:14:00Z' },
    });
  });

  it('stale-turn: the cited read and the answer are in different run legs (a pause between)', () => {
    const call = incidentCall({ id: 'c1', runId: 'run-0' });
    const citation = [{ kind: 'none', restsOn: [rid('c1', 'run-0')] }];
    expect(codeOf(citation, [call], { runId: 'run-1' })).toEqual(['stale-turn']);
  });
});

describe('the call sequence — what ran after the cited read', () => {
  it('a retry after a 503 does not withhold a correct none: cite the retry', () => {
    const calls = [incidentCall({ id: 'c1', outcome: 'error' }), incidentCall({ id: 'c2' })];
    expect(codeOf(none('c2'), calls)).toEqual(['established']);
  });

  it('citing the failed attempt itself is call-not-read — another read never establishes it', () => {
    const calls = [incidentCall({ id: 'c1', outcome: 'error' }), incidentCall({ id: 'c2' })];
    expect(codeOf(none('c1'), calls)).toEqual(['call-not-read']);
  });

  it('later-read-failed: a same-key call after the cited read that did not read', () => {
    const calls = [incidentCall({ id: 'c1' }), incidentCall({ id: 'c2', outcome: 'error' })];
    const [j] = judge(none('c1'), calls);
    expect(j?.row).toMatchObject({ code: 'later-read-failed', disposition: 'checked-fail' });
  });

  it('later-read-failed: a failure whose scope was never composed may be the same search', () => {
    const calls = [
      incidentCall({ id: 'c1' }),
      incidentCall({ id: 'c2', service: 'checkout', outcome: 'error', noScope: true }),
    ];
    expect(codeOf(none('c1'), calls)).toEqual(['later-read-failed']);
  });

  it('later-read-failed: a same-key failure in the same batch counts as after', () => {
    const calls = [
      incidentCall({ id: 'c2', outcome: 'error', batch: 4 }),
      incidentCall({ id: 'c1', batch: 4 }),
    ];
    expect(codeOf(none('c1'), calls)).toEqual(['later-read-failed']);
  });

  it('a later failure on ANOTHER key leaves the cited read alone', () => {
    const calls = [
      incidentCall({ id: 'c1' }),
      incidentCall({ id: 'c2', service: 'checkout', outcome: 'error' }),
    ];
    expect(codeOf(none('c1'), calls)).toEqual(['established']);
  });

  it('superseded-by-write: a call of a tool with no `search` ran after the cited read', () => {
    const [j] = judge(none('c1'), [incidentCall({ id: 'c1' }), writeCall('w1')]);
    expect(j?.row).toMatchObject({ code: 'superseded-by-write', disposition: 'checked-fail' });
    expect(j?.statement).toBeUndefined();
  });

  it('superseded-by-write: a timed-out write after the read — it may have written', () => {
    expect(
      codeOf(none('c1'), [incidentCall({ id: 'c1' }), writeCall('w1', { outcome: 'error' })]),
    ).toEqual(['superseded-by-write']);
  });

  it('a write refused before dispatch (a schema refusal) never ran and does not count', () => {
    const refused = writeCall('w1', { outcome: 'error', dispatched: false });
    expect(codeOf(none('c1'), [incidentCall({ id: 'c1' }), refused])).toEqual(['established']);
  });

  it('a write declined before it ran (not-run) does not count', () => {
    const declined = writeCall('w1', { outcome: 'not-run' });
    expect(codeOf(none('c1'), [incidentCall({ id: 'c1' }), declined])).toEqual(['established']);
  });

  it('a write in the SAME parallel batch as the read counts as after: order unknown', () => {
    const calls = [writeCall('w1', { batch: 7 }), incidentCall({ id: 'c1', batch: 7 })];
    expect(codeOf(none('c1'), calls)).toEqual(['superseded-by-write']);
  });

  it('a read of a `search` tool after the cited read is not a write', () => {
    expect(codeOf(none('c1'), [incidentCall({ id: 'c1' }), changesCall('k1')])).toEqual([
      'established',
    ]);
  });

  it('a write BEFORE the cited read does not supersede it', () => {
    expect(codeOf(none('c1'), [writeCall('w1'), incidentCall({ id: 'c1' })])).toEqual([
      'established',
    ]);
  });

  it('a write on an earlier turn does not supersede a read of this turn', () => {
    const calls = [writeCall('w0', { turn: 1 }), incidentCall({ id: 'c1', turn: 2 })];
    expect(codeOf(none('c1'), calls, { turn: 2 })).toEqual(['established']);
  });

  it('a claim citing two reads needs both: one unread withholds it', () => {
    const calls = [
      incidentCall({ id: 'c1' }),
      incidentCall({ id: 'c2', service: 'checkout', outcome: 'error' }),
    ];
    expect(codeOf(none('c1', 'c2'), calls)).toEqual(['call-not-read']);
  });
});

describe('the row — names, identities and codes only', () => {
  it('never carries a value or a sentence', () => {
    const judged = judge(
      [
        { ...none('c1')[0], about: 'payments' },
        { ...none('c1')[0], about: 'checkout' },
      ],
      [incidentCall()],
    );
    const rows = JSON.stringify(judged.map((j) => j.row));
    expect(rows).not.toContain('payments');
    expect(rows).not.toContain('checkout');
    expect(rows).not.toContain('found no');
    expect(judged.map((j) => j.row.id)).toEqual([
      'agent:negative-claims:negatives#0',
      'agent:negative-claims:negatives#1',
    ]);
  });

  it('is deterministic: the same record judged twice gives equal rows and statements', () => {
    const run = () => judge([...none('c1'), ...complete('c1')], [incidentCall()]);
    expect(run()).toEqual(run());
  });
});
