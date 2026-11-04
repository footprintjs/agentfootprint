/**
 * Evidence bridge (#5) — the 7 test types. Causal snapshots persist REAL run
 * evidence (decisions / toolCalls / iterations / duration / tokenUsage)
 * harvested by `causalEvidenceRecorder` instead of TODO-zeros.
 */

import { describe, it, expect, vi } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import {
  defineMemory,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  SNAPSHOT_PROJECTIONS,
  InMemoryStore,
  mockEmbedder,
} from '../../../src/memory/index.js';
import { mock } from '../../../src/llm-providers.js';
import {
  causalEvidenceRecorder,
  type CausalEvidenceRecorderOptions,
} from '../../../src/memory/causal/evidenceRecorder.js';
import type { SnapshotEntry } from '../../../src/memory/causal/types.js';
import type { MemoryEntry } from '../../../src/memory/entry/types.js';
import { expectScalesLinearly } from '../../helpers/perf.js';

const IDENTITY = { tenant: 'acme', conversationId: 'conv-1' };

/** Synthetic unit coverage; native producer/writer joins are tested separately. */
const UNIT_COVERAGE = {
  scope: 'component-execution-leg',
  runId: 'r1',
  entry: { kind: 'run' },
  priorLegs: 'not-carried',
} as const;
function coveredRecorder(options: Omit<CausalEvidenceRecorderOptions, 'coverage'> = {}) {
  return causalEvidenceRecorder({ ...options, coverage: UNIT_COVERAGE });
}
function collected(rec: ReturnType<typeof causalEvidenceRecorder>) {
  const value = rec.collect();
  expect(value.availability).not.toBe('unavailable');
  if (value.availability === 'unavailable') throw new Error('Unit collector lacks coverage');
  return value;
}

function causalMemory(store: InMemoryStore) {
  return defineMemory({
    id: 'causal',
    type: MEMORY_TYPES.CAUSAL,
    // threshold 0: this test verifies the evidence ROUND-TRIP, not cosine matching
    strategy: { kind: MEMORY_STRATEGIES.TOP_K, topK: 1, threshold: 0, embedder: mockEmbedder() },
    store,
    projection: SNAPSHOT_PROJECTIONS.DECISIONS,
  });
}

const creditTool = defineTool({
  name: 'credit_score_check',
  description: 'Look up the applicant credit score.',
  inputSchema: {
    type: 'object',
    properties: { applicantId: { type: 'string' } },
    required: ['applicantId'],
  },
  execute: async () => '580',
});

function loanAgent(store: InMemoryStore) {
  return Agent.create({
    provider: mock({
      replies: [
        {
          content: 'Checking credit.',
          toolCalls: [{ id: 'c1', name: 'credit_score_check', args: { applicantId: '42' } }],
          usage: { input: 100, output: 20 },
        },
        {
          content: 'REJECTED: creditScore 580 is below the 600 threshold.',
          toolCalls: [],
          usage: { input: 150, output: 30 },
        },
      ],
    }),
    model: 'mock',
    maxIterations: 4,
  })
    .tools([creditTool])
    .memory(causalMemory(store))
    .build();
}

async function snapshotsIn(store: InMemoryStore): Promise<SnapshotEntry[]> {
  const result = await store.list<SnapshotEntry>(IDENTITY);
  return (result.entries as readonly MemoryEntry<SnapshotEntry>[])
    .map((e) => e.value)
    .filter((v) => v && typeof v === 'object' && 'query' in v);
}

// ─── Functional + Integration (the headline round-trip) ──────────────
describe('evidence bridge — snapshot round-trip', () => {
  it('persists REAL toolCalls/decisions/iterations/tokens/duration (not zeros)', async () => {
    const store = new InMemoryStore();
    await loanAgent(store).run({ message: 'underwrite loan #42 for $50K', identity: IDENTITY });

    const snaps = await snapshotsIn(store);
    expect(snaps.length).toBe(1);
    const s = snaps[0]!;
    expect(s.schemaVersion).toBe(2);
    expect(s.availability).not.toBe('unavailable');
    if (s.availability === 'unavailable') throw new Error('Expected actual leg evidence');
    expect(s.coverage.priorLegs).toBe('not-carried');

    // toolCalls — name, args, result preview, no error
    expect(s.toolCalls.length).toBe(1);
    expect(s.toolCalls[0]).toMatchObject({
      name: 'credit_score_check',
      args: { applicantId: '42' },
      resultPreview: '580',
      errored: false,
    });

    // decisions — the agent's route decider fires footprintjs onDecision per iteration
    expect(s.decisions.length).toBeGreaterThan(0);
    const chosenValues = s.decisions.map((d) => d.chosen);
    // the agent's Route decider fires per iteration (cache-gate noise is filtered)
    expect(chosenValues.some((c) => /tool/i.test(c))).toBe(true);
    expect(chosenValues.some((c) => /final/i.test(c))).toBe(true);

    // iterations / tokens / duration — real values
    expect(s.observedIterationStarts).toBeGreaterThanOrEqual(2);
    expect(s.tokenUsage).toEqual({ input: 250, output: 50 });
    expect(s.duration.kind).toBe('measured');
    if (s.duration.kind === 'measured')
      expect(s.duration.observationWindowMs).toBeGreaterThanOrEqual(0);
    expect(s.finalContent).toContain('REJECTED');
  });

  it('the stored evidence answers "why?" — loadSnapshot DECISIONS projection is non-empty', async () => {
    const store = new InMemoryStore();
    await loanAgent(store).run({ message: 'underwrite loan #42 for $50K', identity: IDENTITY });

    // Friday: a fresh cheap agent with the SAME store answers the follow-up.
    const friday = Agent.create({
      provider: mock({ reply: 'It was rejected because the credit score 580 was below 600.' }),
      model: 'mock',
      maxIterations: 2,
    })
      .memory(causalMemory(store))
      .build();
    await friday.run({ message: 'why was loan #42 rejected?', identity: IDENTITY });

    // The injected memory must NOT be the "(no decision evidence captured)" fallback.
    const snap = (await friday.getSnapshot()) ?? {};
    const trace = JSON.stringify(snap);
    expect(trace).not.toContain('no decision evidence captured');
    expect(trace).toContain('credit_score_check');
  });
});

// ─── Unit (the recorder in isolation) ─────────────────────────────────
describe('evidence bridge — causalEvidenceRecorder unit', () => {
  it('an unconfigured collector reports unavailable instead of measured zeros', () => {
    const rec = causalEvidenceRecorder();
    rec.onEmit({
      name: 'agentfootprint.stream.llm_end',
      payload: { usage: { input: 10, output: 5 } },
    });
    expect(rec.collect()).toEqual({ availability: 'unavailable', reason: 'not-configured' });
  });

  it('accumulates this leg and ignores turn_start; a fresh handle starts separately', () => {
    const rec = coveredRecorder();
    rec.onEmit({ name: 'agentfootprint.agent.iteration_start', payload: { iterIndex: 2 } });
    rec.onEmit({
      name: 'agentfootprint.stream.tool_start',
      payload: { toolCallId: 't1', toolName: 'x', args: { a: 1 } },
    });
    rec.onEmit({
      name: 'agentfootprint.stream.tool_end',
      payload: { toolCallId: 't1', result: 'ok', durationMs: 5 },
    });
    rec.onEmit({
      name: 'agentfootprint.stream.llm_end',
      payload: { iteration: 2, usage: { input: 10, output: 5 } },
    });
    const observed = collected(rec);
    expect(observed.toolCalls).toEqual([
      { name: 'x', args: { a: 1 }, resultPreview: 'ok', errored: false },
    ]);
    expect(observed.tokenUsage).toEqual({ input: 10, output: 5 });
    expect(observed.observedIterationStarts).toBe(1);
    expect(observed.lastObservedIteration).toBe(2);
    rec.onEmit({ name: 'agentfootprint.agent.turn_start', payload: { turnIndex: 1 } });
    expect(collected(rec).toolCalls).toEqual(observed.toolCalls);
    expect(collected(rec).tokenUsage).toEqual({ input: 10, output: 5 });
    expect(collected(coveredRecorder())).toMatchObject({
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      observedIterationStarts: 0,
    });
  });

  it('turn_end totals cannot overwrite this leg observed usage, iterations or duration', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(50);
    try {
      const rec = coveredRecorder();
      rec.onEmit({ name: 'agentfootprint.agent.iteration_start', payload: { iterIndex: 1 } });
      rec.onEmit({
        name: 'agentfootprint.stream.llm_end',
        payload: { iteration: 1, usage: { input: 1, output: 1 } },
      });
      rec.onEmit({
        name: 'agentfootprint.agent.turn_end',
        payload: {
          iterationCount: 3,
          totalInputTokens: 99,
          totalOutputTokens: 42,
          durationMs: 1234,
        },
      });
      clock.mockReturnValue(57);
      expect(collected(rec)).toMatchObject({
        observedIterationStarts: 1,
        lastObservedIteration: 1,
        tokenUsage: { input: 1, output: 1 },
        duration: { kind: 'measured', observationWindowMs: 7 },
      });
    } finally {
      clock.mockRestore();
    }
  });

  it('onDecision maps the REAL FlowDecisionEvent shape (decider + traversalContext)', () => {
    const rec = coveredRecorder();
    // The real engine event: { decider, chosen, evidence?, traversalContext? } —
    // no stageId/stageName at the top level (the panel caught a fabricated-shape test).
    rec.onDecision({
      decider: 'ClassifyRisk',
      chosen: 'rejected',
      evidence: {
        label: 'Good credit',
        conditions: [{ key: 'creditScore', op: 'gt', value: 700 }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      traversalContext: {
        runId: 'r1',
        stageId: 'classify-risk',
        runtimeStageId: 'classify-risk#3',
        stageName: 'ClassifyRisk',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
    const d = collected(rec).decisions[0]!;
    expect(d).toMatchObject({ stageId: 'classify-risk', chosen: 'rejected', rule: 'Good credit' });
    expect(d.evidence).toBeTruthy();
    // without traversalContext, the decider display name is the fallback
    rec.onDecision({ decider: 'Route', chosen: 'Final' });
    expect(collected(rec).decisions[1]).toMatchObject({ stageId: 'Route', chosen: 'Final' });
  });

  it('onSelected maps select() evidence; cache + context-fork plumbing filtered', () => {
    const rec = coveredRecorder();
    rec.onSelected({
      parent: 'PickStrategy',
      selected: ['aggressive'],
      total: 3,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evidence: { chosen: ['aggressive'] } as any,
    });
    rec.onSelected({ parent: 'context', selected: ['sf-system-prompt', 'sf-messages'], total: 3 });
    const ds = collected(rec).decisions;
    expect(ds.length).toBe(1); // the context slot-fork was filtered
    expect(ds[0]).toMatchObject({ stageId: 'PickStrategy', chosen: 'aggressive' });
  });

  it('oversized tool args are bounded (PII cap)', () => {
    const rec = coveredRecorder({ maxFieldChars: 100 });
    rec.onEmit({ name: 'agentfootprint.agent.turn_start', payload: {} });
    rec.onEmit({
      name: 'agentfootprint.stream.tool_start',
      payload: { toolCallId: 'b', toolName: 't', args: { blob: 'x'.repeat(500) } },
    });
    rec.onEmit({
      name: 'agentfootprint.stream.tool_end',
      payload: { toolCallId: 'b', result: 'ok' },
    });
    const args = collected(rec).toolCalls[0]!.args;
    expect(JSON.stringify(args).length).toBeLessThan(200);
    expect(args.__truncated).toBeTruthy();
  });

  it('integration: a persisted DecisionRecord carries a REAL stageId (not "decider")', async () => {
    const store = new InMemoryStore();
    await loanAgent(store).run({ message: 'underwrite loan #42 for $50K', identity: IDENTITY });
    const snaps = await snapshotsIn(store);
    expect(snaps[0]!.decisions.length).toBeGreaterThan(0);
    for (const d of snaps[0]!.decisions) {
      expect(d.stageId).not.toBe('decider'); // the fabricated-shape bug, pinned
    }
  });
});

// ─── Property ─────────────────────────────────────────────────────────
describe('evidence bridge — property', () => {
  it('result previews are truncated to maxPreviewChars for any size', () => {
    for (const size of [0, 10, 50, 51, 5000]) {
      const rec = coveredRecorder({ maxPreviewChars: 50 });
      rec.onEmit({ name: 'agentfootprint.agent.turn_start', payload: {} });
      rec.onEmit({
        name: 'agentfootprint.stream.tool_start',
        payload: { toolCallId: 'p', toolName: 't', args: {} },
      });
      rec.onEmit({
        name: 'agentfootprint.stream.tool_end',
        payload: { toolCallId: 'p', result: 'x'.repeat(size) },
      });
      const p = collected(rec).toolCalls[0]!.resultPreview;
      expect(p.length).toBeLessThanOrEqual(51); // 50 + ellipsis
    }
  });
});

// ─── Security ─────────────────────────────────────────────────────────
describe('evidence bridge — security', () => {
  it('evidence does not capture untracked secrets: only event-visible data lands in the snapshot', async () => {
    // The private computation port sees emitted tool facts before record serving;
    // a closure-local secret used inside a tool never reaches the snapshot.
    const SECRET = 'sk-super-secret-9876';
    const store = new InMemoryStore();
    const tool = defineTool({
      name: 'lookup',
      description: 'x',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const auth = `Bearer ${SECRET}`; // used locally, never returned
        return `ok (${auth.length} chars of auth used)`;
      },
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { content: 'go', toolCalls: [{ id: 'c1', name: 'lookup', args: {} }] },
          { content: 'done', toolCalls: [] },
        ],
      }),
      model: 'mock',
      maxIterations: 3,
    })
      .tools([tool])
      .memory(causalMemory(store))
      .build();
    await agent.run({ message: 'check', identity: IDENTITY });
    const snaps = await snapshotsIn(store);
    expect(JSON.stringify(snaps)).not.toContain(SECRET);
  });
});

// ─── Performance + Load ──────────────────────────────────────────────
describe('evidence bridge — performance/load', () => {
  it(
    'processes a tenfold event load while retaining only the fixed observation bound',
    { timeout: 30_000, retry: 2 },
    async () => {
      // Event processing stays bounded per event; retention and omissions remain explicit.
      const record = (pairs: number): void => {
        const rec = coveredRecorder();
        rec.onEmit({ name: 'agentfootprint.agent.turn_start', payload: {} });
        for (let i = 0; i < pairs; i++) {
          rec.onEmit({
            name: 'agentfootprint.stream.tool_start',
            payload: { toolCallId: `t${i}`, toolName: 'x', args: {} },
          });
          rec.onEmit({
            name: 'agentfootprint.stream.tool_end',
            payload: { toolCallId: `t${i}`, result: 'r' },
          });
        }
        const evidence = collected(rec);
        expect(evidence.toolCalls).toHaveLength(256);
        expect(evidence).toMatchObject({
          availability: 'partial',
          causes: ['bounded-observation'],
          omittedObservations: { toolCalls: pairs - 256, pendingStarts: 0, decisions: 0 },
          toolAccounting: { unmatchedStarts: 0, unmatchedEnds: 0, duplicateStarts: 0 },
        });
      };
      await expectScalesLinearly({
        small: () => record(2_500),
        large: () => record(25_000),
        scale: 10,
        why: 'tool-call pairing must be a keyed lookup, not a scan',
      });
    },
  );
});
