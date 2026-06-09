/**
 * Evidence bridge (#5) — the 7 test types. Causal snapshots persist REAL run
 * evidence (decisions / toolCalls / iterations / duration / tokenUsage)
 * harvested by `causalEvidenceRecorder` instead of TODO-zeros.
 */

import { describe, it, expect } from 'vitest';
import {
  Agent,
  defineMemory,
  defineTool,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  SNAPSHOT_PROJECTIONS,
  InMemoryStore,
  mockEmbedder,
  mock,
} from '../../../src/index.js';
import { causalEvidenceRecorder } from '../../../src/memory/causal/evidenceRecorder.js';
import type { SnapshotEntry } from '../../../src/memory/causal/types.js';
import type { MemoryEntry } from '../../../src/memory/entry/types.js';

const IDENTITY = { tenant: 'acme', conversationId: 'conv-1' };

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
    expect(s.iterations).toBeGreaterThanOrEqual(2);
    expect(s.tokenUsage).toEqual({ input: 250, output: 50 });
    expect(s.durationMs).toBeGreaterThanOrEqual(0);
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
  it('accumulates tool calls + tokens + iterations and resets on turn_start', () => {
    const rec = causalEvidenceRecorder();
    rec.onEmit({ name: 'agentfootprint.agent.turn_start', payload: { turnIndex: 0 } });
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
    let e = rec.collect();
    expect(e.toolCalls).toEqual([
      { name: 'x', args: { a: 1 }, resultPreview: 'ok', errored: false },
    ]);
    expect(e.tokenUsage).toEqual({ input: 10, output: 5 });
    expect(e.iterations).toBe(2);

    rec.onEmit({ name: 'agentfootprint.agent.turn_start', payload: { turnIndex: 1 } });
    e = rec.collect();
    expect(e.toolCalls).toEqual([]); // fresh per turn
    expect(e.tokenUsage).toEqual({ input: 0, output: 0 });
  });

  it('turn_end totals are authoritative when present', () => {
    const rec = causalEvidenceRecorder();
    rec.onEmit({ name: 'agentfootprint.agent.turn_start', payload: {} });
    rec.onEmit({
      name: 'agentfootprint.stream.llm_end',
      payload: { iteration: 1, usage: { input: 1, output: 1 } },
    });
    rec.onEmit({
      name: 'agentfootprint.agent.turn_end',
      payload: { iterationCount: 3, totalInputTokens: 99, totalOutputTokens: 42, durationMs: 1234 },
    });
    expect(rec.collect()).toMatchObject({
      iterations: 3,
      tokenUsage: { input: 99, output: 42 },
      durationMs: 1234,
    });
  });

  it('onDecision maps footprintjs evidence into DecisionRecord', () => {
    const rec = causalEvidenceRecorder();
    rec.onDecision({
      stageName: 'ClassifyRisk',
      stageId: 'classify-risk',
      chosen: 'rejected',
      evidence: {
        label: 'Good credit',
        conditions: [{ key: 'creditScore', op: 'gt', value: 700 }],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const d = rec.collect().decisions[0]!;
    expect(d).toMatchObject({ stageId: 'classify-risk', chosen: 'rejected', rule: 'Good credit' });
    expect(d.evidence).toBeTruthy();
  });
});

// ─── Property ─────────────────────────────────────────────────────────
describe('evidence bridge — property', () => {
  it('result previews are truncated to maxPreviewChars for any size', () => {
    const rec = causalEvidenceRecorder({ maxPreviewChars: 50 });
    for (const size of [0, 10, 50, 51, 5000]) {
      rec.onEmit({ name: 'agentfootprint.agent.turn_start', payload: {} });
      rec.onEmit({
        name: 'agentfootprint.stream.tool_start',
        payload: { toolCallId: 'p', toolName: 't', args: {} },
      });
      rec.onEmit({
        name: 'agentfootprint.stream.tool_end',
        payload: { toolCallId: 'p', result: 'x'.repeat(size) },
      });
      const p = rec.collect().toolCalls[0]!.resultPreview;
      expect(p.length).toBeLessThanOrEqual(51); // 50 + ellipsis
    }
  });
});

// ─── Security ─────────────────────────────────────────────────────────
describe('evidence bridge — security', () => {
  it('evidence does not capture untracked secrets: only event-visible data lands in the snapshot', async () => {
    // The recorder only sees what the emit channel carries (post-RedactionPolicy);
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
  it('handles 5,000 events well under budget and collect() stays O(run-size)', () => {
    const rec = causalEvidenceRecorder();
    rec.onEmit({ name: 'agentfootprint.agent.turn_start', payload: {} });
    const start = Date.now();
    for (let i = 0; i < 2500; i++) {
      rec.onEmit({
        name: 'agentfootprint.stream.tool_start',
        payload: { toolCallId: `t${i}`, toolName: 'x', args: {} },
      });
      rec.onEmit({
        name: 'agentfootprint.stream.tool_end',
        payload: { toolCallId: `t${i}`, result: 'r' },
      });
    }
    const evidence = rec.collect();
    expect(evidence.toolCalls.length).toBe(2500);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
