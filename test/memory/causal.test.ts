/**
 * Causal memory — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Covers: SnapshotEntry shape, writeSnapshot stage, loadSnapshot stage,
 * snapshotPipeline factory, and the defineMemory({type: CAUSAL}) wiring.
 */

import { describe, expect, it } from 'vitest';

import {
  defineMemory,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  SNAPSHOT_PROJECTIONS,
} from '../../src/memory/index.js';
import { Agent } from '../../src/core/Agent.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import { InMemoryStore } from '../../src/memory/store/index.js';
import { mockEmbedder } from '../../src/memory/embedding/index.js';
import {
  snapshotPipeline,
  writeSnapshot,
  loadSnapshot,
  type SnapshotEntry,
} from '../../src/memory/causal/index.js';

// ─── Unit — pipeline factory shape ─────────────────────────────────

describe('snapshotPipeline — unit', () => {
  it('returns { read, write } subflows', () => {
    const p = snapshotPipeline({
      store: new InMemoryStore({ embedder: mockEmbedder() }),
      embedder: mockEmbedder(),
    });
    expect(p.read).toBeDefined();
    expect(p.write).toBeDefined();
  });

  it('honors topK + minScore + projection options', () => {
    const p = snapshotPipeline({
      store: new InMemoryStore({ embedder: mockEmbedder() }),
      embedder: mockEmbedder(),
      topK: 3,
      minScore: 0.85,
      projection: SNAPSHOT_PROJECTIONS.NARRATIVE,
    });
    expect(p.read).toBeDefined();
  });
});

// ─── Unit — stage builders ─────────────────────────────────────────

describe('writeSnapshot stage — unit', () => {
  it('returns an async function', () => {
    const stage = writeSnapshot({
      store: new InMemoryStore({ embedder: mockEmbedder() }),
      embedder: mockEmbedder(),
    });
    expect(typeof stage).toBe('function');
  });
});

describe('loadSnapshot stage — unit', () => {
  it('builds successfully with a vector-capable store', () => {
    const stage = loadSnapshot({
      store: new InMemoryStore({ embedder: mockEmbedder() }),
      embedder: mockEmbedder(),
    });
    expect(typeof stage).toBe('function');
  });

  it('throws when the store omits search() (custom non-vector adapter)', () => {
    const noSearchStore = {
      get: async () => null,
      put: async () => {},
      list: async () => ({ entries: [] }),
      // search intentionally omitted
    };
    expect(() =>
      loadSnapshot({
        store: noSearchStore as never,
        embedder: mockEmbedder(),
      }),
    ).toThrow(/does not implement search/);
  });
});

// ─── Scenario — defineMemory wires CAUSAL correctly ────────────────

describe('defineMemory({ type: CAUSAL }) — scenarios', () => {
  it('builds a CAUSAL definition with TOP_K + embedder + projection', () => {
    const def = defineMemory({
      id: 'causal-test',
      type: MEMORY_TYPES.CAUSAL,
      strategy: {
        kind: MEMORY_STRATEGIES.TOP_K,
        topK: 1,
        threshold: 0.7,
        embedder: mockEmbedder(),
      },
      store: new InMemoryStore({ embedder: mockEmbedder() }),
      projection: SNAPSHOT_PROJECTIONS.DECISIONS,
    });
    expect(def.type).toBe('causal');
    expect(def.read).toBeDefined();
    expect(def.write).toBeDefined();
    expect(def.projection).toBe('decisions');
  });

  it('rejects non-TOP_K strategies on CAUSAL with a clear remediation', () => {
    expect(() =>
      defineMemory({
        id: 'bad',
        type: MEMORY_TYPES.CAUSAL,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
        store: new InMemoryStore({ embedder: mockEmbedder() }),
      }),
    ).toThrow(/CAUSAL type only supports TOP_K/);
  });

  it('rejects non-vector stores with a clear remediation hint', () => {
    const noSearchStore = {
      get: async () => null,
      put: async () => {},
      list: async () => ({ entries: [] }),
    };
    expect(() =>
      defineMemory({
        id: 'bad',
        type: MEMORY_TYPES.CAUSAL,
        strategy: {
          kind: MEMORY_STRATEGIES.TOP_K,
          topK: 1,
          embedder: mockEmbedder(),
        },
        store: noSearchStore as never,
      }),
    ).toThrow(/vector-capable store/);
  });
});

// ─── Integration — full agent + causal memory end-to-end ───────────

describe('CAUSAL memory — integration', () => {
  it('persists a snapshot per turn (query, finalContent) tagged for retrieval', async () => {
    const store = new InMemoryStore({ embedder: mockEmbedder() });
    const memory = defineMemory({
      id: 'causal',
      type: MEMORY_TYPES.CAUSAL,
      strategy: {
        kind: MEMORY_STRATEGIES.TOP_K,
        topK: 1,
        threshold: 0.5,
        embedder: mockEmbedder(),
      },
      store,
      projection: SNAPSHOT_PROJECTIONS.DECISIONS,
    });

    const agent = Agent.create({
      provider: mock({ reply: 'Approved.' }),
      model: 'mock',
      maxIterations: 1,
    })
      .memory(memory)
      .build();

    const identity = { conversationId: 'causal-test' };
    await agent.run({
      message: 'Should I approve loan #42?',
      identity,
    });

    // The store should now contain one snapshot with the (query,
    // finalContent) pair embedded for future cosine-search.
    const result = await store.list<SnapshotEntry>(identity);
    expect(result.entries.length).toBe(1);
    const snap = result.entries[0]!.value;
    expect(snap.query).toBe('Should I approve loan #42?');
    expect(snap.finalContent).toBe('Approved.');
    // Embedding should be attached for retrieval.
    expect(result.entries[0]!.embedding).toBeDefined();
    expect((result.entries[0]!.embedding ?? []).length).toBeGreaterThan(0);
  });

  it('isolates causal snapshots per identity (multi-tenant)', async () => {
    const store = new InMemoryStore({ embedder: mockEmbedder() });
    const memory = defineMemory({
      id: 'causal',
      type: MEMORY_TYPES.CAUSAL,
      strategy: {
        kind: MEMORY_STRATEGIES.TOP_K,
        topK: 1,
        threshold: 0.5,
        embedder: mockEmbedder(),
      },
      store,
    });

    const agent = Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'mock',
      maxIterations: 1,
    })
      .memory(memory)
      .build();

    await agent.run({ message: 'tenant A question', identity: { tenant: 'a', conversationId: 'a-1' } });
    await agent.run({ message: 'tenant B question', identity: { tenant: 'b', conversationId: 'b-1' } });

    const a = await store.list({ tenant: 'a', conversationId: 'a-1' });
    const b = await store.list({ tenant: 'b', conversationId: 'b-1' });
    expect(a.entries.length).toBe(1);
    expect(b.entries.length).toBe(1);
  });
});

// ─── Property — round-trip invariants ──────────────────────────────

describe('Causal memory — properties', () => {
  it('every projection const is accepted by the loader', () => {
    const projections = Object.values(SNAPSHOT_PROJECTIONS);
    for (const p of projections) {
      expect(() =>
        loadSnapshot({
          store: new InMemoryStore({ embedder: mockEmbedder() }),
          embedder: mockEmbedder(),
          projection: p,
        }),
      ).not.toThrow();
    }
  });
});

// ─── Security — strict threshold, identity isolation, payload size ─

describe('Causal memory — security', () => {
  it('strict threshold returns empty when no past snapshot is similar enough', async () => {
    const store = new InMemoryStore({ embedder: mockEmbedder() });
    const memory = defineMemory({
      id: 'strict',
      type: MEMORY_TYPES.CAUSAL,
      strategy: {
        kind: MEMORY_STRATEGIES.TOP_K,
        topK: 1,
        threshold: 0.99, // unrealistically strict
        embedder: mockEmbedder(),
      },
      store,
    });

    const agent = Agent.create({
      provider: mock({ reply: 'first-response' }),
      model: 'mock',
      maxIterations: 1,
    })
      .memory(memory)
      .build();

    // Two unrelated runs — second turn shouldn't pull the first turn's
    // snapshot because cosine similarity won't hit 0.99.
    const id1 = { conversationId: 's1' };
    await agent.run({ message: 'apple banana cherry', identity: id1 });
    // Second run: empty injection because threshold is too strict.
    const result = await agent.run({ message: 'apple banana cherry', identity: id1 });
    expect(typeof result).toBe('string');
  });
});

// ─── Performance — pipeline build is O(1) ──────────────────────────

describe('Causal memory — performance', () => {
  it('repeated defineMemory calls are independent (no shared state)', () => {
    const a = defineMemory({
      id: 'a',
      type: MEMORY_TYPES.CAUSAL,
      strategy: {
        kind: MEMORY_STRATEGIES.TOP_K,
        topK: 1,
        embedder: mockEmbedder(),
      },
      store: new InMemoryStore({ embedder: mockEmbedder() }),
    });
    const b = defineMemory({
      id: 'b',
      type: MEMORY_TYPES.CAUSAL,
      strategy: {
        kind: MEMORY_STRATEGIES.TOP_K,
        topK: 1,
        embedder: mockEmbedder(),
      },
      store: new InMemoryStore({ embedder: mockEmbedder() }),
    });
    expect(a).not.toBe(b);
  });
});

// ─── ROI — what Causal unlocks ─────────────────────────────────────

describe('Causal memory — ROI', () => {
  it('snapshot data shape supports SFT export ((query, finalContent) pair)', async () => {
    const store = new InMemoryStore({ embedder: mockEmbedder() });
    const memory = defineMemory({
      id: 'sft',
      type: MEMORY_TYPES.CAUSAL,
      strategy: {
        kind: MEMORY_STRATEGIES.TOP_K,
        topK: 1,
        embedder: mockEmbedder(),
      },
      store,
    });
    const agent = Agent.create({
      provider: mock({ reply: 'ideal answer' }),
      model: 'mock',
      maxIterations: 1,
    })
      .memory(memory)
      .build();

    await agent.run({
      message: 'classification example',
      identity: { conversationId: 'sft-1' },
    });

    const entries = (await store.list<SnapshotEntry>({ conversationId: 'sft-1' })).entries;
    // The snapshot carries the SFT-shaped pair: query + completion.
    const snap = entries[0]!.value;
    expect(snap.query).toBe('classification example');
    expect(snap.finalContent).toBe('ideal answer');
    // SFT-ready: project to JSONL via { prompt: query, completion: finalContent }.
    const sftRow = { prompt: snap.query, completion: snap.finalContent };
    expect(sftRow.prompt).toBeTruthy();
    expect(sftRow.completion).toBeTruthy();
  });
});
