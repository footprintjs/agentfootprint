/**
 * agent-subflow-structure.test.ts
 *
 * Proves the `reactStructure: 'subflow'` agent chart (buildDynamicAgentChart):
 * the whole LLM turn is wrapped in an `sf-llm-call` SUBFLOW with the 3 slot
 * subflows nested inside — the SAME boundary the LLMCall primitive produces.
 * This is the lens-render keystone (per the wkng9ory9 verdict): once the LLM
 * call is a real subflow, explainable-ui / Lens render it as an LLM group with
 * slots inside, with zero bespoke collapsing.
 *
 * The discipline here (tests-as-guardrail): prove the STRUCTURE in isolation
 * AND prove BEHAVIOUR PARITY with the default 'flat' chart, BEFORE relying on
 * the new path. We assert via runtime subflow-entry events (the honest signal
 * the lens/explainable-ui structure recorder also keys on), not internal chart
 * fields.
 *
 * 7-pattern coverage:
 *   • Unit/Functional — both shapes run to completion + return the same answer.
 *   • Integration (KEYSTONE) — 'subflow' run enters sf-llm-call, and the 3 slot
 *     subflows fire INSIDE it (nested boundary); 'flat' run does NOT enter sf-llm-call.
 *   • Integration (multi-iter) — tool-loop: sf-llm-call re-enters each iteration,
 *     and the cross-iteration accumulators (token totals) round-trip correctly.
 *   • Property — for a 0..2 tool-call script, both shapes yield identical final
 *     answer + identical total token usage (behaviour parity invariant).
 *   • Security — the typed-args freeze contract holds: a run with the subflow
 *     shape doesn't throw a readonly-write error (proves the prior*-alias
 *     accumulator round-trip respects footprintjs's frozen-input rule).
 *   • Performance/Load — N/A here (covered by the broader suite); structure is
 *     build-time, behaviour is identical to the flat path already load-tested.
 */

import { describe, it, expect } from 'vitest';
import type { CombinedRecorder, FlowSubflowEvent, StructureRecorder } from 'footprintjs';
import { splitStageId } from 'footprintjs/trace';
import { Agent } from '../../../src/core/Agent.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import { defineTool } from '../../../src/core/tools.js';
import { defineSkill } from '../../../src/lib/injection-engine/factories/defineSkill.js';
import { askHuman, isPaused } from '../../../src/core/pause.js';
import type { PricingTable } from '../../../src/adapters/types.js';

/** Captures subflow-entry ids (+ their subflowPath) during a run — the same
 *  FlowRecorder signal explainable-ui's structure recorder consumes. */
function subflowSpy(): { recorder: CombinedRecorder; entries: string[] } {
  const entries: string[] = [];
  const recorder: CombinedRecorder = {
    id: 'test.subflow-spy',
    onSubflowEntry(event: FlowSubflowEvent): void {
      if (event.subflowId) entries.push(event.subflowId);
    },
  };
  return { recorder, entries };
}

/** A tool the LLM can call, to drive the ReAct loop for >1 iteration. */
const weatherTool = defineTool({
  name: 'get_weather',
  description: 'weather for a city',
  inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
  execute: () => '{"temp":72}',
});

describe('Agent reactStructure: subflow — sf-llm-call boundary', () => {
  // ── Functional — both shapes run + return the same answer ──────────
  it('functional: subflow + flat shapes both run to completion with the same answer', async () => {
    const flat = Agent.create({ provider: new MockProvider({ reply: 'done' }) as never, model: 'm' })
      .system('s')
      .build();
    const sub = Agent.create({
      provider: new MockProvider({ reply: 'done' }) as never,
      model: 'm',
      reactStructure: 'subflow',
    })
      .system('s')
      .build();

    const flatOut = await flat.run({ message: 'hi' });
    const subOut = await sub.run({ message: 'hi' });
    expect(subOut).toBe(flatOut);
    expect(subOut).toBe('done');
  });

  // ── Integration (KEYSTONE) — sf-llm-call wraps the slot subflows ───
  it('integration: subflow run enters sf-llm-call with the 3 slots NESTED inside it', async () => {
    const sub = Agent.create({
      provider: new MockProvider({ reply: 'done' }) as never,
      model: 'm',
      reactStructure: 'subflow',
    })
      .system('weather bot')
      .tool(weatherTool)
      .build();
    const spy = subflowSpy();
    sub.attach(spy.recorder);

    await sub.run({ message: 'hi' });

    // The LLM turn is a subflow boundary.
    const sawLlmCall = spy.entries.some((id) => id === 'sf-llm-call' || id.endsWith('/sf-llm-call'));
    expect(sawLlmCall).toBe(true);

    // The 3 slot subflows fire NESTED under sf-llm-call (path-prefixed).
    const nestedUnderLlmCall = (slot: string) =>
      spy.entries.some((id) => id.includes('sf-llm-call/') && id.endsWith(slot));
    expect(nestedUnderLlmCall('sf-system-prompt')).toBe(true);
    expect(nestedUnderLlmCall('sf-messages')).toBe(true);
    expect(nestedUnderLlmCall('sf-tools')).toBe(true);
  });

  // ── Integration — flat shape does NOT produce the sf-llm-call boundary ─
  it('integration: flat run does NOT enter sf-llm-call (slots are top-level siblings)', async () => {
    const flat = Agent.create({ provider: new MockProvider({ reply: 'done' }) as never, model: 'm' })
      .system('weather bot')
      .tool(weatherTool)
      .build();
    const spy = subflowSpy();
    flat.attach(spy.recorder);

    await flat.run({ message: 'hi' });

    const sawLlmCall = spy.entries.some((id) => id === 'sf-llm-call' || id.endsWith('/sf-llm-call'));
    expect(sawLlmCall).toBe(false);
    // The slots still run — just as top-level siblings, not nested.
    expect(spy.entries.some((id) => id.endsWith('sf-system-prompt'))).toBe(true);
  });

  // ── Integration (multi-iter) — sf-llm-call re-enters each loop ─────
  it('integration: tool loop re-enters sf-llm-call once per iteration', async () => {
    // 1st call asks for a tool; 2nd call answers → 2 LLM turns.
    const provider = new MockProvider({
      replies: [{ toolCalls: [{ id: 't1', name: 'get_weather', args: { city: 'NYC' } }] }, { content: 'it is 72' }],
    });
    const sub = Agent.create({ provider: provider as never, model: 'm', reactStructure: 'subflow' })
      .system('weather bot')
      .tool(weatherTool)
      .build();
    const spy = subflowSpy();
    sub.attach(spy.recorder);

    const out = await sub.run({ message: 'weather in NYC?' });

    expect(out).toBe('it is 72');
    // sf-llm-call entered twice (one per ReAct iteration).
    const llmCallEntries = spy.entries.filter((id) => id === 'sf-llm-call' || id.endsWith('/sf-llm-call'));
    expect(llmCallEntries.length).toBe(2);
  });

  // ── Property — behaviour parity across tool-call counts ────────────
  it('property: subflow and flat shapes yield identical answer + token usage for 0..2 tool calls', async () => {
    for (let toolCalls = 0; toolCalls <= 2; toolCalls++) {
      const script = () => {
        const replies = [];
        for (let i = 0; i < toolCalls; i++) {
          replies.push({ toolCalls: [{ id: `t${i}`, name: 'get_weather', args: { city: 'X' } }] });
        }
        replies.push({ content: 'final answer', usage: { input: 10, output: 5 } });
        return replies;
      };

      const flat = Agent.create({ provider: new MockProvider({ replies: script() }) as never, model: 'm' })
        .system('s')
        .tool(weatherTool)
        .build();
      const sub = Agent.create({
        provider: new MockProvider({ replies: script() }) as never,
        model: 'm',
        reactStructure: 'subflow',
      })
        .system('s')
        .tool(weatherTool)
        .build();

      const flatOut = await flat.run({ message: 'q' });
      const subOut = await sub.run({ message: 'q' });
      expect(subOut).toBe(flatOut);
      expect(subOut).toBe('final answer');

      // The invariant that matters: EVERY cross-iteration accumulator must
      // round-trip through the sf-llm-call boundary identically to the flat
      // path (this is what the prior*-alias seed + outputMapper bubble
      // protect). We assert PARITY (sub === flat), not absolute values —
      // the absolutes depend on MockProvider's per-reply usage heuristic.
      type Acc = {
        totalInputTokens?: number;
        totalOutputTokens?: number;
        cumEstimatedUsd?: number;
        skillHistory?: readonly unknown[];
      };
      const f = (flat.getSnapshot()?.sharedState ?? {}) as Acc;
      const s = (sub.getSnapshot()?.sharedState ?? {}) as Acc;
      // PARITY is the invariant: every cross-iteration accumulator must
      // equal the flat path's value. (Absolute token counts depend on
      // MockProvider's per-reply char/4 heuristic over echoed args, which
      // is not deterministic enough to assert directly — parity is.)
      expect(s.totalInputTokens).toBe(f.totalInputTokens);
      expect(s.totalOutputTokens).toBe(f.totalOutputTokens);
      expect(s.cumEstimatedUsd).toBe(f.cumEstimatedUsd);
      expect(s.skillHistory).toEqual(f.skillHistory);
      // Floor sanity: only the FINAL reply carries usage.output:5; the
      // tool-using replies contribute 0 output. So output is exactly 5
      // regardless of loop count — a deterministic, structure-independent
      // check that the final reply's usage round-tripped through the boundary.
      expect(s.totalOutputTokens).toBe(5);
    }
  });

  // ── Security — frozen-input contract holds across the boundary ─────
  it('security: subflow run does not throw a readonly-write error (prior*-alias round-trip is safe)', async () => {
    // If the accumulator round-trip wrote to a frozen inputMapper key,
    // footprintjs would throw "Cannot write to readonly input key". A
    // clean multi-iteration run proves the prior*-alias indirection holds.
    const provider = new MockProvider({
      replies: [{ toolCalls: [{ id: 't1', name: 'get_weather', args: {} }] }, { content: 'ok' }],
    });
    const sub = Agent.create({ provider: provider as never, model: 'm', reactStructure: 'subflow' })
      .system('s')
      .tool(weatherTool)
      .build();

    await expect(sub.run({ message: 'go' })).resolves.toBe('ok');
  });

  // ── Review fix 3 — cumEstimatedUsd parity with a REAL pricing table ──
  // The original property test asserted cumEstimatedUsd parity but set no
  // pricingTable → emitCostTick early-returns → 0===0 (vacuous). With a
  // pricing table the cost accumulator actually accumulates, so this proves
  // it round-trips through the sf-llm-call boundary identically to flat.
  it('integration: cost accumulators round-trip identically with a pricing table (non-vacuous)', async () => {
    const pricing: PricingTable = {
      name: 'test-pricing',
      pricePerToken: (_model, kind) => (kind === 'input' ? 0.001 : kind === 'output' ? 0.002 : 0),
    };
    // 1 tool call → 2 LLM turns, so cost accumulates across the loop.
    const script = () => [
      { toolCalls: [{ id: 't1', name: 'get_weather', args: { city: 'X' } }], usage: { input: 100, output: 20 } },
      { content: 'final', usage: { input: 100, output: 20 } },
    ];
    const flat = Agent.create({ provider: new MockProvider({ replies: script() }) as never, model: 'm', pricingTable: pricing })
      .system('s')
      .tool(weatherTool)
      .build();
    const sub = Agent.create({
      provider: new MockProvider({ replies: script() }) as never,
      model: 'm',
      pricingTable: pricing,
      reactStructure: 'subflow',
    })
      .system('s')
      .tool(weatherTool)
      .build();

    expect(await sub.run({ message: 'q' })).toBe(await flat.run({ message: 'q' }));

    type Cost = { cumEstimatedUsd?: number; cumTokensInput?: number; cumTokensOutput?: number };
    const f = (flat.getSnapshot()?.sharedState ?? {}) as Cost;
    const s = (sub.getSnapshot()?.sharedState ?? {}) as Cost;
    // Parity AND non-zero — the assertion now actually exercises the round-trip.
    expect(s.cumEstimatedUsd).toBe(f.cumEstimatedUsd);
    expect(s.cumTokensInput).toBe(f.cumTokensInput);
    expect(s.cumTokensOutput).toBe(f.cumTokensOutput);
    expect(s.cumEstimatedUsd).toBeGreaterThan(0);
    expect(s.cumTokensInput).toBeGreaterThan(0);
  });

  // ── Review fix 4 (highest value) — OBSERVABILITY parity ─────────────
  // Lens renders from the EVENT stream, so "behaviour identical, only
  // nesting differs" must hold on the emit channel a consumer observes —
  // not just on returned values. Assert identical per-type event counts.
  it('observability: flat and subflow emit identical domain-event-type counts', async () => {
    const countEvents = async (shape: 'flat' | 'subflow') => {
      const provider = new MockProvider({
        replies: [{ toolCalls: [{ id: 't1', name: 'get_weather', args: { city: 'X' } }] }, { content: 'final' }],
      });
      const agent = Agent.create({ provider: provider as never, model: 'm', reactStructure: shape })
        .system('s')
        .tool(weatherTool)
        .build();
      const counts = new Map<string, number>();
      // '*' wildcard captures every dispatched typed event.
      agent.on('*', (e) => counts.set(e.type, (counts.get(e.type) ?? 0) + 1));
      await agent.run({ message: 'q' });
      return counts;
    };

    const flat = await countEvents('flat');
    const sub = await countEvents('subflow');

    // Compare as plain sorted records so the assertion is order-independent
    // and the diff is human-readable on failure. Every domain event type
    // must fire the SAME number of times in both shapes. (Subflow adds
    // structural FlowRecorder subflow-entry/exit events, but those are NOT
    // on the typed dispatcher stream — only domain events are, so the two
    // streams are directly comparable.)
    const toRecord = (m: Map<string, number>): Record<string, number> =>
      Object.fromEntries([...m.entries()].sort(([a], [b]) => a.localeCompare(b)));
    expect(toRecord(sub)).toEqual(toRecord(flat));
    // Sanity: the run actually emitted the core context-engineering events.
    expect(flat.get('agentfootprint.context.injected') ?? 0).toBeGreaterThan(0);
  });

  // ── Review note — memory-read TIMING parity (refutes a review premise) ──
  // A reviewer claimed flat re-runs memory reads every iteration while subflow
  // runs them once — a parity break. Ground truth verified directly in the
  // builders: the loop target is the InjectionEngine (flat) / sf-llm-call
  // (subflow), and the memory-read subflows mount UPSTREAM of that target in
  // BOTH charts — so the reads are upstream of the loop in both, running exactly
  // once per turn. (The loop is now sourced from the tool-calls branch, but the
  // TARGET is unchanged, so this invariant holds.) It is a STRUCTURAL invariant
  // of the wiring, not a runtime-countable difference; the observability-parity
  // test above already proves the two shapes emit identical event streams. No
  // separate runtime memory assertion is added here — a no-.memory() run would
  // be a vacuous 0===0, and a full memory fixture is disproportionate to a
  // premise that is false by construction.

  // ── Review fix — pause/resume across the new boundary (confirming) ──
  // A tool's askHuman fires in the `tool-calls` branch — a PEER of sf-llm-call
  // in the outer chart, NOT nested inside it — so the pause frame matches flat.
  // This confirms checkpoint+resume works end-to-end with reactStructure:subflow.
  it('pause/resume: tool askHuman pauses and resumes correctly under subflow shape', async () => {
    const provider = new MockProvider({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'approve_action', args: { action: 'delete' } }] },
        { content: 'approved and done' },
      ],
    });
    const approvalTool = defineTool({
      name: 'approve_action',
      description: 'Request human approval',
      inputSchema: { type: 'object', properties: { action: { type: 'string' } } },
      execute: () => {
        askHuman({ question: 'Approve?' });
      },
    });
    const agent = Agent.create({ provider: provider as never, model: 'm', reactStructure: 'subflow' })
      .tool(approvalTool)
      .build();

    const result = await agent.run({ message: 'delete the thing' });
    expect(isPaused(result)).toBe(true);
    if (!isPaused(result)) throw new Error('expected pause');

    const finalAnswer = await agent.resume(result.checkpoint, 'yes, approved');
    expect(finalAnswer).toBe('approved and done');
  });
});

// ── Structure — the 3 context slots are a PARALLEL selector fan-out ──────────
// Guards against a silent revert to sequential slot mounting. The runtime
// fork is what lets the Lens render the merge-tree (slots converging into one
// request) AND makes the execution tree tell the truth about slot independence.
// Behavior tests pass under both sequential and parallel, so ONLY this
// structural assertion catches a regression to the old `.addSubFlowChartNext`
// chain. Holds for both the flat (buildAgentChart) and subflow
// (buildDynamicAgentChart) shapes.
describe('Agent slot fork — context selector fans the 3 slots out in parallel', () => {
  type SpecNode = {
    id?: string;
    hasSelector?: boolean;
    children?: SpecNode[];
    next?: SpecNode;
    subflowStructure?: SpecNode;
  };
  // Walks children + next + nested subflowStructure to find a node by id.
  function findById(node: SpecNode | undefined, id: string): SpecNode | undefined {
    if (!node) return undefined;
    if (node.id === id) return node;
    for (const c of node.children ?? []) {
      const hit = findById(c, id);
      if (hit) return hit;
    }
    return findById(node.next, id) ?? findById(node.subflowStructure, id);
  }

  for (const shape of ['flat', 'subflow'] as const) {
    it(`structure (${shape}): 'context' is a selector whose branches are the 3 slots`, () => {
      const agent = Agent.create({
        provider: new MockProvider({ reply: 'done' }) as never,
        model: 'm',
        ...(shape === 'subflow' ? { reactStructure: 'subflow' as const } : {}),
      })
        .system('bot')
        .tool(weatherTool)
        .build();

      const root = agent.getSpec().buildTimeStructure as unknown as SpecNode;
      const ctx = findById(root, 'context');
      expect(ctx).toBeDefined(); // the selector node must exist (not a sequential chain)
      expect(ctx!.hasSelector).toBe(true); // a fan-out, NOT three chained `next` mounts

      // The 3 slots are its BRANCHES (parallel children), not chained via next.
      const branchIds = (ctx!.children ?? []).map((c) => c.id);
      expect(branchIds).toContain('sf-system-prompt');
      expect(branchIds).toContain('sf-messages');
      expect(branchIds).toContain('sf-tools');
    });
  }
});

// ── Structure — cache machinery is ONE sf-cache subflow; skill-history outside ─
// Guards the v2.14 cache grouping AND its key design decision: the cache
// DECISION (decideCacheMarkers → CacheGate → apply/skip) lives inside sf-cache,
// but UpdateSkillHistory stays in the MAIN loop so the rolling skillHistory
// window persists across iterations without round-tripping through the subflow.
describe('Agent cache subflow — grouped decision, skill-history stays outside', () => {
  type SpecNode = {
    id?: string;
    children?: SpecNode[];
    next?: SpecNode;
    subflowStructure?: SpecNode;
  };
  function findById(node: SpecNode | undefined, id: string): SpecNode | undefined {
    if (!node) return undefined;
    if (node.id === id) return node;
    for (const c of node.children ?? []) {
      const hit = findById(c, id);
      if (hit) return hit;
    }
    return findById(node.next, id) ?? findById(node.subflowStructure, id);
  }

  const churnSkill = defineSkill({
    id: 'billing',
    description: 'Billing skill',
    body: 'Billing playbook.',
  });

  for (const shape of ['flat', 'subflow'] as const) {
    it(`structure (${shape}): WITH skills, sf-cache wraps the gate; update-skill-history is in the main loop, NOT inside sf-cache`, () => {
      const agent = Agent.create({
        provider: new MockProvider({ reply: 'done' }) as never,
        model: 'm',
        ...(shape === 'subflow' ? { reactStructure: 'subflow' as const } : {}),
      })
        .system('bot')
        .tool(weatherTool)
        .skill(churnSkill)
        .build();

      const root = agent.getSpec().buildTimeStructure as unknown as SpecNode;
      const cache = findById(root, 'sf-cache');
      expect(cache).toBeDefined(); // the cache machinery is grouped into one box

      // The CacheGate decider lives INSIDE sf-cache...
      expect(findById(cache!.subflowStructure, 'cache-gate')).toBeDefined();
      // ...but UpdateSkillHistory is NOT inside sf-cache (it stays in the main
      // loop so skillHistory persists across iterations — no round-trip).
      expect(findById(cache!.subflowStructure, 'update-skill-history')).toBeUndefined();
      // ...and it DOES exist in the main loop because skills are registered.
      expect(findById(root, 'update-skill-history')).toBeDefined();
    });

    it(`structure (${shape}): with NO skills, update-skill-history is omitted entirely (conditional mount)`, () => {
      const agent = Agent.create({
        provider: new MockProvider({ reply: 'done' }) as never,
        model: 'm',
        ...(shape === 'subflow' ? { reactStructure: 'subflow' as const } : {}),
      })
        .system('bot')
        .tool(weatherTool)
        .build();

      const root = agent.getSpec().buildTimeStructure as unknown as SpecNode;
      // sf-cache still exists — the gate runs regardless of skills...
      expect(findById(root, 'sf-cache')).toBeDefined();
      // ...but with no skills the churn window can never fire, so the stage is
      // not mounted anywhere in the chart (no dead weight, no misleading box).
      expect(findById(root, 'update-skill-history')).toBeUndefined();
    });
  }

  // End-to-end guard for cacheRecorder: it matches the cache-gate decision by
  // its LOCAL stage id (splitStageId(traversalContext.stageId).localStageId ===
  // 'cache-gate'). Now that the gate is nested in sf-cache, BOTH the decider
  // name AND the stageId are prefixed ('sf-cache/cache-gate'), so the recorder
  // MUST strip the prefix. Prove the real engine emits a cache-gate decision
  // that survives that match — else cacheRecorder's audit trail silently breaks.
  it('integration: a real run fires a cache-gate decision matchable by local stage id', async () => {
    const gateDecisions: string[] = [];
    const agent = Agent.create({ provider: new MockProvider({ reply: 'done' }) as never, model: 'm' })
      .system('bot')
      .tool(weatherTool)
      .build();
    agent.attach({
      id: 'decider-spy',
      onDecision: (e: { traversalContext?: { stageId?: string } }) => {
        const sid = e.traversalContext?.stageId;
        if (sid && splitStageId(sid).localStageId === 'cache-gate') gateDecisions.push(sid);
      },
    } as never);

    await agent.run({ message: 'hi' });

    // The cache gate fires every iteration; cacheRecorder matches exactly this.
    expect(gateDecisions.length).toBeGreaterThan(0);
  });
});

// ── Structure — the ReAct loop is sourced from the tool-calls BRANCH ──────────
// The loop-back edge now originates at the `tool-calls` branch (branch-sourced
// `{ loopTo }`), NOT the `sf-route` decider. So the chart reads honestly —
// `ToolCalls → <loop target>` loops, `final` is a terminal leaf. The loop target
// is the InjectionEngine (flat) / sf-llm-call (subflow). This relies on the
// footprintjs engine resolving a SUBFLOW loop target on pause/resume; the
// `pause/resume: tool askHuman` test above is the end-to-end guard that the
// human-in-the-loop path still works with the loop on a pausable branch.
describe('Agent ReAct loop — sourced from the tool-calls branch, not the decider', () => {
  type SpecNode = {
    id?: string;
    loopTarget?: string;
    children?: SpecNode[];
    next?: SpecNode;
    subflowStructure?: SpecNode;
  };
  function findById(node: SpecNode | undefined, id: string): SpecNode | undefined {
    if (!node) return undefined;
    if (node.id === id) return node;
    for (const c of node.children ?? []) {
      const hit = findById(c, id);
      if (hit) return hit;
    }
    return findById(node.next, id) ?? findById(node.subflowStructure, id);
  }

  // flat loops back to the InjectionEngine; subflow loops back to sf-llm-call.
  const loopTargetFor = { flat: 'sf-injection-engine', subflow: 'sf-llm-call' } as const;

  for (const shape of ['flat', 'subflow'] as const) {
    it(`structure (${shape}): the tool-calls branch owns the loop; sf-route + final do NOT`, () => {
      const agent = Agent.create({
        provider: new MockProvider({ reply: 'done' }) as never,
        model: 'm',
        ...(shape === 'subflow' ? { reactStructure: 'subflow' as const } : {}),
      })
        .system('bot')
        .tool(weatherTool)
        .build();

      const root = agent.getSpec().buildTimeStructure as unknown as SpecNode;

      // The loop is SOURCED from the tool-calls branch → its target.
      const toolCalls = findById(root, 'tool-calls');
      expect(toolCalls).toBeDefined();
      expect(toolCalls!.loopTarget).toBe(loopTargetFor[shape]);

      // The decider itself does NOT loop (was the old, misattributed shape)...
      expect(findById(root, 'sf-route')!.loopTarget).toBeUndefined();
      // ...and the terminal branch is a plain leaf.
      expect(findById(root, 'final')!.loopTarget).toBeUndefined();
    });
  }
});

// ── Setup stage naming — display 'Initialize', id stays 'seed' ─────
// The root setup stage was renamed from the confusing 'Seed' (reads like
// planting/growing) to the clearer 'Initialize'. DISPLAY-ONLY rename: the
// internal id stays 'seed' so runtimeStageId 'seed#0' is stable across
// recorders / Lens / tests. This guard pins both halves of that decision.
describe('Agent setup stage naming', () => {
  for (const shape of ['flat', 'subflow'] as const) {
    it(`(${shape}) root setup stage displays as "Initialize" but keeps id "seed"`, () => {
      const stages: { stageId: string; name: string }[] = [];
      const rec: StructureRecorder = {
        id: 'setup-name-guard',
        onStageAdded: (e) => stages.push({ stageId: e.stageId, name: e.name }),
      };
      Agent.create({
        provider: new MockProvider({ reply: 'done' }) as never,
        model: 'm',
        structureRecorders: [rec],
        ...(shape === 'subflow' ? { reactStructure: 'subflow' as const } : {}),
      })
        .system('bot')
        .build();

      const setup = stages.find((s) => s.stageId === 'seed');
      expect(setup).toBeDefined(); // id unchanged → runtimeStageId 'seed#0' stable
      expect(setup!.name).toBe('Initialize'); // display renamed for clarity
    });
  }
});
