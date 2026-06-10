/**
 * Observer delivery tier (RFC-001 Block 10) — `AgentOptions.observerDelivery`.
 *
 * The compatibility bar: a `'deferred'` agent's `agent.on()` listeners must
 * receive the SAME typed events (type + payload + stage anchor, in the same
 * order) an `'inline'` agent delivers — one beat later, fully drained before
 * `run()` returns. Plus the per-bridge pins:
 *
 *   - causal-evidence recorder stays INLINE even under 'deferred' (the
 *     memory write stage consumes `collect()` MID-run);
 *   - crash checkpoints + error.fatal stay complete under 'deferred'
 *     (terminal flush at the reject boundary);
 *   - pause returns with the pre-pause record already delivered;
 *   - default ('inline') attaches NO deferred tier — `observerStats` absent.
 */

import { describe, it, expect, vi } from 'vitest';
import { disableDevMode, enableDevMode } from 'footprintjs';
import {
  Agent,
  defineMemory,
  defineTool,
  InMemoryStore,
  MEMORY_STRATEGIES,
  MEMORY_TYPES,
  SNAPSHOT_PROJECTIONS,
  mock,
  mockEmbedder,
} from '../../../src/index.js';
import { isPaused, pauseHere } from '../../../src/core/pause.js';
import { RunCheckpointError } from '../../../src/core/runCheckpoint.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';
import type { CombinedRecorder, EmitEvent } from 'footprintjs';

// ─── helpers ──────────────────────────────────────────────────────

function scripted(...responses: readonly LLMResponse[]): LLMProvider {
  let i = 0;
  return {
    name: 'mock',
    complete: async () => responses[Math.min(i++, responses.length - 1)],
  };
}

function resp(
  content: string,
  toolCalls: readonly { id: string; name: string; args: Record<string, unknown> }[] = [],
): LLMResponse {
  return {
    content,
    toolCalls,
    usage: { input: 10, output: 5 },
    stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
  };
}

const lookupTool = {
  schema: { name: 'lookup', description: 'look something up', inputSchema: { type: 'object' } },
  execute: () => '3 results',
};

/** Two tool iterations then a final answer — a small but real ReAct loop. */
function scriptedReplies() {
  return [
    { content: 'Looking…', toolCalls: [{ id: 't1', name: 'lookup', args: { q: 'a' } }] },
    { content: 'One more…', toolCalls: [{ id: 't2', name: 'lookup', args: { q: 'b' } }] },
    { content: 'All done.', toolCalls: [] },
  ];
}

function buildAgent(observer?: {
  delivery?: 'inline' | 'deferred';
  options?: import('../../../src/index.js').ObserverDeliveryOptions;
}) {
  return Agent.create({
    provider: mock({ replies: scriptedReplies(), chunkDelayMs: 0 }),
    model: 'mock',
    maxIterations: 5,
    ...(observer?.delivery !== undefined && { observerDelivery: observer.delivery }),
    ...(observer?.options !== undefined && { observerDeliveryOptions: observer.options }),
  })
    .system('You answer questions.')
    .tool(lookupTool)
    .build();
}

/**
 * Normalize an event for cross-run comparison: drop wall-clock-dependent
 * numbers (any key ending in `ms`, case-insensitive) and per-run ids.
 * Everything else — types, payload values, stage anchors, ORDER — must
 * match exactly between inline and deferred delivery.
 */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/ms$/i.test(k) && typeof v === 'number') {
        out[k] = 0;
      } else if (k === 'runId' || k === 'correlationId') {
        out[k] = '<run>';
      } else {
        out[k] = normalize(v);
      }
    }
    return out;
  }
  return value;
}

interface Collected {
  readonly type: string;
  readonly payload: unknown;
  readonly runtimeStageId: string;
}

function collectAll(agent: Agent): Collected[] {
  const events: Collected[] = [];
  agent.on('*', (e) => {
    events.push({
      type: e.type,
      payload: normalize(e.payload),
      runtimeStageId: e.meta.runtimeStageId,
    });
  });
  return events;
}

// ─── construction validation ──────────────────────────────────────

describe('observerDelivery — construction', () => {
  it('throws when observerDeliveryOptions is set without observerDelivery: "deferred"', () => {
    expect(() =>
      Agent.create({
        provider: mock({ reply: 'ok' }),
        model: 'mock',
        observerDeliveryOptions: { maxQueue: 100 },
      }).build(),
    ).toThrow(/observerDeliveryOptions requires observerDelivery: 'deferred'/);
  });

  it('accepts the dials together with observerDelivery: "deferred"', () => {
    expect(() =>
      Agent.create({
        provider: mock({ reply: 'ok' }),
        model: 'mock',
        observerDelivery: 'deferred',
        observerDeliveryOptions: { maxQueue: 100, flushBudgetMs: 5 },
      }).build(),
    ).not.toThrow();
  });
});

// ─── parity: the compatibility bar ────────────────────────────────

describe('observerDelivery — deferred/inline event parity', () => {
  it('agent.on() listeners receive identical typed events (type+payload+anchor, same order)', async () => {
    const inlineAgent = buildAgent(); // default 'inline'
    const deferredAgent = buildAgent({ delivery: 'deferred' });

    const inlineEvents = collectAll(inlineAgent);
    const deferredEvents = collectAll(deferredAgent);

    const inlineOut = await inlineAgent.run({ message: 'find it' });
    const deferredOut = await deferredAgent.run({ message: 'find it' });

    expect(deferredOut).toEqual(inlineOut);
    // A real run, not a degenerate one: streaming tokens + tools + iterations.
    expect(inlineEvents.length).toBeGreaterThan(20);
    expect(inlineEvents.some((e) => e.type === 'agentfootprint.stream.token')).toBe(true);
    expect(inlineEvents.some((e) => e.type === 'agentfootprint.stream.tool_end')).toBe(true);
    // Byte-equal after wall-clock normalization — the drop-in-port bar.
    expect(deferredEvents).toEqual(inlineEvents);
  });

  it('narrative entries are identical (the built-in narrative recorder stays inline)', async () => {
    const inlineAgent = buildAgent();
    const deferredAgent = buildAgent({ delivery: 'deferred' });
    await inlineAgent.run({ message: 'find it' });
    await deferredAgent.run({ message: 'find it' });

    // Narrative embeds one wall-clock value (turnStartMs) — scrub epoch
    // timestamps; everything else must match byte-for-byte.
    const texts = (a: Agent) =>
      a.getLastNarrativeEntries().map((e) => e.text.replace(/\b\d{13}\b/g, '<ts>'));
    expect(texts(deferredAgent)).toEqual(texts(inlineAgent));
  });
});

// ─── default-off byte-identity ────────────────────────────────────

describe('observerDelivery — default is inline (zero deferred footprint)', () => {
  it('omitting the option attaches NO deferred tier: snapshot.observerStats is absent', async () => {
    const agent = buildAgent();
    await agent.run({ message: 'find it' });
    expect(agent.getLastSnapshot()?.observerStats).toBeUndefined();
  });

  it("observerDelivery: 'deferred' surfaces observerStats with the bridge ids; causal-evidence is NOT on the deferred tier", async () => {
    const store = new InMemoryStore();
    const agent = Agent.create({
      provider: mock({ replies: scriptedReplies(), chunkDelayMs: 0 }),
      model: 'mock',
      maxIterations: 5,
      observerDelivery: 'deferred',
    })
      .system('')
      .tool(lookupTool)
      .memory(
        defineMemory({
          id: 'causal',
          type: MEMORY_TYPES.CAUSAL,
          strategy: {
            kind: MEMORY_STRATEGIES.TOP_K,
            topK: 1,
            threshold: 0,
            embedder: mockEmbedder(),
          },
          store,
          projection: SNAPSHOT_PROJECTIONS.DECISIONS,
        }),
      )
      .build();
    await agent.run({ message: 'find it', identity: { conversationId: 'c1' } });

    const stats = agent.getLastSnapshot()?.observerStats;
    expect(stats).toBeDefined();
    const listenerIds = Object.keys(stats?.perListener ?? {});
    expect(listenerIds).toContain('agentfootprint.stream-recorder');
    expect(listenerIds).toContain('agentfootprint.agent-recorder');
    expect(listenerIds).toContain('agentfootprint.context-recorder');
    // The per-bridge INLINE pin: the evidence harvester must never ride the
    // queue — the memory write stage reads `collect()` mid-run.
    expect(listenerIds).not.toContain('causal-evidence');
    // Nothing lost, nothing stranded.
    expect(stats?.drops).toBe(0);
    expect(stats?.terminalStranded).toBe(0);
    expect(stats?.depth).toBe(0);
  });
});

// ─── per-bridge pin: causal evidence stays complete under 'deferred' ──

describe("observerDelivery — causal evidence is complete under 'deferred'", () => {
  it('writeSnapshot persists REAL tool/token evidence (collect() ran inline)', async () => {
    const IDENTITY = { tenant: 'acme', conversationId: 'conv-1' };
    const store = new InMemoryStore();
    const creditTool = defineTool({
      name: 'credit_check',
      description: 'Look up the credit score.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      execute: async () => '580',
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          {
            content: 'Checking.',
            toolCalls: [{ id: 'c1', name: 'credit_check', args: { id: '42' } }],
            usage: { input: 100, output: 20 },
          },
          { content: 'REJECTED: 580 < 600.', toolCalls: [], usage: { input: 150, output: 30 } },
        ],
        chunkDelayMs: 0,
      }),
      model: 'mock',
      maxIterations: 4,
      observerDelivery: 'deferred',
    })
      .tools([creditTool])
      .memory(
        defineMemory({
          id: 'causal',
          type: MEMORY_TYPES.CAUSAL,
          strategy: {
            kind: MEMORY_STRATEGIES.TOP_K,
            topK: 1,
            threshold: 0,
            embedder: mockEmbedder(),
          },
          store,
          projection: SNAPSHOT_PROJECTIONS.DECISIONS,
        }),
      )
      .build();

    await agent.run({ message: 'underwrite loan #42', identity: IDENTITY });

    const result = await store.list<{
      toolCalls?: readonly { name: string }[];
      tokenUsage?: { input: number; output: number };
      iterations?: number;
    }>(IDENTITY);
    const snaps = result.entries
      .map((e) => e.value)
      .filter((v) => v && typeof v === 'object' && 'toolCalls' in v);
    expect(snaps.length).toBe(1);
    const s = snaps[0]!;
    // Would be [] / zeros if the evidence recorder ran one beat behind.
    expect(s.toolCalls?.length).toBe(1);
    expect(s.toolCalls?.[0]?.name).toBe('credit_check');
    expect(s.tokenUsage?.input).toBeGreaterThan(0);
    expect(s.tokenUsage?.output).toBeGreaterThan(0);
    expect(s.iterations).toBeGreaterThan(0);
  });
});

// ─── terminal completeness: crash ─────────────────────────────────

describe("observerDelivery — terminal completeness on crash ('deferred')", () => {
  it('RunCheckpointError carries the full pre-crash history; error.fatal delivered before the rejection', async () => {
    let calls = 0;
    const provider: LLMProvider = {
      name: 'mock',
      complete: async () => {
        calls += 1;
        if (calls >= 2) throw new Error('provider 503');
        return resp('Looking…', [{ id: 't1', name: 'lookup', args: { q: 'a' } }]);
      },
    };
    const agent = Agent.create({
      provider,
      model: 'mock',
      maxIterations: 5,
      observerDelivery: 'deferred',
    })
      .system('')
      .tool(lookupTool)
      .build();

    const fatal: unknown[] = [];
    const iterationEnds: unknown[] = [];
    agent.on('agentfootprint.error.fatal', (e) => fatal.push(e.payload));
    agent.on('agentfootprint.agent.iteration_end', (e) => iterationEnds.push(e.payload));

    let caught: unknown;
    try {
      await agent.run({ message: 'go' });
    } catch (err) {
      caught = err;
      // The reject-boundary terminal flush already drained the queue:
      // both the iteration record AND the fatal signal are delivered
      // BEFORE the rejection reached this catch.
      expect(fatal.length).toBe(1);
      expect(iterationEnds.length).toBe(1);
    }
    expect(caught).toBeInstanceOf(RunCheckpointError);
    const checkpoint = (caught as RunCheckpointError).checkpoint;
    // iteration 1 completed through the DEFERRED agent-recorder bridge —
    // the checkpoint tracker saw it via the terminal flush.
    expect(checkpoint.lastCompletedIteration).toBe(1);
    expect(checkpoint.history.length).toBeGreaterThan(0);
  });
});

// ─── terminal completeness: pause ─────────────────────────────────

describe("observerDelivery — terminal completeness on pause ('deferred')", () => {
  it('pre-pause events are fully delivered when run() returns paused; resume completes', async () => {
    const agent = Agent.create({
      provider: scripted(
        resp('', [{ id: 't1', name: 'approve', args: { action: 'refund' } }]),
        resp('done'),
      ),
      model: 'mock',
      observerDelivery: 'deferred',
    })
      .system('')
      .tool({
        schema: { name: 'approve', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({ question: 'Approve refund?' });
          return '';
        },
      })
      .build();

    const types: string[] = [];
    agent.on('*', (e) => types.push(e.type));

    const result = await agent.run({ message: 'refund me' });
    expect(isPaused(result)).toBe(true);
    if (!isPaused(result)) return;
    // The pause-boundary terminal flush delivered the pre-pause record.
    expect(types).toContain('agentfootprint.stream.llm_start');
    expect(types).toContain('agentfootprint.stream.llm_end');
    expect(types).toContain('agentfootprint.stream.tool_start');
    expect(types).toContain('agentfootprint.pause.request');

    const resumed = await agent.resume(result.checkpoint, { approved: true });
    expect(resumed).toBe('done');
    expect(types).toContain('agentfootprint.agent.turn_end');
  });
});

// ─── per-recorder tier override (the field form wins) ─────────────

describe('observerDelivery — consumer recorder field overrides the agent default', () => {
  it("a recorder declaring delivery: 'inline' stays off the queue under a 'deferred' agent", async () => {
    const pinnedInline: CombinedRecorder = {
      id: 'pinned-inline',
      delivery: 'inline',
      onEmit: () => {},
    };
    const followsDefault: CombinedRecorder = {
      id: 'follows-default',
      onEmit: () => {},
    };
    const agent = buildAgent({ delivery: 'deferred' });
    agent.attach(pinnedInline);
    agent.attach(followsDefault);
    await agent.run({ message: 'find it' });

    const listenerIds = Object.keys(agent.getLastSnapshot()?.observerStats?.perListener ?? {});
    expect(listenerIds).toContain('follows-default');
    expect(listenerIds).not.toContain('pinned-inline');
  });

  it("a recorder declaring delivery: 'deferred' rides the queue under a default (inline) agent", async () => {
    const optedIn: CombinedRecorder = {
      id: 'opted-in',
      delivery: 'deferred',
      onEmit: () => {},
    };
    const agent = buildAgent(); // default inline
    agent.attach(optedIn);
    await agent.run({ message: 'find it' });

    const listenerIds = Object.keys(agent.getLastSnapshot()?.observerStats?.perListener ?? {});
    expect(listenerIds).toContain('opted-in');
  });
});

// ─── typedEmit payload contract (dev-mode guard) ──────────────────

describe('typedEmit — dev-mode unclonable-payload guard', () => {
  it('warns ONCE per event type when a payload holds a live scope proxy (dev mode only)', async () => {
    const { typedEmit } = await import('../../../src/recorders/core/typedEmit.js');
    const fakeScope = { $emit: () => {} };
    // A bare Proxy is the same failure class as a TypedScope read:
    // structuredClone throws DataCloneError.
    const proxyPayload = new Proxy([], {}) as never;

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Production (dev mode off): silent.
      typedEmit(fakeScope, 'agentfootprint.eval.guard_probe_off' as never, proxyPayload);
      expect(warn).not.toHaveBeenCalled();

      enableDevMode();
      typedEmit(fakeScope, 'agentfootprint.eval.guard_probe' as never, proxyPayload);
      typedEmit(fakeScope, 'agentfootprint.eval.guard_probe' as never, proxyPayload);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('not structured-clone-safe');

      // Clonable payloads never warn.
      typedEmit(fakeScope, 'agentfootprint.eval.guard_probe_ok' as never, { ok: true } as never);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      disableDevMode();
      warn.mockRestore();
    }
  });
});

// ─── drainObservers ───────────────────────────────────────────────

describe('agent.drainObservers', () => {
  it('resolves with zeros before any run', async () => {
    const agent = buildAgent({ delivery: 'deferred' });
    await expect(agent.drainObservers()).resolves.toEqual({ done: 0, failed: 0, pending: 0 });
  });

  it('settles async listener continuations after a deferred run (pending === 0)', async () => {
    const settled: string[] = [];
    const asyncRecorder: CombinedRecorder = {
      id: 'async-exporter',
      onEmit: async (e: EmitEvent) => {
        await new Promise((r) => setTimeout(r, 1));
        settled.push(e.name);
      },
    };
    const agent = buildAgent({ delivery: 'deferred' });
    agent.attach(asyncRecorder);
    await agent.run({ message: 'find it' });

    const drain = await agent.drainObservers({ timeoutMs: 5_000 });
    expect(drain.pending).toBe(0);
    expect(settled.length).toBeGreaterThan(0);
  });
});
