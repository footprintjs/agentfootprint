/**
 * A step is done only when its tool says so — through the REAL Agent loop.
 *
 * A finished call has one of four outcomes for the procedure step it ran
 * (`routing/stepOutcome.ts` · `stepOutcomeOf`):
 *
 *   - `succeeded`    — the tool declared `success` (or `absent`): the step
 *                      advances and the model reads "Step k of n done." as before;
 *   - `failed`       — the tool declared `failure`, `denied` or `invalid`: the
 *                      step holds, the next step's tool is not offered, the
 *                      model reads that the step was not completed and what
 *                      its tool reported, and `skill.step_held` records it;
 *   - `not-finished` — the tool declared `pending` or `partial`: held the same way;
 *   - `not-reported` — the tool declared nothing: the step advances, and both
 *                      the model's sentence and `step_advanced.outcome` say so.
 *
 * The same rule runs at every door a step can advance through: the batch
 * loop and the plain, check-in, ask and credential resumes. One test per door.
 */

import { describe, it, expect } from 'vitest';
import {
  Agent,
  allow,
  ask,
  checkInApproved,
  defineTool,
  isAskPause,
  isPaused,
} from '../../../src/index.js';
import { defineSkill, pointerOf, skillGraph } from '../../../src/injection-engine.js';
import { mock } from '../../../src/llm-providers.js';
import { bearer, type CredentialProvider } from '../../../src/identity.js';
import type { ToolResultStatus } from '../../../src/semantics/toolOutcome.js';
import { pausedRequest } from '../../helpers/pausedRequest.js';

// ── Toolkit ──────────────────────────────────────────────────────────────

/** A marker the failed tool's content carries — the model must still read it. */
const UPSTREAM = 'lookup could not run: upstream down';

const envelope = (status: ToolResultStatus, content = UPSTREAM) => ({
  content,
  effects: [],
  status,
});

const statusTool = (name: string, result: unknown, extra: Record<string, unknown> = {}) =>
  defineTool<Record<string, never>, unknown>({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: () => result,
    ...extra,
  } as never);

const plainTool = (name: string) => statusTool(name, `${name} ran`);

const refund = (lookup: unknown, charge: unknown = plainTool('charge')) =>
  defineSkill({
    id: 'refund',
    description: 'refund handling',
    body: 'Handle refunds carefully.',
    tools: [lookup, charge] as never,
    steps: [
      { tool: 'lookup', note: 'find the order first' },
      { tool: 'charge', note: 'refund the charge' },
    ],
  });

const call = (name: string, id: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});
const final = (content: string) => ({ content, toolCalls: [], stopReason: 'stop' as const });

type Payload = Record<string, unknown>;
const capture = () => {
  const advanced: Payload[] = [];
  const held: Payload[] = [];
  const unfinished: Payload[] = [];
  const llmStarts: Payload[] = [];
  const all: Array<{ name: string; payload: Payload }> = [];
  const recorder = {
    id: 'capture-step-outcome',
    onEmit: (e: { name: string; payload?: Payload }) => {
      const p = e.payload ?? {};
      all.push({ name: e.name, payload: p });
      if (e.name === 'agentfootprint.skill.step_advanced') advanced.push(p);
      if (e.name === 'agentfootprint.skill.step_held') held.push(p);
      if (e.name === 'agentfootprint.skill.steps_unfinished') unfinished.push(p);
      if (e.name === 'agentfootprint.stream.llm_start') llmStarts.push(p);
    },
  };
  return { advanced, held, unfinished, llmStarts, all, recorder };
};

const build = (
  replies: readonly unknown[],
  setup: {
    skill?: unknown;
    graph?: unknown;
    maxIterations?: number;
    credentials?: CredentialProvider;
    middleware?: Parameters<ReturnType<typeof Agent.create>['toolMiddleware']>[0];
  },
) => {
  const caps = capture();
  let builder = Agent.create({
    provider: mock({ replies: replies as never }),
    model: 'mock',
    maxIterations: setup.maxIterations ?? 8,
    ...(setup.credentials && { credentials: setup.credentials }),
  } as never).system('You are support.');
  if (setup.skill) builder = builder.injection(setup.skill as never);
  if (setup.graph) builder = builder.skillGraph(setup.graph as never);
  if (setup.middleware) builder = builder.toolMiddleware(setup.middleware);
  const agent = builder.watch(caps.recorder).build();
  return { agent, ...caps };
};

const historyOf = (agent: Agent): ReadonlyArray<{ content: string; toolName?: string }> =>
  (
    agent.getLastSnapshot()?.sharedState as {
      history: Array<{ content: string; toolName?: string }>;
    }
  ).history;

const toolMessage = (agent: Agent, toolCallId: string): string =>
  (historyOf(agent) as ReadonlyArray<{ content: string; toolCallId?: string }>).find(
    (m) => m.toolCallId === toolCallId,
  )?.content ?? '';

const pointer = (agent: Agent) =>
  pointerOf((agent.getLastSnapshot()?.sharedState as { stepPointer?: unknown }).stepPointer);

const offered = (llmStart: Payload): string[] =>
  ((llmStart.tools ?? []) as ReadonlyArray<{ name: string }>).map((t) => t.name);

const HELD_FAILED =
  " Step 1 of 2 was not completed: its tool reported 'failure'. The procedure stayed on " +
  'step 1 (tool: `lookup`).';

// ─────────────────────────────────────────────────────────────────────────
// The batch loop — every status word the library has
// ─────────────────────────────────────────────────────────────────────────

describe('the batch loop: a declared failure holds the step', () => {
  it("'failure': pointer stays, the next tool is not offered, fixed words, step_held — never 'done'", async () => {
    const { agent, advanced, held, llmStarts, all } = build(
      [
        call('read_skill', 't1', { id: 'refund' }),
        call('lookup', 't2'),
        final('the lookup failed; stopping'),
        final('the lookup failed; stopping'),
      ],
      { skill: refund(statusTool('lookup', envelope('failure'))) },
    );
    await agent.run({ message: 'refund order 42' });

    expect(pointer(agent)).toMatchObject({ skillId: 'refund', step: 1, total: 2 });
    expect(advanced).toHaveLength(0);
    expect(held).toEqual([
      {
        skillId: 'refund',
        step: { index: 1, total: 2, tool: 'lookup', note: 'find the order first' },
        outcome: 'failed',
        status: 'failure',
        iteration: expect.any(Number),
        toolCallId: 't2',
      },
    ]);
    // The model read the tool's own words, then the library's fixed sentence.
    const msg = toolMessage(agent, 't2');
    expect(msg).toBe(UPSTREAM + HELD_FAILED);
    expect(msg).not.toContain('done');
    // The call after the hold still offers the step's tool, never the next one.
    const afterHold = offered(llmStarts[2]!);
    expect(afterHold).toContain('lookup');
    expect(afterHold).toContain('skip_step');
    expect(afterHold).not.toContain('charge');
    // Nothing anywhere says this step was done.
    expect(JSON.stringify(all)).not.toContain('Step 1 of 2 done');
  });

  it.each([
    ['denied', 'failed'],
    ['invalid', 'failed'],
    ['pending', 'not-finished'],
    ['partial', 'not-finished'],
  ] as const)("'%s' holds the step as %s", async (status, outcome) => {
    const { agent, advanced, held } = build(
      [call('read_skill', 't1', { id: 'refund' }), call('lookup', 't2'), final('x'), final('x')],
      { skill: refund(statusTool('lookup', envelope(status))) },
    );
    await agent.run({ message: 'refund' });
    expect(advanced).toHaveLength(0);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ outcome, status, toolCallId: 't2' });
    expect(pointer(agent)).toMatchObject({ step: 1 });
    const words =
      outcome === 'failed'
        ? ` Step 1 of 2 was not completed: its tool reported '${status}'. The procedure ` +
          'stayed on step 1 (tool: `lookup`).'
        : ` Step 1 of 2 was not completed: its tool reported '${status}', so its work was ` +
          'not finished. The procedure stayed on step 1 (tool: `lookup`).';
    expect(toolMessage(agent, 't2')).toBe(UPSTREAM + words);
  });

  it("'success' advances exactly as before, with outcome 'succeeded'", async () => {
    const { agent, advanced, held } = build(
      [
        call('read_skill', 't1', { id: 'refund' }),
        call('lookup', 't2'),
        call('charge', 't3'),
        final('refunded'),
      ],
      {
        skill: refund(
          statusTool('lookup', envelope('success', 'order 42')),
          statusTool('charge', envelope('success', 'charged')),
        ),
      },
    );
    await agent.run({ message: 'refund' });
    expect(held).toHaveLength(0);
    expect(advanced.map((a) => [a.toolCallId, a.outcome])).toEqual([
      ['t2', 'succeeded'],
      ['t3', 'succeeded'],
    ]);
    expect(toolMessage(agent, 't2')).toBe(
      'order 42 Step 1 of 2 done. Now on step 2 of 2: refund the charge (tool: `charge`).',
    );
    expect(toolMessage(agent, 't3')).toBe('charged Step 2 of 2 done. All 2 steps complete.');
  });

  it("'absent' (nothing found, declared) is a finished look: it advances as 'succeeded'", async () => {
    const { agent, advanced, held } = build(
      [call('read_skill', 't1', { id: 'refund' }), call('lookup', 't2'), final('x'), final('x')],
      { skill: refund(statusTool('lookup', envelope('absent', 'no order 42'))) },
    );
    await agent.run({ message: 'refund' });
    expect(held).toHaveLength(0);
    expect(advanced).toHaveLength(1);
    expect(advanced[0]).toMatchObject({ toolCallId: 't2', outcome: 'succeeded' });
  });

  it("no declared status: the step advances and it is said — 'not-reported' on the event and in the words", async () => {
    const { agent, advanced, held } = build(
      [
        call('read_skill', 't1', { id: 'refund' }),
        call('lookup', 't2'),
        call('charge', 't3'),
        final('refunded'),
      ],
      { skill: refund(plainTool('lookup')) },
    );
    await agent.run({ message: 'refund' });
    expect(held).toHaveLength(0);
    expect(advanced.map((a) => [a.toolCallId, a.outcome])).toEqual([
      ['t2', 'not-reported'],
      ['t3', 'not-reported'],
    ]);
    expect(toolMessage(agent, 't2')).toBe(
      'lookup ran Step 1 of 2 ran; its tool reported no outcome. Now on step 2 of 2: ' +
        'refund the charge (tool: `charge`).',
    );
    expect(toolMessage(agent, 't3')).toBe(
      'charge ran Step 2 of 2 ran; its tool reported no outcome. It was the last step.',
    );
    expect(pointer(agent)).toMatchObject({ step: 3, total: 2 });
  });

  it('a thrown error still holds silently, as before — no step_held, no sentence', async () => {
    const { agent, advanced, held } = build(
      [call('read_skill', 't1', { id: 'refund' }), call('lookup', 't2'), final('x'), final('x')],
      {
        skill: refund(
          defineTool<Record<string, never>, string>({
            name: 'lookup',
            description: 'lookup tool',
            inputSchema: { type: 'object', properties: {} },
            execute: () => {
              throw new Error('backend down');
            },
          }),
        ),
      },
    );
    await agent.run({ message: 'refund' });
    expect(advanced).toHaveLength(0);
    expect(held).toHaveLength(0);
    expect(toolMessage(agent, 't2')).not.toContain('Step 1 of 2');
  });

  it('after a hold, a retry that succeeds advances', async () => {
    let calls = 0;
    const flaky = defineTool<Record<string, never>, unknown>({
      name: 'lookup',
      description: 'lookup tool',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        calls += 1;
        return calls === 1 ? envelope('failure') : envelope('success', 'order 42');
      },
    });
    const { agent, advanced, held } = build(
      [
        call('read_skill', 't1', { id: 'refund' }),
        call('lookup', 't2'),
        call('lookup', 't3'),
        call('charge', 't4'),
        final('done'),
      ],
      { skill: refund(flaky) },
    );
    await agent.run({ message: 'refund' });
    expect(held.map((h) => h.toolCallId)).toEqual(['t2']);
    expect(advanced.map((a) => [a.toolCallId, a.outcome])).toEqual([
      ['t3', 'succeeded'],
      ['t4', 'not-reported'],
    ]);
  });
});

describe('a skill-graph agent: the same rule', () => {
  it('a declared failure on a graph entry skill holds its step', async () => {
    const skill = refund(statusTool('lookup', envelope('failure')));
    const graph = skillGraph().entry(skill).build();
    const { agent, advanced, held } = build([call('lookup', 't1'), final('x'), final('x')], {
      graph,
    });
    await agent.run({ message: 'refund' });
    expect(advanced).toHaveLength(0);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ outcome: 'failed', status: 'failure', toolCallId: 't1' });
    expect(toolMessage(agent, 't1')).toBe(UPSTREAM + HELD_FAILED);
  });
});

describe('a step whose tool keeps failing ends with the turn', () => {
  it('maxIterations ends the turn: each failure is held and recorded, then the procedure is cut short', async () => {
    const { agent, advanced, held, unfinished } = build(
      [
        call('read_skill', 't1', { id: 'refund' }),
        call('lookup', 't2'),
        call('lookup', 't3'),
        call('lookup', 't4'), // iteration 4 = maxIterations: the loop refuses this call
        // The exhausted turn buys ONE more call with the tools withheld (the
        // wrap-up), so the script needs the answer it asks for.
        final('The lookup kept failing; nothing was refunded.'),
      ],
      { skill: refund(statusTool('lookup', envelope('failure'))), maxIterations: 4 },
    );
    const answer = await agent.run({ message: 'refund' });
    expect(answer).toBe('The lookup kept failing; nothing was refunded.');
    expect(advanced).toHaveLength(0);
    expect(held.map((h) => h.toolCallId)).toEqual(['t2', 't3']);
    expect(unfinished).toHaveLength(1);
    expect(unfinished[0]).toMatchObject({ action: 'cut-short', skillId: 'refund' });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The resume doors — one test per door
// ─────────────────────────────────────────────────────────────────────────

describe('every resume door asks the same rule', () => {
  it("plain door (askHuman): the person's answer declares no status — advances as 'not-reported'", async () => {
    const { askHuman } = await import('../../../src/core/pause.js');
    const lookup = defineTool<Record<string, never>, string>({
      name: 'lookup',
      description: 'ask a person for the order',
      inputSchema: { type: 'object', properties: {} },
      execute: () => askHuman({ question: 'which order?' }),
    });
    const { agent, advanced, held } = build(
      [call('read_skill', 't1', { id: 'refund' }), call('lookup', 't2'), final('x'), final('x')],
      { skill: refund(lookup) },
    );
    const paused = await agent.run({ message: 'refund' });
    expect(isPaused(paused)).toBe(true);
    await agent.resume((paused as { checkpoint: never }).checkpoint, 'order 42');
    expect(held).toHaveLength(0);
    expect(advanced).toHaveLength(1);
    expect(advanced[0]).toMatchObject({ toolCallId: 't2', outcome: 'not-reported' });
    expect(toolMessage(agent, 't2')).toBe(
      'order 42 Step 1 of 2 ran; its tool reported no outcome. Now on step 2 of 2: ' +
        'refund the charge (tool: `charge`).',
    );
  });

  it('check-in door: an approved call whose tool declares failure holds the step', async () => {
    const lookup = statusTool('lookup', envelope('failure'), { checkIn: 'always' });
    const { agent, advanced, held } = build(
      [call('read_skill', 't1', { id: 'refund' }), call('lookup', 't2'), final('x'), final('x')],
      { skill: refund(lookup) },
    );
    const paused = await agent.run({ message: 'refund' });
    expect(isPaused(paused)).toBe(true);
    await agent.resume(
      (paused as { checkpoint: never }).checkpoint,
      checkInApproved({ request: pausedRequest(paused), by: 'ops' }),
    );
    expect(advanced).toHaveLength(0);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ outcome: 'failed', status: 'failure', toolCallId: 't2' });
    expect(toolMessage(agent, 't2')).toBe(UPSTREAM + HELD_FAILED);
    expect(pointer(agent)).toMatchObject({ step: 1 });
  });

  it('ask door: a middleware-approved call whose tool declares pending holds the step as not finished', async () => {
    const { agent, advanced, held } = build(
      [call('read_skill', 't1', { id: 'refund' }), call('lookup', 't2'), final('x'), final('x')],
      {
        skill: refund(statusTool('lookup', envelope('pending'))),
        middleware: {
          name: 'approve-lookup',
          onToolCall: (c) => (c.toolName === 'lookup' ? ask({ question: 'look it up?' }) : allow()),
        },
      },
    );
    const paused = await agent.run({ message: 'refund' });
    expect(isAskPause(paused)).toBe(true);
    await agent.resume(
      (paused as { checkpoint: never }).checkpoint,
      checkInApproved({ request: pausedRequest(paused), by: 'ops' }),
    );
    expect(advanced).toHaveLength(0);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ outcome: 'not-finished', status: 'pending', toolCallId: 't2' });
    expect(toolMessage(agent, 't2')).toContain(
      "Step 1 of 2 was not completed: its tool reported 'pending', so its work was not finished.",
    );
  });

  it('credential door: a call resumed after consent whose tool declares failure holds the step', async () => {
    const state = { granted: false };
    const vault: CredentialProvider = {
      id: 'test-3lo',
      getCredential: () =>
        Promise.resolve(
          state.granted
            ? { status: 'issued', credential: bearer('tok') }
            : {
                status: 'authorization-required',
                authorizationUrl: 'https://idp.example.test/authorize',
                sessionId: 'sess',
              },
        ),
    };
    const lookup = statusTool('lookup', envelope('failure'), {
      needs: { credential: 'billing', mode: 'user', scopes: ['orders.read'] },
    });
    const { agent, advanced, held } = build(
      [call('read_skill', 't1', { id: 'refund' }), call('lookup', 't2'), final('x'), final('x')],
      { skill: refund(lookup), credentials: vault },
    );
    const paused = await agent.run({ message: 'refund' });
    expect(isPaused(paused)).toBe(true);
    state.granted = true;
    await agent.resume((paused as { checkpoint: never }).checkpoint, undefined as never);
    expect(advanced).toHaveLength(0);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ outcome: 'failed', status: 'failure', toolCallId: 't2' });
    expect(toolMessage(agent, 't2')).toBe(UPSTREAM + HELD_FAILED);
  });

  it('check-in door: an approved call whose tool declares success advances as before', async () => {
    const lookup = statusTool('lookup', envelope('success', 'order 42'), { checkIn: 'always' });
    const { agent, advanced, held } = build(
      [call('read_skill', 't1', { id: 'refund' }), call('lookup', 't2'), final('x'), final('x')],
      { skill: refund(lookup) },
    );
    const paused = await agent.run({ message: 'refund' });
    await agent.resume(
      (paused as { checkpoint: never }).checkpoint,
      checkInApproved({ request: pausedRequest(paused), by: 'ops' }),
    );
    expect(held).toHaveLength(0);
    expect(advanced).toHaveLength(1);
    expect(advanced[0]).toMatchObject({ toolCallId: 't2', outcome: 'succeeded' });
    expect(toolMessage(agent, 't2')).toBe(
      'order 42 Step 1 of 2 done. Now on step 2 of 2: refund the charge (tool: `charge`).',
    );
  });
});
