/**
 * runCheckpoint — 7-pattern tests for fault-tolerant resume.
 *
 *   P1 Unit         — successful run NEVER throws RunCheckpointError
 *   P2 Boundary     — error after iteration 1 throws RunCheckpointError with checkpoint
 *   P3 Scenario     — resumeOnError replays from checkpoint, picks up at next iteration
 *   P4 Property     — checkpoint is JSON-serializable (Redis/Postgres/S3 ready)
 *   P5 Security     — validateCheckpoint rejects malformed payloads
 *   P6 Performance  — happy path zero-overhead (no try/catch impact)
 *   P7 ROI          — failure-phase classifier surfaces useful triage info
 */

import { describe, expect, it } from 'vitest';
import { Agent } from '../../src/core/Agent.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import {
  buildCheckpoint,
  classifyFailurePhase,
  RunCheckpointError,
  validateCheckpoint,
  type AgentRunCheckpoint,
  type RunCheckpointTracker,
} from '../../src/core/runCheckpoint.js';
import type { LLMMessage } from '../../src/adapters/types.js';

// ── Test helpers ─────────────────────────────────────────────────────

/**
 * A provider that errors on the Nth call. Mimics a transient vendor
 * outage — first calls succeed, then a 503 hits.
 */
function makeFlakeProvider(failOnCall: number, errorMessage = 'vendor 503') {
  let calls = 0;
  return {
    name: 'flake',
    calls() {
      return calls;
    },
    async complete(_req: unknown) {
      calls += 1;
      if (calls === failOnCall) throw new Error(errorMessage);
      // Use mock's reply path for happy calls.
      return mock({ replies: [{ content: 'ok response' }] }).complete(_req as never);
    },
  };
}

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('runCheckpoint — P1 unit', () => {
  it('P1 successful run never throws RunCheckpointError', async () => {
    const agent = Agent.create({
      provider: mock({ replies: [{ content: 'happy path' }] }),
      model: 'mock',
    })
      .system('You answer succinctly.')
      .build();

    const result = await agent.run({ message: 'hi' });
    expect(typeof result).toBe('string');
  });
});

// ─── P2 Boundary — error after iteration produces checkpoint ─────────

describe('runCheckpoint — P2 boundary', () => {
  it('P2 LLM error after iteration boundary throws RunCheckpointError with checkpoint', async () => {
    // mock with a single happy reply followed by a throw.
    let call = 0;
    const provider = {
      name: 'flake',
      async complete() {
        call += 1;
        if (call >= 2) throw new Error('vendor 503');
        // First call: tool-call response so the loop continues to iter 2.
        return {
          content: '',
          toolCalls: [{ id: 't1', name: 'noop', args: {} }],
          usage: { input: 1, output: 1 },
        };
      },
    };

    const agent = Agent.create({ provider: provider as never, model: 'mock' })
      .system('s')
      .tool({
        schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
        execute: () => 'noop result',
      })
      .build();

    let captured: RunCheckpointError | undefined;
    try {
      await agent.run({ message: 'try' });
    } catch (e) {
      if (e instanceof RunCheckpointError) captured = e;
    }
    expect(captured).toBeInstanceOf(RunCheckpointError);
    expect(captured!.code).toBe('ERR_RUN_CHECKPOINT');
    expect(captured!.cause.message).toMatch(/vendor 503/);
    expect(captured!.checkpoint.version).toBe(1);
    expect(captured!.checkpoint.history.length).toBeGreaterThan(0);
    expect(captured!.checkpoint.lastCompletedIteration).toBeGreaterThanOrEqual(0);
    expect(captured!.checkpoint.originalInput.message).toBe('try');
  });
});

// ─── P3 Scenario — resumeOnError replays from checkpoint ─────────────

describe('runCheckpoint — P3 scenario', () => {
  it('P3 resumeOnError completes the run from the captured checkpoint', async () => {
    let call = 0;
    const provider = {
      name: 'flake',
      async complete() {
        call += 1;
        // Iter 1: tool call → succeeds
        // Iter 2 (first attempt): vendor 503 → throws, checkpoint captured
        // Iter 2 (resume attempt): final answer → success
        if (call === 1) {
          return {
            content: '',
            toolCalls: [{ id: 't1', name: 'noop', args: {} }],
            usage: { input: 1, output: 1 },
          };
        }
        if (call === 2) throw new Error('transient 503');
        return {
          content: 'recovered final answer',
          toolCalls: [],
          usage: { input: 1, output: 1 },
        };
      },
    };

    const agent = Agent.create({ provider: provider as never, model: 'mock' })
      .system('s')
      .tool({
        schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
        execute: () => 'noop',
      })
      .build();

    let checkpoint: AgentRunCheckpoint | undefined;
    try {
      await agent.run({ message: 'task' });
    } catch (e) {
      if (e instanceof RunCheckpointError) checkpoint = e.checkpoint;
    }
    expect(checkpoint).toBeDefined();

    const resumed = await agent.resumeOnError(checkpoint!);
    expect(resumed).toBe('recovered final answer');
  });
});

// ─── P4 Property — JSON-serializable checkpoint ──────────────────────

describe('runCheckpoint — P4 property', () => {
  it('P4 checkpoint round-trips through JSON.stringify / parse', () => {
    const tracker: RunCheckpointTracker = {
      runId: 'r-1',
      originalInput: { message: 'orig' },
      history: [{ role: 'user', content: 'hello' } as LLMMessage],
      lastCompletedIteration: 2,
    };
    const cp = buildCheckpoint(tracker, { iteration: 3, phase: 'llm' });
    const serialized = JSON.stringify(cp);
    const parsed = JSON.parse(serialized);
    expect(() => validateCheckpoint(parsed)).not.toThrow();
    const validated = validateCheckpoint(parsed);
    expect(validated.runId).toBe('r-1');
    expect(validated.originalInput.message).toBe('orig');
    expect(validated.history).toHaveLength(1);
    expect(validated.failurePoint?.phase).toBe('llm');
  });

  it('P4 checkpoint with no failurePoint also round-trips', () => {
    const tracker: RunCheckpointTracker = {
      runId: 'r-2',
      originalInput: { message: 'orig' },
      history: [],
      lastCompletedIteration: 0,
    };
    const cp = buildCheckpoint(tracker);
    expect(cp.failurePoint).toBeUndefined();
    const validated = validateCheckpoint(JSON.parse(JSON.stringify(cp)));
    expect(validated.failurePoint).toBeUndefined();
  });
});

// ─── P5 Security — validate rejects malformed checkpoints ────────────

describe('runCheckpoint — P5 security', () => {
  it('P5 rejects null / undefined / non-object', () => {
    expect(() => validateCheckpoint(null)).toThrow(TypeError);
    expect(() => validateCheckpoint(undefined)).toThrow(TypeError);
    expect(() => validateCheckpoint('string')).toThrow(TypeError);
  });

  it('P5 rejects checkpoint with wrong version (forward-compat guard)', () => {
    const futureCheckpoint = {
      version: 2,
      runId: 'r',
      history: [],
      lastCompletedIteration: 0,
      originalInput: { message: 'm' },
      checkpointedAt: 0,
    };
    expect(() => validateCheckpoint(futureCheckpoint)).toThrow(/version/);
  });

  it('P5 rejects checkpoint missing required fields', () => {
    expect(() => validateCheckpoint({ version: 1, runId: 'r' })).toThrow(/required/);
    expect(() =>
      validateCheckpoint({ version: 1, runId: 'r', history: [], lastCompletedIteration: 0 }),
    ).toThrow(/originalInput/);
  });
});

// ─── P6 Performance — happy path zero-overhead ───────────────────────

describe('runCheckpoint — P6 performance', () => {
  it('P6 happy path with checkpoint tracker installed completes promptly', async () => {
    const agent = Agent.create({
      provider: mock({ replies: [{ content: 'fast' }] }),
      model: 'mock',
    })
      .system('s')
      .build();
    const t0 = performance.now();
    const result = await agent.run({ message: 'hi' });
    const elapsed = performance.now() - t0;
    expect(result).toBe('fast');
    // No assertion on absolute timing — pace varies. We're just
    // verifying tracker installation doesn't deadlock or timeout.
    expect(elapsed).toBeLessThan(5000);
  });
});

// ─── P7 ROI — failure-phase classifier ───────────────────────────────

describe('runCheckpoint — P7 ROI', () => {
  it('P7 classifies CircuitOpenError as `llm` phase', () => {
    const err = Object.assign(new Error('circuit open'), {
      code: 'ERR_CIRCUIT_OPEN',
    });
    expect(classifyFailurePhase(err)).toBe('llm');
  });

  it('P7 classifies provider-name errors as `llm` phase', () => {
    const err = new Error('Anthropic 503 service unavailable');
    expect(classifyFailurePhase(err)).toBe('llm');
  });

  it('P7 classifies tool errors as `tool` phase', () => {
    const err = new Error('Tool execute failed');
    expect(classifyFailurePhase(err)).toBe('tool');
  });

  it('P7 unknown errors default to `unknown` (still recoverable)', () => {
    const err = new Error('something exploded');
    expect(classifyFailurePhase(err)).toBe('unknown');
  });
});
