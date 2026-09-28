/**
 * The answer layer (honesty layer 4, `.answerLayer()`) — the standing folded
 * INSIDE the run, at the head of the final branch, and served as data.
 *
 * Test types (Convention 3):
 *   - UNIT        — the witness rows' builders and their checkpoint door; the
 *                   read list (`answerFoldReads`); the run constant
 *                   (`honestyLayersOf`); the projection (`assessmentDataOf`
 *                   carries no witness, no digest); the fold reading the two
 *                   witness rows (a clean gate pass is a check that RAN and
 *                   supports nothing; unfinished steps are a reason; an earlier
 *                   turn's witness counts for nothing); the standing line, one
 *                   standing at a time;
 *   - SCENARIO    — real agents on the mock provider: the event and
 *                   `turn_end.answerAssessment` carry the same projection; the
 *                   run constant; the gate's clean pass filed as a `grounded`
 *                   row (after a revision too) and folded as "consistent"; a
 *                   stepped skill's accepted / cut-short verdicts filed as
 *                   `steps-unfinished` rows and folded as "not sure"; a passed
 *                   enforce `.answerValidation()` folds "known"; a typed answer
 *                   still parses; both chart shapes; a stepped skill beside the
 *                   evidence gate files ONE witness, for the answer that stands
 *                   (a draft the gate sends back files none — both deciders);
 *   - BOUNDARY    — the build refusals (the line beside `.answerValidation()`
 *                   and beside `.outputSchema()`, a second call, bad options),
 *                   through the builder and the options door alike; the
 *                   checkpoint door accepts well-formed witness rows and a
 *                   carried turn, and refuses malformed ones; a continued
 *                   conversation's carried witness rows do not count for the
 *                   next turn, and the turn stamp never repeats — under a
 *                   window strategy, from a checkpoint without the carrier, and
 *                   across `resumeOnError`;
 *   - SECURITY    — the event and the `turn_end` field carry names, enums and
 *                   counts only: no value from the answer, no tool result, no
 *                   witness pointer; the line prints an assumed value only in
 *                   the tool's own view.
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  defineTool,
  slidingWindow,
  type AgentRunCheckpoint,
  type Tool,
} from '../../../../src/index.js';
import { SHOWN_ARGS } from '../../../../src/core/toolShownArgs.js';
import { mock } from '../../../../src/llm-providers.js';
import { assessAnswer, recordRun } from '../../../../src/observe.js';
import { defineSkill } from '../../../../src/injection-engine.js';
import type { Recording } from '../../../../src/recorders/observability/recordRun.js';
import {
  groundedRowFrom,
  stepsUnfinishedRowFrom,
  witnessRowIsWellFormed,
} from '../../../../src/core/agent/assessment/witness.js';
import {
  assessmentDataOf,
  standingLineOf,
  STANDING_LINE_OPENINGS,
  type AnswerAssessmentData,
} from '../../../../src/core/agent/assessment/compose.js';
import { answerFoldReads } from '../../../../src/core/agent/honesty/mounts.js';
import { honestyLayersOf } from '../../../../src/core/agent/honesty/armed.js';
import { validateCheckpoint } from '../../../../src/core/runCheckpoint.js';
import { TOOL_RESULTS } from '../fixtures/sanEvidence.js';

// ─── the harness ─────────────────────────────────────────────────────

const lookup = (name: string, execute: () => unknown) =>
  defineTool({
    name,
    description: `the ${name} tool`,
    inputSchema: { type: 'object', properties: { host: { type: 'string' } } },
    execute,
  });

const callThen = (name: string, answer: string) =>
  mock({ replies: [{ toolCalls: [{ id: 'c1', name, args: {} }] }, { content: answer }] });

interface Captured {
  readonly assessed: Record<string, unknown>[];
  readonly turnEnds: Record<string, unknown>[];
}

function capture(agent: Agent): Captured {
  const assessed: Record<string, unknown>[] = [];
  const turnEnds: Record<string, unknown>[] = [];
  agent.on('agentfootprint.answer.assessed', (e) => {
    assessed.push(e.payload as unknown as Record<string, unknown>);
  });
  agent.on('agentfootprint.agent.turn_end', (e) => {
    turnEnds.push(e.payload as unknown as Record<string, unknown>);
  });
  return { assessed, turnEnds };
}

/** Run once: the answer, the captured events, and a JSON round trip of the recording. */
async function runOnce(agent: Agent, message = 'what runs on host-9?') {
  const caps = capture(agent);
  const recorder = recordRun(agent);
  const answer = await agent.run({ message });
  const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
  recorder.stop();
  return { answer, recording, ...caps };
}

const ledgerOf = (agent: Agent): readonly Record<string, unknown>[] =>
  ((agent.getLastSnapshot()?.sharedState as { findingsLedger?: Record<string, unknown>[] })
    .findingsLedger ?? []) as readonly Record<string, unknown>[];

const reasonsOf = (a: { reasons: readonly unknown[] }) =>
  a.reasons.map((r) => (typeof r === 'string' ? r : (r as { reason: string }).reason));

// ─── UNIT ────────────────────────────────────────────────────────────

describe('UNIT — the witness rows and their door', () => {
  it('the gate’s clean pass as a row: counts and the posture only, afterRevision only when true', () => {
    const row = groundedRowFrom({
      turn: 2,
      iteration: 3,
      posture: 'guard',
      candidates: 4,
      lookedUp: 3,
      afterRevision: false,
    });
    expect(row).toEqual({
      kind: 'grounded',
      turn: 2,
      iteration: 3,
      posture: 'guard',
      candidates: 4,
      lookedUp: 3,
    });
    expect(
      groundedRowFrom({
        turn: 1,
        iteration: 1,
        posture: 'rails',
        candidates: 0,
        lookedUp: 0,
        afterRevision: true,
      }).afterRevision,
    ).toBe(true);
  });

  it('unfinished steps as a row: position and tool only — never the step’s note', () => {
    const row = stepsUnfinishedRowFrom({
      turn: 1,
      iteration: 4,
      skillId: 'refund',
      remaining: [{ index: 2, tool: 'charge', note: 'refund the charge' } as never],
      total: 3,
      action: 'accepted',
    });
    expect(row).toEqual({
      kind: 'steps-unfinished',
      turn: 1,
      iteration: 4,
      skillId: 'refund',
      remaining: [{ index: 2, tool: 'charge' }],
      total: 3,
      action: 'accepted',
    });
    expect(JSON.stringify(row)).not.toContain('refund the charge');
  });

  it('the checkpoint door: well-formed witness rows pass, every malformed one is refused', () => {
    const grounded = groundedRowFrom({
      turn: 1,
      iteration: 1,
      posture: 'assist',
      candidates: 2,
      lookedUp: 2,
      afterRevision: false,
    });
    const steps = stepsUnfinishedRowFrom({
      turn: 1,
      iteration: 2,
      skillId: 's',
      remaining: [{ index: 3, tool: 't' }],
      total: 3,
      action: 'cut-short',
    });
    expect(witnessRowIsWellFormed(grounded as never)).toBe(true);
    expect(witnessRowIsWellFormed(steps as never)).toBe(true);
    for (const bad of [
      { ...grounded, turn: '1' },
      { ...grounded, iteration: undefined },
      { ...grounded, posture: 'strict' },
      { ...grounded, candidates: -1 },
      { ...grounded, lookedUp: 1.5 },
      { ...grounded, afterRevision: false },
      { ...steps, action: 'nudged' },
      { ...steps, remaining: [{ index: 'two', tool: 't' }] },
      { ...steps, remaining: 'none' },
      { ...steps, skillId: 7 },
      { ...steps, kind: 'steps' },
    ]) {
      expect(witnessRowIsWellFormed(bad as never), JSON.stringify(bad)).toBe(false);
    }
    // Through the one door a continued conversation enters by.
    const cp = (ledger: unknown[]): AgentRunCheckpoint =>
      ({
        version: 1,
        runId: 'r',
        originalInput: { message: 'm' },
        history: [{ role: 'user', content: 'm' }],
        lastCompletedIteration: 1,
        failurePoint: { iteration: 1, phase: 'iteration' },
        findingsLedger: ledger,
      } as unknown as AgentRunCheckpoint);
    expect(() => validateCheckpoint(cp([grounded, steps]))).not.toThrow();
    expect(() => validateCheckpoint(cp([{ ...steps, action: 'nudged' }]))).toThrow(
      /steps-unfinished/,
    );
  });
});

describe('UNIT — the read list and the run constant', () => {
  it('reads only the keys an arm of the agent can write', () => {
    const none = { tools: false, evidenceGate: false, answerValidation: false, inputs: false };
    // `stoppedEarly` with no arm at all: the Route decider writes it on every
    // agent — a tool-less one included, when its model asks for a call at the
    // limit (pinned end to end in answer-layer-equality.test.ts).
    expect(answerFoldReads({ ...none, toolMiddleware: false })).toEqual([
      'history',
      'turnNumber',
      'pausedToolCallId',
      'findingsLedger',
      'stoppedEarly',
    ]);
    expect(
      answerFoldReads({
        tools: true,
        evidenceGate: true,
        answerValidation: true,
        inputs: true,
        toolMiddleware: true,
      }),
    ).toEqual([
      'history',
      'turnNumber',
      'pausedToolCallId',
      'findingsLedger',
      'stoppedEarly',
      'coverageDeclared',
      'unsupportedValues',
      'answerValidation',
      'argumentAsk',
      'middlewareDecisions',
    ]);
    // A rewrite needs a ruled argument to rewrite: no inputs layer, no read.
    expect(answerFoldReads({ ...none, toolMiddleware: true })).not.toContain('middlewareDecisions');
  });

  it('names every armed layer and nothing else — absent when none is armed', () => {
    expect(honestyLayersOf({ inputs: false, answer: false })).toBeUndefined();
    expect(honestyLayersOf({ inputs: true, answer: false })).toEqual({ inputs: true });
    expect(honestyLayersOf({ inputs: false, answer: true })).toEqual({ answer: true });
    expect(honestyLayersOf({ inputs: true, answer: true })).toEqual({ inputs: true, answer: true });
  });
});

describe('UNIT — the fold reads the witness rows', () => {
  const state = (ledger: unknown[], extra: Record<string, unknown> = {}) => ({
    snapshot: {
      sharedState: {
        history: [{ role: 'user', content: 'q' }],
        turnNumber: 2,
        pausedToolCallId: '',
        findingsLedger: ledger,
        ...extra,
      },
    },
  });
  const grounded = (turn: number) =>
    groundedRowFrom({
      turn,
      iteration: 1,
      posture: 'guard',
      candidates: 1,
      lookedUp: 1,
      afterRevision: false,
    });

  it('a clean gate pass of THIS turn: the check ran — "consistent", never "known"', () => {
    const a = assessAnswer(state([grounded(2)]));
    expect(a.assessment).toBe('unrefuted');
    expect(a.standing).toBe('consistent');
    expect(a.support).toBeUndefined();
    expect(a.checked).toEqual([
      {
        layer: 4,
        check: 'names-and-numbers',
        ran: 1,
        of: 1,
        witness: [{ kind: 'state', key: 'findingsLedger', path: '/0/kind' }],
      },
    ]);
  });

  it('an earlier turn’s witness counts for nothing', () => {
    const a = assessAnswer(
      state([
        grounded(1),
        stepsUnfinishedRowFrom({
          turn: 1,
          iteration: 2,
          skillId: 's',
          remaining: [{ index: 2, tool: 't' }],
          total: 2,
          action: 'accepted',
        }),
      ]),
    );
    expect(a.standing).toBe('not-assessed');
    expect(a.reasons).toEqual([]);
  });

  it('a flag and a clean pass never both count: the committed flag is the verdict', () => {
    const a = assessAnswer(
      state([grounded(2)], {
        unsupportedValues: { values: [], candidates: 1, revised: false, refused: false },
      }),
    );
    expect(a.checked.filter((c) => c.check === 'names-and-numbers')).toHaveLength(1);
    expect(reasonsOf(a)).toEqual(['value-unsupported']);
  });

  it('unfinished steps of THIS turn: a layer-4 reason, "not sure"', () => {
    const a = assessAnswer(
      state([
        stepsUnfinishedRowFrom({
          turn: 2,
          iteration: 2,
          skillId: 'refund',
          remaining: [{ index: 3, tool: 'export' }],
          total: 3,
          action: 'cut-short',
        }),
      ]),
    );
    expect(a.standing).toBe('not-sure');
    expect(a.reasons).toEqual([
      {
        reason: 'steps-unfinished',
        layer: 4,
        witness: [{ kind: 'state', key: 'findingsLedger', path: '/0/kind' }],
      },
    ]);
  });
});

describe('UNIT — the standing as data and as one line', () => {
  const data = (over: Partial<AnswerAssessmentData>): AnswerAssessmentData => ({
    assessment: 'unknown',
    standing: 'not-sure',
    reasons: [],
    checked: [],
    ...over,
  });

  it('the projection carries the value, the words, the reason kinds and the checks — no witness, no digest', () => {
    const a = assessAnswer({
      snapshot: {
        sharedState: {
          history: [],
          answerValidation: {
            status: 'passed',
            mode: 'enforce',
            candidateDigest: 'sha256:abc',
          },
        },
      },
    });
    const d = assessmentDataOf(a);
    expect(d).toEqual({
      assessment: 'known',
      standing: 'known',
      reasons: [],
      checked: [{ layer: 4, check: 'answer-checks', ran: 1, of: 1 }],
    });
    expect(JSON.stringify(d)).not.toContain('sha256');
    expect(JSON.stringify(d)).not.toContain('witness');
  });

  it('every standing has its own opening, and the line starts with it', () => {
    const lines = {
      ask: standingLineOf(data({ standing: 'ask', reasons: ['asked'] }), [], false),
      'not-sure': standingLineOf(data({ reasons: ['empty-undeclared'] }), [], false),
      known: standingLineOf(data({ assessment: 'known', standing: 'known' }), [], false),
      consistent: standingLineOf(
        data({
          assessment: 'unrefuted',
          standing: 'consistent',
          checked: [
            { layer: 3, check: 'tool-coverage', ran: 0, of: 1 },
            { layer: 3, check: 'result-shape', ran: 1, of: 1 },
            { layer: 4, check: 'names-and-numbers', ran: 1, of: 1 },
          ],
        }),
        [],
        false,
      ),
      'not-assessed': standingLineOf(
        data({ assessment: 'not-applicable', standing: 'not-assessed' }),
        [],
        false,
      ),
    };
    for (const [standing, line] of Object.entries(lines)) {
      expect(
        line.startsWith(STANDING_LINE_OPENINGS[standing as AnswerAssessmentData['standing']]),
      ).toBe(true);
    }
    expect(lines.consistent).toBe(
      "Consistent with the run's record — 2 checks ran and none fired: what came back · names and numbers. This is not a verification.",
    );
    expect(lines['not-sure']).toBe(
      'Not sure — a lookup came back empty without saying what it searched.',
    );
    expect(lines.consistent).not.toMatch(/verified\b|known/i);
  });

  it('an assumed value is printed in the tool’s view — a hidden one never; a rewrite without an origin is named once', () => {
    const shown = standingLineOf(
      data({ reasons: ['argument-assumed'] }),
      [
        { toolName: 'search_logs', argument: 'window', value: '2h', hidden: false },
        { toolName: 'search_logs', argument: 'window', value: '2h', hidden: false },
        { toolName: 'vault', argument: 'token', value: 'REDACTED', hidden: true },
      ],
      true,
    );
    expect(shown).toBe(
      'Not sure — window = "2h" was assumed by search_logs\'s rule, not given by you; ' +
        "token was assumed by vault's rule (its value is hidden by the tool's view), not given by you; " +
        'a before-tool rule set a value a call ran with and did not say where it came from.',
    );
    expect(shown).not.toContain('REDACTED');
  });

  it('every assumed value is printed — the line replaces the uncapped "Assumed" block, so it never cuts one', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      toolName: `t${i}`,
      argument: 'a',
      value: String(i),
      hidden: false,
    }));
    const line = standingLineOf(data({ reasons: ['argument-assumed'] }), many, false);
    for (let i = 0; i < 20; i++) expect(line).toContain(`was assumed by t${i}'s rule`);
    expect(line).not.toContain('more (in the run record)');
  });

  it('a rewrite with no declared origin is named beside the assumed values, once', () => {
    const line = standingLineOf(
      data({ reasons: ['argument-assumed'] }),
      [{ toolName: 'search_logs', argument: 'window', value: '2h', hidden: false }],
      true,
    );
    expect(line).toBe(
      'Not sure — window = "2h" was assumed by search_logs\'s rule, not given by you; ' +
        'a before-tool rule set a value a call ran with and did not say where it came from.',
    );
  });

  it('past the cap, the OTHER reasons fold into a count, and the cut is said', () => {
    const others = [
      'asked',
      'argument-asked',
      'argument-unverified',
      'coverage-gap',
      'declared-absent',
      'empty-undeclared',
      'sources-conflict',
      'value-unsupported',
      'value-survived-revision',
      'stopped-early',
      'steps-unfinished',
      'answer-check-failed',
      'check-unreachable',
    ] as const;
    const line = standingLineOf(
      data({ reasons: ['argument-assumed', ...others] }),
      [{ toolName: 'search_logs', argument: 'window', value: '2h', hidden: false }],
      false,
    );
    expect(line).toContain('window = "2h" was assumed');
    expect(line.endsWith('; … and 1 more (in the run record).')).toBe(true);
  });
});

// ─── SCENARIO ────────────────────────────────────────────────────────

describe('SCENARIO — the standing as data, from a real run', () => {
  // `dynamic` and `classic` build the flat chart, `dynamic-grouped` the grouped one:
  // both builders start the final branch through the one helper.
  for (const reactMode of ['dynamic', 'dynamic-grouped', 'classic'] as const) {
    it(`${reactMode}: the event and turn_end carry ONE projection, equal to the read-after fold`, async () => {
      const agent = Agent.create({
        provider: callThen('find_vm', 'No VMs on host-9.'),
        model: 'mock',
        reactMode,
      })
        .tool(lookup('find_vm', () => []))
        .answerLayer()
        .build();
      const { answer, recording, assessed, turnEnds } = await runOnce(agent);
      // A label, never an edit: the answer is the model's, byte for byte.
      expect(answer).toBe('No VMs on host-9.');
      expect(assessed).toHaveLength(1);
      const { turn, iteration, ...fields } = assessed[0]!;
      expect(turn).toBe(1);
      expect(iteration).toBe(2);
      expect(turnEnds.at(-1)!.answerAssessment).toEqual(fields);
      const after = assessmentDataOf(assessAnswer(recording));
      expect(fields).toEqual(after);
      expect(fields).toMatchObject({ standing: 'not-sure', reasons: ['empty-undeclared'] });
      // The run constant names the layer, on the record.
      expect(
        (agent.getLastSnapshot()!.sharedState as { honestyLayers?: unknown }).honestyLayers,
      ).toEqual({ answer: true });
    });
  }

  it('the gate’s clean pass is filed as a `grounded` row and folds "consistent" — never "known"', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 't1', name: 'show_flogi', args: {} }] },
          { content: 'fc1/5 is logged in with FCID 0x650400 and WWPN 50:00:09:72:08:60:2a:00.' },
        ],
      }),
      model: 'mock',
    })
      .tool(
        defineTool<Record<string, never>, string>({
          name: 'show_flogi',
          description: 'fabric logins for a switch',
          inputSchema: { type: 'object', properties: {} },
          execute: () => JSON.stringify(TOOL_RESULTS.show_flogi),
        }),
      )
      .namesAndNumbersFromEvidence({ posture: 'guard' })
      .answerLayer()
      .build();
    const { assessed } = await runOnce(agent, 'which ports are logged in?');
    const rows = ledgerOf(agent).filter((r) => r.kind === 'grounded');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'grounded', turn: 1, posture: 'guard' });
    expect(rows[0]!.afterRevision).toBeUndefined();
    expect(assessed[0]).toMatchObject({ assessment: 'unrefuted', standing: 'consistent' });
    expect(assessed[0]!.checked).toContainEqual({
      layer: 4,
      check: 'names-and-numbers',
      ran: 1,
      of: 1,
    });
  });

  it('after the one revision: the grounded row says so, and the fold still reads "consistent"', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 't1', name: 'show_flogi', args: {} }] },
          { content: 'The affected array port is SHPMAXDLVAP001-FA0 with FCID 0xef0101.' },
          { content: 'fc1/5 is logged in with FCID 0x650400.' },
        ],
      }),
      model: 'mock',
    })
      .tool(
        defineTool<Record<string, never>, string>({
          name: 'show_flogi',
          description: 'fabric logins for a switch',
          inputSchema: { type: 'object', properties: {} },
          execute: () => JSON.stringify(TOOL_RESULTS.show_flogi),
        }),
      )
      .namesAndNumbersFromEvidence({ posture: 'guard' })
      .answerLayer()
      .build();
    const { recording, assessed } = await runOnce(agent, 'which ports are logged in?');
    const rows = ledgerOf(agent).filter((r) => r.kind === 'grounded');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ afterRevision: true });
    expect(assessed).toHaveLength(1); // one event per ANSWER — the draft sent back files none
    expect(assessed[0]).toMatchObject({ standing: 'consistent' });
    expect(assessmentDataOf(assessAnswer(recording))).toEqual(
      (({ turn: _t, iteration: _i, ...rest }) => rest)(assessed[0]!),
    );
  });

  it('a stepped skill’s accepted stop files a `steps-unfinished` row and folds "not sure"', async () => {
    const t = (name: string) =>
      defineTool<Record<string, never>, string>({
        name,
        description: `${name} tool`,
        inputSchema: { type: 'object', properties: {} },
        execute: () => `${name} ran`,
      });
    const refund = defineSkill({
      id: 'refund',
      description: 'refund handling',
      body: 'Handle refunds carefully.',
      tools: [t('lookup'), t('charge'), t('export')] as never,
      steps: [
        { tool: 'lookup', note: 'find the order first' },
        { tool: 'charge', note: 'refund the charge' },
        { tool: 'export', note: 'file the receipt' },
      ],
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 't1', name: 'read_skill', args: { id: 'refund' } }] },
          { toolCalls: [{ id: 't2', name: 'lookup', args: {} }] },
          { content: 'stopping here' },
          { content: 'still stopping — cannot verify the charge' },
        ] as never,
      }),
      model: 'mock',
      maxIterations: 8,
    })
      .system('You are support.')
      .injection(refund)
      .answerLayer()
      .build();
    const { recording, assessed } = await runOnce(agent, 'refund order 42');
    const rows = ledgerOf(agent).filter((r) => r.kind === 'steps-unfinished');
    expect(rows).toEqual([
      {
        kind: 'steps-unfinished',
        turn: 1,
        iteration: 4,
        skillId: 'refund',
        remaining: [
          { index: 2, tool: 'charge' },
          { index: 3, tool: 'export' },
        ],
        total: 3,
        action: 'accepted',
      },
    ]);
    expect(assessed[0]).toMatchObject({ standing: 'not-sure' });
    expect(assessed[0]!.reasons).toContain('steps-unfinished');
    expect(reasonsOf(assessAnswer(recording))).toContain('steps-unfinished');
    // The step's note — the author's words — stays out of the row and the event.
    expect(JSON.stringify(rows)).not.toContain('refund the charge');
    expect(JSON.stringify(assessed)).not.toContain('refund the charge');
  });

  it('a passed enforce answer check folds "known" — the one tie check this version reads', async () => {
    const agent = Agent.create({
      provider: mock({ replies: [{ content: '{"ok":true}' }] }),
      model: 'mock',
    })
      .outputSchema({ parse: (value: unknown) => value })
      .answerValidation({
        id: 'ok-check',
        version: '1',
        validate() {
          return { checks: [{ id: 'ok', disposition: 'checked-pass' }] };
        },
      })
      .answerLayer()
      .build();
    const { assessed, recording } = await runOnce(agent, 'is it ok?');
    expect(assessed[0]).toMatchObject({ assessment: 'known', standing: 'known' });
    expect(assessmentDataOf(assessAnswer(recording)).standing).toBe('known');
  });

  it('a typed answer is never touched: it still parses, and the standing rides beside it', async () => {
    const parser = {
      parse: (v: unknown) => v as { hosts: string[] },
      toJsonSchema: () => ({ type: 'object', properties: { hosts: { type: 'array' } } }),
    };
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'find_vm', args: {} }] },
          { content: '{"hosts":[]}' },
        ],
      }),
      model: 'mock',
    })
      .tool(lookup('find_vm', () => []))
      .outputSchema(parser as never)
      .answerLayer()
      .build();
    const turnEnds: Record<string, unknown>[] = [];
    agent.on('agentfootprint.agent.turn_end', (e) => {
      turnEnds.push(e.payload as unknown as Record<string, unknown>);
    });
    const typed = await agent.runTyped<{ hosts: string[] }>({ message: 'which hosts?' });
    expect(typed).toEqual({ hosts: [] });
    expect(turnEnds.at(-1)!.finalContent).toBe('{"hosts":[]}');
    expect(turnEnds.at(-1)!.answerAssessment).toMatchObject({ standing: 'not-sure' });
  });

  it('the chart: armed, the final branch opens with `assess-answer` then PrepareFinal (still a milestone); unarmed, no such stage', () => {
    const build = (armed: boolean) => {
      const b = Agent.create({ provider: mock({ reply: 'x' }), model: 'mock' }).tool(
        lookup('find_vm', () => []),
      );
      return (armed ? b.answerLayer() : b).build();
    };
    const armed = JSON.stringify(build(true).getSpec());
    const unarmed = JSON.stringify(build(false).getSpec());
    expect(armed).toContain('"assess-answer"');
    expect(unarmed).not.toContain('assess-answer');
    // PrepareFinal keeps its milestone tags when it is no longer the branch's root.
    expect(armed.match(/milestone-label:Answer/g)?.length).toBe(
      unarmed.match(/milestone-label:Answer/g)?.length,
    );
  });

  it('unarmed: no event, no turn_end field, no run constant, no witness row', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 't1', name: 'show_flogi', args: {} }] },
          { content: 'fc1/5 is logged in with FCID 0x650400.' },
        ],
      }),
      model: 'mock',
    })
      .tool(
        defineTool<Record<string, never>, string>({
          name: 'show_flogi',
          description: 'fabric logins',
          inputSchema: { type: 'object', properties: {} },
          execute: () => JSON.stringify(TOOL_RESULTS.show_flogi),
        }),
      )
      .namesAndNumbersFromEvidence({ posture: 'guard' })
      .build();
    const { assessed, turnEnds } = await runOnce(agent, 'which ports?');
    expect(assessed).toEqual([]);
    expect('answerAssessment' in turnEnds.at(-1)!).toBe(false);
    const state = agent.getLastSnapshot()!.sharedState as Record<string, unknown>;
    expect('honestyLayers' in state).toBe(false);
    expect('findingsLedger' in state).toBe(false);
  });
});

// ─── SCENARIO — a draft sent back files no witness ───────────────────

/**
 * A stepped skill beside the evidence gate: the step judge can ACCEPT a stop on
 * a draft the gate then sends back. The witness row belongs to the answer that
 * stands — filed once, when the decider really answers `'final'` — never to the
 * draft: a revision that finished the steps must not read "the answer came
 * before the skill's declared steps finished", and a revision that did not must
 * not file the verdict twice.
 */
describe('SCENARIO — a stepped skill beside the evidence gate: one witness, for the answer that stands', () => {
  const t = (name: string, out: unknown) =>
    defineTool<Record<string, never>, string>({
      name,
      description: `${name} tool`,
      inputSchema: { type: 'object', properties: {} },
      execute: () => JSON.stringify(out),
    });
  const refund = () =>
    defineSkill({
      id: 'refund',
      description: 'refund handling',
      body: 'Handle refunds carefully.',
      tools: [
        t('lookup', { order: 'ORD-4242' }),
        t('charge', { refunded: 'ORD-4242' }),
        t('export', { receipt: 'RCPT-77' }),
      ] as never,
      steps: [
        { tool: 'lookup', note: 'find the order first' },
        { tool: 'charge', note: 'refund the charge' },
        { tool: 'export', note: 'file the receipt' },
      ],
    });
  /** read_skill, the first step, one early stop (the nudge) — then the case's own replies. */
  const opening = (typed: boolean) => [
    { toolCalls: [{ id: 't1', name: 'read_skill', args: { id: 'refund' } }] },
    { toolCalls: [{ id: 't2', name: 'lookup', args: {} }] },
    { content: typed ? '{"answer":"stopping here"}' : 'stopping here' },
  ];
  const say = (typed: boolean, text: string) => ({
    content: typed ? JSON.stringify({ answer: text }) : text,
  });
  const cases = [
    {
      name: 'the revision finishes the steps',
      tail: (typed: boolean) => [
        say(typed, 'Refunded order ORD-9999.'), // accepted, then sent back: ORD-9999 is on no result
        { toolCalls: [{ id: 't3', name: 'charge', args: {} }] },
        { toolCalls: [{ id: 't4', name: 'export', args: {} }] },
        say(typed, 'Refunded order ORD-4242; receipt RCPT-77.'),
      ],
      steps: 0,
      grounded: 1,
      reasons: [],
    },
    {
      name: 'the revision still leaves steps unrun',
      tail: (typed: boolean) => [
        say(typed, 'Refunded order ORD-9999.'),
        say(typed, 'Order ORD-4242 is on record; the charge was not verified.'),
      ],
      steps: 1,
      grounded: 1,
      reasons: ['steps-unfinished'],
    },
    {
      name: 'a grounded draft stops with steps unrun',
      tail: (typed: boolean) => [say(typed, 'Order ORD-4242 is on record.')],
      steps: 1,
      grounded: 1,
      reasons: ['steps-unfinished'],
    },
    {
      name: 'the revision still states an unsupported value',
      tail: (typed: boolean) => [
        say(typed, 'Refunded order ORD-9999.'),
        say(typed, 'It is ORD-9999, I am sure.'),
      ],
      steps: 1,
      grounded: 0,
      reasons: ['value-survived-revision', 'steps-unfinished'],
    },
  ] as const;
  const parser = {
    parse: (v: unknown) => {
      const o = v as { answer?: unknown };
      if (typeof o.answer !== 'string') throw new Error('answer must be a string');
      return o as { answer: string };
    },
    toJsonSchema: () => ({ type: 'object', properties: { answer: { type: 'string' } } }),
  };

  for (const typed of [false, true]) {
    for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
      it.each(cases)(
        `${
          typed ? 'typed (the enforcing decider)' : 'prose (the judging decider)'
        }, ${reactMode}: $name`,
        async (c) => {
          let b = Agent.create({
            provider: mock({ replies: [...opening(typed), ...c.tail(typed)] as never }),
            model: 'mock',
            reactMode,
            maxIterations: 12,
          })
            .system('You are support.')
            .injection(refund())
            .namesAndNumbersFromEvidence({ posture: 'guard' });
          if (typed) b = b.outputSchema(parser as never);
          const agent = b.answerLayer().build();
          const { recording, assessed } = await runOnce(agent, 'refund the order');
          expect(assessed).toHaveLength(1);
          const answered = assessed[0]!.iteration;
          const ledger = ledgerOf(agent);
          const steps = ledger.filter((r) => r.kind === 'steps-unfinished');
          const grounded = ledger.filter((r) => r.kind === 'grounded');
          expect(steps).toHaveLength(c.steps);
          expect(grounded).toHaveLength(c.grounded);
          // Every witness row is the verdict on the answer that stands — its iteration.
          for (const row of [...steps, ...grounded]) expect(row.iteration).toBe(answered);
          expect(assessed[0]!.reasons).toEqual(c.reasons);
          expect(reasonsOf(assessAnswer(recording))).toEqual(c.reasons);
        },
      );
    }
  }
});

describe('SCENARIO — the line, under its own arm', () => {
  it('appends one line to a prose answer, after the separator', async () => {
    const agent = Agent.create({
      provider: callThen('find_vm', 'No VMs on host-9.'),
      model: 'mock',
    })
      .tool(lookup('find_vm', () => []))
      .answerLayer({ standingLine: true })
      .build();
    const { answer } = await runOnce(agent);
    expect(answer).toBe(
      'No VMs on host-9.\n\n---\n\nNot sure — a lookup came back empty without saying what it searched.',
    );
  });

  it('beside the limits block, the line opens the section and the block follows', async () => {
    const agent = Agent.create({ provider: callThen('find_vm', 'Nothing matched.'), model: 'mock' })
      .tool(
        lookup('find_vm', () => ({
          af_absent: true,
          what: 'VMs on host-9',
          checked: ['the VM inventory'],
          not_checked: ['powered-off VMs'],
        })),
      )
      .limitsTravelWithTheAnswer()
      .answerLayer({ standingLine: true })
      .build();
    const { answer } = await runOnce(agent);
    const [body, section] = (answer as string).split('\n\n---\n\n');
    expect(body).toBe('Nothing matched.');
    expect(section!.startsWith('Not sure — ')).toBe(true);
    expect(section).toContain('Coverage of this answer');
    expect(section!.indexOf('Not sure — ')).toBeLessThan(
      section!.indexOf('Coverage of this answer'),
    );
  });
});

describe('SCENARIO — the line owns the "assumed" sentence (one composer for one fact)', () => {
  const ruled = () =>
    defineTool({
      name: 'search_logs',
      description: 'Error lines for one service over a look-back period.',
      inputSchema: {
        type: 'object',
        required: ['service', 'window'],
        properties: {
          service: { type: 'string' },
          window: { type: 'string', enum: ['1h', '2h', '24h'] },
        },
      },
      askOrAssume: { window: { assume: '2h' } },
      execute: async () => ({ errors: 0 }),
    });
  const replies = () =>
    mock({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }] },
        { content: 'No errors on checkout.' },
      ] as never,
    });

  it('beside the limits block: the line names the assumed value, and no "Assumed" block is appended', async () => {
    const agent = Agent.create({ provider: replies(), model: 'mock' })
      .tool(ruled())
      .limitsTravelWithTheAnswer()
      .answerLayer({ standingLine: true })
      .build();
    const { answer } = await runOnce(agent, 'errors on checkout?');
    expect(answer).toBe(
      'No errors on checkout.\n\n---\n\n' +
        'Not sure — window = "2h" was assumed by search_logs\'s rule, not given by you.',
    );
    expect(answer).not.toContain("Assumed (a tool's rule");
  });

  it('without the line, the limits block keeps its "Assumed" block — the arm changes nothing else', async () => {
    const agent = Agent.create({ provider: replies(), model: 'mock' })
      .tool(ruled())
      .limitsTravelWithTheAnswer()
      .answerLayer()
      .build();
    const { answer, assessed } = await runOnce(agent, 'errors on checkout?');
    expect(answer).toBe(
      'No errors on checkout.\n\n---\n\n' +
        'Assumed (a tool\'s rule, not your words):\n- window = "2h" (search_logs)',
    );
    expect(assessed[0]!.reasons).toContain('argument-assumed');
  });

  it('a hidden argument: the line says the value is hidden and never prints it', async () => {
    const hiding = {
      ...ruled(),
      [SHOWN_ARGS]: (args: Record<string, unknown>) =>
        'window' in args ? { ...args, window: 'REDACTED' } : args,
    } as unknown as Tool;
    const agent = Agent.create({ provider: replies(), model: 'mock' })
      .tool(hiding)
      .answerLayer({ standingLine: true })
      .build();
    const { answer } = await runOnce(agent, 'errors on checkout?');
    expect(answer).toContain(
      "window was assumed by search_logs's rule (its value is hidden by the tool's view), not given by you",
    );
    expect(answer).not.toContain('"2h"');
    expect(answer).not.toContain('REDACTED');
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────

describe('BOUNDARY — the build refuses what cannot be honest', () => {
  const parser = { parse: (v: unknown) => v, toJsonSchema: () => ({ type: 'object' }) };
  const validation = {
    id: 'v',
    version: '1',
    validate() {
      return { checks: [{ id: 'v', disposition: 'checked-pass' as const }] };
    },
  };

  it('the line beside .answerValidation() — the checks judge the exact bytes', () => {
    expect(() =>
      Agent.create({ provider: mock({ replies: [] }), model: 'mock' })
        .outputSchema(parser as never)
        .answerValidation(validation)
        .answerLayer({ standingLine: true })
        .build(),
    ).toThrow(/cannot be combined with \.answerValidation\(\)/);
  });

  it('the line beside .outputSchema() — JSON followed by prose is not JSON', () => {
    expect(() =>
      Agent.create({ provider: mock({ replies: [] }), model: 'mock' })
        .outputSchema(parser as never)
        .answerLayer({ standingLine: true })
        .build(),
    ).toThrow(/cannot be combined with \.outputSchema\(\)/);
  });

  it('the data alone is fine beside both', () => {
    expect(() =>
      Agent.create({ provider: mock({ replies: [] }), model: 'mock' })
        .outputSchema(parser as never)
        .answerValidation(validation)
        .answerLayer()
        .build(),
    ).not.toThrow();
  });

  it('a second call, an unknown option, a non-boolean line — each refused by name', () => {
    const b = () => Agent.create({ provider: mock({ replies: [] }), model: 'mock' });
    expect(() => b().answerLayer().answerLayer()).toThrow(/already set/);
    expect(() => b().answerLayer({ line: true } as never)).toThrow(/unknown option\(s\) 'line'/);
    expect(() => b().answerLayer({ standingLine: 'yes' } as never)).toThrow(/must be a boolean/);
    expect(() => b().answerLayer(7 as never)).toThrow(/must be an object/);
  });

  // The OPTIONS door (`AgentOptions.answerLayer`) reaches the same arm, so it
  // meets the same refusals — once it skipped both, and the line was appended
  // to a typed answer's JSON (the bug the refusal exists to stop).
  describe('the same refusals through the options door', () => {
    const viaOptions = (answerLayer: unknown) =>
      Agent.create({
        provider: mock({ replies: [{ content: '{"hosts":[]}' }] }),
        model: 'mock',
        answerLayer: answerLayer as never,
      });

    it('the line beside .outputSchema() and beside .answerValidation() — refused at build', () => {
      expect(() =>
        viaOptions({ standingLine: true })
          .outputSchema(parser as never)
          .build(),
      ).toThrow(/cannot be combined with \.outputSchema\(\)/);
      expect(() =>
        viaOptions({ standingLine: true })
          .outputSchema(parser as never)
          .answerValidation(validation)
          .build(),
      ).toThrow(/cannot be combined with \.answerValidation\(\)/);
    });

    it('the data alone is fine, and a typed answer is never touched', async () => {
      const agent = viaOptions(true)
        .outputSchema(parser as never)
        .build();
      const turnEnds: Record<string, unknown>[] = [];
      agent.on('agentfootprint.agent.turn_end', (e) => {
        turnEnds.push(e.payload as unknown as Record<string, unknown>);
      });
      expect(await agent.run({ message: 'which hosts?' })).toBe('{"hosts":[]}');
      expect(turnEnds.at(-1)!.answerAssessment).toMatchObject({ standing: 'not-assessed' });
      expect(() =>
        viaOptions({})
          .outputSchema(parser as never)
          .build(),
      ).not.toThrow();
      expect(() =>
        viaOptions(false)
          .outputSchema(parser as never)
          .build(),
      ).not.toThrow();
    });

    it('a malformed option is refused by name, as through the builder', () => {
      expect(() => viaOptions({ line: true }).build()).toThrow(/unknown option\(s\) 'line'/);
      expect(() => viaOptions({ standingLine: 'yes' }).build()).toThrow(/must be a boolean/);
      expect(() => viaOptions(7).build()).toThrow(/must be a boolean or an object/);
    });
  });
});

describe('BOUNDARY — a continued conversation', () => {
  it('turn 1’s witness row rides the conversation; turn 2 folds only its own', async () => {
    const flogi = defineTool<Record<string, never>, string>({
      name: 'show_flogi',
      description: 'fabric logins',
      inputSchema: { type: 'object', properties: {} },
      execute: () => JSON.stringify(TOOL_RESULTS.show_flogi),
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 't1', name: 'show_flogi', args: {} }] },
          { content: 'fc1/5 is logged in.' },
          { content: 'Nothing else to add.' },
        ],
      }),
      model: 'mock',
    })
      .tool(flogi)
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .answerLayer()
      .build();
    const first = capture(agent);
    await agent.run({ message: 'which ports are logged in?' });
    expect(first.assessed.at(-1)).toMatchObject({ turn: 1, standing: 'consistent' });
    const cp = agent.checkpoint();
    expect(cp).toBeDefined();
    await agent.run({ message: 'anything else?', continueFrom: cp! });
    const ledger = ledgerOf(agent);
    // Turn 1's row was carried; turn 2's clean pass is its own row — on an
    // answer that stated nothing to look up.
    const grounded = ledger.filter((r) => r.kind === 'grounded');
    expect(grounded.map((r) => [r.turn, r.lookedUp])).toEqual([
      [1, 1],
      [2, 0],
    ]);
    // Turn 2 folds only its own row, and a check that looked nothing up did
    // not apply: the names-and-numbers check is absent, never "ran".
    const last = first.assessed.at(-1)!;
    expect(last.turn).toBe(2);
    expect(last.checked).not.toContainEqual(
      expect.objectContaining({ check: 'names-and-numbers' }),
    );
    expect(last.standing).toBe('not-assessed');
  });
});

/**
 * THE TURN STAMP NEVER REPEATS IN ONE CONVERSATION. Every row the one writer
 * files while a layer is armed carries `turn`, and the fold reads "this turn"
 * by it — so a number that comes back folds an earlier turn's verdict as this
 * one's. Counting the user messages of the stored history cannot promise that:
 * a window strategy (or a compaction) trims them, and the count repeats and
 * goes backwards. The checkpoint carries the turn it ended on while a layer is
 * armed, and the restored ledger's latest stamp is a floor under it.
 */
describe('BOUNDARY — the turn stamp never repeats in a conversation', () => {
  const t = (name: string, out: unknown) =>
    defineTool<Record<string, never>, string>({
      name,
      description: `${name} tool`,
      inputSchema: { type: 'object', properties: {} },
      execute: () => JSON.stringify(out),
    });
  const refund = () =>
    defineSkill({
      id: 'refund',
      description: 'refund handling',
      body: 'Handle refunds carefully.',
      tools: [t('lookup', { order: 'ORD-4242' }), t('charge', { ok: true })] as never,
      steps: [
        { tool: 'lookup', note: 'find the order first' },
        { tool: 'charge', note: 'refund the charge' },
      ],
    });
  type Kind = 'plain' | 'skill';
  /** Each turn's replies: a plain lookup, or a stepped skill whose stop is accepted unfinished. */
  const repliesOf = (kinds: readonly Kind[]) =>
    kinds.flatMap((k, i) =>
      k === 'plain'
        ? [
            { toolCalls: [{ id: `p${i}`, name: 'lookup', args: {} }] },
            { content: `plain ${i + 1}` },
          ]
        : [
            { toolCalls: [{ id: `s${i}a`, name: 'read_skill', args: { id: 'refund' } }] },
            { toolCalls: [{ id: `s${i}b`, name: 'lookup', args: {} }] },
            { content: 'stopping' },
            { content: `stopping again ${i + 1}` },
          ],
    );

  async function converse(kinds: readonly Kind[], keepRecentTurns: number) {
    const agent = Agent.create({
      provider: mock({ replies: repliesOf(kinds) as never }),
      model: 'mock',
      maxIterations: 8,
    })
      .system('You are support.')
      .injection(refund())
      .window(slidingWindow({ keepRecentTurns }))
      .answerLayer({ standingLine: true })
      .build();
    const turns: { turn: number; stamp: unknown; reasons: unknown; answer: string }[] = [];
    let checkpoint: AgentRunCheckpoint | undefined;
    for (let i = 0; i < kinds.length; i++) {
      const caps = capture(agent);
      const answer = (await agent.run({
        message: `message ${i + 1}`,
        ...(checkpoint !== undefined && { continueFrom: checkpoint }),
      })) as string;
      const state = agent.getLastSnapshot()!.sharedState as { turnNumber: number };
      checkpoint = agent.checkpoint()!;
      turns.push({
        turn: state.turnNumber,
        stamp: checkpoint.turnNumber,
        reasons: caps.assessed.at(-1)!.reasons,
        answer,
      });
    }
    return { agent, turns };
  }

  it.each([
    [1, 1],
    [1, 2],
    [2, 1],
    [2, 3],
  ])(
    'window keepRecentTurns %i, the skill on turn %i: the numbers climb, and a plain turn never folds the skill’s verdict',
    async (keep, at) => {
      const kinds = Array.from({ length: 6 }, (_, i): Kind => (i === at ? 'skill' : 'plain'));
      const { turns } = await converse(kinds, keep);
      expect(turns.map((x) => x.turn)).toEqual([1, 2, 3, 4, 5, 6]);
      // The conversation carrier holds the turn its history ended on.
      expect(turns.map((x) => x.stamp)).toEqual([1, 2, 3, 4, 5, 6]);
      turns.forEach((x, i) => {
        if (kinds[i] === 'skill') {
          expect(x.reasons).toContain('steps-unfinished');
        } else {
          expect(x.reasons).not.toContain('steps-unfinished');
          expect(x.answer).not.toContain('declared steps');
        }
      });
    },
  );

  it('a conversation stored without the carrier (an older writer): the restored ledger’s stamps are the floor', async () => {
    const kinds: Kind[] = ['plain', 'skill', 'plain', 'plain', 'plain', 'plain'];
    const agent = Agent.create({
      provider: mock({ replies: repliesOf(kinds) as never }),
      model: 'mock',
      maxIterations: 8,
    })
      .system('You are support.')
      .injection(refund())
      .window(slidingWindow({ keepRecentTurns: 1 }))
      .answerLayer()
      .build();
    let checkpoint: AgentRunCheckpoint | undefined;
    const seen: { turn: number; reasons: unknown }[] = [];
    for (let i = 0; i < kinds.length; i++) {
      const caps = capture(agent);
      await agent.run({
        message: `message ${i + 1}`,
        ...(checkpoint !== undefined && { continueFrom: checkpoint }),
      });
      const state = agent.getLastSnapshot()!.sharedState as { turnNumber: number };
      seen.push({ turn: state.turnNumber, reasons: caps.assessed.at(-1)!.reasons });
      // What an older runtime stored: the ledger's rows (stamped), no carried turn.
      const { turnNumber: _carried, ...older } = agent.checkpoint()!;
      void _carried;
      checkpoint = older as AgentRunCheckpoint;
    }
    const skillTurn = seen[1]!.turn;
    for (const later of seen.slice(2)) {
      expect(later.turn).toBeGreaterThan(skillTurn);
      expect(later.reasons).not.toContain('steps-unfinished');
    }
  });

  it('only while a layer is armed does the carrier hold the turn — an unarmed checkpoint keeps its bytes', async () => {
    const plain = Agent.create({ provider: mock({ reply: 'hi' }), model: 'mock' }).build();
    await plain.run({ message: 'hello' });
    expect('turnNumber' in plain.checkpoint()!).toBe(false);
    const armed = Agent.create({ provider: mock({ reply: 'hi' }), model: 'mock' })
      .answerLayer()
      .build();
    await armed.run({ message: 'hello' });
    expect(armed.checkpoint()!.turnNumber).toBe(1);
  });

  it('a retry of a failed turn (resumeOnError) is the SAME turn — the crash carrier holds its number', async () => {
    let calls = 0;
    // Turn 1 and 2 answer; turn 3 calls the tool, then the provider fails; the retry answers.
    const script = [
      { content: 'first' },
      { content: 'second' },
      { content: '', toolCalls: [{ id: 'c3', name: 'lookup', args: {} }] },
      'fail',
      { content: 'third' },
    ] as const;
    const provider = {
      name: 'scripted',
      complete: () => {
        const next = script[calls++];
        if (next === 'fail' || next === undefined)
          return Promise.reject(new Error('vendor is down'));
        return Promise.resolve({ toolCalls: [], usage: { input: 1, output: 1 }, ...next });
      },
    };
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .tool(t('lookup', { order: 'ORD-4242' }))
      .window(slidingWindow({ keepRecentTurns: 1 }))
      .answerLayer()
      .build();
    const turnOf = () =>
      (agent.getLastSnapshot()!.sharedState as { turnNumber: number }).turnNumber;
    await agent.run({ message: 'one' });
    await agent.run({ message: 'two', continueFrom: agent.checkpoint()! });
    expect(turnOf()).toBe(2);
    let crash: unknown;
    try {
      await agent.run({ message: 'three', continueFrom: agent.checkpoint()! });
    } catch (e) {
      crash = e;
    }
    const failed = (crash as { checkpoint?: AgentRunCheckpoint }).checkpoint;
    expect(failed).toBeDefined();
    expect(failed!.turnNumber).toBe(3);
    const caps = capture(agent);
    await agent.resumeOnError(failed!);
    expect(turnOf()).toBe(3);
    expect(caps.assessed.at(-1)!.turn).toBe(3);
  });

  it('the checkpoint door: a carried turn is a positive integer, or the checkpoint is refused', () => {
    const cp = (turnNumber: unknown) =>
      ({
        version: 1,
        runId: 'r',
        history: [],
        lastCompletedIteration: 0,
        originalInput: { message: 'x' },
        checkpointedAt: 0,
        turnNumber,
      } as unknown as AgentRunCheckpoint);
    expect(() => validateCheckpoint(cp(3))).not.toThrow();
    for (const bad of [0, -1, 1.5, '3', Number.NaN, null]) {
      expect(() => validateCheckpoint(cp(bad)), String(bad)).toThrow(/turnNumber/);
    }
  });
});

// ─── SECURITY ────────────────────────────────────────────────────────

describe('SECURITY — the standing as data carries no value', () => {
  it('the event and turn_end hold names, enums and counts only', async () => {
    const secret = 'host-9-SECRET-7731';
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'find_vm', args: { host: secret } }] },
          { content: `Nothing runs on ${secret}.` },
        ],
      }),
      model: 'mock',
    })
      .tool(lookup('find_vm', () => ({ rows: [], note: secret })))
      .answerLayer()
      .build();
    const { assessed, turnEnds } = await runOnce(agent, `what runs on ${secret}?`);
    const payloads = JSON.stringify([assessed, turnEnds.map((t) => t.answerAssessment)]);
    expect(payloads).not.toContain(secret);
    expect(payloads).not.toContain('witness');
    expect(payloads).not.toContain('findingsLedger');
    for (const p of assessed) {
      expect(Object.keys(p).sort()).toEqual(
        ['assessment', 'checked', 'iteration', 'reasons', 'standing', 'turn'].sort(),
      );
    }
  });
});
