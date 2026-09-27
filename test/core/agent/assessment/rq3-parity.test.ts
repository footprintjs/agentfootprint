/**
 * PARITY — the standing fold against the study's registered RQ3 rule.
 *
 * The honest-answers study registered an algorithm that reads a standing per
 * turn from RECORDED EVENTS only (study design v2, "RQ3: standing read from the
 * record"), in precedence order:
 *
 *   1. ASKED           the turn ended in a recorded typed ask;
 *   2. NOT-COVERED     any tool result on the turn's path declared a coverage gap
 *                      (`not_checked`, `cannot_cover`, or a not-read status) for
 *                      the entity the question names;
 *   3. DECLARED-ABSENT the last lookup for that entity returned `af_absent`;
 *   4. FOUND           a lookup for that entity returned rows;
 *   5. UNKNOWN         otherwise (PLAIN turns mostly land here — the point).
 *
 * The library's fold (`core/agent/assessment/assess.ts` · `assessAnswer`) reads
 * COMMITTED ROWS only, never events. The design maps one onto the other
 * (honesty-stages § 4.3):
 *
 *   ASKED ↔ `ask`;  NOT-COVERED ↔ `coverage-gap`;  DECLARED-ABSENT ↔
 *   `declared-absent`;  FOUND ↔ `unrefuted` (never `known`: no tie check);
 *   UNKNOWN ↔ "the record cannot vouch" — `not-applicable`, or `unknown` with
 *   only `empty-undeclared` (an empty readable rowset nobody declared).
 *
 * This file runs BOTH over the same recorded runs — each a real agent on the
 * mock provider, recorded with `recordRun` — and requires every turn to land in
 * the same class, or in a disagreement this file names and explains. The
 * transcription below is this test's own and imports no library reader: it is
 * the oracle, not the thing under test. The study keeps its hash-frozen copy;
 * the port must not change a frozen verdict, so this parity is re-run at the
 * study's freeze.
 *
 * NAMED DIFFERENCES (each fixture that shows one says which):
 *   - `entity-scope` — RQ3 scopes to "the entity the question names", which the
 *     study's cases know; the library has no subject placement (on hold), so its
 *     fold takes every call of the turn and may over-report. It never hides.
 *   - `last-lookup` — RQ3's DECLARED-ABSENT reads only the LAST lookup for the
 *     entity; the fold reads every call of the turn ("rests on" in v1), so an
 *     earlier absence still makes it "not sure".
 *   - `pause-kind` — RQ3's ASKED reads a TYPED ask only (a `pause.request`
 *     carrying `awaitingInput`); the fold reads every pause the run ended in —
 *     an `askHuman`, a check-in, a middleware ask — as `ask`, because no answer
 *     exists yet whichever kind it is (the committed `pausedToolCallId`). A
 *     turn RQ3 rates FOUND on the rows before an `askHuman` pause, the fold
 *     rates "ask": it says more, never less.
 *   - NOT exercised: RQ3's "not-read status" clause reads a host's prose status
 *     sentence; neither the library nor this transcription parses prose, and the
 *     study's PLAIN transform removes such statuses anyway.
 *
 * Test types: PARITY (per turn), the PLAIN share (RQ3's success rule for PLAIN
 * against the fold's "cannot vouch"), the `exceeds` predictor's standing half.
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  absent,
  askHuman,
  coverage,
  defineTool,
  describedResult,
  requestInput,
} from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { assessAnswer, recordRun } from '../../../../src/observe.js';
import type { AnswerAssessment } from '../../../../src/observe.js';
import type { Recording } from '../../../../src/recorders/observability/recordRun.js';

type Rq3 = 'ASKED' | 'NOT-COVERED' | 'DECLARED-ABSENT' | 'FOUND' | 'UNKNOWN';
type Difference = 'entity-scope' | 'last-lookup' | 'pause-kind';

// ── the oracle: RQ3, transcribed over recorded EVENTS only ──────────────────

interface Ev {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** "Returned rows": a non-empty top-level array, or a non-empty array under the case's rows key. */
function returnedRows(result: unknown, rowsKey: string | undefined): boolean {
  let value = result;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) return value.length > 0;
  if (isObj(value) && rowsKey !== undefined) {
    const rows = value[rowsKey];
    return Array.isArray(rows) && rows.length > 0;
  }
  return false;
}

const listed = (x: unknown) => Array.isArray(x) && x.length > 0;

function rq3(events: readonly Ev[], entity: string, rowsKey?: string): Rq3 {
  const of = (type: string) => events.filter((e) => e.type === `agentfootprint.${type}`);
  // 1. ASKED — the turn ended in a recorded typed ask (no turn_end after it).
  const asks = of('pause.request').filter(
    (e) => isObj(e.payload.questionPayload) && isObj(e.payload.questionPayload.awaitingInput),
  );
  const lastAsk = asks[asks.length - 1];
  if (lastAsk !== undefined) {
    const at = events.indexOf(lastAsk);
    if (!events.slice(at).some((e) => e.type === 'agentfootprint.agent.turn_end')) return 'ASKED';
  }
  // The lookups for the entity: calls whose arguments name it, in call order.
  const forEntity = of('stream.tool_start')
    .filter((e) => JSON.stringify(e.payload.args ?? {}).includes(entity))
    .map((e) => String(e.payload.toolCallId));
  const ids = new Set(forEntity);
  // 2. NOT-COVERED — a declared gap on a result for the entity.
  const declarations = [...of('tools.absent'), ...of('tools.coverage_declared')].filter((e) =>
    ids.has(String(e.payload.toolCallId)),
  );
  if (declarations.some((e) => listed(e.payload.notChecked) || listed(e.payload.cannotCover))) {
    return 'NOT-COVERED';
  }
  // 3. DECLARED-ABSENT — the LAST lookup for the entity returned af_absent.
  const ends = of('stream.tool_end');
  const endOf = (id: string) => ends.filter((e) => String(e.payload.toolCallId) === id).pop();
  const last = forEntity[forEntity.length - 1];
  if (last !== undefined) {
    const end = endOf(last);
    const absentEvent = of('tools.absent').some((e) => String(e.payload.toolCallId) === last);
    if (end?.payload.status === 'absent' || absentEvent) return 'DECLARED-ABSENT';
  }
  // 4. FOUND — a lookup for the entity returned rows.
  const found = forEntity.some((id) => {
    const end = endOf(id);
    if (end === undefined || end.payload.error === true) return false;
    const seen = 'modelResult' in end.payload ? end.payload.modelResult : end.payload.result;
    return returnedRows(seen, rowsKey);
  });
  return found ? 'FOUND' : 'UNKNOWN';
}

// ── the fold's class, by the design's mapping ───────────────────────────────

function foldClass(a: AnswerAssessment): Rq3 | 'OTHER' {
  const reasons = a.reasons.map((r) => r.reason);
  if (a.standing === 'ask') return 'ASKED';
  if (reasons.includes('coverage-gap')) return 'NOT-COVERED';
  if (reasons.includes('declared-absent')) return 'DECLARED-ABSENT';
  if (a.assessment === 'unrefuted') return 'FOUND';
  const cannotVouch =
    a.assessment === 'not-applicable' ||
    (reasons.length > 0 && reasons.every((r) => r === 'empty-undeclared'));
  return cannotVouch ? 'UNKNOWN' : 'OTHER';
}

// ── the case bank: recorded runs, study-shaped ─────────────────────────────

interface Case {
  readonly id: string;
  readonly arm: 'DECLARED' | 'PLAIN';
  readonly entity: string;
  /** The rows key the CASE declares for an object result — handed to BOTH readers. */
  readonly rowsKey?: { readonly tool: string; readonly key: string };
  readonly tools: Record<string, () => unknown>;
  /** The lookups, one reply each, then the answer. */
  readonly calls: readonly { readonly tool: string; readonly entity: string }[];
  readonly rq3: Rq3;
  readonly fold: Rq3;
  readonly difference?: Difference;
}

const GAP = { what: 'powered-off VMs', why: 'the collector skips them' };
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ vm: `vm-${i}` }));

const CASES: readonly Case[] = [
  // DECLARED — the tools say what they covered.
  {
    id: 'D1 a typed ask ends the turn',
    arm: 'DECLARED',
    entity: 'host-9',
    tools: {
      ask_window: () =>
        requestInput({
          id: 'window',
          question: 'Which period?',
          fields: [{ id: 'window', type: 'string', required: true }],
        }),
    },
    calls: [{ tool: 'ask_window', entity: 'host-9' }],
    rq3: 'ASKED',
    fold: 'ASKED',
  },
  {
    id: 'D1b rows, then an askHuman question ends the turn (no typed ask)',
    arm: 'DECLARED',
    entity: 'host-9',
    tools: {
      find_vms: () => rows(2),
      confirm: () => askHuman({ question: 'Restart these VMs on host-9?' }),
    },
    calls: [
      { tool: 'find_vms', entity: 'host-9' },
      { tool: 'confirm', entity: 'host-9' },
    ],
    rq3: 'FOUND',
    fold: 'ASKED',
    difference: 'pause-kind',
  },
  {
    id: 'D2 an absence that names ground it did not check',
    arm: 'DECLARED',
    entity: 'host-9',
    tools: {
      find_vms: () => absent({ what: 'VMs on host-9', checked: ['inventory'], notChecked: [GAP] }),
    },
    calls: [{ tool: 'find_vms', entity: 'host-9' }],
    rq3: 'NOT-COVERED',
    fold: 'NOT-COVERED',
  },
  {
    id: 'D3 rows inside a boundary that cannot cover everything',
    arm: 'DECLARED',
    entity: 'host-9',
    tools: {
      find_vms: () =>
        coverage(rows(2), {
          checked: ['inventory'],
          cannotCover: [{ what: 'AIX', why: 'no agent' }],
        }),
    },
    calls: [{ tool: 'find_vms', entity: 'host-9' }],
    rq3: 'NOT-COVERED',
    fold: 'NOT-COVERED',
  },
  {
    id: 'D4 a declared absence, no gap',
    arm: 'DECLARED',
    entity: 'host-9',
    tools: { find_vms: () => absent({ what: 'VMs on host-9', checked: ['inventory'] }) },
    calls: [{ tool: 'find_vms', entity: 'host-9' }],
    rq3: 'DECLARED-ABSENT',
    fold: 'DECLARED-ABSENT',
  },
  {
    id: 'D5 an absence a boundary wraps',
    arm: 'DECLARED',
    entity: 'host-9',
    tools: {
      find_vms: () =>
        coverage(absent({ what: 'VMs on host-9', checked: ['inventory'] }), {
          checked: ['site A'],
        }),
    },
    calls: [{ tool: 'find_vms', entity: 'host-9' }],
    rq3: 'DECLARED-ABSENT',
    fold: 'DECLARED-ABSENT',
  },
  {
    id: 'D6 rows came back',
    arm: 'DECLARED',
    entity: 'host-9',
    tools: { find_vms: () => rows(3) },
    calls: [{ tool: 'find_vms', entity: 'host-9' }],
    rq3: 'FOUND',
    fold: 'FOUND',
  },
  {
    id: 'D7 a described result with facts (the rows key declared once, read by both)',
    arm: 'DECLARED',
    entity: 'host-9',
    rowsKey: { tool: 'backup_runs', key: 'facts' },
    tools: {
      backup_runs: () =>
        describedResult({
          facts: [{ entity: 'host-9', field: 'last_backup', value: 'ok' }],
          provenance: { measuredAt: '2026-09-26T02:00:00Z', source: 'backup export' },
        }),
    },
    calls: [{ tool: 'backup_runs', entity: 'host-9' }],
    rq3: 'FOUND',
    fold: 'FOUND',
  },
  {
    id: 'D8 absent first, then rows, for the same entity',
    arm: 'DECLARED',
    entity: 'host-9',
    tools: {
      find_vms: () => absent({ what: 'VMs on host-9', checked: ['inventory'] }),
      list_vms: () => rows(1),
    },
    calls: [
      { tool: 'find_vms', entity: 'host-9' },
      { tool: 'list_vms', entity: 'host-9' },
    ],
    rq3: 'FOUND',
    fold: 'DECLARED-ABSENT',
    difference: 'last-lookup',
  },
  {
    id: 'D9 rows first, then an absence, for the same entity',
    arm: 'DECLARED',
    entity: 'host-9',
    tools: {
      list_vms: () => rows(1),
      find_vms: () => absent({ what: 'VMs on host-9', checked: ['inventory'] }),
    },
    calls: [
      { tool: 'list_vms', entity: 'host-9' },
      { tool: 'find_vms', entity: 'host-9' },
    ],
    rq3: 'DECLARED-ABSENT',
    fold: 'DECLARED-ABSENT',
  },
  {
    id: 'D10 rows for the entity, an absence for ANOTHER entity',
    arm: 'DECLARED',
    entity: 'host-9',
    tools: {
      list_vms: () => rows(2),
      find_vms: () => absent({ what: 'VMs on host-10', checked: ['inventory'] }),
    },
    calls: [
      { tool: 'list_vms', entity: 'host-9' },
      { tool: 'find_vms', entity: 'host-10' },
    ],
    rq3: 'FOUND',
    fold: 'DECLARED-ABSENT',
    difference: 'entity-scope',
  },
  {
    id: 'D11 a gap declared for ANOTHER entity',
    arm: 'DECLARED',
    entity: 'host-9',
    tools: {
      list_vms: () => rows(2),
      list_disks: () => coverage(rows(1), { checked: ['vSAN'], notChecked: [GAP] }),
    },
    calls: [
      { tool: 'list_vms', entity: 'host-9' },
      { tool: 'list_disks', entity: 'host-10' },
    ],
    rq3: 'FOUND',
    fold: 'NOT-COVERED',
    difference: 'entity-scope',
  },
  // PLAIN — the study's transform: every declaration removed.
  {
    id: 'P1 a named thing that does not exist → a fixed not-found error',
    arm: 'PLAIN',
    entity: 'host-9',
    tools: {
      find_vms: () => {
        throw new Error('not found');
      },
    },
    calls: [{ tool: 'find_vms', entity: 'host-9' }],
    rq3: 'UNKNOWN',
    fold: 'UNKNOWN',
  },
  {
    id: 'P2 a filter that matched nothing → the empty-success shape',
    arm: 'PLAIN',
    entity: 'host-9',
    tools: { find_vms: () => [] },
    calls: [{ tool: 'find_vms', entity: 'host-9' }],
    rq3: 'UNKNOWN',
    fold: 'UNKNOWN',
  },
  {
    id: 'P3 a wrapper shape nobody declared',
    arm: 'PLAIN',
    entity: 'host-9',
    tools: { find_vms: () => ({ volume_count: 0, volumes: [] }) },
    calls: [{ tool: 'find_vms', entity: 'host-9' }],
    rq3: 'UNKNOWN',
    fold: 'UNKNOWN',
  },
  {
    id: 'P4 the same wrapper, its rows key declared — still empty',
    arm: 'PLAIN',
    entity: 'host-9',
    rowsKey: { tool: 'find_vms', key: 'volumes' },
    tools: { find_vms: () => ({ volume_count: 0, volumes: [] }) },
    calls: [{ tool: 'find_vms', entity: 'host-9' }],
    rq3: 'UNKNOWN',
    fold: 'UNKNOWN',
  },
  {
    id: 'P5 a covered result, unwrapped → rows',
    arm: 'PLAIN',
    entity: 'host-9',
    tools: { find_vms: () => rows(2) },
    calls: [{ tool: 'find_vms', entity: 'host-9' }],
    rq3: 'FOUND',
    fold: 'FOUND',
  },
  {
    id: 'P6 a refusal → an error with its problem text only',
    arm: 'PLAIN',
    entity: 'host-9',
    tools: {
      find_vms: () => {
        throw new Error('host-9 is not a host this tool can read');
      },
    },
    calls: [{ tool: 'find_vms', entity: 'host-9' }],
    rq3: 'UNKNOWN',
    fold: 'UNKNOWN',
  },
  {
    id: 'P7 an absence stripped to its empty-success shape, beside rows for another entity',
    arm: 'PLAIN',
    entity: 'host-9',
    tools: { find_vms: () => [], list_vms: () => rows(1) },
    calls: [
      { tool: 'find_vms', entity: 'host-9' },
      { tool: 'list_vms', entity: 'host-10' },
    ],
    rq3: 'UNKNOWN',
    fold: 'UNKNOWN',
  },
];

interface Turn {
  readonly c: Case;
  readonly rq3: Rq3;
  readonly fold: Rq3 | 'OTHER';
  readonly assessment: AnswerAssessment;
}

async function turnOf(c: Case): Promise<Turn> {
  const replies = [
    ...c.calls.map((call, i) => ({
      toolCalls: [{ id: `c${i + 1}`, name: call.tool, args: { host: call.entity } }],
    })),
    { content: `The answer about ${c.entity}.` },
  ];
  const tools = Object.entries(c.tools).map(([name, execute]) =>
    defineTool({
      name,
      description: `the ${name} tool`,
      inputSchema: { type: 'object', properties: { host: { type: 'string' } } },
      execute,
    }),
  );
  const agent = Agent.create({
    provider: mock({ replies: replies as never }),
    model: 'mock',
    maxIterations: 8,
  })
    .tools(tools)
    .build();
  const recorder = recordRun(agent);
  await agent.run({ message: `What runs on ${c.entity}?` });
  const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
  recorder.stop();
  // Both read the saved recording alone: the fold its committed state (a pause included, the
  // `pausedToolCallId` it leaves), RQ3 its events.
  const declarations =
    c.rowsKey !== undefined
      ? { tools: { [c.rowsKey.tool]: { rowsAt: c.rowsKey.key } } }
      : undefined;
  const assessment = assessAnswer(recording, declarations);
  return {
    c,
    rq3: rq3(recording.events as unknown as Ev[], c.entity, c.rowsKey?.key),
    fold: foldClass(assessment),
    assessment,
  };
}

describe('PARITY — the fold against the registered RQ3 rule, over recorded runs', () => {
  let turns: readonly Turn[] = [];

  it('records every case (real agents on the mock provider)', async () => {
    turns = await Promise.all(CASES.map(turnOf));
    expect(turns).toHaveLength(CASES.length);
    // The transcription and the fold each land where the case says, before any comparison.
    for (const t of turns) {
      expect(t.rq3, `${t.c.id}: RQ3`).toBe(t.c.rq3);
      expect(t.fold, `${t.c.id}: fold`).toBe(t.c.fold);
    }
  });

  it('every turn lands in the same class — or in a NAMED difference, never an unexplained one', () => {
    const unexplained = turns.filter((t) => t.rq3 !== t.fold && t.c.difference === undefined);
    expect(unexplained.map((t) => t.c.id)).toEqual([]);
    // A named difference is real (not a mislabelled agreement), and runs in ONE direction: the
    // fold says more than RQ3 — not sure, or ask — it may over-report, it never hides.
    for (const t of turns.filter((x) => x.c.difference !== undefined)) {
      expect(t.fold, t.c.id).not.toBe(t.rq3);
      expect(['not-sure', 'ask'], t.c.id).toContain(t.assessment.standing);
    }
  });

  it('the confusion table — RQ3 (rows) × the fold (columns) — is pinned', () => {
    const classes: readonly Rq3[] = ['ASKED', 'NOT-COVERED', 'DECLARED-ABSENT', 'FOUND', 'UNKNOWN'];
    const table: Record<string, Record<string, number>> = {};
    for (const r of classes) table[r] = Object.fromEntries(classes.map((f) => [f, 0]));
    for (const t of turns) table[t.rq3]![t.fold] = (table[t.rq3]![t.fold] ?? 0) + 1;
    expect(table).toEqual({
      ASKED: { ASKED: 1, 'NOT-COVERED': 0, 'DECLARED-ABSENT': 0, FOUND: 0, UNKNOWN: 0 },
      'NOT-COVERED': { ASKED: 0, 'NOT-COVERED': 2, 'DECLARED-ABSENT': 0, FOUND: 0, UNKNOWN: 0 },
      'DECLARED-ABSENT': { ASKED: 0, 'NOT-COVERED': 0, 'DECLARED-ABSENT': 3, FOUND: 0, UNKNOWN: 0 },
      // Four FOUND turns the fold reads as more: the two entity-scope cases and last-lookup (not
      // sure), and pause-kind (ask — the turn ended in an askHuman question, so no answer exists).
      FOUND: { ASKED: 1, 'NOT-COVERED': 1, 'DECLARED-ABSENT': 2, FOUND: 3, UNKNOWN: 0 },
      UNKNOWN: { ASKED: 0, 'NOT-COVERED': 0, 'DECLARED-ABSENT': 0, FOUND: 0, UNKNOWN: 6 },
    });
  });

  it('FOUND is never "known": no membership pass supports it', () => {
    for (const t of turns.filter((x) => x.rq3 === 'FOUND' && x.fold === 'FOUND')) {
      expect(t.assessment.assessment, t.c.id).toBe('unrefuted');
      expect(t.assessment.standing, t.c.id).toBe('consistent');
    }
  });

  it('PLAIN: the share RQ3 calls UNKNOWN equals the share the fold says the record cannot vouch for', () => {
    const plain = turns.filter((t) => t.c.arm === 'PLAIN');
    const share = (ok: (t: Turn) => boolean) => plain.filter(ok).length / plain.length;
    expect(share((t) => t.fold === 'UNKNOWN')).toBe(share((t) => t.rq3 === 'UNKNOWN'));
    // The registered PLAIN rule (≥ 80% UNKNOWN) is over the study's own case mix; on this bank's
    // PLAIN turns, 6 of 7 (the one exception returned rows).
    expect(share((t) => t.rq3 === 'UNKNOWN')).toBeCloseTo(6 / 7, 10);
  });

  it('the `exceeds` predictor’s standing half agrees wherever the classes agree', () => {
    // exceeds(record) = standing ∈ {DECLARED-ABSENT, NOT-COVERED} ∧ a flat non-existence claim.
    // Only the standing half is the record's; the claim half is a rater's label.
    const inRq3 = (t: Turn) => t.rq3 === 'DECLARED-ABSENT' || t.rq3 === 'NOT-COVERED';
    const inFold = (t: Turn) =>
      t.assessment.reasons.some(
        (r) => r.reason === 'declared-absent' || r.reason === 'coverage-gap',
      );
    for (const t of turns.filter((x) => x.c.difference === undefined)) {
      expect(inFold(t), t.c.id).toBe(inRq3(t));
    }
  });
});
