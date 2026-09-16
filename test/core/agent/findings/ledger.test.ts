/**
 * findings/ledger — the one writer of `findingsLedger`, the fold that reads
 * it, and the two row builders, on a fake scope and on a real TypedScope.
 *
 * The laws under test are the spec's MUST-NOTs for the record: never infer
 * (a row carries exactly what was declared, and nothing else); append only,
 * the LAST standing per result winning; conflicts from `conflictsOf` over
 * the asserted stratum only — written once per key, witnesses as identities;
 * `epoch` never set; and an event stream that carries identities, enums and
 * counts and never a value or a line of model text.
 *
 * Sections follow Convention 3: Unit (`foldLedger`) · Functional (the row
 * builders) · Integration (`recordFindings` on a fake scope) · Scenario (a
 * footprintjs chart, so the live-proxy read and the commit are the real
 * ones) · Edge (unknown ids, the placed ticket, malformed counts).
 */

import { flowChart } from 'footprintjs';
import { describe, expect, it } from 'vitest';
import { placedToolResult } from '../../../../src/artifacts/placement.js';
import type { ArtifactMeta } from '../../../../src/artifacts/types.js';
import {
  basisRowFrom,
  foldLedger,
  recordFindings,
  standingRowsFrom,
  type FindingsScope,
  type PreviousResult,
} from '../../../../src/core/agent/findings/ledger.js';
import { splitFindings } from '../../../../src/core/agent/findings/reserved.js';
import type {
  ConflictRow,
  DeclaredAssertion,
  FindingsDeclaration,
  FindingsLedger,
  FindingsRow,
  PreviousStanding,
  StandingRow,
} from '../../../../src/core/agent/findings/types.js';
import { assertionKey } from '../../../../src/integrity/assertion/types.js';

// ── Toolkit ──────────────────────────────────────────────────────────────

interface Emitted {
  readonly name: string;
  readonly payload: unknown;
}

/** A scope with the two things the writer touches: the key and `$emit`. */
function fakeScope(): FindingsScope & { readonly events: Emitted[] } {
  const events: Emitted[] = [];
  return {
    events,
    $emit(name: string, payload?: unknown) {
      events.push({ name, payload });
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

const PLACED_META: ArtifactMeta = {
  ref: 'art_9f3c',
  kind: 'tool-result/fetch_log',
  mediaType: 'text/plain',
  bytes: 40_000,
  createdAt: 1_758_000_000_000,
};

/**
 * The previous batch as `AgentState.toolResults` holds it: a JSON result that
 * is not a ticket, a prose result, and ONE placed ticket minted by the library
 * itself (`artifacts/placement.ts · placedToolResult`).
 */
const BATCH: readonly PreviousResult[] = deepFreeze([
  { toolName: 'lookup_port', result: '{"state":"up"}', toolCallId: 'call_1' },
  { toolName: 'lookup_port', result: 'state: down', toolCallId: 'call_2' },
  {
    toolName: 'fetch_log',
    result: JSON.stringify(placedToolResult('fetch_log', PLACED_META, 40_000, 8_000)),
    toolCallId: 'call_3',
  },
]);

const state = (id: string, value: unknown): DeclaredAssertion => ({
  subject: { kind: 'port', id },
  predicate: 'state',
  value,
});

const fact = (toolCallId: string, ...assertions: DeclaredAssertion[]): PreviousStanding => ({
  toolCallId,
  standing: 'fact',
  assertions,
});

const declaring = (...entries: PreviousStanding[]): FindingsDeclaration => ({ previous: entries });

const ON_CALL = { toolCallId: 'call_9' } as const;

/** The key every reading of `port fc1/7 · state` shares (epoch absent). */
const STATE_KEY = assertionKey({
  subject: { kind: 'port', id: 'fc1/7' },
  predicate: 'state',
  value: 'up',
  stratum: 'asserted',
  provenance: 'tool:call_1',
});

const conflictRows = (ledger: FindingsLedger | undefined): ConflictRow[] =>
  (ledger ?? []).filter((r): r is ConflictRow => r.kind === 'conflict');

const standingRows = (ledger: FindingsLedger | undefined): StandingRow[] =>
  (ledger ?? []).filter((r): r is StandingRow => r.kind === 'standing');

const witness = (toolCallId: string) => ({
  toolCallId,
  subject: { kind: 'port', id: 'fc1/7' },
  predicate: 'state',
});

// ── Unit: foldLedger ─────────────────────────────────────────────────────

describe('foldLedger', () => {
  it('an empty ledger folds to nothing', () => {
    const fold = foldLedger([]);
    expect(fold.hasStanding).toBe(false);
    expect(fold.standingOf.size).toBe(0);
    expect(fold.asserted).toEqual([]);
    expect(fold.conflicts).toEqual([]);
  });

  it('the LAST standing row per toolCallId wins; the earlier row stays as history', () => {
    const first = standingRowsFrom(
      BATCH,
      declaring(fact('call_1', state('fc1/7', 'up'))),
      ON_CALL,
      2,
    );
    const second = standingRowsFrom(
      BATCH,
      declaring({ toolCallId: 'call_1', standing: 'noise' }),
      'answer',
      3,
    );
    const rows = [...first, ...second];
    const fold = foldLedger(rows);
    expect(fold.hasStanding).toBe(true);
    expect(fold.standingOf.size).toBe(1);
    expect(fold.standingOf.get('call_1')).toBe(second[0]);
    expect(fold.asserted).toEqual([]);
    expect(rows).toHaveLength(2);
  });

  it('asserted = the assertions of the CURRENT fact rows only, in fold order', () => {
    const rows = [
      ...standingRowsFrom(
        BATCH,
        declaring(fact('call_1', state('fc1/7', 'up'), state('fc1/8', 'down'))),
        ON_CALL,
        2,
      ),
      ...standingRowsFrom(
        BATCH,
        declaring({ toolCallId: 'call_2', standing: 'open', assertions: [state('fc1/9', 'up')] }),
        ON_CALL,
        2,
      ),
    ];
    const fold = foldLedger(rows);
    expect(fold.asserted.map((a) => [a.subject.id, a.value, a.stratum])).toEqual([
      ['fc1/7', 'up', 'asserted'],
      ['fc1/8', 'down', 'asserted'],
    ]);
  });

  it('conflicts are recomputed from asserted: a later ruled-out retires a witness without a rewrite', () => {
    const up = standingRowsFrom(BATCH, declaring(fact('call_1', state('fc1/7', 'up'))), ON_CALL, 2);
    const down = standingRowsFrom(
      BATCH,
      declaring(fact('call_2', state('fc1/7', 'down'))),
      ON_CALL,
      2,
    );
    expect(foldLedger([...up, ...down]).conflicts.map((c) => c.key)).toEqual([STATE_KEY]);

    const retired = standingRowsFrom(
      BATCH,
      declaring({ toolCallId: 'call_2', standing: 'ruled-out', line: 'a stale reading' }),
      'answer',
      3,
    );
    const after = foldLedger([...up, ...down, ...retired]);
    expect(after.conflicts).toEqual([]);
    expect(after.standingOf.get('call_2')?.standing).toBe('ruled-out');
    expect(after.asserted).toEqual(up[0].assertions);
  });

  it('basis and conflict rows never enter standingOf', () => {
    const rows: FindingsRow[] = [
      basisRowFrom({ id: 'call_9', name: 'lookup_port' }, { basis: 'direct' }, 2),
      { kind: 'conflict', key: STATE_KEY, witnesses: [], iteration: 2 },
    ];
    const fold = foldLedger(rows);
    expect(fold.hasStanding).toBe(false);
    expect(fold.standingOf.size).toBe(0);
  });
});

// ── Functional: standingRowsFrom ─────────────────────────────────────────

describe('standingRowsFrom — the stratum mapping', () => {
  it("fact → 'asserted'", () => {
    const [row] = standingRowsFrom(
      BATCH,
      declaring(fact('call_1', state('fc1/7', 'up'))),
      ON_CALL,
      2,
    );
    expect(row.standing).toBe('fact');
    expect(row.assertions).toEqual([
      {
        subject: { kind: 'port', id: 'fc1/7' },
        predicate: 'state',
        value: 'up',
        stratum: 'asserted',
        provenance: 'tool:call_1',
      },
    ]);
  });

  it("open → 'quoted', settles kept", () => {
    const [row] = standingRowsFrom(
      BATCH,
      declaring({
        toolCallId: 'call_1',
        standing: 'open',
        assertions: [state('fc1/7', 'up')],
        settles: 'a second reading',
      }),
      ON_CALL,
      2,
    );
    expect(row.assertions.map((a) => a.stratum)).toEqual(['quoted']);
    expect(row.settles).toBe('a second reading');
  });

  it("ruled-out → 'quoted', line kept", () => {
    const [row] = standingRowsFrom(
      BATCH,
      declaring({
        toolCallId: 'call_1',
        standing: 'ruled-out',
        assertions: [state('fc1/7', 'up')],
        line: 'not a cabling fault',
      }),
      ON_CALL,
      2,
    );
    expect(row.assertions.map((a) => a.stratum)).toEqual(['quoted']);
    expect(row.line).toBe('not a cabling fault');
  });

  it('noise → no assertions, even when the model attached some', () => {
    const [row] = standingRowsFrom(
      BATCH,
      declaring({
        toolCallId: 'call_1',
        standing: 'noise',
        sought: false,
        assertions: [state('fc1/7', 'up')],
      }),
      ON_CALL,
      2,
    );
    expect(row.assertions).toEqual([]);
    expect(row.sought).toBe(false);
  });

  it('never sets epoch or runtimeStageId on a ledger assertion', () => {
    const [row] = standingRowsFrom(
      BATCH,
      declaring(fact('call_1', state('fc1/7', 'up'))),
      ON_CALL,
      2,
    );
    const [assertion] = row.assertions;
    expect(Object.keys(assertion).sort()).toEqual([
      'predicate',
      'provenance',
      'stratum',
      'subject',
      'value',
    ]);
    expect(Object.prototype.hasOwnProperty.call(assertion, 'epoch')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(assertion, 'runtimeStageId')).toBe(false);
  });
});

describe('standingRowsFrom — provenance and the placed ticket', () => {
  it("provenance is 'tool:<toolCallId>' for a JSON result that is not a ticket and for prose", () => {
    const rows = standingRowsFrom(
      BATCH,
      declaring(fact('call_1', state('fc1/7', 'up')), fact('call_2', state('fc1/7', 'down'))),
      ON_CALL,
      2,
    );
    expect(rows.map((r) => r.assertions[0].provenance)).toEqual(['tool:call_1', 'tool:call_2']);
    expect(rows.every((r) => !Object.prototype.hasOwnProperty.call(r, 'ref'))).toBe(true);
  });

  it("a placed result gives 'artifact:<ref>' and puts the ref on the row", () => {
    const [row] = standingRowsFrom(
      BATCH,
      declaring(fact('call_3', state('fc1/7', 'up'))),
      ON_CALL,
      2,
    );
    expect(row.ref).toBe('art_9f3c');
    expect(row.toolName).toBe('fetch_log');
    expect(row.assertions[0].provenance).toBe('artifact:art_9f3c');
  });

  it('a ticket-shaped string the library did not mint is not a ticket (the predicate, not inference)', () => {
    const batch: PreviousResult[] = [
      { toolName: 't', result: '{"placed":true,"ref":"art_x"}', toolCallId: 'c1' }, // no reason
      { toolName: 't', result: '{"placed":true,"reason":"r"}', toolCallId: 'c2' }, // no ref
      { toolName: 't', result: '{"placed":true,"ref":"art_x","reason":', toolCallId: 'c3' }, // not JSON
      { toolName: 't', result: '["art_x"]', toolCallId: 'c4' }, // not an object
    ];
    const rows = standingRowsFrom(
      batch,
      declaring(
        fact('c1', state('p', 1)),
        fact('c2', state('p', 1)),
        fact('c3', state('p', 1)),
        fact('c4', state('p', 1)),
      ),
      ON_CALL,
      2,
    );
    expect(rows.map((r) => r.assertions[0].provenance)).toEqual([
      'tool:c1',
      'tool:c2',
      'tool:c3',
      'tool:c4',
    ]);
    expect(rows.some((r) => 'ref' in r)).toBe(false);
  });
});

describe('standingRowsFrom — identity, declaredOn, iteration', () => {
  it('an id the batch does not hold is filed with unknownId and no toolName, never resolved', () => {
    const [row] = standingRowsFrom(
      BATCH,
      declaring(fact('call_404', state('fc1/7', 'up'))),
      ON_CALL,
      2,
    );
    expect(row.unknownId).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(row, 'toolName')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(row, 'ref')).toBe(false);
    expect(row.assertions[0].provenance).toBe('tool:call_404');
  });

  it('declaredOn is a copy of the declaring call, or the literal answer', () => {
    const [onCall] = standingRowsFrom(BATCH, declaring(fact('call_1')), ON_CALL, 2);
    expect(onCall.declaredOn).toEqual({ toolCallId: 'call_9' });
    expect(onCall.declaredOn).not.toBe(ON_CALL);
    const [onAnswer] = standingRowsFrom(BATCH, declaring(fact('call_1')), 'answer', 2);
    expect(onAnswer.declaredOn).toBe('answer');
  });

  it('iteration is the DECLARING iteration, whatever the result was produced on', () => {
    const [row] = standingRowsFrom(BATCH, declaring(fact('call_1')), 'answer', 7);
    expect(row.iteration).toBe(7);
  });

  it('a minimal row carries exactly the declared keys — nothing defaulted', () => {
    const [row] = standingRowsFrom(
      BATCH,
      declaring({ toolCallId: 'call_1', standing: 'noise' }),
      ON_CALL,
      2,
    );
    expect(Object.keys(row).sort()).toEqual([
      'assertions',
      'declaredOn',
      'iteration',
      'kind',
      'standing',
      'toolCallId',
      'toolName',
    ]);
    expect(row).toEqual({
      kind: 'standing',
      toolCallId: 'call_1',
      toolName: 'lookup_port',
      standing: 'noise',
      assertions: [],
      declaredOn: { toolCallId: 'call_9' },
      iteration: 2,
    });
  });

  it('a declaration without previous files no rows; every entry files one row, in order', () => {
    expect(standingRowsFrom(BATCH, { basis: 'direct' }, ON_CALL, 2)).toEqual([]);
    const rows = standingRowsFrom(
      BATCH,
      declaring(fact('call_1', state('fc1/7', 'up')), fact('call_1', state('fc1/7', 'down'))),
      ON_CALL,
      2,
    );
    expect(rows.map((r) => [r.toolCallId, r.assertions[0].value])).toEqual([
      ['call_1', 'up'],
      ['call_1', 'down'],
    ]);
  });

  it('never mutates the batch or the declaration', () => {
    const declaration = deepFreeze(
      declaring(fact('call_3', state('fc1/7', 'up')), { toolCallId: 'x', standing: 'open' }),
    );
    expect(() => standingRowsFrom(BATCH, declaration, ON_CALL, 2)).not.toThrow();
    expect(declaration.previous).toHaveLength(2);
  });
});

// ── Functional: basisRowFrom ─────────────────────────────────────────────

describe('basisRowFrom', () => {
  const tc = { id: 'call_9', name: 'lookup_port' };

  it('files the basis and the expect the model declared', () => {
    expect(basisRowFrom(tc, { basis: 'exploratory', expect: 'low' }, 4)).toEqual({
      kind: 'basis',
      toolCallId: 'call_9',
      toolName: 'lookup_port',
      iteration: 4,
      basis: 'exploratory',
      expect: 'low',
    });
  });

  it('leaves expect and malformed absent unless declared and non-zero', () => {
    const row = basisRowFrom(tc, { basis: 'direct', previous: [] }, 1, 0);
    expect(Object.keys(row).sort()).toEqual([
      'basis',
      'iteration',
      'kind',
      'toolCallId',
      'toolName',
    ]);
    expect(basisRowFrom(tc, { basis: 'direct' }, 1, 2).malformed).toBe(2);
  });

  it('refuses to file a basis the model did not declare (never infer)', () => {
    expect(() => basisRowFrom(tc, { expect: 'high' }, 1)).toThrow(/lookup_port/);
  });
});

// ── Integration: recordFindings on a fake scope ──────────────────────────

describe('recordFindings — the one writer', () => {
  it('is a no-op on an empty list: no key, no event', () => {
    const scope = fakeScope();
    recordFindings(scope, []);
    expect(Object.prototype.hasOwnProperty.call(scope, 'findingsLedger')).toBe(false);
    expect(scope.events).toEqual([]);
  });

  it('assigns a FRESH array every write and never mutates the committed one', () => {
    const scope = fakeScope();
    const first = [basisRowFrom({ id: 'call_1', name: 'lookup_port' }, { basis: 'direct' }, 1)];
    recordFindings(scope, first);
    const committed = scope.findingsLedger as FindingsLedger;
    expect(committed).toEqual(first);
    expect(committed).not.toBe(first);
    deepFreeze(committed);

    const second = standingRowsFrom(BATCH, declaring(fact('call_1')), { toolCallId: 'call_4' }, 2);
    recordFindings(scope, second);
    expect(scope.findingsLedger).not.toBe(committed);
    expect(committed).toHaveLength(1);
    expect(scope.findingsLedger).toEqual([...first, ...second]);
  });

  it('commits plain data — every row survives structuredClone', () => {
    const scope = fakeScope();
    recordFindings(scope, [
      ...standingRowsFrom(BATCH, declaring(fact('call_3', state('fc1/7', 'up'))), ON_CALL, 2),
      basisRowFrom({ id: 'call_9', name: 'lookup_port' }, { basis: 'direct' }, 2),
    ]);
    expect(() => structuredClone(scope.findingsLedger)).not.toThrow();
    expect(structuredClone(scope.findingsLedger)).toEqual(scope.findingsLedger);
  });

  it('emits one typed event per basis or standing row, in row order, with exact shapes', () => {
    const scope = fakeScope();
    recordFindings(scope, [
      ...standingRowsFrom(
        BATCH,
        declaring(
          fact('call_1', state('fc1/7', 'up')),
          { toolCallId: 'call_2', standing: 'open', settles: 'a second reading' },
          { toolCallId: 'call_404', standing: 'noise' },
        ),
        { toolCallId: 'call_9' },
        2,
      ),
      basisRowFrom(
        { id: 'call_9', name: 'lookup_port' },
        { basis: 'direct', expect: 'high' },
        2,
        1,
      ),
      ...standingRowsFrom(
        BATCH,
        declaring({ toolCallId: 'call_3', standing: 'ruled-out' }),
        'answer',
        3,
      ),
    ]);
    expect(scope.events).toEqual([
      {
        name: 'agentfootprint.findings.standing',
        payload: {
          toolCallId: 'call_1',
          toolName: 'lookup_port',
          iteration: 2,
          standing: 'fact',
          declaredOn: 'tool-call',
          assertionCount: 1,
        },
      },
      {
        name: 'agentfootprint.findings.standing',
        payload: {
          toolCallId: 'call_2',
          toolName: 'lookup_port',
          iteration: 2,
          standing: 'open',
          declaredOn: 'tool-call',
          assertionCount: 0,
        },
      },
      {
        name: 'agentfootprint.findings.standing',
        payload: {
          toolCallId: 'call_404',
          iteration: 2,
          standing: 'noise',
          declaredOn: 'tool-call',
          assertionCount: 0,
          unknownId: true,
        },
      },
      {
        name: 'agentfootprint.findings.declared',
        payload: {
          toolName: 'lookup_port',
          toolCallId: 'call_9',
          iteration: 2,
          basis: 'direct',
          expect: 'high',
          malformed: 1,
        },
      },
      {
        name: 'agentfootprint.findings.standing',
        payload: {
          toolCallId: 'call_3',
          toolName: 'fetch_log',
          iteration: 3,
          standing: 'ruled-out',
          declaredOn: 'answer',
          assertionCount: 0,
        },
      },
    ]);
  });

  it('never puts an assertion value, settles, line or a ref on the event stream', () => {
    const scope = fakeScope();
    recordFindings(
      scope,
      standingRowsFrom(
        BATCH,
        declaring(
          fact('call_3', state('fc1/7', 'SECRET-VALUE')),
          { toolCallId: 'call_1', standing: 'open', settles: 'SECRET-SETTLES' },
          { toolCallId: 'call_2', standing: 'ruled-out', line: 'SECRET-LINE' },
        ),
        'answer',
        2,
      ),
    );
    for (const { payload } of scope.events) {
      expect(payload).not.toHaveProperty('assertions');
      expect(payload).not.toHaveProperty('settles');
      expect(payload).not.toHaveProperty('line');
      expect(payload).not.toHaveProperty('ref');
      expect(JSON.stringify(payload)).not.toMatch(/SECRET|art_9f3c/);
      expect(() => structuredClone(payload)).not.toThrow();
    }
  });
});

describe('recordFindings — conflict rows', () => {
  it('writes ONE conflict row, identities only, at the write whose readings first disagreed', () => {
    const scope = fakeScope();
    recordFindings(
      scope,
      standingRowsFrom(
        BATCH,
        declaring(fact('call_1', state('fc1/7', 'up'))),
        { toolCallId: 'call_4' },
        2,
      ),
    );
    expect(conflictRows(scope.findingsLedger)).toEqual([]);
    expect(scope.events[0].payload).not.toHaveProperty('conflictKeys');

    recordFindings(
      scope,
      standingRowsFrom(BATCH, declaring(fact('call_2', state('fc1/7', 'down'))), 'answer', 3),
    );
    expect(conflictRows(scope.findingsLedger)).toEqual([
      {
        kind: 'conflict',
        key: STATE_KEY,
        witnesses: [witness('call_1'), witness('call_2')],
        iteration: 3,
      },
    ]);
    const [row] = conflictRows(scope.findingsLedger);
    for (const w of row.witnesses) expect(w).not.toHaveProperty('value');
    expect(JSON.stringify(row)).not.toMatch(/"up"|"down"/);
    // the row sits after the standing that created it — append only
    expect((scope.findingsLedger as FindingsLedger).map((r) => r.kind)).toEqual([
      'standing',
      'standing',
      'conflict',
    ]);
    // only the standing event of THIS write names the key
    expect((scope.events[1].payload as { conflictKeys?: string[] }).conflictKeys).toEqual([
      STATE_KEY,
    ]);
  });

  it('files a conflict row only for a NEW key: a third disagreeing reading adds none', () => {
    const scope = fakeScope();
    recordFindings(
      scope,
      standingRowsFrom(
        BATCH,
        declaring(fact('call_1', state('fc1/7', 'up')), fact('call_2', state('fc1/7', 'down'))),
        ON_CALL,
        2,
      ),
    );
    expect(conflictRows(scope.findingsLedger)).toHaveLength(1);
    // both witnesses landed in one write, so both standing events name the key
    expect(
      scope.events.map((e) => (e.payload as { conflictKeys?: string[] }).conflictKeys),
    ).toEqual([[STATE_KEY], [STATE_KEY]]);

    recordFindings(
      scope,
      standingRowsFrom(BATCH, declaring(fact('call_3', state('fc1/7', 'flapping'))), 'answer', 3),
    );
    expect(conflictRows(scope.findingsLedger)).toHaveLength(1);
    expect(scope.events[2].payload).not.toHaveProperty('conflictKeys');
    // the FOLD still sees the live conflict, now with three readings
    const fold = foldLedger(scope.findingsLedger as FindingsLedger);
    expect(fold.conflicts.map((c) => [c.key, c.assertions.length])).toEqual([[STATE_KEY, 3]]);
  });

  it('two disagreeing standings for ONE result are two rows and NOT a conflict', () => {
    const scope = fakeScope();
    recordFindings(
      scope,
      standingRowsFrom(BATCH, declaring(fact('call_1', state('fc1/7', 'up'))), ON_CALL, 2),
    );
    recordFindings(
      scope,
      standingRowsFrom(BATCH, declaring(fact('call_1', state('fc1/7', 'down'))), 'answer', 3),
    );
    expect(standingRows(scope.findingsLedger)).toHaveLength(2);
    expect(conflictRows(scope.findingsLedger)).toEqual([]);
    const fold = foldLedger(scope.findingsLedger as FindingsLedger);
    expect(fold.conflicts).toEqual([]);
    expect(fold.standingOf.get('call_1')?.assertions[0].value).toBe('down');
    expect(scope.events.every((e) => !('conflictKeys' in (e.payload as object)))).toBe(true);
  });

  it('a quoted reading never contradicts: open and ruled-out file no conflict against a fact', () => {
    const scope = fakeScope();
    recordFindings(
      scope,
      standingRowsFrom(
        BATCH,
        declaring(
          fact('call_1', state('fc1/7', 'up')),
          { toolCallId: 'call_2', standing: 'open', assertions: [state('fc1/7', 'down')] },
          { toolCallId: 'call_3', standing: 'ruled-out', assertions: [state('fc1/7', 'flapping')] },
        ),
        ON_CALL,
        2,
      ),
    );
    expect(conflictRows(scope.findingsLedger)).toEqual([]);
  });

  it('a later ruled-out retires the witness in the fold; the conflict row stays as history', () => {
    const scope = fakeScope();
    recordFindings(
      scope,
      standingRowsFrom(
        BATCH,
        declaring(fact('call_1', state('fc1/7', 'up')), fact('call_2', state('fc1/7', 'down'))),
        ON_CALL,
        2,
      ),
    );
    recordFindings(
      scope,
      standingRowsFrom(
        BATCH,
        declaring({ toolCallId: 'call_2', standing: 'ruled-out', line: 'stale' }),
        'answer',
        3,
      ),
    );
    expect(conflictRows(scope.findingsLedger)).toHaveLength(1);
    expect(foldLedger(scope.findingsLedger as FindingsLedger).conflicts).toEqual([]);
    // and a fresh disagreement on the same key later is NOT a second row
    recordFindings(
      scope,
      standingRowsFrom(BATCH, declaring(fact('call_3', state('fc1/7', 'down'))), 'answer', 4),
    );
    expect(conflictRows(scope.findingsLedger)).toHaveLength(1);
    expect(foldLedger(scope.findingsLedger as FindingsLedger).conflicts.map((c) => c.key)).toEqual([
      STATE_KEY,
    ]);
  });

  it('a conflict row is never written for a basis-only write', () => {
    const scope = fakeScope();
    recordFindings(scope, [basisRowFrom({ id: 'c', name: 't' }, { basis: 'direct' }, 1)]);
    expect((scope.findingsLedger as FindingsLedger).map((r) => r.kind)).toEqual(['basis']);
  });
});

// ── From the wire: the README example end to end ─────────────────────────

describe('from a tool call carrying _findings', () => {
  it('peel → standing rows on the previous batch → basis row, malformed entries dropped and counted', () => {
    const scope = fakeScope();
    const tc = {
      id: 'call_4',
      name: 'lookup_port',
      args: {
        port: 'fc1/7',
        _findings: {
          basis: 'direct',
          previous: [
            fact('call_1', state('fc1/7', 'up')),
            { toolCallId: 'call_2', standing: 'settled' }, // not a standing — dropped, counted
            { toolCallId: 'call_3', standing: 'noise', sought: 'no' }, // bad field — dropped, counted
          ],
        },
      },
    };
    const { args, findings, malformed } = splitFindings(tc.args);
    expect(args).toEqual({ port: 'fc1/7' });
    expect(malformed).toBe(2);

    recordFindings(
      scope,
      standingRowsFrom(BATCH, findings as FindingsDeclaration, { toolCallId: tc.id }, 2),
    );
    recordFindings(scope, [basisRowFrom(tc, findings as FindingsDeclaration, 2, malformed)]);

    const ledger = scope.findingsLedger as FindingsLedger;
    expect(ledger.map((r) => r.kind)).toEqual(['standing', 'standing', 'basis']);
    expect(standingRows(ledger).map((r) => [r.toolCallId, r.standing])).toEqual([
      ['call_1', 'fact'],
      ['call_3', 'noise'],
    ]);
    expect(foldLedger(ledger).standingOf.get('call_2')).toBeUndefined(); // undeclared, never 'open'
    expect(scope.events.map((e) => e.name)).toEqual([
      'agentfootprint.findings.standing',
      'agentfootprint.findings.standing',
      'agentfootprint.findings.declared',
    ]);
    expect((scope.events[2].payload as { malformed?: number }).malformed).toBe(2);
  });
});

// ── Scenario: a real TypedScope ──────────────────────────────────────────

describe('on a real TypedScope', () => {
  it('reads the live proxy, commits a plain fresh array per stage, and emits through the scope', async () => {
    interface State {
      findingsLedger?: FindingsLedger;
    }
    const events: Emitted[] = [];
    const chart = flowChart<State>(
      'first',
      (scope) => {
        recordFindings(
          scope,
          standingRowsFrom(
            BATCH,
            declaring(fact('call_1', state('fc1/7', 'up'))),
            { toolCallId: 'call_4' },
            2,
          ),
        );
        recordFindings(scope, [
          basisRowFrom(
            { id: 'call_4', name: 'lookup_port' },
            { basis: 'direct', expect: 'high' },
            2,
          ),
        ]);
      },
      'first',
    )
      .addFunction(
        'second',
        (scope) => {
          // the read of `scope.findingsLedger` here is the live proxy view
          recordFindings(
            scope,
            standingRowsFrom(BATCH, declaring(fact('call_2', state('fc1/7', 'down'))), 'answer', 3),
          );
        },
        'second',
      )
      .build();

    const result = await chart
      .recorder({
        id: 'capture',
        onEmit: (e: { name: string; payload?: unknown }) =>
          events.push({ name: e.name, payload: e.payload }),
      })
      .run();

    const ledger = result.state.findingsLedger as FindingsLedger;
    expect(ledger.map((r) => r.kind)).toEqual(['standing', 'basis', 'standing', 'conflict']);
    expect(() => structuredClone(ledger)).not.toThrow();
    expect(conflictRows(ledger)).toEqual([
      {
        kind: 'conflict',
        key: STATE_KEY,
        witnesses: [witness('call_1'), witness('call_2')],
        iteration: 3,
      },
    ]);
    expect(foldLedger(ledger).standingOf.get('call_2')?.assertions[0].provenance).toBe(
      'tool:call_2',
    );
    expect(events.map((e) => e.name)).toEqual([
      'agentfootprint.findings.standing',
      'agentfootprint.findings.declared',
      'agentfootprint.findings.standing',
    ]);
    expect((events[2].payload as { conflictKeys?: string[] }).conflictKeys).toEqual([STATE_KEY]);
    for (const { payload } of events) expect(() => structuredClone(payload)).not.toThrow();
  });
});
