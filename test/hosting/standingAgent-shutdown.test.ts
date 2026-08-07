/**
 * standingAgent shutdown wiring (8.12.0) — 7-pattern tests.
 *
 * The laws being pinned:
 *   • close() DRAINS the agent's telemetry by default — a batching exporter
 *     losing its last batch when the server stops is the most common way a
 *     shutdown lies about what happened.
 *   • Draining is not releasing. 'flush' leaves the strategies running,
 *     because this composer BORROWED the agent; only 'flush-and-stop' says
 *     the agent's life ends with the host.
 *   • Signals are opt-in, and when taken they are given back: handlers are
 *     removed and the signal is re-raised so the process dies the way the
 *     platform meant it to.
 *
 *   P1 Unit         — default is 'flush'; 'none' touches nothing
 *   P2 Boundary     — 'flush-and-stop' releases; close() is idempotent
 *   P3 Scenario     — a served request's telemetry reaches the sink on close
 *   P4 Property     — no signal listener exists unless asked for
 *   P5 Security     — shutdownOn removes its listeners and re-raises
 *   P6 Performance  — close() on an idle host stays fast
 *   P7 ROI          — the SIGTERM story, end to end, in one option
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Agent } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { memorySessions, standingAgent } from '../../src/hosting/index.js';
import type { ObservabilityStrategy } from '../../src/strategies/types.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { inProcessHost } from './testHost.js';

// ── Helpers ──────────────────────────────────────────────────────────

interface Recording extends ObservabilityStrategy {
  readonly exported: AgentfootprintEvent[];
  readonly buffered: AgentfootprintEvent[];
  flushes: number;
  stops: number;
}

/** Buffers like a real batching exporter, so "was it flushed" is observable. */
function recordingStrategy(): Recording {
  const exported: AgentfootprintEvent[] = [];
  const buffered: AgentfootprintEvent[] = [];
  return {
    name: 'recording',
    capabilities: { events: true },
    exported,
    buffered,
    flushes: 0,
    stops: 0,
    exportEvent(event: AgentfootprintEvent) {
      buffered.push(event);
    },
    flush(): Promise<void> {
      this.flushes += 1;
      exported.push(...buffered.splice(0));
      return Promise.resolve();
    },
    stop(): void {
      this.stops += 1;
    },
  } as Recording;
}

function buildAgent(): Agent {
  return Agent.create({ provider: mock({ responses: ['hello'] }), model: 'mock' })
    .system('You answer.')
    .build();
}

const SIGNAL: NodeJS.Signals = 'SIGUSR2';

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('standingAgent shutdown — P1 unit', () => {
  it('P1 close() flushes the agent telemetry by default', async () => {
    const agent = buildAgent();
    const strategy = recordingStrategy();
    agent.enable.observability({ strategy, tier: 'firehose' });
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions: memorySessions(), host });

    await host.deliver({ input: 'hi', sessionId: 's1' });
    expect(strategy.exported).toHaveLength(0);

    await handle.close();
    expect(strategy.exported.length).toBeGreaterThan(0);
    // Drained, NOT released — this composer only borrowed the agent.
    expect(strategy.stops).toBe(0);
  });

  it("P1 shutdown: 'none' touches nothing (pre-8.12.0 behaviour)", async () => {
    const agent = buildAgent();
    const strategy = recordingStrategy();
    agent.enable.observability({ strategy, tier: 'firehose' });
    const host = inProcessHost();
    const handle = await standingAgent({
      agent,
      sessions: memorySessions(),
      host,
      shutdown: 'none',
    });

    await host.deliver({ input: 'hi', sessionId: 's1' });
    await handle.close();
    expect(strategy.flushes).toBe(0);
    expect(strategy.exported).toHaveLength(0);
    expect(strategy.stops).toBe(0);
  });
});

// ─── P2 Boundary ─────────────────────────────────────────────────────

describe('standingAgent shutdown — P2 boundary', () => {
  it("P2 shutdown: 'flush-and-stop' drains AND releases", async () => {
    const agent = buildAgent();
    const strategy = recordingStrategy();
    agent.enable.observability({ strategy, tier: 'firehose' });
    const host = inProcessHost();
    const handle = await standingAgent({
      agent,
      sessions: memorySessions(),
      host,
      shutdown: 'flush-and-stop',
    });

    await host.deliver({ input: 'hi', sessionId: 's1' });
    await handle.close();
    expect(strategy.exported.length).toBeGreaterThan(0);
    expect(strategy.stops).toBe(1);
  });

  it('P2 close() is idempotent — the first call owns the shutdown', async () => {
    const agent = buildAgent();
    const strategy = recordingStrategy();
    agent.enable.observability({ strategy, tier: 'firehose' });
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions: memorySessions(), host });

    await host.deliver({ input: 'hi', sessionId: 's1' });
    await Promise.all([handle.close(), handle.close()]);
    await handle.close();
    expect(strategy.flushes).toBe(1);
  });
});

// ─── P3 Scenario ─────────────────────────────────────────────────────

describe('standingAgent shutdown — P3 scenario', () => {
  it('P3 everything a served request produced reaches the sink on close', async () => {
    const agent = buildAgent();
    const strategy = recordingStrategy();
    agent.enable.observability({ strategy, tier: 'firehose' });
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions: memorySessions(), host });

    const reply = await host.deliver({ input: 'hi', sessionId: 's1' });
    expect(reply.output).toBeTruthy();
    await handle.close();

    const types = strategy.exported.map((e) => e.type);
    expect(types).toContain('agentfootprint.agent.turn_start');
    expect(types).toContain('agentfootprint.agent.turn_end');
  });
});

// ─── P4 Property ─────────────────────────────────────────────────────

describe('standingAgent shutdown — P4 property', () => {
  it('P4 no signal listener exists unless shutdownOn asked for one', async () => {
    const before = process.listenerCount(SIGNAL);
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: buildAgent(),
      sessions: memorySessions(),
      host,
    });
    expect(process.listenerCount(SIGNAL)).toBe(before);
    await handle.close();
    expect(process.listenerCount(SIGNAL)).toBe(before);
  });

  it('P4 shutdownOn installs one listener and close() gives it back', async () => {
    const before = process.listenerCount(SIGNAL);
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: buildAgent(),
      sessions: memorySessions(),
      host,
      shutdownOn: [SIGNAL],
    });
    expect(process.listenerCount(SIGNAL)).toBe(before + 1);
    await handle.close();
    expect(process.listenerCount(SIGNAL)).toBe(before);
  });
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('standingAgent shutdown — P5 security', () => {
  it('P5 a signal closes the host, removes the listener, and re-raises', async () => {
    const before = process.listenerCount(SIGNAL);
    // `process.kill` is intercepted: the real call would end this test run,
    // which is exactly the point — the library hands the signal back to its
    // DEFAULT disposition rather than choosing an exit code of its own.
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const agent = buildAgent();
    const strategy = recordingStrategy();
    agent.enable.observability({ strategy, tier: 'firehose' });
    const host = inProcessHost();
    await standingAgent({
      agent,
      sessions: memorySessions(),
      host,
      shutdownOn: [SIGNAL],
    });
    await host.deliver({ input: 'hi', sessionId: 's1' });

    process.emit(SIGNAL);
    // The handler is async; let its close() settle.
    for (let i = 0; i < 50; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(strategy.exported.length).toBeGreaterThan(0); // drained
    expect(process.listenerCount(SIGNAL)).toBe(before); // handed back
    expect(kill).toHaveBeenCalledWith(process.pid, SIGNAL); // re-raised
  });
});

// ─── P6 Performance ──────────────────────────────────────────────────

describe('standingAgent shutdown — P6 performance', () => {
  it('P6 close() on an idle host is not slowed by the drain', async () => {
    const agent = buildAgent();
    agent.enable.observability({ strategy: recordingStrategy(), tier: 'firehose' });
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions: memorySessions(), host });
    const started = performance.now();
    await handle.close();
    expect(performance.now() - started).toBeLessThan(100);
  });
});

// ─── P7 ROI ──────────────────────────────────────────────────────────

describe('standingAgent shutdown — P7 ROI', () => {
  it('P7 the whole SIGTERM story is one option, and the batch survives it', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const agent = buildAgent();
    const strategy = recordingStrategy();
    agent.enable.observability({ strategy, tier: 'firehose' });
    const host = inProcessHost();

    await standingAgent({
      agent,
      sessions: memorySessions(),
      host,
      shutdown: 'flush-and-stop',
      shutdownOn: [SIGNAL],
    });
    await host.deliver({ input: 'hi', sessionId: 'prod-1' });

    process.emit(SIGNAL);
    for (let i = 0; i < 50; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(strategy.exported.length).toBeGreaterThan(0);
    expect(strategy.stops).toBe(1);
    expect(kill).toHaveBeenCalledOnce();
  });
});
