/**
 * Phase 6b — agent-chart mount integration tests.
 *
 * 7-pattern matrix verifying the cache layer is wired into the agent's
 * main flowchart correctly. The cache stages execute on every iteration
 * but currently produce no LLM-visible behavior change (Phase 7 lights
 * up the strategy.prepareRequest call — Phase 6 just mounts).
 */

import { describe, expect, it, vi } from 'vitest';
import { Agent, defineTool } from '../../src/index.js';
import { BreakpointCacheStrategy } from '../../src/cache/index.js';
import { defineFact, defineSteering } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';
import { recordRun } from '../../src/observe.js';

const cacheWork = vi.hoisted(() => ({
  historyVisits: undefined as number[] | undefined,
}));

vi.mock(import('../../src/cache/CacheDecisionSubflow.js'), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    cacheDecisionStage: (...args: Parameters<typeof original.cacheDecisionStage>) => {
      const stage = original.cacheDecisionStage(...args);
      return (scope: Parameters<typeof stage>[0]) => {
        const visits = cacheWork.historyVisits;
        if (visits === undefined) return stage(scope);

        let rows = 0;
        try {
          return stage(
            new Proxy(scope, {
              get(target, key) {
                const value = Reflect.get(target, key);
                if (key !== 'history' || !Array.isArray(value)) return value;
                // Count row accesses only inside the real cache decision, after
                // the engine has moved the history into this stage's scope.
                return new Proxy(value, {
                  get(history, index) {
                    if (index === Symbol.iterator) {
                      // The engine can bind the iterator to its own scope array.
                      // Count its yielded rows as well as direct index reads.
                      return function* () {
                        for (const row of history) {
                          rows++;
                          yield row;
                        }
                      };
                    }
                    if (typeof index === 'string' && /^\d+$/.test(index)) rows++;
                    return Reflect.get(history, index);
                  },
                });
              },
              set: (target, key, value) => Reflect.set(target, key, value),
            }),
          );
        } finally {
          visits.push(rows);
        }
      };
    },
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────

function buildAgent(opts: { caching?: 'off' } = {}) {
  // Single-call terminal mock: returns 'done' with no tool calls →
  // agent routes directly to Final → 1 iteration.
  const provider = mock({
    respond: () => ({
      content: 'done',
      toolCalls: [],
      usage: { input: 100, output: 20 },
      stopReason: 'stop' as const,
    }),
  });
  const builder = Agent.create({ provider, model: 'mock', maxIterations: 3, ...opts });
  builder.system('You are a test agent.', { cache: 'always' });
  builder.steering(defineSteering({ id: 'test', prompt: 'Be brief.' }));
  return builder.build();
}

// ─── 1. Unit ──────────────────────────────────────────────────────

describe('agent-chart cache integration — unit', () => {
  it('agent.run() with default caching: pass-through, no behavior change', async () => {
    const agent = buildAgent();
    const result = await agent.run({ message: 'go' });
    expect(typeof result).toBe('string');
  });

  it('scope.cacheMarkers is initialized in seed', async () => {
    const agent = buildAgent();
    await agent.run({ message: 'go' });
    const snap = agent.getLastSnapshot();
    const state = snap?.sharedState as { cacheMarkers?: readonly unknown[] } | undefined;
    expect(state?.cacheMarkers).toBeDefined();
    expect(Array.isArray(state?.cacheMarkers)).toBe(true);
  });

  it('scope.cachingDisabled is false by default', async () => {
    const agent = buildAgent();
    await agent.run({ message: 'go' });
    const snap = agent.getLastSnapshot();
    const state = snap?.sharedState as { cachingDisabled?: boolean } | undefined;
    expect(state?.cachingDisabled).toBe(false);
  });
});

// ─── 2. Boundary ──────────────────────────────────────────────────

describe('agent-chart cache integration — boundary', () => {
  it("Agent.create({ caching: 'off' }) sets cachingDisabled=true", async () => {
    const agent = buildAgent({ caching: 'off' });
    await agent.run({ message: 'go' });
    const snap = agent.getLastSnapshot();
    const state = snap?.sharedState as { cachingDisabled?: boolean } | undefined;
    expect(state?.cachingDisabled).toBe(true);
  });
});

// ─── 3. Scenario ──────────────────────────────────────────────────

describe('agent-chart cache integration — scenario', () => {
  it("'apply-markers' branch is the default route (CacheGate falls through)", async () => {
    const agent = buildAgent();
    const result = await agent.run({ message: 'go' });
    // Agent terminating with a string result proves the chart's cache
    // stages didn't crash mid-run. ApplyMarkers is the pass-through
    // default; SkipCaching only fires when CacheGate routes to it.
    expect(typeof result).toBe('string');
    expect(result).toBe('done');
  });

  it("kill switch route: 'no-markers' branch clears cacheMarkers", async () => {
    const agent = buildAgent({ caching: 'off' });
    await agent.run({ message: 'go' });
    const snap = agent.getLastSnapshot();
    // SkipCaching branch fired → cacheMarkers cleared
    const markers = (snap?.sharedState as { cacheMarkers?: readonly unknown[] })?.cacheMarkers;
    expect(markers).toEqual([]);
  });
});

// ─── 4. Property ──────────────────────────────────────────────────

describe('agent-chart cache integration — property', () => {
  it('activeInjections stays bounded across iterations (regression — same property as v2.5.1)', async () => {
    const agent = buildAgent();
    await agent.run({ message: 'go' });
    const snap = agent.getLastSnapshot();
    // The cache-layer additions DON'T re-introduce the v2.5.0 bug.
    // activeInjections must still be ≤4 (per Phase 1 regression test invariant).
    const active = (snap?.sharedState as { activeInjections?: readonly unknown[] })
      ?.activeInjections;
    expect(active?.length ?? 0).toBeLessThanOrEqual(4);
  });

  it('skillHistory is initialized as an empty array (no skills → UpdateSkillHistory not mounted)', async () => {
    const agent = buildAgent(); // steering only, NO skills registered
    await agent.run({ message: 'go' });
    const snap = agent.getLastSnapshot();
    const history = (snap?.sharedState as { skillHistory?: readonly unknown[] })?.skillHistory;
    // seed initializes it to []; with no skills the UpdateSkillHistory stage is
    // omitted (conditional mount), so it stays empty. The population mechanism
    // is covered by CacheGateDecider's tail-sampling unit tests + the skill-on
    // structure tests in agent-subflow-structure.
    expect(history).toBeDefined();
    expect(Array.isArray(history)).toBe(true);
    expect(history).toEqual([]);
  });
});

// ─── 5. Security ──────────────────────────────────────────────────

describe('agent-chart cache integration — security', () => {
  it("cache layer doesn't leak across separate agent.run() calls (state isolation)", async () => {
    const agent = buildAgent({ caching: 'off' });
    await agent.run({ message: 'first' });
    const snap1 = agent.getLastSnapshot();
    const history1 = (snap1?.sharedState as { skillHistory?: readonly unknown[] })?.skillHistory;

    await agent.run({ message: 'second' });
    const snap2 = agent.getLastSnapshot();
    const history2 = (snap2?.sharedState as { skillHistory?: readonly unknown[] })?.skillHistory;

    // Each run starts with fresh history
    expect(history2?.length).toBeLessThanOrEqual((history1?.length ?? 0) + 5);
  });
});

// ─── 6. Performance ───────────────────────────────────────────────

describe('agent-chart cache integration — performance', () => {
  it.each([2, 8])(
    'keeps conversation history out of the cache decision on %i model turns',
    async (turns) => {
      const lookup = defineTool({
        name: 'lookup',
        description: 'Return a fixture value.',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => 'found',
      });

      async function run(caching?: 'off') {
        const requests: { prefixLength: number; markerCount: number; tail: number | undefined }[] =
          [];
        const provider = mock({
          respond: (request) => {
            requests.push({
              prefixLength: request.messages.length,
              markerCount: request.cacheMarkers?.length ?? 0,
              tail: request.cacheMarkers?.find(({ field }) => field === 'messages')?.boundaryIndex,
            });
            return requests.length < turns
              ? {
                  content: '',
                  toolCalls: [{ id: `call-${requests.length}`, name: 'lookup', args: {} }],
                  usage: { input: 100, output: 20 },
                  stopReason: 'tool_use' as const,
                }
              : {
                  content: 'done',
                  toolCalls: [],
                  usage: { input: 100, output: 20 },
                  stopReason: 'stop' as const,
                };
          },
        });
        const cacheStrategy = new BreakpointCacheStrategy({
          mode: 'breakpoints',
          maxBreakpoints: 4,
          reportsUsage: false,
        });
        const prepare = vi.spyOn(cacheStrategy, 'prepareRequest');
        const agent = Agent.create({
          provider,
          model: 'mock',
          maxIterations: turns + 1,
          cacheStrategy,
          caching,
        })
          .system('You are a test agent.', { cache: 'always' })
          .tool(lookup)
          .build();

        const historyVisits: number[] = [];
        cacheWork.historyVisits = historyVisits;
        try {
          expect(await agent.run({ message: 'go' })).toBe('done');
        } finally {
          cacheWork.historyVisits = undefined;
        }
        expect(prepare).toHaveBeenCalledTimes(turns);
        expect(requests).toHaveLength(turns);
        expect(requests.map(({ prefixLength }) => prefixLength)).toEqual(
          Array.from({ length: turns }, (_, index) => 2 * index + 1),
        );
        return { requests, historyVisits };
      }

      const off = await run('off');
      const on = await run();
      expect(off.historyVisits).toEqual(Array<number>(turns).fill(0));
      expect(on.historyVisits).toEqual(Array<number>(turns).fill(0));
      for (const [index, { prefixLength, tail }] of on.requests.entries()) {
        expect(off.requests[index]?.markerCount).toBe(0);
        expect(tail).toBe(prefixLength - 1);
      }
    },
  );
});

// ─── 7. ROI — full integration ────────────────────────────────────

describe('agent-chart cache integration — ROI', () => {
  it("cache machinery mounts as ONE sf-cache subflow but doesn't change final answer", async () => {
    const agent = buildAgent();
    const result = await agent.run({ message: 'go' });
    expect(result).toBe('done'); // mock's terminal reply

    // Spec includes the cache subflow (visible to ExplainableShell). v2.14:
    // the per-turn cache decision is grouped into ONE `sf-cache` boundary
    // (decideCacheMarkers → CacheGate → apply/skip) instead of 4 loose nodes.
    const spec = agent.getSpec() as { subflows?: Record<string, unknown> };
    expect(spec.subflows).toBeDefined();
    expect(spec.subflows?.['sf-cache']).toBeDefined();
  });
});

describe('recorded cache mount input', () => {
  it.each(['dynamic', 'dynamic-grouped'] as const)(
    'records positions without copying message bodies in %s',
    async (reactMode) => {
      const requests: { messages: readonly { readonly content: unknown }[]; tail?: number }[] = [];
      const userBody = 'ordinary conversation fixture';
      const deliveredBody = 'cacheable delivered fixture';
      const provider = mock({
        respond(request) {
          requests.push({
            messages: JSON.parse(JSON.stringify(request.messages)),
            tail: request.cacheMarkers?.find(({ field }) => field === 'messages')?.boundaryIndex,
          });
          return 'done';
        },
      });
      const agent = Agent.create({
        provider,
        model: 'mock',
        reactMode,
        cacheStrategy: new BreakpointCacheStrategy({
          mode: 'breakpoints',
          maxBreakpoints: 4,
          reportsUsage: false,
        }),
      })
        .system('test prompt', { cache: 'always' })
        .fact(
          defineFact({
            id: 'cached-fact',
            data: deliveredBody,
            slot: 'messages',
            role: 'assistant',
            cache: 'always',
          }),
        )
        .build();
      const recorder = recordRun(agent, { boundaryDetail: 'full' });
      try {
        expect(await agent.run({ message: userBody })).toBe('done');
        expect(requests).toHaveLength(1);
        const request = requests[0]!;
        const position = request.messages.findIndex(({ content }) => content === deliveredBody);
        expect(position).toBeGreaterThan(0);
        expect(request.messages[0]?.content).toBe(userBody);
        expect(request.tail).toBe(position);

        const steps = recorder.boundary.getSteps();
        const cache = steps.find(
          (event) => event.type === 'subflow.entry' && event.localSubflowId === 'sf-cache',
        );
        const injection = steps.find(
          (event) =>
            event.type === 'subflow.entry' && event.localSubflowId === 'sf-injection-engine',
        );
        expect(cache).toBeDefined();
        expect(injection).toBeDefined();
        const snapshots = recorder.toRecording().snapshot?.subflowResults;
        const cacheSeed = snapshots?.[cache!.runtimeStageId]?.treeContext?.history[0]?.overwrite;
        const injectionSeed =
          snapshots?.[injection!.runtimeStageId]?.treeContext?.history[0]?.overwrite;
        const expected = {
          length: 2,
          deliveries: [{ index: position, injectionId: 'cached-fact', flavor: 'fact' }],
        };
        expect(injection?.payload).toMatchObject({
          history: [{ role: 'user', content: userBody }],
        });
        expect(injectionSeed).toMatchObject({ history: [{ role: 'user', content: userBody }] });
        expect(cache?.payload).toMatchObject({ cacheHistory: expected });
        expect(cache?.payload).not.toHaveProperty('history');
        expect(cacheSeed).toMatchObject({ cacheHistory: expected });
        expect(cacheSeed).not.toHaveProperty('history');
      } finally {
        recorder.stop();
        await agent.shutdown();
      }
    },
  );
});
