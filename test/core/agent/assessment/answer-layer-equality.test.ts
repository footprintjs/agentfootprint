/**
 * THE EQUALITY LAW — the standing the answer layer folds INSIDE the run equals
 * the standing `assessAnswer()` folds over the same run's recording read
 * afterwards. One pure function, the same committed rows, the one moment
 * nothing after it can change them (`assessment/stage.ts`, "The equality law").
 *
 * Test types (Convention 3):
 *   - PROPERTY     — a seeded generator (the repo carries no property-testing
 *                    library; a fixed seed keeps every case reproducible by
 *                    its index) over agent configurations — tool result shapes,
 *                    the evidence gate's postures, the inputs layer, the limits
 *                    block, the line, a tight action budget, and an agent with
 *                    no tool at all whose model still asks for one — each run
 *                    once and held to the law; with the line on, the answer
 *                    account finds exactly the section the run appended;
 *   - SCENARIO     — the named paths the law must survive: a pause and its
 *                    resume (a tool's question; the inputs layer's own batch
 *                    ask), a continued conversation of three turns, a typed
 *                    answer re-asked once for its schema, the evidence gate's
 *                    one revision, a limit that cut the turn short (wrapped up,
 *                    cut short with the wrap-up off, and on a tool-less agent),
 *                    a before-tool rewrite of a ruled argument, and an agent
 *                    mounted in a composition (a Sequence step), whose standing
 *                    reaches the composition on `turn_end`;
 *   - REGRESSION   — the in-run projection also equals `agent.assessment()`,
 *                    the running agent's own read-after door; and every case
 *                    holds at most one witness row of each kind per turn.
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  allow,
  askHuman,
  coverage,
  defineTool,
  type Tool,
  type ToolMiddleware,
} from '../../../../src/index.js';
import { Sequence } from '../../../../src/core-flow/Sequence.js';
import { isPaused } from '../../../../src/core/pause.js';
import { mock } from '../../../../src/llm-providers.js';
import { accountForAnswer, assessAnswer, recordRun } from '../../../../src/observe.js';
import type { Recording } from '../../../../src/recorders/observability/recordRun.js';
import {
  assessmentDataOf,
  type AnswerAssessmentData,
} from '../../../../src/core/agent/assessment/compose.js';
import { TOOL_RESULTS } from '../fixtures/sanEvidence.js';

// ─── the law, as a helper ────────────────────────────────────────────

/** The in-run projection with the event's own stamps taken off. */
function inRunOf(payload: Record<string, unknown>): AnswerAssessmentData {
  const { turn: _turn, iteration: _iteration, ...data } = payload;
  void _turn;
  void _iteration;
  return data as unknown as AnswerAssessmentData;
}

interface Leg {
  readonly assessed: Record<string, unknown>[];
  readonly turnEnds: Record<string, unknown>[];
  readonly recording: Recording;
  readonly result: unknown;
}

/** One leg (a run or a resume) with its events and the recording read afterwards. */
async function leg(agent: Agent, drive: () => Promise<unknown>): Promise<Leg> {
  const assessed: Record<string, unknown>[] = [];
  const turnEnds: Record<string, unknown>[] = [];
  const offA = agent.on('agentfootprint.answer.assessed', (e) => {
    assessed.push(e.payload as unknown as Record<string, unknown>);
  });
  const offT = agent.on('agentfootprint.agent.turn_end', (e) => {
    turnEnds.push(e.payload as unknown as Record<string, unknown>);
  });
  const recorder = recordRun(agent);
  const result = await drive();
  const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
  recorder.stop();
  offA();
  offT();
  return { assessed, turnEnds, recording, result };
}

/**
 * ONE witness row of each kind per turn, at most: a row is filed only for the
 * answer that stands — a draft the gate or the schema sends back files none.
 */
function atMostOneWitnessPerTurn(agent: Agent): void {
  const state = agent.getLastSnapshot()?.sharedState as { findingsLedger?: unknown[] } | undefined;
  const ledger = (state?.findingsLedger ?? []) as Record<string, unknown>[];
  for (const kind of ['grounded', 'steps-unfinished']) {
    const turns = ledger.filter((r) => r.kind === kind).map((r) => r.turn);
    expect(new Set(turns).size, `${kind} rows per turn`).toBe(turns.length);
  }
}

/** THE LAW for one leg that ended in an answer: event = turn_end = read-after fold = agent.assessment(). */
async function holdsTheLaw(agent: Agent, l: Leg): Promise<AnswerAssessmentData> {
  expect(l.assessed).toHaveLength(1);
  const inRun = inRunOf(l.assessed[0]!);
  expect(l.turnEnds.at(-1)!.answerAssessment).toEqual(inRun);
  expect(assessmentDataOf(assessAnswer(l.recording))).toEqual(inRun);
  const live = await agent.assessment();
  if (live !== undefined) expect(assessmentDataOf(live)).toEqual(inRun);
  atMostOneWitnessPerTurn(agent);
  return inRun;
}

const tool = (name: string, execute: Tool['execute']): Tool =>
  defineTool({
    name,
    description: `the ${name} tool`,
    inputSchema: { type: 'object', properties: { host: { type: 'string' } } },
    execute: execute as never,
  });

const flogi = (): Tool =>
  defineTool<Record<string, never>, string>({
    name: 'show_flogi',
    description: 'fabric logins for a switch',
    inputSchema: { type: 'object', properties: {} },
    execute: () => JSON.stringify(TOOL_RESULTS.show_flogi),
  });

// ─── SCENARIO — the named paths ──────────────────────────────────────

describe('SCENARIO — the law across a pause and its resume', () => {
  it('a tool’s own question: the paused leg has no answer to assess; the resumed leg holds the law', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c0', name: 'list_ports', args: {} }] },
          { toolCalls: [{ id: 'c1', name: 'act', args: {} }] },
          { content: 'Port 3 was shut; nothing else is down.' },
        ] as never,
      }),
      model: 'mock',
    })
      .tools([
        tool('list_ports', () => []),
        tool('act', () => askHuman({ question: 'Shut port 3 down?' })),
      ])
      .answerLayer()
      .build();
    const first = await leg(agent, () => agent.run({ message: 'which ports are down?' }));
    expect(isPaused(first.result)).toBe(true);
    // No answer yet: the layer never ran — and the read-after fold says `ask`.
    expect(first.assessed).toEqual([]);
    expect(assessAnswer(first.recording).standing).toBe('ask');
    const paused = first.result as { checkpoint: unknown };
    const second = await leg(agent, () => agent.resume(paused.checkpoint as never, 'yes'));
    expect(second.result).toBe('Port 3 was shut; nothing else is down.');
    const inRun = await holdsTheLaw(agent, second);
    expect(inRun.standing).toBe('not-sure');
    expect(inRun.reasons).toEqual(['empty-undeclared']); // c0's [] from before the pause
  });

  it('the inputs layer’s own batch ask: paused, then answered — the resumed leg holds the law', async () => {
    const ran: Record<string, unknown>[] = [];
    const searchLogs = defineTool({
      name: 'search_logs',
      description: 'Error lines for one service over a look-back period.',
      inputSchema: {
        type: 'object',
        required: ['service', 'window'],
        properties: {
          service: { type: 'string' },
          window: { type: 'string', enum: ['1h', '24h', '7d'] },
        },
      },
      askOrAssume: {
        window: { ask: 'Which period should the search cover?', choices: ['1h', '24h', '7d'] },
      },
      execute: async (args) => {
        ran.push({ ...args });
        return [];
      },
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'search_logs', args: { service: 'api' } }] },
          { content: 'No errors for api in the last 24h.' },
        ] as never,
      }),
      model: 'mock',
    })
      .tool(searchLogs)
      .answerLayer()
      .build();
    const first = await leg(agent, () => agent.run({ message: 'any errors on api?' }));
    expect(isPaused(first.result)).toBe(true);
    expect(first.assessed).toEqual([]);
    expect(assessAnswer(first.recording).standing).toBe('ask');
    const paused = first.result as {
      checkpoint: unknown;
      awaitingInput: { requestId: string; fields: readonly { id: string }[] };
    };
    const field = paused.awaitingInput.fields[0]!.id;
    const second = await leg(agent, () =>
      agent.resume(paused.checkpoint as never, {
        requestId: paused.awaitingInput.requestId,
        values: { [field]: '24h' },
      }),
    );
    expect(ran).toEqual([{ service: 'api', window: '24h' }]);
    await holdsTheLaw(agent, second);
  });
});

describe('SCENARIO — the law across a continued conversation', () => {
  it('three turns, each assessed on its own record — earlier turns never leak in', async () => {
    let n = 0;
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'a1', name: 'list_ports', args: {} }] },
          { content: 'none are down' },
          { toolCalls: [{ id: 'b1', name: 'list_ports', args: {} }] },
          { content: 'port 3 is down' },
          { content: 'as I said, port 3' },
        ] as never,
      }),
      model: 'mock',
    })
      .tool(tool('list_ports', () => (n++ === 0 ? [] : [{ port: 3, state: 'down' }])))
      .answerLayer()
      .build();
    const t1 = await leg(agent, () => agent.run({ message: 'which ports are down?' }));
    const s1 = await holdsTheLaw(agent, t1);
    expect(s1.standing).toBe('not-sure');
    expect(t1.assessed[0]!.turn).toBe(1);
    const t2 = await leg(agent, () =>
      agent.run({ message: 'and now?', continueFrom: agent.checkpoint()! }),
    );
    const s2 = await holdsTheLaw(agent, t2);
    expect(s2.standing).toBe('consistent');
    expect(t2.assessed[0]!.turn).toBe(2);
    const t3 = await leg(agent, () =>
      agent.run({ message: 'sure?', continueFrom: agent.checkpoint()! }),
    );
    const s3 = await holdsTheLaw(agent, t3);
    expect(t3.assessed[0]!.turn).toBe(3);
    // Turn 3 called no tool: nothing on ITS record could be checked.
    expect(s3.standing).toBe('not-assessed');
  });
});

describe('SCENARIO — the law on a typed answer re-asked for its schema', () => {
  it('the retry is one more ordinary turn; the answer that stands is assessed once', async () => {
    const parser = {
      parse: (v: unknown) => {
        const o = v as { hosts?: unknown };
        if (!Array.isArray(o.hosts)) throw new Error('hosts must be an array');
        return o as { hosts: string[] };
      },
      toJsonSchema: () => ({ type: 'object', properties: { hosts: { type: 'array' } } }),
    };
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'find_vm', args: {} }] },
          { content: '{"hosts":"none"}' },
          { content: '{"hosts":[]}' },
        ] as never,
      }),
      model: 'mock',
    })
      .tool(tool('find_vm', () => coverage([], { checked: ['the VM inventory'] })))
      .outputSchema(parser as never, { retries: 1 })
      .answerLayer()
      .build();
    const l = await leg(agent, () => agent.run({ message: 'which hosts?' }));
    expect(l.result).toBe('{"hosts":[]}');
    const s = await holdsTheLaw(agent, l);
    expect(s.reasons).toEqual(['declared-absent']);
    expect(agent.parseOutput(l.result as string)).toEqual({ hosts: [] });
  });
});

describe('SCENARIO — the law across the evidence gate’s one revision', () => {
  it('a fabricated draft is sent back; the grounded revision is the one assessed', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 't1', name: 'show_flogi', args: {} }] },
          { content: 'The affected array port is SHPMAXDLVAP001-FA0 with FCID 0xef0101.' },
          { content: 'fc1/5 is logged in with FCID 0x650400.' },
        ] as never,
      }),
      model: 'mock',
    })
      .tool(flogi())
      .namesAndNumbersFromEvidence({ posture: 'guard' })
      .answerLayer()
      .build();
    const l = await leg(agent, () => agent.run({ message: 'which ports are logged in?' }));
    const s = await holdsTheLaw(agent, l);
    expect(s.standing).toBe('consistent');
  });

  it('a revision that still fabricates: flagged, and the law holds on the flag', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 't1', name: 'show_flogi', args: {} }] },
          { content: 'The affected array port is SHPMAXDLVAP001-FA0.' },
          { content: 'It is SHPMAXDLVAP001-FA0, I am sure.' },
        ] as never,
      }),
      model: 'mock',
    })
      .tool(flogi())
      .namesAndNumbersFromEvidence({ posture: 'guard' })
      .answerLayer()
      .build();
    const l = await leg(agent, () => agent.run({ message: 'which port?' }));
    const s = await holdsTheLaw(agent, l);
    expect(s.reasons).toEqual(['value-survived-revision']);
  });
});

describe('SCENARIO — the law when a limit cut the turn short', () => {
  const looping = (wrapUp: boolean) =>
    Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'list_ports', args: {} }] },
          { toolCalls: [{ id: 'c2', name: 'list_ports', args: {} }] },
          { content: 'I checked twice and ran out of steps.' },
        ] as never,
      }),
      model: 'mock',
      maxIterations: 2,
      ...(!wrapUp && { wrapUpAtMaxIterations: false }),
    })
      .tool(tool('list_ports', () => [{ port: 1 }]))
      .answerLayer()
      .build();

  it('wrapped up: stopped early, and the law holds', async () => {
    const agent = looping(true);
    const l = await leg(agent, () => agent.run({ message: 'check the ports' }));
    const s = await holdsTheLaw(agent, l);
    expect(s.reasons).toContain('stopped-early');
  });

  it('cut short (no wrap-up): stopped early, and the law holds', async () => {
    const agent = looping(false);
    const l = await leg(agent, () => agent.run({ message: 'check the ports' }));
    const s = await holdsTheLaw(agent, l);
    expect(s.reasons).toContain('stopped-early');
  });

  // The Route decider records a cut-short turn on EVERY agent — the model asked
  // for calls and a limit refused to run them, whether or not a tool could have
  // answered. An agent with no tool surface once left `stoppedEarly` out of the
  // layer's reads, so the run said "not assessed" and the recording "not sure".
  it.each([
    ['empty answer', ''],
    ['answer beside the call', 'partial answer'],
  ])(
    'no tools at all, a call asked for at the limit (%s): stopped early, and the law holds',
    async (_, content) => {
      const agent = Agent.create({
        provider: mock({
          replies: [
            { content, toolCalls: [{ id: 'g1', name: 'ghost', args: {} }] },
            { content: 'done' },
          ] as never,
        }),
        model: 'mock',
        maxIterations: 1,
      })
        .answerLayer()
        .build();
      const l = await leg(agent, () => agent.run({ message: 'hello' }));
      expect(l.result).toBe(content);
      const stopped = (agent.getLastSnapshot()?.sharedState as { stoppedEarly?: unknown })
        .stoppedEarly;
      expect(stopped).toMatchObject({ reason: 'max-iterations', pendingToolCalls: 1 });
      const s = await holdsTheLaw(agent, l);
      expect(s).toMatchObject({ standing: 'not-sure', reasons: ['stopped-early'] });
    },
  );
});

describe('SCENARIO — the law with a before-tool rewrite of a ruled argument', () => {
  // The rewrite is what the call RAN with, so it supersedes the inputs layer's
  // row — the in-run fold must read `middlewareDecisions` exactly as the
  // read-after fold does, and the line names a rewrite with no declared origin.
  const searchLogs = defineTool({
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
  const rewrite = (from?: { window: 'person' }): ToolMiddleware => ({
    name: 'absolute-window',
    onToolCall: (c) =>
      c.toolName === 'search_logs'
        ? from === undefined
          ? allow({ ...c.args, window: '24h' }, 'window from the receipt')
          : allow({ ...c.args, window: '24h' }, 'window from the receipt', { from })
        : allow(),
  });

  it.each([
    [
      'no declared origin: assumed, and the line names the rewrite',
      undefined,
      ['argument-assumed'],
    ],
    [
      "declared the person's: the rewrite supersedes the model's value",
      { window: 'person' } as const,
      [],
    ],
  ])('%s', async (_, from, reasons) => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'search_logs', args: { service: 'a', window: '1h' } }] },
          { content: 'No errors on a.' },
        ] as never,
      }),
      model: 'mock',
    })
      .tool(searchLogs)
      .toolMiddleware(rewrite(from))
      .answerLayer({ standingLine: true })
      .build();
    const l = await leg(agent, () => agent.run({ message: 'errors on a?' }));
    const s = await holdsTheLaw(agent, l);
    expect(s.reasons).toEqual(reasons);
    const account = accountForAnswer(l.recording);
    expect(`${account.answer.value}\n\n---\n\n${account.facts.limitsBlock.value}`).toBe(l.result);
    if (from === undefined) {
      expect(l.result).toContain(
        'a before-tool rule set a value a call ran with and did not say where it came from',
      );
    }
  });
});

describe('SCENARIO — the law on an agent mounted in a composition', () => {
  it('a Sequence step: its standing reaches the composition on turn_end, equal to the fold of its own state', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'find_vm', args: {} }] },
          { content: 'No VMs on host-9.' },
        ] as never,
      }),
      model: 'mock',
    })
      .tool(tool('find_vm', () => []))
      .answerLayer()
      .build();
    const seq = Sequence.create().step('triage', agent).build();
    const turnEnds: Record<string, unknown>[] = [];
    seq.on('agentfootprint.agent.turn_end', (e) => {
      turnEnds.push(e.payload as unknown as Record<string, unknown>);
    });
    const out = await seq.run({ message: 'what runs on host-9?' });
    expect(out).toBe('No VMs on host-9.');
    const inRun = turnEnds.at(-1)!.answerAssessment as AnswerAssessmentData;
    expect(inRun).toBeDefined();
    // The agent's own committed state, where the composition keeps it: its mount's subflow result.
    const snap = seq.getLastSnapshot() as unknown as {
      subflowResults?:
        | Map<string, { treeContext?: { globalContext?: unknown } }>
        | Record<string, { treeContext?: { globalContext?: unknown } }>;
    };
    const results = snap.subflowResults;
    const entry = results instanceof Map ? results.get('step-triage') : results?.['step-triage'];
    const sharedState = entry?.treeContext?.globalContext;
    expect(sharedState).toBeDefined();
    const after = assessmentDataOf(assessAnswer({ snapshot: { sharedState } }));
    expect(after).toEqual(inRun);
    expect(inRun).toMatchObject({ standing: 'not-sure', reasons: ['empty-undeclared'] });
  });
});

// ─── PROPERTY — the law over generated configurations ────────────────

/** mulberry32 — a tiny seeded PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type ResultShape = 'empty' | 'rows' | 'absent' | 'coverage-gap' | 'text';

const RESULTS: Readonly<Record<ResultShape, () => unknown>> = {
  empty: () => [],
  rows: () => [{ port: 3, state: 'down' }],
  absent: () => ({
    af_absent: true,
    what: 'ports on switch A',
    checked: ['the port table'],
    not_checked: ['disabled ports'],
  }),
  'coverage-gap': () => coverage([{ port: 3 }], { checked: ['A'], notChecked: ['B'] }),
  text: () => 'port 3 is down',
};

interface Config {
  /** Both chart builders: `dynamic` builds the flat chart, `dynamic-grouped` the grouped one. */
  readonly reactMode: 'dynamic' | 'dynamic-grouped';
  readonly shape: ResultShape;
  readonly calls: number;
  readonly gate?: 'assist' | 'guard' | 'rails';
  readonly assume: boolean;
  readonly limits: boolean;
  readonly line: boolean;
  readonly tight: boolean;
  readonly findings: boolean;
  readonly answer: string;
  /**
   * No tool registered at all — the model still asks for one (the mock's
   * script), so the call is refused as unknown, or a limit cuts the turn
   * short before it runs. Drawn LAST, so every other field of a seed is the
   * one it always drew.
   */
  readonly noTools: boolean;
}

function configOf(seed: number): Config {
  const r = prng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  return {
    reactMode: pick(['dynamic', 'dynamic-grouped'] as const),
    shape: pick(['empty', 'rows', 'absent', 'coverage-gap', 'text'] as const),
    calls: 1 + Math.floor(r() * 3),
    ...(r() < 0.5 && { gate: pick(['assist', 'guard'] as const) }),
    assume: r() < 0.4,
    limits: r() < 0.4,
    line: r() < 0.4,
    tight: r() < 0.25,
    findings: r() < 0.25,
    answer: pick(['Port 3 is down.', 'Nothing is down.', 'I could not tell.', 'Port 9 is down.']),
    noTools: r() < 0.15,
  };
}

function agentOf(c: Config): Agent {
  const replies = [
    ...Array.from({ length: c.calls }, (_, i) => ({
      toolCalls: [
        {
          id: `c${i}`,
          name: c.assume ? 'search_ports' : 'list_ports',
          args: c.assume ? { switch: 'A' } : {},
        },
      ],
    })),
    { content: c.answer },
    { content: c.answer },
    { content: c.answer },
  ];
  const listPorts = c.assume
    ? defineTool({
        name: 'search_ports',
        description: 'ports of one switch over a look-back period',
        inputSchema: {
          type: 'object',
          required: ['switch', 'window'],
          properties: {
            switch: { type: 'string' },
            window: { type: 'string', enum: ['1h', '24h'] },
          },
        },
        askOrAssume: { window: { assume: '24h' } },
        execute: RESULTS[c.shape] as never,
      })
    : tool('list_ports', RESULTS[c.shape] as never);
  let b = Agent.create({
    provider: mock({ replies: replies as never }),
    model: 'mock',
    reactMode: c.reactMode,
    ...(c.tight && { maxIterations: 1 }),
  });
  if (!c.noTools) b = b.tool(listPorts);
  if (c.gate !== undefined) b = b.namesAndNumbersFromEvidence({ posture: c.gate });
  if (c.limits) b = b.limitsTravelWithTheAnswer();
  if (c.findings) b = b.findings();
  return b.answerLayer(c.line ? { standingLine: true } : undefined).build();
}

describe('PROPERTY — the in-run standing equals the read-after fold, over 40 generated configurations', () => {
  /** Every generated case's standing and reasons — the generator must not collapse to one shape. */
  const seen: AnswerAssessmentData[] = [];

  it.each(Array.from({ length: 40 }, (_, i) => i + 1))('seed %i', async (seed) => {
    const config = configOf(seed);
    const agent = agentOf(config);
    const l = await leg(agent, () => agent.run({ message: 'which ports on switch A are down?' }));
    seen.push(await holdsTheLaw(agent, l));
    // A line arm on a prose answer: the answer carries exactly one standing line.
    if (config.line && typeof l.result === 'string') {
      const section = l.result.split('\n\n---\n\n').at(-1)!;
      expect(section).toMatch(
        /^(Known|Consistent with the run's record|Not sure|Ask|Not assessed) — /,
      );
      // …and the answer account finds exactly what the run appended — the line
      // by its own words, rebuilt from the record — never less, never more.
      const account = accountForAnswer(l.recording);
      const model = account.answer.value ?? '';
      const appended = account.facts.limitsBlock.value;
      expect(appended).not.toBeNull();
      expect(model === '' ? appended : `${model}\n\n---\n\n${appended}`).toBe(l.result);
    }
  });

  it('the generated cases are not one shape: several standings and many reasons were held to the law', () => {
    expect(seen).toHaveLength(40);
    const configs = Array.from({ length: 40 }, (_, i) => configOf(i + 1));
    expect(new Set(configs.map((c) => c.reactMode)).size).toBe(2);
    // An agent with no tool surface is generated, and one of them is cut short
    // at the limit — the path whose `stoppedEarly` the layer once never read.
    expect(configs.some((c) => c.noTools && c.tight)).toBe(true);
    expect(configs.some((c) => c.noTools && !c.tight)).toBe(true);
    expect(new Set(seen.map((s) => s.standing)).size).toBeGreaterThanOrEqual(2);
    const reasons = new Set(seen.flatMap((s) => s.reasons));
    for (const r of [
      'empty-undeclared',
      'declared-absent',
      'coverage-gap',
      'argument-assumed',
      'stopped-early',
    ]) {
      expect(reasons.has(r as never), r).toBe(true);
    }
  });
});
