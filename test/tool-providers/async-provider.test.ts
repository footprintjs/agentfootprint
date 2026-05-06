/**
 * Async ToolProvider — v2.11.6 type widening tests.
 *
 * Pins the contract for `ToolProvider.list(ctx)` returning either
 * `readonly Tool[]` (sync, default) OR `Promise<readonly Tool[]>`
 * (discovery-style providers backed by network catalogs / hubs).
 *
 * Coverage:
 *   1. Sync path  — `list()` returns Tool[]; the agent never awaits.
 *   2. Async path — `list()` returns Promise; the agent awaits + dispatches.
 *   3. Sync throw — provider throws synchronously → discovery_failed event.
 *   4. Async reject — provider rejects → discovery_failed event.
 *   5. Signal abort — env.signal flows to provider; provider can short-circuit.
 *   6. Mixed sync/async chain — gatedTools(asyncInner, predicate) preserves async.
 *   7. No double-discovery — one list() call per iteration, even when LLM
 *      dispatches the resulting tool (toolCalls handler reads from cache).
 *   8. Concurrent agents share one provider safely (reentrancy contract).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  Agent,
  defineTool,
  gatedTools,
  mock,
  staticTools,
  type LLMToolSchema,
  type Tool,
  type ToolDispatchContext,
  type ToolProvider,
} from '../../src/index.js';

// ─── Fixtures ─────────────────────────────────────────────────────

function fakeTool(name: string, body = 'ok'): Tool {
  return defineTool({
    name,
    description: name,
    inputSchema: { type: 'object' },
    execute: async () => `${name}:${body}`,
  });
}

const baseCtx: ToolDispatchContext = {
  iteration: 1,
  identity: { conversationId: 'c1' },
};

// ─── 1. SYNC PATH (zero microtask overhead) ──────────────────────

describe('async-provider — sync path', () => {
  it('sync list() returns Tool[] directly without wrapping in Promise', () => {
    const provider: ToolProvider = {
      id: 'sync',
      list: () => [fakeTool('a')],
    };
    const result = provider.list(baseCtx);
    // Hot path: `result instanceof Promise` is false, agent skips await.
    expect(result instanceof Promise).toBe(false);
    expect((result as readonly Tool[])[0]?.schema.name).toBe('a');
  });

  it('built-in staticTools is sync (zero overhead path)', () => {
    const result = staticTools([fakeTool('a')]).list(baseCtx);
    expect(result instanceof Promise).toBe(false);
  });

  it('built-in gatedTools over sync inner stays sync', () => {
    const inner = staticTools([fakeTool('a'), fakeTool('b')]);
    const gated = gatedTools(inner, (n) => n === 'a');
    const result = gated.list(baseCtx);
    expect(result instanceof Promise).toBe(false);
    expect((result as readonly Tool[]).map((t) => t.schema.name)).toEqual(['a']);
  });
});

// ─── 2. ASYNC PATH ────────────────────────────────────────────────

describe('async-provider — async path', () => {
  it('async list() returns Promise; resolves to Tool[]', async () => {
    const provider: ToolProvider = {
      id: 'async',
      async list() {
        await Promise.resolve(); // simulate I/O
        return [fakeTool('discovered')];
      },
    };
    const result = provider.list(baseCtx);
    expect(result instanceof Promise).toBe(true);
    const visible = await result;
    expect(visible.map((t) => t.schema.name)).toEqual(['discovered']);
  });

  it('agent awaits async provider and dispatches the discovered tool', async () => {
    let observedToolNames: string[] = [];
    let toolDispatched = false;
    const llm = mock({
      respond: (req: {
        tools?: readonly LLMToolSchema[];
        messages: readonly { role: string }[];
      }) => {
        observedToolNames = (req.tools ?? []).map((t) => t.name);
        const sawToolResult = req.messages.some((m) => m.role === 'tool');
        if (sawToolResult) return { content: 'final', toolCalls: [] };
        return {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'discovered', args: {} }],
        };
      },
    });
    const tool = defineTool({
      name: 'discovered',
      description: 'd',
      inputSchema: { type: 'object' },
      execute: async () => {
        toolDispatched = true;
        return 'ok';
      },
    });
    const provider: ToolProvider = {
      id: 'rube-async',
      async list() {
        await Promise.resolve();
        return [tool];
      },
    };

    const agent = Agent.create({ provider: llm, model: 'mock' })
      .system('s')
      .toolProvider(provider)
      .build();
    await agent.run({ message: 'go' });

    expect(observedToolNames).toContain('discovered');
    expect(toolDispatched).toBe(true);
  });
});

// ─── 3. SYNC THROW → discovery_failed event ──────────────────────

describe('async-provider — sync throw', () => {
  it('emits agentfootprint.tools.discovery_failed with providerId + error', async () => {
    const captured: Array<{ providerId?: string; error: string; iteration: number }> = [];
    const llm = mock({ respond: () => ({ content: 'ok', toolCalls: [] }) });
    const provider: ToolProvider = {
      id: 'broken-hub',
      list() {
        throw new Error('hub unreachable');
      },
    };
    const agent = Agent.create({ provider: llm, model: 'mock' })
      .system('s')
      .toolProvider(provider)
      .build();
    agent.on('agentfootprint.tools.discovery_failed', (e) => {
      captured.push({
        providerId: e.payload.providerId,
        error: e.payload.error,
        iteration: e.payload.iteration,
      });
    });
    await expect(agent.run({ message: 'go' })).rejects.toThrow(/hub unreachable/);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      providerId: 'broken-hub',
      error: 'hub unreachable',
      iteration: 1,
    });
  });
});

// ─── 4. ASYNC REJECT → discovery_failed event ────────────────────

describe('async-provider — async reject', () => {
  it('rejected Promise emits discovery_failed and aborts iteration', async () => {
    const captured: Array<{ providerId?: string; errorName: string }> = [];
    const llm = mock({ respond: () => ({ content: 'ok', toolCalls: [] }) });
    const provider: ToolProvider = {
      id: 'flaky-hub',
      async list() {
        await Promise.resolve();
        const e = new TypeError('catalog fetch 503');
        throw e;
      },
    };
    const agent = Agent.create({ provider: llm, model: 'mock' })
      .system('s')
      .toolProvider(provider)
      .build();
    agent.on('agentfootprint.tools.discovery_failed', (e) => {
      captured.push({
        providerId: e.payload.providerId,
        errorName: e.payload.errorName,
      });
    });
    await expect(agent.run({ message: 'go' })).rejects.toThrow(/catalog fetch 503/);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({ providerId: 'flaky-hub', errorName: 'TypeError' });
  });
});

// ─── 5. SIGNAL PROPAGATION ───────────────────────────────────────

describe('async-provider — signal propagation', () => {
  it('env.signal flows into ctx.signal so providers can honor abort', async () => {
    const sawSignals: AbortSignal[] = [];
    const llm = mock({ respond: () => ({ content: 'ok', toolCalls: [] }) });
    const provider: ToolProvider = {
      id: 'signal-aware',
      list(ctx) {
        if (ctx.signal) sawSignals.push(ctx.signal);
        return [fakeTool('a')];
      },
    };
    const agent = Agent.create({ provider: llm, model: 'mock' })
      .system('s')
      .toolProvider(provider)
      .build();
    const controller = new AbortController();
    await agent.run({ message: 'go' }, { env: { signal: controller.signal } });
    expect(sawSignals).toHaveLength(1);
    expect(sawSignals[0]).toBe(controller.signal);
  });

  it('ctx.signal is undefined when the agent runs without an env.signal', async () => {
    let sawSignal: AbortSignal | undefined;
    const llm = mock({ respond: () => ({ content: 'ok', toolCalls: [] }) });
    const provider: ToolProvider = {
      id: 'optional-signal',
      list(ctx) {
        sawSignal = ctx.signal;
        return [fakeTool('a')];
      },
    };
    const agent = Agent.create({ provider: llm, model: 'mock' })
      .system('s')
      .toolProvider(provider)
      .build();
    await agent.run({ message: 'go' });
    expect(sawSignal).toBeUndefined();
  });
});

// ─── 6. MIXED CHAIN — async inner + sync gate ───────────────────

describe('async-provider — mixed sync/async chain', () => {
  it('gatedTools(asyncInner, pred) returns Promise; filter applies after await', async () => {
    const asyncInner: ToolProvider = {
      id: 'async-inner',
      async list() {
        await Promise.resolve();
        return [fakeTool('a'), fakeTool('b'), fakeTool('c')];
      },
    };
    const gated = gatedTools(asyncInner, (n) => n !== 'b');
    const result = gated.list(baseCtx);
    expect(result instanceof Promise).toBe(true);
    const visible = await result;
    expect(visible.map((t) => t.schema.name)).toEqual(['a', 'c']);
  });
});

// ─── 7. NO DOUBLE-DISCOVERY (cache contract) ─────────────────────

describe('async-provider — single list() call per iteration', () => {
  it('agent calls provider.list(ctx) exactly once per iteration even when dispatching', async () => {
    const listSpy = vi.fn();
    const tool = defineTool({
      name: 'echo',
      description: 'e',
      inputSchema: { type: 'object' },
      execute: async () => 'echoed',
    });
    const provider: ToolProvider = {
      id: 'count',
      async list(ctx) {
        listSpy(ctx.iteration);
        await Promise.resolve();
        return [tool];
      },
    };
    let calls = 0;
    const llm = mock({
      respond: () => {
        calls++;
        if (calls === 1) {
          return { content: '', toolCalls: [{ id: 'tc-1', name: 'echo', args: {} }] };
        }
        return { content: 'final', toolCalls: [] };
      },
    });
    const agent = Agent.create({ provider: llm, model: 'mock', maxIterations: 4 })
      .system('s')
      .toolProvider(provider)
      .build();
    await agent.run({ message: 'go' });

    // 2 iterations × 1 list() call each = 2. Without the cache,
    // dispatch would re-invoke list() → 3 calls.
    expect(listSpy).toHaveBeenCalledTimes(2);
    expect(listSpy).toHaveBeenNthCalledWith(1, 1);
    expect(listSpy).toHaveBeenNthCalledWith(2, 2);
  });
});

// ─── 9. DISCOVERY EVENTS — start/complete ordering + timing ──────

describe('async-provider — discovery_started / discovery_completed', () => {
  it('emits started → completed in order with toolCount and durationMs', async () => {
    const events: Array<{
      type: 'started' | 'completed';
      providerId?: string;
      iteration: number;
      durationMs?: number;
      toolCount?: number;
    }> = [];
    const llm = mock({ respond: () => ({ content: 'final', toolCalls: [] }) });
    const provider: ToolProvider = {
      id: 'timed-hub',
      async list() {
        await new Promise((r) => setTimeout(r, 5));
        return [fakeTool('a'), fakeTool('b'), fakeTool('c')];
      },
    };
    const agent = Agent.create({ provider: llm, model: 'mock' })
      .system('s')
      .toolProvider(provider)
      .build();
    agent.on('agentfootprint.tools.discovery_started', (e) => {
      events.push({
        type: 'started',
        providerId: e.payload.providerId,
        iteration: e.payload.iteration,
      });
    });
    agent.on('agentfootprint.tools.discovery_completed', (e) => {
      events.push({
        type: 'completed',
        providerId: e.payload.providerId,
        iteration: e.payload.iteration,
        durationMs: e.payload.durationMs,
        toolCount: e.payload.toolCount,
      });
    });
    await agent.run({ message: 'go' });

    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('started');
    expect(events[0]?.providerId).toBe('timed-hub');
    expect(events[1]?.type).toBe('completed');
    expect(events[1]?.toolCount).toBe(3);
    // durationMs should reflect the 5ms sleep — tolerant lower bound,
    // generous upper bound to absorb CI jitter.
    expect(events[1]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(events[1]?.durationMs).toBeLessThan(500);
  });

  it('failed discovery emits started → failed (no completed)', async () => {
    const order: string[] = [];
    const llm = mock({ respond: () => ({ content: 'ok', toolCalls: [] }) });
    const provider: ToolProvider = {
      id: 'broken-hub',
      list() {
        throw new Error('boom');
      },
    };
    const agent = Agent.create({ provider: llm, model: 'mock' })
      .system('s')
      .toolProvider(provider)
      .build();
    agent.on('agentfootprint.tools.discovery_started', () => order.push('started'));
    agent.on('agentfootprint.tools.discovery_completed', () => order.push('completed'));
    agent.on('agentfootprint.tools.discovery_failed', (e) => {
      order.push('failed');
      expect(e.payload.durationMs).toBeGreaterThanOrEqual(0);
    });

    await expect(agent.run({ message: 'go' })).rejects.toThrow();
    expect(order).toEqual(['started', 'failed']);
  });

  it('no-provider agents emit zero discovery events (no-op Discover stage)', async () => {
    const events: string[] = [];
    const llm = mock({ respond: () => ({ content: 'final', toolCalls: [] }) });
    const agent = Agent.create({ provider: llm, model: 'mock' })
      .system('s')
      .tool(fakeTool('inline'))
      .build();
    agent.on('agentfootprint.tools.discovery_started', () => events.push('started'));
    agent.on('agentfootprint.tools.discovery_completed', () => events.push('completed'));
    agent.on('agentfootprint.tools.discovery_failed', () => events.push('failed'));

    await agent.run({ message: 'go' });
    expect(events).toEqual([]);
  });
});

// ─── 8. CONCURRENT AGENTS SHARING ONE PROVIDER ───────────────────

describe('async-provider — concurrent agents (reentrancy)', () => {
  it('two agents using the same async provider in parallel both see their own tools', async () => {
    const provider: ToolProvider = {
      id: 'shared-async',
      async list(ctx) {
        // simulate variable I/O latency keyed by iteration so the
        // promises resolve out of order
        await new Promise((r) => setTimeout(r, ctx.iteration * 5));
        return [fakeTool(`t-${ctx.iteration}`)];
      },
    };
    const observedA: string[] = [];
    const observedB: string[] = [];
    const llmA = mock({
      respond: (req: { tools?: readonly LLMToolSchema[] }) => {
        for (const t of req.tools ?? []) observedA.push(t.name);
        return { content: 'done', toolCalls: [] };
      },
    });
    const llmB = mock({
      respond: (req: { tools?: readonly LLMToolSchema[] }) => {
        for (const t of req.tools ?? []) observedB.push(t.name);
        return { content: 'done', toolCalls: [] };
      },
    });
    const agentA = Agent.create({ provider: llmA, model: 'mock' })
      .system('s')
      .toolProvider(provider)
      .build();
    const agentB = Agent.create({ provider: llmB, model: 'mock' })
      .system('s')
      .toolProvider(provider)
      .build();
    await Promise.all([agentA.run({ message: 'a' }), agentB.run({ message: 'b' })]);

    // Both agents ran iteration 1 → both saw t-1
    expect(observedA).toContain('t-1');
    expect(observedB).toContain('t-1');
  });
});
