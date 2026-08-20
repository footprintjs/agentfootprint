/**
 * Steps-as-data through the REAL Agent loop (9.18.0): per-step offer
 * narrowing with intact escape hatches, the banner, skip_step (advance /
 * hold / teaching), advance at every result boundary — the batch loop AND
 * the pausable resume path (an askHuman step advances on resume) — the
 * tenure re-key on cursor moves, the one-per-turn nudge truth table, and
 * the zero-delta guards that pin "no steps = byte-identical".
 *
 * Sections follow Convention 3: Functional (offer + advance) · Integration
 * (skip, re-key, pause/resume, nudge) · Security/containment (ownership,
 * escape hatches) · Regression (zero-delta, checkup refusals).
 */

import { describe, it, expect, vi } from 'vitest';
import { Agent, defineTool, isPaused } from '../../../src/index.js';
import {
  defineSkill,
  defineStepsHint,
  skillGraph,
  decideSkill,
  pointerOf,
} from '../../../src/injection-engine.js';
import { mock } from '../../../src/llm-providers.js';
import type { Injection } from '../../../src/lib/injection-engine/types.js';
import type { PermissionChecker } from '../../../src/adapters/types.js';

// ── Toolkit ──────────────────────────────────────────────────────────────

const tool = (name: string, result = `${name} ran`) =>
  defineTool<Record<string, never>, string>({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: () => result,
  });

/** The canonical 3-step refund procedure. */
const refundSkill = (over: Partial<Parameters<typeof defineSkill>[0]> = {}) =>
  defineSkill({
    id: 'refund',
    description: 'refund handling',
    body: 'Handle refunds carefully.',
    tools: [tool('lookup'), tool('charge'), tool('export')] as never,
    steps: [
      { tool: 'lookup', note: 'find the order first' },
      { tool: 'charge', note: 'refund the charge' },
      { tool: 'export', note: 'file the receipt' },
    ],
    ...over,
  });

const notesSkill = (tools: unknown[] = [tool('take_note')]) =>
  defineSkill({
    id: 'notes',
    description: 'note keeping',
    body: 'Keep notes.',
    tools: tools as never,
  });

type Ev = { name: string; payload: Record<string, unknown> };

/** Capture the typed emits the steps machinery writes. */
const capture = () => {
  const llmStarts: Array<Record<string, unknown>> = [];
  const advanced: Array<Record<string, unknown>> = [];
  const skipped: Array<Record<string, unknown>> = [];
  const unfinished: Array<Record<string, unknown>> = [];
  const routed: Array<Record<string, unknown>> = [];
  const evaluated: Array<Record<string, unknown>> = [];
  const all: Ev[] = [];
  const recorder = {
    id: 'capture-steps',
    onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
      all.push({ name: e.name, payload: e.payload ?? {} });
      if (e.name === 'agentfootprint.stream.llm_start') llmStarts.push(e.payload ?? {});
      if (e.name === 'agentfootprint.skill.step_advanced') advanced.push(e.payload ?? {});
      if (e.name === 'agentfootprint.skill.step_skipped') skipped.push(e.payload ?? {});
      if (e.name === 'agentfootprint.skill.steps_unfinished') unfinished.push(e.payload ?? {});
      if (e.name === 'agentfootprint.agent.route_decided') routed.push(e.payload ?? {});
      if (e.name === 'agentfootprint.context.evaluated') evaluated.push(e.payload ?? {});
    },
  };
  return { llmStarts, advanced, skipped, unfinished, routed, evaluated, all, recorder };
};

const toolNames = (llmStart: Record<string, unknown>): string[] =>
  ((llmStart.tools ?? []) as ReadonlyArray<{ name: string }>).map((t) => t.name);

const toolDesc = (llmStart: Record<string, unknown>, name: string): string =>
  ((llmStart.tools ?? []) as ReadonlyArray<{ name: string; description?: string }>).find(
    (t) => t.name === name,
  )?.description ?? '';

const call = (name: string, id: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});

const batch = (calls: Array<{ name: string; id: string; args?: Record<string, unknown> }>) => ({
  content: '',
  toolCalls: calls.map((c) => ({ id: c.id, name: c.name, args: c.args ?? {} })),
  stopReason: 'tool_use' as const,
});

const buildAgent = (
  replies: readonly unknown[],
  injections: readonly Injection[],
  opts: {
    maxIterations?: number;
    reactMode?: 'dynamic' | 'dynamic-grouped' | 'classic';
    tools?: unknown[];
    permissionChecker?: PermissionChecker;
  } = {},
) => {
  const caps = capture();
  let builder = Agent.create({
    provider: mock({ replies: replies as never }),
    model: 'mock',
    maxIterations: opts.maxIterations ?? 8,
    ...(opts.reactMode && { reactMode: opts.reactMode }),
    ...(opts.permissionChecker && { permissionChecker: opts.permissionChecker }),
  }).system('You are support.');
  for (const t of opts.tools ?? []) builder = builder.tool(t as never);
  for (const inj of injections) builder = builder.injection(inj);
  const agent = builder.watch(caps.recorder).build();
  return { agent, ...caps };
};

const historyOf = (
  agent: Agent,
): ReadonlyArray<{ role: string; content: string; toolName?: string }> =>
  (
    agent.getLastSnapshot()?.sharedState as {
      history: Array<{ role: string; content: string; toolName?: string }>;
    }
  ).history;

const stepPointerOf = (agent: Agent) =>
  pointerOf((agent.getLastSnapshot()?.sharedState as { stepPointer?: unknown }).stepPointer);

// ─────────────────────────────────────────────────────────────────────────
// Functional — the offer is the enforcement
// ─────────────────────────────────────────────────────────────────────────

describe('functional: per-step offer narrowing', () => {
  const runNarrowingAgent = async (reactMode?: 'dynamic-grouped') => {
    const { agent, llmStarts, evaluated } = buildAgent(
      [call('read_skill', 't1', { id: 'refund' }), { content: 'done for now', toolCalls: [] }],
      [refundSkill(), notesSkill()],
      { tools: [tool('calc')], ...(reactMode && { reactMode }) },
    );
    // The premature stop gets nudged once (steps unfinished), so the run
    // needs one more scripted final for the accepted stop.
    return { agent, llmStarts, evaluated };
  };

  it('before any tenure: the full offer, no skip_step, no banner', async () => {
    const { agent, llmStarts } = await runNarrowingAgent();
    await agent.run({ message: 'refund order 42' }).catch(() => undefined);
    const names = toolNames(llmStarts[0]!);
    expect(names).toEqual(
      expect.arrayContaining(['lookup', 'charge', 'export', 'take_note', 'calc', 'read_skill']),
    );
    expect(names).not.toContain('skip_step');
    expect(toolDesc(llmStarts[0]!, 'lookup')).not.toContain('[Step');
  });

  it('the tenure iteration narrows to the current step + skip_step, escape hatches intact — and the banner leads', async () => {
    const { agent, llmStarts } = buildAgent(
      [
        call('read_skill', 't1', { id: 'refund' }),
        { content: 'stopping here', toolCalls: [] },
        { content: 'still stopping', toolCalls: [] },
      ],
      [refundSkill(), notesSkill()],
      { tools: [tool('calc')] },
    );
    await agent.run({ message: 'refund order 42' });
    const offer = toolNames(llmStarts[1]!);
    // The current step's tool + the integrity tool…
    expect(offer).toContain('lookup');
    expect(offer).toContain('skip_step');
    // …future step tools are NOT in the request (unoffered = uncallable)…
    expect(offer).not.toContain('charge');
    expect(offer).not.toContain('export');
    // …and every escape hatch stays: read_skill, the other skill's tools,
    // the baseline registry.
    expect(offer).toEqual(expect.arrayContaining(['read_skill', 'take_note', 'calc']));
    // The banner leads the current step's description; skip_step names the policy.
    expect(toolDesc(llmStarts[1]!, 'lookup')).toMatch(/^\[Step 1 of 3 — find the order first\] /);
    expect(toolDesc(llmStarts[1]!, 'skip_step')).toContain("declared policy: 'advance'");
    // The read_skill activation result told the model where the procedure starts.
    const readSkillResult = historyOf(agent).find(
      (m) => m.role === 'tool' && m.toolName === 'read_skill',
    );
    expect(readSkillResult?.content).toContain('You are on step 1 of 3: find the order first');
  });

  it('dynamic-grouped: the offer narrows on the very iteration the tenure begins (the correction-1 pin)', async () => {
    const { agent, llmStarts } = buildAgent(
      [
        call('read_skill', 't1', { id: 'refund' }),
        { content: 'stopping here', toolCalls: [] },
        { content: 'still stopping', toolCalls: [] },
      ],
      [refundSkill(), notesSkill()],
      { tools: [tool('calc')], reactMode: 'dynamic-grouped' },
    );
    await agent.run({ message: 'refund order 42' });
    const offer = toolNames(llmStarts[1]!);
    expect(offer).toContain('lookup');
    expect(offer).toContain('skip_step');
    expect(offer).not.toContain('charge');
    expect(toolDesc(llmStarts[1]!, 'lookup')).toMatch(/^\[Step 1 of 3/);
  });

  it('the steps advisory hint activates with the tenure (fresh pointer in ctx), not one iteration late', async () => {
    const { agent, evaluated } = buildAgent(
      [
        call('read_skill', 't1', { id: 'refund' }),
        { content: 'stopping', toolCalls: [] },
        { content: 'still stopping', toolCalls: [] },
      ],
      [refundSkill()],
    );
    await agent.run({ message: 'refund' });
    expect(evaluated[0]!.activeIds).not.toContain('skill-steps-hint');
    expect(evaluated[1]!.activeIds).toContain('skill-steps-hint');
  });
});

describe('functional: advance at the return boundary', () => {
  it('a completed step advances the pointer, suffixes the result, and lands on the record — through completion', async () => {
    const { agent, llmStarts, advanced } = buildAgent(
      [
        call('read_skill', 't1', { id: 'refund' }),
        call('lookup', 't2'),
        batch([
          { name: 'charge', id: 't3' },
          { name: 'export', id: 't4' },
        ]),
        { content: 'refund complete', toolCalls: [] },
      ],
      [refundSkill()],
    );
    const answer = await agent.run({ message: 'refund order 42' });
    expect(answer).toBe('refund complete');

    // Three advances, batch call order preserved (the SG-B interaction:
    // both results of one message advance, in order, each on the record).
    expect(advanced.map((a) => (a.step as { index: number }).index)).toEqual([1, 2, 3]);
    expect(advanced.map((a) => a.toolCallId)).toEqual(['t2', 't3', 't4']);
    expect(advanced[2]).toMatchObject({ completed: true, skillId: 'refund' });

    // The suffix is part of the one past: history carries it.
    const hist = historyOf(agent);
    const lookupResult = hist.find((m) => m.toolName === 'lookup');
    expect(lookupResult?.content).toContain(
      'Step 1 of 3 done. Now on step 2 of 3: refund the charge',
    );
    const exportResult = hist.find((m) => m.toolName === 'export');
    expect(exportResult?.content).toContain('All 3 steps complete.');

    // Pointer complete on the snapshot; the post-completion offer is FULL
    // again — no narrowing, no skip_step (zero-cost once done).
    expect(stepPointerOf(agent)).toMatchObject({ skillId: 'refund', step: 4, total: 3 });
    const postOffer = toolNames(llmStarts[3]!);
    expect(postOffer).toEqual(expect.arrayContaining(['lookup', 'charge', 'export']));
    expect(postOffer).not.toContain('skip_step');
  });

  it('two adjacent steps naming the SAME tool advance twice in one batch', async () => {
    const doubled = defineSkill({
      id: 'audit',
      description: 'audit',
      body: 'audit',
      tools: [tool('probe'), tool('seal')] as never,
      steps: [
        { tool: 'probe', note: 'probe before' },
        { tool: 'probe', note: 'probe after' },
        { tool: 'seal', note: 'seal it' },
      ],
    });
    const { agent, advanced } = buildAgent(
      [
        call('read_skill', 't1', { id: 'audit' }),
        batch([
          { name: 'probe', id: 't2' },
          { name: 'probe', id: 't3' },
        ]),
        call('seal', 't4'),
        { content: 'done', toolCalls: [] },
      ],
      [doubled],
    );
    await agent.run({ message: 'audit it' });
    expect(advanced.map((a) => [(a.step as { index: number }).index, a.toolCallId])).toEqual([
      [1, 't2'],
      [2, 't3'],
      [3, 't4'],
    ]);
  });

  it('an error result never advances — the pointer holds and the model retries', async () => {
    let calls = 0;
    const flaky = defineTool<Record<string, never>, string>({
      name: 'lookup',
      description: 'lookup tool',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        calls += 1;
        if (calls === 1) throw new Error('backend down');
        return 'order found';
      },
    });
    const skill = defineSkill({
      id: 'refund',
      description: 'refunds',
      body: 'b',
      tools: [flaky, tool('charge')] as never,
      steps: [
        { tool: 'lookup', note: 'find it' },
        { tool: 'charge', note: 'refund it' },
      ],
    });
    const { agent, llmStarts, advanced } = buildAgent(
      [
        call('read_skill', 't1', { id: 'refund' }),
        call('lookup', 't2'),
        call('lookup', 't3'),
        call('charge', 't4'),
        { content: 'done', toolCalls: [] },
      ],
      [skill],
    );
    await agent.run({ message: 'refund' });
    // The failed call did not advance; the offer after it still narrows to
    // lookup (+ skip_step); only the clean retry and the charge advanced.
    expect(advanced.map((a) => a.toolCallId)).toEqual(['t3', 't4']);
    const offerAfterError = toolNames(llmStarts[2]!);
    expect(offerAfterError).toContain('lookup');
    expect(offerAfterError).toContain('skip_step');
    expect(offerAfterError).not.toContain('charge');
  });

  it('a permission-denied call never advances', async () => {
    const denyLookup: PermissionChecker = {
      name: 'deny-lookup',
      check: ({ target }) =>
        Promise.resolve(
          target === 'lookup' ? { result: 'deny', rationale: 'not now' } : { result: 'allow' },
        ),
    } as never;
    const { agent, advanced } = buildAgent(
      [
        call('read_skill', 't1', { id: 'refund' }),
        call('lookup', 't2'),
        { content: 'stopping', toolCalls: [] },
        { content: 'still stopping', toolCalls: [] },
      ],
      [refundSkill()],
      { permissionChecker: denyLookup },
    );
    await agent.run({ message: 'refund' });
    expect(advanced).toHaveLength(0);
    expect(stepPointerOf(agent)).toMatchObject({ step: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — skip_step, tenure re-key, pause/resume, the nudge
// ─────────────────────────────────────────────────────────────────────────

describe('integration: skip_step', () => {
  it("'advance' (default): the skip is recorded, the pointer moves, the result is the authoritative sentence", async () => {
    const { agent, skipped, advanced } = buildAgent(
      [
        call('read_skill', 't1', { id: 'refund' }),
        call('skip_step', 't2', { reason: 'order already on file' }),
        call('charge', 't3'),
        call('export', 't4'),
        { content: 'done', toolCalls: [] },
      ],
      [refundSkill()],
    );
    await agent.run({ message: 'refund' });
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({
      skillId: 'refund',
      policy: 'advance',
      reason: 'order already on file',
      toolCallId: 't2',
    });
    expect((skipped[0]!.step as { index: number }).index).toBe(1);
    // A skip is not a completion — step_advanced fired only for the two runs.
    expect(advanced.map((a) => a.toolCallId)).toEqual(['t3', 't4']);
    // The model read the authoritative sentence, not the placeholder.
    const skipResult = historyOf(agent).find((m) => m.toolName === 'skip_step');
    expect(skipResult?.content).toContain(
      'Step 1 skipped: order already on file. Now on step 2 of 3',
    );
    expect(skipResult?.content).not.toContain('placeholder');
    // The skipped index is on the completed pointer.
    expect(stepPointerOf(agent)).toMatchObject({ step: 4, skipped: [1] });
  });

  it("'hold': the skip is recorded and the step stays the offer", async () => {
    const { agent, skipped, llmStarts } = buildAgent(
      [
        call('read_skill', 't1', { id: 'refund' }),
        call('skip_step', 't2', { reason: 'cannot verify yet' }),
        { content: 'stopping', toolCalls: [] },
        { content: 'still stopping', toolCalls: [] },
      ],
      [refundSkill({ onSkip: 'hold' })],
    );
    await agent.run({ message: 'refund' });
    expect(skipped[0]).toMatchObject({ policy: 'hold', reason: 'cannot verify yet' });
    const skipResult = historyOf(agent).find((m) => m.toolName === 'skip_step');
    expect(skipResult?.content).toContain("Step 1 of 3 stays current (declared policy 'hold')");
    // The step is still the offer on the next iteration.
    const offer = toolNames(llmStarts[2]!);
    expect(offer).toContain('lookup');
    expect(offer).toContain('skip_step');
    expect(offer).not.toContain('charge');
  });

  it('an empty reason is a teaching result — no event, nothing moves', async () => {
    const { agent, skipped } = buildAgent(
      [
        call('read_skill', 't1', { id: 'refund' }),
        call('skip_step', 't2', { reason: '   ' }),
        call('lookup', 't3'),
        call('charge', 't4'),
        call('export', 't5'),
        { content: 'done', toolCalls: [] },
      ],
      [refundSkill()],
    );
    await agent.run({ message: 'refund' });
    expect(skipped).toHaveLength(0);
    const skipResult = historyOf(agent).find((m) => m.toolName === 'skip_step');
    expect(skipResult?.content).toContain('`reason` is required and must be non-empty');
  });

  it('skip_step outside a stepped tenure is a teaching result — no event', async () => {
    const { agent, skipped } = buildAgent(
      [call('skip_step', 't1', { reason: 'why not' }), { content: 'done', toolCalls: [] }],
      [refundSkill()],
    );
    await agent.run({ message: 'hello' });
    expect(skipped).toHaveLength(0);
    const skipResult = historyOf(agent).find((m) => m.toolName === 'skip_step');
    expect(skipResult?.content).toContain('no step procedure is active');
  });
});

describe('integration: tenure re-key', () => {
  it('a read_skill hop to another skill mid-procedure resets the pointer (plain agent, activation-tail tenant) — silently, per the cursor law', async () => {
    const { agent, llmStarts, unfinished } = buildAgent(
      [
        call('read_skill', 't1', { id: 'refund' }),
        call('lookup', 't2'),
        call('read_skill', 't3', { id: 'notes' }),
        { content: 'done', toolCalls: [] },
      ],
      [refundSkill(), notesSkill()],
    );
    await agent.run({ message: 'refund' });
    // After the hop the tenure is notes (unstepped): narrowing gone, full
    // offer back, no skip_step.
    const postHop = toolNames(llmStarts[3]!);
    expect(postHop).toEqual(expect.arrayContaining(['lookup', 'charge', 'export', 'take_note']));
    expect(postHop).not.toContain('skip_step');
    // The pointer is cleared, and the abandoned procedure raised no event —
    // the reset is the cursor's business; the record already shows a pointer
    // that never completed.
    expect(stepPointerOf(agent)).toBeUndefined();
    expect(unfinished).toHaveLength(0);
  });

  it('a declared route edge moves the cursor and the pointer follows (graph agent)', async () => {
    const billing = refundSkill({ id: 'billing', description: 'billing desk' });
    const shipping = defineSkill({
      id: 'shipping',
      description: 'shipping desk',
      body: 'ship',
      tools: [tool('track')] as never,
    });
    const graph = skillGraph()
      .entry(billing, { match: { keywords: ['refund'] } })
      .route(billing, shipping, { onToolReturn: 'lookup' })
      .build();
    const caps = capture();
    const graphAgent = Agent.create({
      provider: mock({
        replies: [call('lookup', 't1'), { content: 'done', toolCalls: [] }] as never,
      }),
      model: 'mock',
      maxIterations: 6,
    })
      .system('support')
      .skillGraph(graph)
      .watch(caps.recorder)
      .build();
    await graphAgent.run({ message: 'refund my order' });
    // Iteration 1: billing entered by rule → its procedure narrows the offer.
    const offer1 = toolNames(caps.llmStarts[0]!);
    expect(offer1).toContain('lookup');
    expect(offer1).toContain('skip_step');
    expect(offer1).not.toContain('charge');
    // lookup's return BOTH advanced the step (it was current) AND matched
    // the route edge — the cursor moved to shipping, so the next Evaluate
    // re-keyed the pointer away: no narrowing, no skip_step.
    expect(caps.advanced).toHaveLength(1);
    const offer2 = toolNames(caps.llmStarts[1]!);
    expect(offer2).not.toContain('skip_step');
    expect(
      pointerOf(
        (graphAgent.getLastSnapshot()?.sharedState as { stepPointer?: unknown }).stepPointer,
      ),
    ).toBeUndefined();
  });
});

describe('integration: pause/resume — the HITL step (correction 2)', () => {
  it('an askHuman step advances on the RESUMED call, at the same boundary', async () => {
    const { askHuman } = await import('../../../src/core/pause.js');
    const askFirst = defineTool<Record<string, never>, string>({
      name: 'ask_first',
      description: 'ask a person before exporting',
      inputSchema: { type: 'object', properties: {} },
      execute: () => askHuman({ question: 'approve the export?' }),
    });
    const hitl = defineSkill({
      id: 'exporter',
      description: 'export flow',
      body: 'export with consent',
      tools: [tool('lookup'), askFirst, tool('export')] as never,
      steps: [
        { tool: 'lookup', note: 'find the record' },
        { tool: 'ask_first', note: 'ask a human' },
        { tool: 'export', note: 'export it' },
      ],
    });
    const { agent, advanced } = buildAgent(
      [
        call('read_skill', 't1', { id: 'exporter' }),
        call('lookup', 't2'),
        call('ask_first', 't3'),
        call('export', 't4'),
        { content: 'exported', toolCalls: [] },
      ],
      [hitl],
    );
    const paused = await agent.run({ message: 'export the record' });
    // Paused mid-step-2: the pointer survived the checkpoint (committed
    // shared state) and has NOT advanced — the call has no result yet.
    expect(isPaused(paused)).toBe(true);
    expect(advanced.map((a) => a.toolCallId)).toEqual(['t2']);

    const answer = await agent.resume(
      (paused as { checkpoint: never }).checkpoint,
      'yes — approved',
    );
    expect(answer).toBe('exported');
    // The RESUMED call advanced step 2 — the correction-2 pin: the advance
    // fired for t3 specifically, then the loop finished step 3 inline.
    expect(advanced.map((a) => a.toolCallId)).toEqual(['t2', 't3', 't4']);
    expect(advanced[2]).toMatchObject({ completed: true });
    // The human's answer carries the step suffix in the one past.
    const askResult = historyOf(agent).find((m) => m.toolName === 'ask_first');
    expect(askResult?.content).toContain('yes — approved');
    expect(askResult?.content).toContain('Step 2 of 3 done. Now on step 3 of 3: export it');
  });
});

describe('integration: the nudge truth table', () => {
  it('a premature final gets ONE teaching nudge, and the loop turns once more', async () => {
    const { agent, unfinished, routed } = buildAgent(
      [
        call('read_skill', 't1', { id: 'refund' }),
        call('lookup', 't2'),
        { content: 'all set!', toolCalls: [] }, // premature: steps 2–3 unrun
        call('charge', 't3'),
        call('export', 't4'),
        { content: 'now really done', toolCalls: [] },
      ],
      [refundSkill()],
    );
    const answer = await agent.run({ message: 'refund order 42' });
    expect(answer).toBe('now really done');
    expect(unfinished).toHaveLength(1);
    expect(unfinished[0]).toMatchObject({ skillId: 'refund', action: 'nudged', total: 3 });
    expect((unfinished[0]!.remaining as unknown[]).length).toBe(2);
    expect(routed.map((r) => r.chosen)).toContain('step-nudge');
    // The teaching went back as the conversation: premature answer, then the ask.
    const hist = historyOf(agent);
    const teachingIdx = hist.findIndex(
      (m) => m.role === 'user' && m.content.includes('have not run'),
    );
    expect(teachingIdx).toBeGreaterThan(0);
    expect(hist[teachingIdx]!.content).toContain("Steps 2–3 of 'refund'");
    expect(hist[teachingIdx - 1]).toMatchObject({ role: 'assistant', content: 'all set!' });
  });

  it('a second premature stop is ACCEPTED — never a forced continue', async () => {
    const { agent, unfinished } = buildAgent(
      [
        call('read_skill', 't1', { id: 'refund' }),
        call('lookup', 't2'),
        { content: 'stopping here', toolCalls: [] },
        { content: 'still stopping — cannot verify the charge', toolCalls: [] },
      ],
      [refundSkill()],
    );
    const answer = await agent.run({ message: 'refund order 42' });
    expect(answer).toBe('still stopping — cannot verify the charge');
    expect(unfinished.map((u) => u.action)).toEqual(['nudged', 'accepted']);
  });

  it('a limit cutting the turn short is honored — no nudge, cut-short on the record', async () => {
    const { agent, unfinished, routed } = buildAgent(
      [
        call('read_skill', 't1', { id: 'refund' }),
        call('lookup', 't2'),
        call('charge', 't3'), // maxIterations reached — the loop refuses this
        // Since 9.56.0 the exhausted turn buys ONE more call — the wrap-up,
        // with the tools withheld — so the script needs the answer it asks
        // for. The nudge table is judged on THAT answer, and the verdict is
        // the same: a limit fired, so the procedure is cut short, not nudged.
        { content: 'I looked the order up but never got to the charge.', toolCalls: [] },
      ],
      [refundSkill()],
      { maxIterations: 3 },
    );
    await agent.run({ message: 'refund order 42' });
    expect(unfinished).toHaveLength(1);
    expect(unfinished[0]).toMatchObject({ action: 'cut-short' });
    expect(routed.map((r) => r.chosen)).not.toContain('step-nudge');
    expect(routed.map((r) => r.chosen)).toContain('wrap-up');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Security / containment — ownership: never steal an escape hatch
// ─────────────────────────────────────────────────────────────────────────

describe("containment: the hold-out never pulls another owner's tool", () => {
  it('a shared-reference tool carried by another ACTIVE skill stays offered (nice-7)', async () => {
    const shared = tool('shared_probe');
    const stepped = defineSkill({
      id: 'stepped',
      description: 'stepped',
      body: 'b',
      tools: [tool('first'), shared, tool('finish')] as never,
      steps: [
        { tool: 'first', note: 'start' },
        { tool: 'shared_probe', note: 'probe (shared)' },
        { tool: 'finish', note: 'finish' },
      ],
    });
    const other = defineSkill({
      id: 'other',
      description: 'other',
      body: 'b',
      tools: [shared] as never, // the SAME Tool reference — legal share
    });
    const { agent, llmStarts } = buildAgent(
      [
        call('read_skill', 't1', { id: 'other' }), // other becomes active…
        call('read_skill', 't2', { id: 'stepped' }), // …then stepped takes the tenure
        { content: 'stopping', toolCalls: [] },
        { content: 'still stopping', toolCalls: [] },
      ],
      [stepped, other],
    );
    await agent.run({ message: 'go' });
    const offer = toolNames(llmStarts[2]!);
    // Step 1 is current: 'finish' (sole-owned future step) is held out, but
    // 'shared_probe' — also step 2's tool — stays offered, because the other
    // ACTIVE skill legitimately carries it. Escape hatches are load-bearing.
    expect(offer).toContain('first');
    expect(offer).toContain('shared_probe');
    expect(offer).not.toContain('finish');
  });

  it('the ownership is judged on ACTIVE owners: a share with an inactive skill still narrows', async () => {
    const shared = tool('shared_probe');
    const stepped = defineSkill({
      id: 'stepped',
      description: 'stepped',
      body: 'b',
      tools: [tool('first'), shared, tool('finish')] as never,
      steps: [
        { tool: 'first', note: 'start' },
        { tool: 'shared_probe', note: 'probe (shared)' },
        { tool: 'finish', note: 'finish' },
      ],
    });
    const other = defineSkill({
      id: 'other',
      description: 'other',
      body: 'b',
      // The same reference — but this skill is NEVER activated this run, so
      // it is not an active owner and lends the name no protection.
      tools: [shared] as never,
    });
    const { agent, llmStarts } = buildAgent(
      [
        call('read_skill', 't1', { id: 'stepped' }),
        { content: 'stopping', toolCalls: [] },
        { content: 'still stopping', toolCalls: [] },
      ],
      [stepped, other],
    );
    await agent.run({ message: 'go' });
    const offer = toolNames(llmStarts[1]!);
    expect(offer).toContain('first');
    expect(offer).not.toContain('shared_probe');
    expect(offer).not.toContain('finish');
  });

  it('a baseline .tool() can never collide with a step tool — refused at build (validators), so the hold-out cannot reach it', () => {
    const calc = tool('calc');
    const stepped = defineSkill({
      id: 'calculator-flow',
      description: 'calc flow',
      body: 'b',
      tools: [tool('gather'), calc] as never,
      steps: [
        { tool: 'gather', note: 'gather inputs' },
        { tool: 'calc', note: 'compute' },
      ],
    });
    expect(() =>
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
        .system('s')
        .tool(calc as never)
        .injection(stepped)
        .build(),
    ).toThrow(/collides with the static \.tool\(\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression — zero-delta pins + the build checkup
// ─────────────────────────────────────────────────────────────────────────

describe('regression: zero-delta when unused', () => {
  it('an agent with skills but NO steps: no pointer keys, no skip_step, no step events, untouched read_skill description', async () => {
    const { agent, llmStarts, all } = buildAgent(
      [call('read_skill', 't1', { id: 'notes' }), { content: 'done', toolCalls: [] }],
      [notesSkill()],
      { tools: [tool('calc')] },
    );
    await agent.run({ message: 'hello' });
    const state = agent.getLastSnapshot()!.sharedState as Record<string, unknown>;
    expect('stepPointer' in state).toBe(false);
    expect('stepNudgeSpent' in state).toBe(false);
    for (const start of llmStarts) {
      expect(toolNames(start)).not.toContain('skip_step');
    }
    expect(toolDesc(llmStarts[0]!, 'read_skill')).not.toContain('step');
    expect(all.some((e) => e.name.startsWith('agentfootprint.skill.step'))).toBe(false);
    expect(all.some((e) => e.name === 'agentfootprint.skill.steps_unfinished')).toBe(false);
  });

  it('a stepped skill that never activates: seeded empty carrier, full offer, no events', async () => {
    const { agent, llmStarts, all } = buildAgent(
      [{ content: 'plain answer', toolCalls: [] }],
      [refundSkill()],
    );
    await agent.run({ message: 'hello' });
    const state = agent.getLastSnapshot()!.sharedState as Record<string, unknown>;
    // The feature is ON (a stepped skill is registered), so seed writes the
    // empty carrier — and nothing else ever does.
    expect(state.stepPointer).toEqual([]);
    expect(state.stepNudgeSpent).toBe(false);
    expect(toolNames(llmStarts[0]!)).not.toContain('skip_step');
    expect(all.some((e) => e.name.startsWith('agentfootprint.skill.step'))).toBe(false);
  });
});

describe('regression: the build checkup', () => {
  const buildWith = (
    injections: readonly Injection[],
    opts: { reactMode?: string; tools?: unknown[] } = {},
  ) => {
    let b = Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'mock',
      ...(opts.reactMode && { reactMode: opts.reactMode as never }),
    }).system('s');
    for (const t of opts.tools ?? []) b = b.tool(t as never);
    for (const i of injections) b = b.injection(i);
    return b;
  };

  it("reactMode 'classic' cannot honor steps — refused at build, teaching the caching reason", () => {
    expect(() => buildWith([refundSkill()], { reactMode: 'classic' }).build()).toThrow(
      /classic' cannot honor `steps`.*freeze/s,
    );
  });

  it('steps on an OPEN skill of a graph agent are refused — its tenure never begins (correction 5)', () => {
    const entry = defineSkill({
      id: 'entry',
      description: 'the entry',
      body: 'b',
      tools: [tool('probe')] as never,
    });
    const openStepped = refundSkill(); // registered beside the graph, never wired
    const graph = skillGraph()
      .entry(entry, { match: { keywords: ['go'] } })
      .build();
    expect(() =>
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
        .system('s')
        .skillGraph(graph)
        .injection(openStepped)
        .build(),
    ).toThrow(/does not wire it.*tenure begins only under the cursor/s);
  });

  it('steps on a decision-TREE leaf are refused — a tree never writes a cursor', () => {
    // The hole the wiring check alone left open: a tree leaf compiles to a
    // 'rule' trigger WITH a predicate edge, so the open-skill clause never
    // fired — the leaf activated with its FULL toolset (no narrowing, no
    // banner, no skip_step), zero step events, pointer stuck empty.
    const chatLeaf = defineSkill({
      id: 'chat',
      description: 'small talk',
      body: 'Chat.',
      tools: [tool('reply')] as never,
    });
    const graph = skillGraph()
      .tree(decideSkill((ctx) => ctx.userMessage.includes('refund'), refundSkill(), chatLeaf))
      .build();
    expect(() =>
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
        .system('s')
        .skillGraph(graph)
        .build(),
    ).toThrow(/tree\(\) cannot honor `steps`.*never writes a cursor/s);
  });

  it('a stepped skill registered BESIDE a tree is refused too — no cursor exists anywhere on a tree agent', () => {
    const leafA = defineSkill({
      id: 'a',
      description: 'a',
      body: 'a',
      tools: [tool('t_a')] as never,
    });
    const leafB = defineSkill({
      id: 'b',
      description: 'b',
      body: 'b',
      tools: [tool('t_b')] as never,
    });
    const graph = skillGraph()
      .tree(decideSkill((ctx) => ctx.userMessage.includes('x'), leafA, leafB))
      .build();
    expect(() =>
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
        .system('s')
        .skillGraph(graph)
        .injection(refundSkill()) // open beside the tree
        .build(),
    ).toThrow(/tree\(\) cannot honor `steps`/);
  });

  it('a tree agent with NO stepped skill builds exactly as before — the refusal is steps-gated', () => {
    const leafA = defineSkill({
      id: 'a',
      description: 'a',
      body: 'a',
      tools: [tool('t_a')] as never,
    });
    const leafB = defineSkill({
      id: 'b',
      description: 'b',
      body: 'b',
      tools: [tool('t_b')] as never,
    });
    const graph = skillGraph()
      .tree(decideSkill((ctx) => ctx.userMessage.includes('x'), leafA, leafB))
      .build();
    expect(() =>
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
        .system('s')
        .skillGraph(graph)
        .build(),
    ).not.toThrow();
  });

  it('steps on a graph-WIRED skill build fine — entries and route targets both', () => {
    const steppedEntry = refundSkill({ id: 'billing', description: 'billing desk' });
    const target = defineSkill({
      id: 'escalation',
      description: 'escalation desk',
      body: 'escalate',
      tools: [tool('page_manager'), tool('log_case')] as never,
      steps: [
        { tool: 'page_manager', note: 'page them' },
        { tool: 'log_case', note: 'log it' },
      ],
    });
    const graph = skillGraph()
      .entry(steppedEntry, { match: { keywords: ['refund'] } })
      .route(steppedEntry, target, { onToolReturn: 'lookup' })
      .build();
    expect(() =>
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
        .system('s')
        .skillGraph(graph)
        .build(),
    ).not.toThrow();
  });

  it('a hand-built stepped skill whose trigger read_skill never fires is refused on a graph-less agent', () => {
    const handBuilt: Injection = {
      id: 'rules-only',
      flavor: 'skill',
      description: 'd',
      trigger: { kind: 'rule', activeWhen: () => true },
      inject: { systemPrompt: 'b', tools: [tool('probe')] as never },
      metadata: { steps: [{ tool: 'probe', note: 'n' }], onSkip: 'advance' },
    };
    expect(() => buildWith([handBuilt]).build()).toThrow(
      /tenure begins at a read_skill activation/,
    );
  });

  it("the name 'skip_step' is reserved the moment steps exist — and free otherwise", () => {
    const skipImpostor = tool('skip_step');
    expect(() => buildWith([refundSkill()], { tools: [skipImpostor] }).build()).toThrow(
      /'skip_step' is reserved/,
    );
    expect(() => buildWith([notesSkill()], { tools: [skipImpostor] }).build()).not.toThrow();
  });

  it('dev-warns when the procedure cannot complete inside maxIterations, and when refreshPolicy rides beside steps', async () => {
    const { enableDevMode, disableDevMode } = await import('footprintjs');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    enableDevMode();
    try {
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock', maxIterations: 2 })
        .system('s')
        .injection(refundSkill({ refreshPolicy: { afterTokens: 50_000, via: 'tool-result' } }))
        .build();
      const lines = warn.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('cannot complete in one turn'))).toBe(true);
      expect(lines.some((l) => l.includes('steps supersede it'))).toBe(true);
    } finally {
      disableDevMode();
      warn.mockRestore();
    }
  });

  it("a consumer's own steps hint (any id) stands the default down — marker, not id", async () => {
    const { agent, evaluated } = buildAgent(
      [
        call('read_skill', 't1', { id: 'refund' }),
        { content: 'stopping', toolCalls: [] },
        { content: 'still stopping', toolCalls: [] },
      ],
      [refundSkill(), defineStepsHint({ id: 'my-own-hint', body: 'my custom advisory' })],
    );
    await agent.run({ message: 'refund' });
    const ids = evaluated[1]!.activeIds as string[];
    expect(ids).toContain('my-own-hint');
    expect(ids).not.toContain('skill-steps-hint');
  });
});
