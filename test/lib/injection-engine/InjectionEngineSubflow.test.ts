/**
 * Injection Engine — readable subflow (Gather → Evaluate → Route → Delta).
 * 7-pattern tests (unit · functional · integration · property · security ·
 * performance · invariant/ROI).
 *
 * The load-bearing invariant: decomposing the old single `evaluate` stage into
 * four readable stages MUST keep `activeInjections` byte-identical (the slots
 * read it), and Route/Delta only ANNOTATE (no slot is skipped).
 *
 * See docs blog (injection algorithm) + memory agentfootprint_slot_plan_review.
 */
import { describe, expect, it } from 'vitest';
import { FlowChartExecutor } from 'footprintjs';

import { Agent } from '../../../src/core/Agent.js';
import { defineTool } from '../../../src/core/tools.js';
import { mock } from '../../../src/adapters/llm/MockProvider.js';
import {
  buildInjectionEngineSubflow,
  routeActiveInjections,
  diffActiveBySlot,
  EMPTY_ACTIVE_BY_SLOT,
  type ActiveBySlot,
} from '../../../src/lib/injection-engine/buildInjectionEngineSubflow.js';
import {
  defineInstruction,
  defineSkill,
  evaluateInjections,
  type Injection,
  type InjectionContext,
} from '../../../src/lib/injection-engine/index.js';
import {
  projectActiveInjection,
  type ActiveInjection,
} from '../../../src/lib/injection-engine/types.js';

// ── helpers ──────────────────────────────────────────────────────────────

function toolEntry(name: string, injectionId: string) {
  return {
    schema: { name, description: `${name} tool`, parameters: { type: 'object', properties: {} } },
    injectionId,
  };
}

// Loose constructor — routeActiveInjections reads inject.* at runtime, so the
// exact static schema type is irrelevant here; cast keeps the tests readable.
function active(o: {
  id: string;
  flavor: string;
  description?: string;
  surfaceMode?: string;
  inject: Record<string, unknown>;
}): ActiveInjection {
  return o as unknown as ActiveInjection;
}

// ─── Unit — routeActiveInjections (per-slot partition) ─────────────────────

describe('routeActiveInjections — unit', () => {
  it('partitions injections into the slots whose content they carry', () => {
    const a = active({ id: 'a', flavor: 'instructions', inject: { systemPrompt: 'rule' } });
    const b = active({
      id: 'b',
      flavor: 'instructions',
      inject: { messages: [{ role: 'user', content: 'hi' }] },
    });
    const c = active({ id: 'c', flavor: 'skill', inject: { tools: [toolEntry('search', 'c')] } });

    const byslot = routeActiveInjections([a, b, c]);
    expect(byslot.systemPrompt.map((e) => e.id)).toEqual(['a']);
    expect(byslot.messages.map((e) => e.id)).toEqual(['b']);
    expect(byslot.tools.map((e) => e.id)).toEqual(['c']);
  });

  it('an injection contributing to multiple slots appears in each', () => {
    const skill = active({
      id: 'multi',
      flavor: 'skill',
      inject: { systemPrompt: 'body', tools: [toolEntry('t', 'multi')] },
    });
    const byslot = routeActiveInjections([skill]);
    expect(byslot.systemPrompt.map((e) => e.id)).toEqual(['multi']);
    expect(byslot.tools.map((e) => e.id)).toEqual(['multi']);
    expect(byslot.messages).toEqual([]);
  });

  it('a tool-only Skill is suppressed from system-prompt but kept in tools', () => {
    const toolOnly = active({
      id: 'to',
      flavor: 'skill',
      surfaceMode: 'tool-only',
      inject: { systemPrompt: 'body', tools: [toolEntry('t', 'to')] },
    });
    const byslot = routeActiveInjections([toolOnly]);
    expect(byslot.systemPrompt).toEqual([]); // suppressed (Block C)
    expect(byslot.tools.map((e) => e.id)).toEqual(['to']);
  });

  it('carries source + a reason for each routed entry', () => {
    const a = active({
      id: 'a',
      flavor: 'instructions',
      description: 'be terse',
      inject: { systemPrompt: 'rule' },
    });
    const [entry] = routeActiveInjections([a]).systemPrompt;
    expect(entry).toEqual({ id: 'a', source: 'instructions', reason: 'be terse' });
  });
});

// ─── Unit — diffActiveBySlot (per-slot delta) ──────────────────────────────

describe('diffActiveBySlot — unit', () => {
  const bs = (sp: string[], msg: string[], tl: string[]): ActiveBySlot => ({
    systemPrompt: sp.map((id) => ({ id, source: 'instructions', reason: id })),
    messages: msg.map((id) => ({ id, source: 'instructions', reason: id })),
    tools: tl.map((id) => ({ id, source: 'skill', reason: id })),
  });

  it('turn-1 (empty prior) → everything is added', () => {
    const delta = diffActiveBySlot(EMPTY_ACTIVE_BY_SLOT, bs(['a'], ['b'], ['c']));
    expect(delta.systemPrompt).toEqual({ added: ['a'], removed: [], kept: [] });
    expect(delta.messages).toEqual({ added: ['b'], removed: [], kept: [] });
    expect(delta.tools).toEqual({ added: ['c'], removed: [], kept: [] });
  });

  it('computes added / removed / kept per slot', () => {
    const prior = bs(['a', 'b'], [], ['x']);
    const current = bs(['b', 'c'], [], ['x']);
    const delta = diffActiveBySlot(prior, current);
    expect(delta.systemPrompt).toEqual({ added: ['c'], removed: ['a'], kept: ['b'] });
    expect(delta.tools).toEqual({ added: [], removed: [], kept: ['x'] });
  });

  it('no change → empty added/removed, all kept', () => {
    const same = bs(['a'], ['b'], ['c']);
    const delta = diffActiveBySlot(same, same);
    expect(delta.systemPrompt).toEqual({ added: [], removed: [], kept: ['a'] });
  });
});

// ─── Functional — run the subflow standalone ───────────────────────────────

describe('injection-engine subflow — functional', () => {
  it('produces activeInjections + activeByslot + slotDelta in one run', async () => {
    const injections: Injection[] = [
      defineInstruction({ id: 'i1', prompt: 'be helpful' }),
      defineInstruction({ id: 'i2', prompt: 'cite sources' }),
    ];
    const subflow = buildInjectionEngineSubflow({ injections });
    const ex = new FlowChartExecutor(subflow);
    await ex.run({
      input: { iteration: 1, userMessage: 'hi', history: [], activatedInjectionIds: [] },
    });

    const shared = (ex.getSnapshot()?.sharedState ?? {}) as Record<string, unknown>;
    expect(Array.isArray(shared.activeInjections)).toBe(true);
    expect((shared.activeInjections as unknown[]).length).toBeGreaterThan(0);

    const byslot = shared.activeByslot as ActiveBySlot;
    expect(byslot).toBeDefined();
    expect(byslot.systemPrompt.map((e) => e.id)).toContain('i1');

    const delta = shared.slotDelta as ReturnType<typeof diffActiveBySlot>;
    expect(delta).toBeDefined();
    // turn 1: prior empty → system-prompt slot's active injections are "added"
    expect(delta.systemPrompt.added).toContain('i1');
    expect(delta.systemPrompt.removed).toEqual([]);
  });
});

// ─── Functional — skill catalog (offered menu) in the emit payload ─────────

describe('injection-engine subflow — skill catalog emit', () => {
  it('emits the offered skill catalog (id + description) in context.evaluated', async () => {
    const injections: Injection[] = [
      defineInstruction({ id: 'i1', prompt: 'be helpful' }),
      defineSkill({ id: 'billing', description: 'Billing help', body: 'handle billing' }),
      defineSkill({ id: 'refunds', description: 'Refund policy', body: 'refunds rules' }),
    ];
    const captured: Array<Record<string, unknown>> = [];
    const ex = new FlowChartExecutor(buildInjectionEngineSubflow({ injections }));
    ex.attachEmitRecorder({
      id: 'cap',
      onEmit: (e: { name: string; payload?: unknown }) => {
        if (e.name === 'agentfootprint.context.evaluated') {
          captured.push(e.payload as Record<string, unknown>);
        }
      },
    });
    await ex.run({
      input: { iteration: 1, userMessage: 'x', history: [], activatedInjectionIds: [] },
    });

    expect(captured.length).toBe(1);
    expect(captured[0].skillCatalog).toEqual([
      { id: 'billing', description: 'Billing help' },
      { id: 'refunds', description: 'Refund policy' },
    ]);
  });

  it('a Skill with no description renders the (no description) marker', async () => {
    // defineSkill REQUIRES a description, so the fallback is only reachable via
    // a raw Injection (power-user construction). That's what we exercise here.
    const injections: Injection[] = [
      {
        id: 'mystery',
        flavor: 'skill',
        trigger: { kind: 'always' },
        inject: { systemPrompt: 'x' },
      } as Injection,
    ];
    const captured: Array<Record<string, unknown>> = [];
    const ex = new FlowChartExecutor(buildInjectionEngineSubflow({ injections }));
    ex.attachEmitRecorder({
      id: 'cap2',
      onEmit: (e: { name: string; payload?: unknown }) => {
        if (e.name === 'agentfootprint.context.evaluated')
          captured.push(e.payload as Record<string, unknown>);
      },
    });
    await ex.run({
      input: { iteration: 1, userMessage: 'x', history: [], activatedInjectionIds: [] },
    });
    expect(captured[0].skillCatalog).toEqual([{ id: 'mystery', description: '(no description)' }]);
  });
});

// ─── Invariant / ROI — activeInjections byte-identical to the old path ──────

describe('injection-engine subflow — safety invariant', () => {
  it('activeInjections equals evaluateInjections(...).active projected (unchanged for slots)', async () => {
    const injections: Injection[] = [
      defineInstruction({ id: 'a', prompt: 'one' }),
      defineInstruction({ id: 'b', activeWhen: (c) => c.iteration > 1, prompt: 'two' }),
    ];
    const ctx: InjectionContext = {
      iteration: 2,
      userMessage: 'q',
      history: [{ role: 'user', content: 'q' }],
      activatedInjectionIds: [],
    };
    const expected = evaluateInjections(injections, ctx).active.map(projectActiveInjection);

    const ex = new FlowChartExecutor(buildInjectionEngineSubflow({ injections }));
    await ex.run({ input: { ...ctx } });
    const actual = (ex.getSnapshot()?.sharedState as Record<string, unknown>).activeInjections;

    expect(actual).toEqual(expected);
  });
});

// ─── Integration — full agent run carries route + delta ────────────────────

describe('injection-engine subflow — integration (Agent)', () => {
  it('a 2-turn agent ends with activeByslot + slotDelta in shared state', async () => {
    const echo = defineTool({
      name: 'echo',
      description: 'echo',
      inputSchema: { type: 'object', properties: { m: { type: 'string' } } },
      execute: async ({ m }: { m: string }) => `echoed ${m}`,
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'echo', args: { m: 'a' } }] },
          { content: 'done' },
        ],
      }),
      model: 'mock',
      maxIterations: 4,
      reactMode: 'dynamic',
    })
      .system('You answer.')
      .instruction(defineInstruction({ id: 'sp', prompt: 'be terse' }))
      .tool(echo)
      .build();

    await agent.run({ message: 'go' });
    const snap = agent.getLastSnapshot();
    const shared = (snap?.sharedState ?? {}) as Record<string, unknown>;

    // activeByslot is carried to parent (for next turn's Delta) — its presence
    // proves the Route stage ran end-to-end inside the real agent.
    const byslot = shared.activeByslot as ActiveBySlot | undefined;
    expect(byslot).toBeDefined();
    expect(byslot!.systemPrompt.map((e) => e.id)).toContain('sp');

    // The injection-engine subflow boundary commit carries the routed output
    // back to the parent (activeInjections + activeByslot) — confirming the
    // engine ran and the Route round-trip is wired.
    const commitLog = (snap?.commitLog ?? []) as Array<{
      runtimeStageId?: string;
      overwrite?: Record<string, unknown>;
    }>;
    const ieBoundary = commitLog.find(
      (c) =>
        (c.runtimeStageId ?? '').startsWith('sf-injection-engine') &&
        'activeByslot' in (c.overwrite ?? {}),
    );
    expect(ieBoundary).toBeDefined();
  });
});

// ─── Property — diff partition is disjoint + complete (full enumeration) ───

describe('diffActiveBySlot — property (enumerated subsets)', () => {
  const universe = ['a', 'b', 'c'];
  // All 2^3 subsets of the universe.
  const subsets: string[][] = [];
  for (let mask = 0; mask < 1 << universe.length; mask++) {
    subsets.push(universe.filter((_, i) => mask & (1 << i)));
  }
  const toByslot = (ids: string[]): ActiveBySlot => ({
    systemPrompt: ids.map((id) => ({ id, source: 'instructions', reason: id })),
    messages: [],
    tools: [],
  });

  it('added/removed/kept partition prior & current with no overlap (all 64 pairs)', () => {
    for (const priorIds of subsets) {
      for (const currentIds of subsets) {
        const { added, removed, kept } = diffActiveBySlot(
          toByslot(priorIds),
          toByslot(currentIds),
        ).systemPrompt;
        // disjoint
        expect(new Set([...added, ...removed, ...kept]).size).toBe(
          added.length + removed.length + kept.length,
        );
        // complete: added ∪ kept = current ; removed ∪ kept = prior
        expect(new Set([...added, ...kept])).toEqual(new Set(currentIds));
        expect(new Set([...removed, ...kept])).toEqual(new Set(priorIds));
      }
    }
  });
});

// ─── Security — a throwing predicate is skipped, route/delta survive ───────

describe('injection-engine subflow — security', () => {
  it('a rule predicate that throws does not crash route/delta', async () => {
    const injections: Injection[] = [
      defineInstruction({ id: 'ok', prompt: 'fine' }),
      defineInstruction({
        id: 'bad',
        activeWhen: () => {
          throw new Error('boom');
        },
        prompt: 'never',
      }),
    ];
    const ex = new FlowChartExecutor(buildInjectionEngineSubflow({ injections }));
    await ex.run({
      input: { iteration: 1, userMessage: 'x', history: [], activatedInjectionIds: [] },
    });
    const shared = (ex.getSnapshot()?.sharedState as Record<string, unknown>) ?? {};
    const byslot = shared.activeByslot as ActiveBySlot;
    // 'ok' present; 'bad' skipped (predicate threw); no crash
    expect(byslot.systemPrompt.map((e) => e.id)).toEqual(['ok']);
  });
});

// ─── Performance — route + diff over a large active set under budget ───────

describe('injection-engine subflow — performance', () => {
  it('routes + diffs 1000 active injections under budget', () => {
    const big: ActiveInjection[] = Array.from({ length: 1000 }, (_, i) =>
      active({ id: `i${i}`, flavor: 'instructions', inject: { systemPrompt: `r${i}` } }),
    );
    const start = performance.now();
    const byslot = routeActiveInjections(big);
    const delta = diffActiveBySlot(EMPTY_ACTIVE_BY_SLOT, byslot);
    const elapsed = performance.now() - start;
    expect(byslot.systemPrompt.length).toBe(1000);
    expect(delta.systemPrompt.added.length).toBe(1000);
    expect(elapsed).toBeLessThan(250); // generous regression guard
  });
});
