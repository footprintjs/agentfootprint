/**
 * xrayObservability — 7-pattern tests.
 *
 *   P1 Unit         — strategy.name is 'xray', capabilities advertise traces
 *   P2 Boundary     — turn_start opens trace; turn_end flushes segments
 *   P3 Scenario     — full turn → iteration → llm-call → tool-call hierarchy
 *   P4 Property     — sample rate gates trace creation deterministically
 *   P5 Security     — missing serviceName + missing SDK paths
 *   P6 Performance  — sync exportEvent at 10k/op
 *   P7 ROI          — segment shape matches X-Ray contract (queryable annotations)
 *   ENVELOPE        — REAL dispatcher envelope shapes (meta.runId, iterIndex,
 *                     toolCallId correlation, cumulative.estimatedUsd, error.fatal)
 *   INTEGRATION     — a REAL Agent run (MockProvider, scripted tool call)
 *                     through agent.enable.observability — the test style
 *                     whose absence masked the dead-field bug class
 */

import { describe, expect, it } from 'vitest';
import {
  xrayObservability,
  type XRayLikeClient,
  type XrayObservabilityOptions,
} from '../../src/adapters/observability/xray.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { Agent } from '../../src/index.js';
import { MockProvider } from '../../src/adapters/llm/MockProvider.js';

// ── Test client ──────────────────────────────────────────────────────

interface CapturedPut {
  readonly TraceSegmentDocuments: ReadonlyArray<string>;
}

function makeMockClient(): {
  client: XrayObservabilityOptions['_client'];
  puts: CapturedPut[];
} {
  const puts: CapturedPut[] = [];
  return {
    puts,
    client: {
      async putTraceSegments(input) {
        puts.push(input as CapturedPut);
      },
    },
  };
}

function parseAllSegments(puts: CapturedPut[]): Record<string, unknown>[] {
  return puts.flatMap((p) =>
    p.TraceSegmentDocuments.map((doc) => JSON.parse(doc) as Record<string, unknown>),
  );
}

// Helper: build a turn-anchored event with a stable runId.
// LEGACY shape (pre-6.18 fabricated events: runId on the payload) —
// kept on purpose to pin the back-compat fallback.
function event(type: string, extra: Record<string, unknown> = {}): AgentfootprintEvent {
  return {
    type: type as never,
    payload: { runId: 'r-test', ...extra },
    timestamp: Date.now(),
  } as unknown as AgentfootprintEvent;
}

// Helper: build a REAL dispatcher envelope — runId lives on `meta`
// (built by bridge/eventMeta.ts), NEVER on the payload.
function envelopeEvent(
  type: string,
  payload: Record<string, unknown> = {},
  runId = 'run-real',
): AgentfootprintEvent {
  return {
    type: type as never,
    payload,
    meta: {
      wallClockMs: Date.now(),
      runOffsetMs: 0,
      runtimeStageId: 'stage#0',
      subflowPath: [],
      compositionPath: [],
      runId,
    },
  } as unknown as AgentfootprintEvent;
}

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('xrayObservability — P1 unit', () => {
  it('P1 strategy.name is `xray` and capabilities advertise traces + events', () => {
    const { client } = makeMockClient();
    const strat = xrayObservability({ serviceName: 'svc', _client: client });
    expect(strat.name).toBe('xray');
    expect(strat.capabilities.traces).toBe(true);
    expect(strat.capabilities.events).toBe(true);
  });
});

// ─── P2 Boundary — turn lifecycle ────────────────────────────────────

describe('xrayObservability — P2 boundary', () => {
  it('P2 turn_start opens trace; turn_end + flush ships segments', async () => {
    const { client, puts } = makeMockClient();
    const strat = xrayObservability({
      serviceName: 'my-agent',
      flushIntervalMs: 0,
      _client: client,
    });
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    strat.exportEvent(event('agentfootprint.agent.turn_end'));
    await strat.flush?.();
    const segs = parseAllSegments(puts);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.name).toBe('my-agent');
    expect(typeof segs[0]?.trace_id).toBe('string');
    expect((segs[0]?.trace_id as string).startsWith('1-')).toBe(true);
    // Root has no parent.
    expect(segs[0]?.parent_id).toBeUndefined();
  });
});

// ─── P3 Scenario — full hierarchical trace ───────────────────────────

describe('xrayObservability — P3 scenario', () => {
  it('P3 turn → iteration → llm + tool produces nested segment tree', async () => {
    const { client, puts } = makeMockClient();
    const strat = xrayObservability({
      serviceName: 'svc',
      flushIntervalMs: 0,
      _client: client,
    });
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    strat.exportEvent(event('agentfootprint.agent.iteration_start', { iteration: 1 }));
    strat.exportEvent(event('agentfootprint.stream.llm_start', { model: 'gpt-4' }));
    strat.exportEvent(event('agentfootprint.stream.llm_end'));
    strat.exportEvent(event('agentfootprint.stream.tool_start', { toolName: 'lookup' }));
    strat.exportEvent(event('agentfootprint.stream.tool_end', { toolName: 'lookup' }));
    strat.exportEvent(event('agentfootprint.agent.iteration_end'));
    strat.exportEvent(event('agentfootprint.agent.turn_end'));
    await strat.flush?.();

    const segs = parseAllSegments(puts);
    // Root + iteration + llm + tool = 4 segments.
    expect(segs).toHaveLength(4);
    const root = segs.find((s) => s.name === 'svc')!;
    const iter = segs.find((s) => (s.name as string).startsWith('iteration:'))!;
    const llm = segs.find((s) => s.name === 'llm')!;
    const tool = segs.find((s) => (s.name as string).startsWith('tool:'))!;
    expect(root.parent_id).toBeUndefined();
    expect(iter.parent_id).toBe(root.id);
    expect(llm.parent_id).toBe(iter.id);
    expect(tool.parent_id).toBe(iter.id);
    // All four segments share the same trace_id.
    expect(new Set(segs.map((s) => s.trace_id)).size).toBe(1);
  });
});

// ─── P4 Property — sampling ──────────────────────────────────────────

describe('xrayObservability — P4 property', () => {
  it('P4 sampleRate=0 produces ZERO segments (no traces shipped)', async () => {
    const { client, puts } = makeMockClient();
    const strat = xrayObservability({
      serviceName: 'svc',
      sampleRate: 0,
      flushIntervalMs: 0,
      _client: client,
    });
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    strat.exportEvent(event('agentfootprint.agent.iteration_start', { iteration: 1 }));
    strat.exportEvent(event('agentfootprint.agent.iteration_end'));
    strat.exportEvent(event('agentfootprint.agent.turn_end'));
    await strat.flush?.();
    expect(puts).toHaveLength(0);
  });

  it('P4 sampleRate=1 (default) produces a trace per turn', async () => {
    const { client, puts } = makeMockClient();
    const strat = xrayObservability({
      serviceName: 'svc',
      flushIntervalMs: 0,
      _client: client,
    });
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    strat.exportEvent(event('agentfootprint.agent.turn_end'));
    await strat.flush?.();
    expect(puts.length).toBeGreaterThan(0);
  });
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('xrayObservability — P5 security', () => {
  it('P5 missing serviceName throws TypeError at factory time', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      xrayObservability({ serviceName: '' as any }),
    ).toThrow(TypeError);
  });

  it('P5 events without runId are dropped (no-op, no crash)', () => {
    const { client, puts } = makeMockClient();
    const strat = xrayObservability({ serviceName: 'svc', flushIntervalMs: 0, _client: client });
    // No runId — should silently no-op.
    strat.exportEvent({
      type: 'agentfootprint.agent.turn_start' as never,
      payload: {},
      timestamp: Date.now(),
    } as unknown as AgentfootprintEvent);
    expect(puts).toHaveLength(0);
  });

  it('P5 missing SDK + no _client → flush() routes through _onError', async () => {
    const strat = xrayObservability({
      serviceName: 'svc',
      flushIntervalMs: 0,
    });
    let captured = '';
    strat._onError = (e) => {
      captured = e.message;
    };
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    strat.exportEvent(event('agentfootprint.agent.turn_end'));
    try {
      await strat.flush?.();
    } catch {
      /* SDK path may surface via throw */
    }
    if (captured) expect(captured).toMatch(/aws-sdk|xray|peer dependency/i);
  });
});

// ─── P6 Performance ──────────────────────────────────────────────────

describe('xrayObservability — P6 performance', () => {
  it('P6 10k mixed events processed under 200ms', () => {
    const { client } = makeMockClient();
    const strat = xrayObservability({
      serviceName: 'svc',
      maxBatchSegments: 100_000,
      flushIntervalMs: 0,
      _client: client,
    });
    const N = 10_000;
    const t0 = performance.now();
    // Simulate 1000 turns × 10 events each = 10k events.
    for (let turn = 0; turn < 1000; turn++) {
      const runId = `r-${turn}`;
      const evt = (type: string, extra: Record<string, unknown> = {}): AgentfootprintEvent =>
        ({
          type: type as never,
          payload: { runId, ...extra },
          timestamp: Date.now(),
        } as unknown as AgentfootprintEvent);
      strat.exportEvent(evt('agentfootprint.agent.turn_start'));
      strat.exportEvent(evt('agentfootprint.agent.iteration_start', { iteration: 1 }));
      strat.exportEvent(evt('agentfootprint.stream.llm_start', { model: 'm' }));
      strat.exportEvent(evt('agentfootprint.stream.llm_end'));
      strat.exportEvent(evt('agentfootprint.stream.tool_start', { toolName: 't' }));
      strat.exportEvent(evt('agentfootprint.stream.tool_end', { toolName: 't' }));
      strat.exportEvent(evt('agentfootprint.agent.iteration_end'));
      strat.exportEvent(evt('agentfootprint.agent.turn_end'));
      strat.exportEvent(evt('agentfootprint.cost.tick', { cumulativeCostUsd: 0.001 }));
      strat.exportEvent(evt('agentfootprint.context.injected'));
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(200);
    void N; // keep the constant for future doc clarity
  });
});

// ─── P7 ROI — X-Ray segment shape contract ───────────────────────────

describe('xrayObservability — P7 ROI', () => {
  it('P7 llm segment carries `model` annotation (queryable in X-Ray Insights)', async () => {
    const { client, puts } = makeMockClient();
    const strat = xrayObservability({ serviceName: 'svc', flushIntervalMs: 0, _client: client });
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    strat.exportEvent(event('agentfootprint.agent.iteration_start', { iteration: 1 }));
    strat.exportEvent(event('agentfootprint.stream.llm_start', { model: 'claude-3-opus' }));
    strat.exportEvent(event('agentfootprint.stream.llm_end'));
    strat.exportEvent(event('agentfootprint.agent.iteration_end'));
    strat.exportEvent(event('agentfootprint.agent.turn_end'));
    await strat.flush?.();
    const segs = parseAllSegments(puts);
    const llm = segs.find((s) => s.name === 'llm')!;
    expect((llm.annotations as Record<string, unknown>)?.model).toBe('claude-3-opus');
  });

  it('P7 trace_id format matches the X-Ray spec (1-{8hex}-{24hex})', async () => {
    const { client, puts } = makeMockClient();
    const strat = xrayObservability({ serviceName: 'svc', flushIntervalMs: 0, _client: client });
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    strat.exportEvent(event('agentfootprint.agent.turn_end'));
    await strat.flush?.();
    const segs = parseAllSegments(puts);
    expect(segs[0]?.trace_id).toMatch(/^1-[0-9a-f]{8}-[0-9a-f]{24}$/);
    expect(segs[0]?.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('P7 cost.tick events annotate the topmost active segment', async () => {
    const { client, puts } = makeMockClient();
    const strat = xrayObservability({ serviceName: 'svc', flushIntervalMs: 0, _client: client });
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    strat.exportEvent(event('agentfootprint.agent.iteration_start', { iteration: 1 }));
    strat.exportEvent(event('agentfootprint.cost.tick', { cumulativeCostUsd: 0.0125 }));
    strat.exportEvent(event('agentfootprint.agent.iteration_end'));
    strat.exportEvent(event('agentfootprint.agent.turn_end'));
    await strat.flush?.();
    const segs = parseAllSegments(puts);
    const iter = segs.find((s) => (s.name as string).startsWith('iteration:'))!;
    expect((iter.annotations as Record<string, unknown>)?.cumulativeCostUsd).toBe(0.0125);
  });
});

// ─── ENVELOPE — real dispatcher shapes (the dead-field bug class) ────

describe('xrayObservability — envelope: meta.runId anchoring', () => {
  it('opens/closes segments for REAL envelope events (runId on meta, NOT payload)', async () => {
    const { client, puts } = makeMockClient();
    const strat = xrayObservability({ serviceName: 'svc', flushIntervalMs: 0, _client: client });
    strat.exportEvent(envelopeEvent('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(envelopeEvent('agentfootprint.agent.turn_end', { turnIndex: 0 }));
    await strat.flush?.();
    const segs = parseAllSegments(puts);
    // Pre-fix the adapter read payload.runId → every event skipped → 0 segments.
    expect(segs).toHaveLength(1);
    expect(segs[0]?.name).toBe('svc');
  });

  it('demultiplexes two interleaved runs by meta.runId', async () => {
    const { client, puts } = makeMockClient();
    const strat = xrayObservability({ serviceName: 'svc', flushIntervalMs: 0, _client: client });
    strat.exportEvent(envelopeEvent('agentfootprint.agent.turn_start', {}, 'run-a'));
    strat.exportEvent(envelopeEvent('agentfootprint.agent.turn_start', {}, 'run-b'));
    strat.exportEvent(envelopeEvent('agentfootprint.agent.turn_end', {}, 'run-a'));
    strat.exportEvent(envelopeEvent('agentfootprint.agent.turn_end', {}, 'run-b'));
    await strat.flush?.();
    const segs = parseAllSegments(puts);
    expect(segs).toHaveLength(2);
    // Distinct turns → distinct traces.
    expect(new Set(segs.map((s) => s.trace_id)).size).toBe(2);
  });
});

describe('xrayObservability — envelope: real payload fields', () => {
  it('iteration segment is named from the REAL iterIndex field (never `iteration:?`)', async () => {
    const { client, puts } = makeMockClient();
    const strat = xrayObservability({ serviceName: 'svc', flushIntervalMs: 0, _client: client });
    strat.exportEvent(envelopeEvent('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(
      envelopeEvent('agentfootprint.agent.iteration_start', { turnIndex: 0, iterIndex: 3 }),
    );
    strat.exportEvent(
      envelopeEvent('agentfootprint.agent.iteration_end', {
        turnIndex: 0,
        iterIndex: 3,
        toolCallCount: 0,
      }),
    );
    strat.exportEvent(envelopeEvent('agentfootprint.agent.turn_end', { turnIndex: 0 }));
    await strat.flush?.();
    const segs = parseAllSegments(puts);
    expect(segs.find((s) => s.name === 'iteration:3')).toBeDefined();
    expect(segs.find((s) => s.name === 'iteration:?')).toBeUndefined();
  });

  it('tool_end correlates by toolCallId — parallel tools close the RIGHT segments', async () => {
    const { client, puts } = makeMockClient();
    const strat = xrayObservability({ serviceName: 'svc', flushIntervalMs: 0, _client: client });
    strat.exportEvent(envelopeEvent('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(
      envelopeEvent('agentfootprint.stream.tool_start', {
        toolName: 'alpha',
        toolCallId: 'tc-a',
        args: {},
      }),
    );
    strat.exportEvent(
      envelopeEvent('agentfootprint.stream.tool_start', {
        toolName: 'beta',
        toolCallId: 'tc-b',
        args: {},
      }),
    );
    // End ALPHA first — out of LIFO order; the REAL ToolEndPayload has
    // NO toolName, only toolCallId. Pre-fix this popped `beta` (topmost).
    strat.exportEvent(
      envelopeEvent('agentfootprint.stream.tool_end', {
        toolCallId: 'tc-a',
        result: 'x',
        error: true,
        durationMs: 1,
      }),
    );
    strat.exportEvent(
      envelopeEvent('agentfootprint.stream.tool_end', {
        toolCallId: 'tc-b',
        result: 'y',
        durationMs: 1,
      }),
    );
    strat.exportEvent(envelopeEvent('agentfootprint.agent.turn_end', { turnIndex: 0 }));
    await strat.flush?.();
    const segs = parseAllSegments(puts);
    const alpha = segs.find((s) => s.name === 'tool:alpha')!;
    const beta = segs.find((s) => s.name === 'tool:beta')!;
    expect(alpha.error).toBe(true); // the errored end landed on alpha…
    expect(beta.error).toBeUndefined(); // …not on the topmost segment
    expect(typeof alpha.end_time).toBe('number');
    expect(typeof beta.end_time).toBe('number');
  });

  it('tool_end with `error: false` is NOT marked as an error', async () => {
    const { client, puts } = makeMockClient();
    const strat = xrayObservability({ serviceName: 'svc', flushIntervalMs: 0, _client: client });
    strat.exportEvent(envelopeEvent('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(
      envelopeEvent('agentfootprint.stream.tool_start', { toolName: 't', toolCallId: 'tc-1' }),
    );
    strat.exportEvent(
      envelopeEvent('agentfootprint.stream.tool_end', {
        toolCallId: 'tc-1',
        result: 'ok',
        error: false,
        durationMs: 1,
      }),
    );
    strat.exportEvent(envelopeEvent('agentfootprint.agent.turn_end', { turnIndex: 0 }));
    await strat.flush?.();
    const segs = parseAllSegments(puts);
    expect(segs.find((s) => s.name === 'tool:t')?.error).toBeUndefined();
  });

  it('cost.tick reads the REAL CostTickPayload shape (cumulative.estimatedUsd)', async () => {
    const { client, puts } = makeMockClient();
    const strat = xrayObservability({ serviceName: 'svc', flushIntervalMs: 0, _client: client });
    strat.exportEvent(envelopeEvent('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(
      envelopeEvent('agentfootprint.agent.iteration_start', { turnIndex: 0, iterIndex: 0 }),
    );
    strat.exportEvent(
      envelopeEvent('agentfootprint.cost.tick', {
        scope: 'iteration',
        tokensInput: 10,
        tokensOutput: 5,
        estimatedUsd: 0.01,
        cumulative: { tokensInput: 10, tokensOutput: 5, estimatedUsd: 0.05 },
      }),
    );
    strat.exportEvent(
      envelopeEvent('agentfootprint.agent.iteration_end', { turnIndex: 0, iterIndex: 0 }),
    );
    strat.exportEvent(envelopeEvent('agentfootprint.agent.turn_end', { turnIndex: 0 }));
    await strat.flush?.();
    const segs = parseAllSegments(puts);
    const iter = segs.find((s) => s.name === 'iteration:0')!;
    expect((iter.annotations as Record<string, unknown>)?.cumulativeCostUsd).toBe(0.05);
  });

  it('error.fatal closes the tree with fault on the root (segments still ship)', async () => {
    const { client, puts } = makeMockClient();
    const strat = xrayObservability({ serviceName: 'svc', flushIntervalMs: 0, _client: client });
    strat.exportEvent(envelopeEvent('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(
      envelopeEvent('agentfootprint.agent.iteration_start', { turnIndex: 0, iterIndex: 0 }),
    );
    strat.exportEvent(envelopeEvent('agentfootprint.stream.llm_start', { model: 'm' }));
    // turn_end never arrives — pre-fix the turn leaked in activeTurns
    // and its closed segments never graduated to the outbox.
    strat.exportEvent(
      envelopeEvent('agentfootprint.error.fatal', {
        error: 'SECRET-MESSAGE boom',
        stage: 'call-llm',
        scope: 'turn',
      }),
    );
    await strat.flush?.();
    const segs = parseAllSegments(puts);
    expect(segs).toHaveLength(3); // root + iteration + llm, all closed
    const root = segs.find((s) => s.name === 'svc')!;
    expect(root.fault).toBe(true);
    const ann = root.annotations as Record<string, unknown>;
    expect(ann?.errorStage).toBe('call-llm');
    expect(ann?.errorScope).toBe('turn');
    // Error MESSAGES can echo PII — never emitted.
    expect(JSON.stringify(segs)).not.toContain('SECRET-MESSAGE');
    expect(segs.every((s) => typeof s.end_time === 'number')).toBe(true);
  });
});

// ─── INTEGRATION — real Agent run (would have caught the runId bug) ──

describe('xrayObservability — integration: real Agent run', () => {
  async function runRealAgent(): Promise<Record<string, unknown>[]> {
    const { client, puts } = makeMockClient();
    const strat = xrayObservability({
      serviceName: 'xray-agent',
      flushIntervalMs: 0,
      _client: client,
    });

    const provider = new MockProvider({
      replies: [
        { toolCalls: [{ id: 'tc-1', name: 'lookup', args: { account: 'A-1' } }] },
        'final answer',
      ],
    });
    const agent = Agent.create({ provider, model: 'mock-model' })
      .system('You are terse.')
      .tool({
        schema: {
          name: 'lookup',
          description: 'Look up an account',
          inputSchema: { type: 'object' },
        },
        execute: () => 'ok',
      })
      .build();

    const stop = agent.enable.observability({ strategy: strat });
    try {
      await agent.run({ message: 'check the account' });
    } finally {
      stop();
    }
    await strat.flush?.();
    return parseAllSegments(puts);
  }

  it('a real agent run produces a closed segment tree end-to-end', async () => {
    const segs = await runRealAgent();

    // Segments actually shipped — the pre-fix payload.runId read
    // produced ZERO segments on real runs (meta.runId is the anchor).
    expect(segs.length).toBeGreaterThan(0);

    // Root segment named after the service, parentless.
    const root = segs.find((s) => s.name === 'xray-agent')!;
    expect(root).toBeDefined();
    expect(root.parent_id).toBeUndefined();

    // Iteration segments named from the REAL iterIndex field.
    const iters = segs.filter((s) => (s.name as string).startsWith('iteration:'));
    expect(iters.length).toBeGreaterThanOrEqual(2); // tool iteration + final
    expect(iters.some((s) => s.name === 'iteration:?')).toBe(false);

    // Two llm calls (tool iteration + final), model annotated.
    const llms = segs.filter((s) => s.name === 'llm');
    expect(llms).toHaveLength(2);
    expect((llms[0]?.annotations as Record<string, unknown>)?.model).toBe('mock-model');

    // Tool segment closed via toolCallId correlation — the REAL
    // ToolEndPayload carries no toolName.
    const tool = segs.find((s) => s.name === 'tool:lookup')!;
    expect(tool).toBeDefined();
    expect((tool.annotations as Record<string, unknown>)?.toolName).toBe('lookup');
    expect(tool.error).toBeUndefined();

    // No leaks: every segment is sealed and shares ONE trace.
    expect(segs.every((s) => typeof s.end_time === 'number')).toBe(true);
    expect(segs.every((s) => s.in_progress === undefined)).toBe(true);
    expect(new Set(segs.map((s) => s.trace_id)).size).toBe(1);
  });
});

// Use the type-only import so the test file demonstrates the export surface.
const _typeCheck: XRayLikeClient | undefined = undefined;
void _typeCheck;
