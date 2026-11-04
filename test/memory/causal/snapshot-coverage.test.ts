import { describe, expect, it, vi } from 'vitest';
import { writeSnapshot } from '../../../src/memory/causal/writeSnapshot.js';
import { loadSnapshot } from '../../../src/memory/causal/loadSnapshot.js';
import { InMemoryStore } from '../../../src/memory/store/index.js';
import { mockEmbedder } from '../../../src/memory/embedding/index.js';

const identity = { tenant: 'test', conversationId: 'coverage' };
const source = {
  kind: 'stage',
  runId: 'native-A',
  startedAtMs: 10,
  runtimeStageId: 'actual-writer',
};
const evidence = () => ({
  availability: 'observed',
  coverage: {
    scope: 'component-execution-leg',
    runId: 'native-A',
    entry: { kind: 'run' },
    priorLegs: 'not-carried',
    source,
  },
  decisions: [{ stageId: 'choose', chosen: 'yes' }],
  toolCalls: [],
  observedIterationStarts: 1,
  toolAccounting: { unmatchedStarts: 0, unmatchedEnds: 0, duplicateStarts: 0 },
  usageAccounting: { observedCalls: 1, missingUsage: 0 },
  omittedObservations: { decisions: 0, toolCalls: 0, pendingStarts: 0 },
  duration: { kind: 'measured', observationWindowMs: 3 },
  tokenUsage: { input: 2, output: 1 },
});
const value = () => ({
  schemaVersion: 2,
  query: 'question',
  finalContent: 'answer',
  ...evidence(),
});
const stored = (v: unknown, id = 'snap-1') => ({
  id,
  value: v,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  lastAccessedAt: 1,
  accessCount: 0,
  source: { identity, turn: 1 },
});

async function read(values: unknown[], projection = 'decisions') {
  const put = vi.fn();
  const scope = {
    identity,
    messages: [{ role: 'user', content: 'why?' }],
    formatted: [],
    snapshotRead: undefined,
  };
  const store = {
    search: vi.fn(async () =>
      values.map((v, i) => ({ entry: stored(v, 'snap-' + i), score: 0.9 })),
    ),
    put,
  };
  await loadSnapshot({
    store: store as never,
    embedder: mockEmbedder(),
    projection: projection as never,
  })(scope as never);
  return { scope, put };
}

describe('versioned causal snapshot admission', () => {
  it('rejects sparse observation arrays rather than treating holes as observations', async () => {
    const { scope } = await read([
      { ...value(), decisions: Array(1) },
      { ...value(), toolCalls: Array(1) },
    ]);
    expect(scope.formatted).toEqual([]);
    expect(scope.snapshotRead).toEqual({ returned: 2, accepted: 0, unsupported: 0, invalid: 2 });
  });

  it('does not execute an accessor while admitting the entry descriptor', async () => {
    const getter = vi.fn(() => 'run');
    const descriptor = Object.defineProperty({}, 'kind', { get: getter, enumerable: true });
    const { scope } = await read([
      { ...value(), coverage: { ...evidence().coverage, entry: descriptor } },
    ]);
    expect(getter).not.toHaveBeenCalled();
    expect(scope.formatted).toEqual([]);
  });

  it('retains finite evaluation scores without inventing a nonnegative-score contract', async () => {
    const { scope } = await read([{ ...value(), evalScore: -0.5 }], 'full');
    expect(scope.formatted).toHaveLength(1);
  });

  it('does not store a snapshot before an assistant answer exists', async () => {
    const store = new InMemoryStore({ embedder: mockEmbedder() });
    await writeSnapshot({ store, embedder: mockEmbedder() })({
      identity,
      turnNumber: 1,
      newMessages: [{ role: 'user', content: 'question' }],
    } as never);
    expect((await store.list(identity)).entries).toEqual([]);
  });

  it('writes unavailable rather than invented zero measurements without a recorder', async () => {
    const store = new InMemoryStore({ embedder: mockEmbedder() });
    const scope = {
      identity,
      turnNumber: 1,
      newMessages: [
        { role: 'user', content: 'question' },
        { role: 'assistant', content: 'answer' },
      ],
    };
    await writeSnapshot({ store, embedder: mockEmbedder() })(scope as never);
    const entry = await store.get(identity, 'snap-1');
    expect(entry?.version).toBe(1);
    expect(entry?.value).toEqual({
      schemaVersion: 2,
      query: 'question',
      finalContent: 'answer',
      availability: 'unavailable',
      reason: 'not-configured',
    });
  });

  it('writes schema2 with actual admitted source and no optimistic-version change', async () => {
    const store = new InMemoryStore({ embedder: mockEmbedder() });
    await writeSnapshot({ store, embedder: mockEmbedder() })({
      identity,
      turnNumber: 1,
      runEvidence: evidence(),
      newMessages: [
        { role: 'user', content: 'question' },
        { role: 'assistant', content: 'answer' },
      ],
    } as never);
    expect((await store.get(identity, 'snap-1'))?.value).toEqual(value());
  });

  it('skips and counts legacy, unsupported, and invalid rows without rewriting them', async () => {
    const legacy = {
      query: 'old',
      finalContent: 'old-answer',
      decisions: [],
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
    };
    const invalid = { ...value(), tokenUsage: { input: Number.NaN, output: 1 } };
    const { scope, put } = await read([legacy, { ...value(), schemaVersion: 3 }, invalid]);
    expect(scope.formatted).toEqual([]);
    expect(scope.snapshotRead).toEqual({ returned: 3, accepted: 0, unsupported: 2, invalid: 1 });
    expect(put).not.toHaveBeenCalled();
    expect(legacy).not.toHaveProperty('schemaVersion');
  });

  it.each(['decisions', 'narrative', 'commits', 'full', 'unknown-projection'])(
    'states leg-only limitations in every %s projection',
    async (projection) => {
      const { scope } = await read([value()], projection);
      expect(scope.formatted).toHaveLength(1);
      const content = String((scope.formatted[0] as { content: unknown }).content);
      expect(content).toContain('only this component execution leg');
      expect(content).toContain('prior legs');
      expect(content).toContain('Empty lists do not prove no operations');
      if (projection === 'commits') {
        expect(content).toContain('no commit log captured');
        expect(content).not.toContain('choose: chose');
      }
    },
  );

  it('projects unavailable answers without manufacturing decisions or measured usage', async () => {
    const { scope } = await read(
      [
        {
          schemaVersion: 2,
          query: 'q',
          finalContent: 'a',
          availability: 'unavailable',
          reason: 'not-configured',
        },
      ],
      'full',
    );
    expect(scope.formatted).toHaveLength(1);
    expect(String((scope.formatted[0] as { content: unknown }).content)).toContain('unavailable');
  });

  it.each([
    { ...value(), availability: 'partial', causes: [] },
    { ...value(), availability: 'partial', causes: ['invented-cause'] },
    { ...value(), toolAccounting: { unmatchedStarts: 1, unmatchedEnds: 0, duplicateStarts: 0 } },
    { ...value(), coverage: { ...evidence().coverage, priorLegs: 'complete' } },
    { ...value(), coverage: { ...evidence().coverage, source: { ...source, runId: 'foreign' } } },
    { ...value(), decisions: Array.from({ length: 257 }, () => ({ stageId: 's', chosen: 'x' })) },
  ])('refuses contradictory or unbounded schema2 data %#', async (bad) => {
    const { scope } = await read([bad]);
    expect(scope.formatted).toEqual([]);
    expect(scope.snapshotRead).toEqual({ returned: 1, accepted: 0, unsupported: 0, invalid: 1 });
  });
});
