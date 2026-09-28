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
 *                   still parses; both chart shapes;
 *   - BOUNDARY    — the build refusals (the line beside `.answerValidation()`
 *                   and beside `.outputSchema()`, a second call, bad options);
 *                   the checkpoint door accepts well-formed witness rows and
 *                   refuses malformed ones; a continued conversation's carried
 *                   witness rows do not count for the next turn;
 *   - SECURITY    — the event and the `turn_end` field carry names, enums and
 *                   counts only: no value from the answer, no tool result, no
 *                   witness pointer; the line prints an assumed value only in
 *                   the tool's own view.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool, type AgentRunCheckpoint, type Tool } from '../../../../src/index.js';
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
    expect(answerFoldReads({ ...none, toolMiddleware: false })).toEqual([
      'history',
      'turnNumber',
      'pausedToolCallId',
      'findingsLedger',
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
      'coverageDeclared',
      'stoppedEarly',
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

  it('a long list of reasons is cut, and the cut is said', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      toolName: `t${i}`,
      argument: 'a',
      value: String(i),
      hidden: false,
    }));
    const line = standingLineOf(data({ reasons: ['argument-assumed'] }), many, false);
    expect(line).toContain('… and 8 more (in the run record)');
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
