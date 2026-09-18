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
import { expectWithinReferenceUnits, measureAsync } from '../helpers/perf.js';

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

  // ── findingsLedger (9.101.0) — value-conditional, the `folded` precedent ──
  const LEDGER_TRACKER: RunCheckpointTracker = {
    runId: 'r-ledger',
    originalInput: { message: 'orig' },
    history: [{ role: 'user', content: 'hello' } as LLMMessage],
    lastCompletedIteration: 1,
  };
  const LEDGER: AgentRunCheckpoint['findingsLedger'] = [
    { kind: 'basis', toolCallId: 'tc-1', toolName: 'search', iteration: 1, basis: 'direct' },
    {
      kind: 'standing',
      toolCallId: 'tc-1',
      toolName: 'search',
      standing: 'noise',
      assertions: [],
      declaredOn: { toolCallId: 'tc-2' },
      iteration: 2,
    },
  ];

  it('P4 findingsLedger is ABSENT when nothing was passed — the pre-ledger key set, byte for byte', () => {
    const before = Object.keys(buildCheckpoint(LEDGER_TRACKER)).sort();
    const withUndefined = buildCheckpoint(
      LEDGER_TRACKER,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(Object.keys(withUndefined).sort()).toEqual(before);
    expect(Object.prototype.hasOwnProperty.call(withUndefined, 'findingsLedger')).toBe(false);
  });

  it('P4 findingsLedger is ABSENT when the ledger is empty — an empty key is a different claim', () => {
    const cp = buildCheckpoint(
      LEDGER_TRACKER,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [],
    );
    expect(Object.prototype.hasOwnProperty.call(cp, 'findingsLedger')).toBe(false);
  });

  it('P4 findingsLedger is carried verbatim when non-empty and round-trips through JSON', () => {
    const cp = buildCheckpoint(
      LEDGER_TRACKER,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      LEDGER,
    );
    expect(cp.findingsLedger).toEqual(LEDGER);
    const validated = validateCheckpoint(JSON.parse(JSON.stringify(cp)));
    expect(validated.findingsLedger).toEqual(LEDGER);
    // Version 1 still — an optional field is not a format change.
    expect(validated.version).toBe(1);
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

  it('P5 accepts a checkpoint WITHOUT findingsLedger exactly as before (present-only rule)', () => {
    const cp = buildCheckpoint({
      runId: 'r-3',
      originalInput: { message: 'orig' },
      history: [],
      lastCompletedIteration: 0,
    });
    expect(() => validateCheckpoint(JSON.parse(JSON.stringify(cp)))).not.toThrow();
  });

  it('P5 rejects a findingsLedger that is not an array', () => {
    const cp = buildCheckpoint({
      runId: 'r-4',
      originalInput: { message: 'orig' },
      history: [],
      lastCompletedIteration: 0,
    });
    const bad = { ...cp, findingsLedger: { kind: 'basis' } };
    expect(() => validateCheckpoint(bad)).toThrow(/findingsLedger/);
  });

  it('P5 rejects a findingsLedger row without a known `kind`', () => {
    const cp = buildCheckpoint({
      runId: 'r-5',
      originalInput: { message: 'orig' },
      history: [],
      lastCompletedIteration: 0,
    });
    for (const row of [null, 'basis', ['basis'], { kind: 'disposition' }, {}]) {
      expect(() => validateCheckpoint({ ...cp, findingsLedger: [row] })).toThrow(/findingsLedger/);
    }
  });

  it('P5 accepts the judge’s rows and a contingent row — every kind the one writer files (9.110.0)', () => {
    // A checkpoint of a judged run was refused on resume before 9.110.0: the
    // door named three kinds while `recordFindings` had filed five.
    const cp = buildCheckpoint({
      runId: 'r-7',
      originalInput: { message: 'orig' },
      history: [],
      lastCompletedIteration: 0,
    });
    const rows: unknown[] = [
      {
        kind: 'judgment',
        toolCallId: 'tc-1',
        toolName: 'search',
        source: 'judge',
        judge: { name: 'mock', model: 'm' },
        against: 'question',
        standing: 'noise',
        probabilities: { fact: 0.1, open: 0.1, noise: 0.7, 'ruled-out': 0.1 },
        confidence: 0.6,
        latencyMs: 3,
        iteration: 1,
      },
      {
        kind: 'judgment-error',
        toolCallId: 'tc-2',
        toolName: 'search',
        source: 'judge',
        judge: { name: 'mock' },
        message: 'boom',
        latencyMs: 2,
        iteration: 2,
      },
      {
        kind: 'contingent',
        declaredOn: { toolCallId: 'tc-3' },
        value: 'fc1/7',
        carriers: [{ toolCallId: 'tc-1', standing: 'noise' }],
        iteration: 3,
      },
      {
        kind: 'contingent',
        declaredOn: 'answer',
        value: '41200',
        carriers: [
          { toolCallId: 'tc-1', standing: 'open' },
          { toolCallId: 'tc-2', standing: 'ruled-out' },
        ],
        iteration: 4,
      },
    ];
    const validated = validateCheckpoint(
      JSON.parse(JSON.stringify({ ...cp, findingsLedger: rows })),
    );
    expect(validated.findingsLedger).toEqual(rows);
    // …and a contingent row the rule could not have written is refused at
    // the door: a field the piece reads missing, NO carrier (the rule files
    // one row per value with at least one), a `fact` carrier (one fact
    // carrier means the value stands), a standing outside the vocabulary.
    const one = [{ toolCallId: 'tc-1', standing: 'noise' }];
    for (const bad of [
      { kind: 'contingent', declaredOn: 'answer', value: 'x', iteration: 1 },
      { kind: 'contingent', declaredOn: 'answer', carriers: one, iteration: 1 },
      { kind: 'contingent', declaredOn: { ref: 'x' }, value: 'x', carriers: one, iteration: 1 },
      { kind: 'contingent', declaredOn: 'answer', value: 'x', carriers: [], iteration: 1 },
      {
        kind: 'contingent',
        declaredOn: 'answer',
        value: 'x',
        carriers: [{ toolCallId: 'tc-1', standing: 'fact' }],
        iteration: 1,
      },
      {
        kind: 'contingent',
        declaredOn: 'answer',
        value: 'x',
        carriers: [{ toolCallId: 'tc-1', standing: 'maybe' }],
        iteration: 1,
      },
      { kind: 'judgment', toolCallId: 'tc-1', standing: 'maybe', iteration: 1 },
    ]) {
      expect(() => validateCheckpoint({ ...cp, findingsLedger: [bad] })).toThrow(/findingsLedger/);
    }
  });

  it('P5 rejects a well-kinded row missing a field the fold consumes — the door, not the kind tag', () => {
    const cp = buildCheckpoint({
      runId: 'r-6',
      originalInput: { message: 'orig' },
      history: [],
      lastCompletedIteration: 0,
    });
    // Each of these names a known `kind` and would have passed a kind-only
    // check; each would then throw inside `foldLedger` / the row readers on
    // the continued run (`row.assertions is not iterable`, and friends).
    const corrupt: unknown[] = [
      { kind: 'standing', standing: 'fact' },
      {
        kind: 'standing',
        toolCallId: 'tc-1',
        standing: 'fact',
        declaredOn: 'answer',
        iteration: 1,
      },
      {
        kind: 'standing',
        toolCallId: 'tc-1',
        standing: 'maybe',
        assertions: [],
        declaredOn: 'answer',
        iteration: 1,
      },
      {
        kind: 'standing',
        toolCallId: 'tc-1',
        standing: 'fact',
        assertions: [],
        declaredOn: { ref: 'x' },
        iteration: 1,
      },
      { kind: 'basis', toolCallId: 'tc-1', toolName: 'search', iteration: 1 },
      { kind: 'basis', toolCallId: 'tc-1', toolName: 'search', iteration: 1, basis: 'guess' },
      {
        kind: 'basis',
        toolCallId: 'tc-1',
        toolName: 'search',
        iteration: 1,
        basis: 'direct',
        expect: 9,
      },
      { kind: 'conflict', key: 'k', iteration: 1 },
      { kind: 'conflict', key: 'k', witnesses: 'tc-1', iteration: 1 },
    ];
    for (const row of corrupt) {
      expect(
        () => validateCheckpoint({ ...cp, findingsLedger: [row] }),
        JSON.stringify(row),
      ).toThrow(/findingsLedger/);
    }
  });

  it('P5 accepts one well-formed row of each kind — the door refuses shape, never values', () => {
    const cp = buildCheckpoint({
      runId: 'r-7',
      originalInput: { message: 'orig' },
      history: [],
      lastCompletedIteration: 0,
    });
    const wellFormed = [
      { kind: 'basis', toolCallId: 'tc-1', toolName: 'search', iteration: 1, basis: 'exploratory' },
      {
        kind: 'standing',
        toolCallId: 'tc-1',
        standing: 'open',
        settles: 'a second source',
        assertions: [],
        declaredOn: { toolCallId: 'tc-2' },
        iteration: 2,
        unknownId: true,
      },
      { kind: 'conflict', key: 'k', witnesses: [], iteration: 2 },
    ];
    const validated = validateCheckpoint({ ...cp, findingsLedger: wellFormed });
    expect(validated.findingsLedger).toEqual(wellFormed);
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
  it(
    'P6 happy path with checkpoint tracker installed completes promptly',
    { timeout: 30_000, retry: 2 },
    async () => {
      const agent = Agent.create({
        provider: mock({ replies: [{ content: 'fast' }] }),
        model: 'mock',
      })
        .system('s')
        .build();
      const elapsed = await measureAsync(async () => {
        expect(await agent.run({ message: 'hi' })).toBe('fast');
      });
      // Not a speed claim: the point is that installing the checkpoint tracker
      // does not deadlock or hang. 5000 reference units of CPU is a liveness
      // ceiling, and stating it in units rather than milliseconds means a
      // loaded runner raises the ceiling with the load instead of failing.
      await expectWithinReferenceUnits(
        elapsed,
        5000,
        'the checkpoint tracker must not stall a run',
      );
    },
  );
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
