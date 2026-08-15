/**
 * The run-configuration manifest (9.41.0) — `agentfootprint.agent.run_configured`:
 * ONE event at run start naming which adapters and strategies the run is about
 * to use, stamped with the runId every other event already carries, so N runs
 * group into N labelled ARMS without the experimenter's own bookkeeping.
 *
 * Sections follow Convention 3: Functional (the pure composer) · Integration
 * (the real loop, the join, the arms) · Security & containment (names only —
 * no endpoint, no key, no principal) · Edge (a graph with no cascade, a
 * hand-built memory, absence that must stay absent) · Regression (the size
 * bound, and the listener gate that keeps an unwatched agent at zero).
 */

import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { skillGraph, defineSkill, keywordScorer } from '../../../src/injection-engine.js';
import { defineMemory, MEMORY_TYPES, MEMORY_STRATEGIES } from '../../../src/memory/index.js';
import { InMemoryStore } from '../../../src/memory/store/index.js';
import { mockEmbedder } from '../../../src/memory/embedding/index.js';
import { topK } from '../../../src/memory/retrieval/index.js';
import { slidingWindow } from '../../../src/index.js';
import { buildRunManifest } from '../../../src/core/agent/runManifest.js';
import type { AgentfootprintEventMap } from '../../../src/events/registry.js';
import type { MemoryDefinition } from '../../../src/memory/define.types.js';
import type { LLMProvider } from '../../../src/adapters/types.js';
import type { ArtifactStore } from '../../../src/artifacts/types.js';
import type { EventDispatcher } from '../../../src/events/dispatcher.js';

type ManifestEvent = AgentfootprintEventMap['agentfootprint.agent.run_configured'];
type Manifest = ManifestEvent['payload'];

/** Subscribe before the run — the manifest is dispatched as the run is wired. */
const watch = (agent: Agent) => {
  const manifests: ManifestEvent[] = [];
  agent.on('agentfootprint.agent.run_configured', (e) => manifests.push(e));
  return manifests;
};

/** The one run id the arm is grouped by, read off any other event. */
const turnEndRunIds = (agent: Agent) => {
  const ids: string[] = [];
  agent.on('agentfootprint.agent.turn_end', (e) => ids.push(e.meta.runId));
  return ids;
};

// ─── 1. FUNCTIONAL — the pure composer ───────────────────────────────

describe('run manifest — the composer', () => {
  const minimal = {
    agentId: 'agent',
    providerName: 'mock',
    model: 'm',
    hasRunConfig: false,
    hasSkillBrains: false,
    reactMode: 'dynamic' as const,
    memories: [],
  };

  it('names the provider and the model this run starts with', () => {
    const m = buildRunManifest(minimal);
    expect(m.agentId).toBe('agent');
    expect(m.llm.provider).toBe('mock');
    expect(m.llm.model).toBe('m');
    expect(m.reactMode).toBe('dynamic');
  });

  it('states "no memory" explicitly — `[]`, never an omitted field', () => {
    expect(buildRunManifest(minimal).memories).toEqual([]);
  });

  it('leaves what is NOT configured ABSENT — never a guessed default', () => {
    const m = buildRunManifest(minimal);
    const keys = Object.keys(m);
    for (const key of ['window', 'skillGraph', 'evidenceGate', 'artifacts']) {
      expect(keys, `${key} must be absent, not defaulted`).not.toContain(key);
    }
    // Nothing can replace the model, so the field that would say so is absent
    // — and `model` is then true of every call the run makes.
    expect(Object.keys(m.llm)).toEqual(['provider', 'model']);
  });

  it('names WHO may replace the model, in a stable order', () => {
    expect(
      buildRunManifest({ ...minimal, hasRunConfig: true, hasSkillBrains: true }).llm.modelOverrides,
    ).toEqual(['configure', 'skill-brains']);
    expect(buildRunManifest({ ...minimal, hasSkillBrains: true }).llm.modelOverrides).toEqual([
      'skill-brains',
    ]);
  });

  it('carries every declared strategy name it is given', () => {
    const m = buildRunManifest({
      ...minimal,
      memories: [
        {
          id: 'docs',
          type: 'semantic',
          strategy: 'topK',
          retrieval: 'topK',
          embedderId: 'mock',
          flavor: 'rag',
        } as MemoryDefinition,
      ],
      windowStrategyName: 'sliding-window',
      skillGraph: { routing: 'guard', continuity: 'conversation', scorerName: 'keyword' },
      evidenceGatePosture: 'rails',
      artifacts: { configured: true, placement: true, recordings: false },
    });
    expect(m.memories[0]).toEqual({
      id: 'docs',
      type: 'semantic',
      strategy: 'topK',
      retrieval: 'topK',
      embedderId: 'mock',
      flavor: 'rag',
    });
    expect(m.window).toBe('sliding-window');
    expect(m.skillGraph).toEqual({
      routing: 'guard',
      continuity: 'conversation',
      scorer: 'keyword',
    });
    expect(m.evidenceGate).toBe('rails');
    // Only the dial that is ON is written; `recordings: false` is silence.
    expect(m.artifacts).toEqual({ placement: true });
  });
});

// ─── 2. INTEGRATION — the real loop, and the join it exists for ──────

describe('run manifest — through the Agent', () => {
  it('fires exactly ONCE per run, before anything else of that run', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build();
    const seen: string[] = [];
    agent.on('*', (e) => seen.push(e.type));
    const manifests = watch(agent);

    await agent.run({ message: 'hi' });

    expect(manifests).toHaveLength(1);
    expect(seen[0]).toBe('agentfootprint.agent.run_configured');
  });

  it('carries the runId every other event of the run carries — the join key', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build();
    const manifests = watch(agent);
    const turnEnds = turnEndRunIds(agent);

    await agent.run({ message: 'hi' });

    expect(manifests[0]?.meta.runId).toBe(turnEnds[0]);
    expect(manifests[0]?.meta.runtimeStageId).toBe('run-configured#0');
  });

  it('WORKED EXAMPLE — two agents, two arms, grouped with no bookkeeping', async () => {
    const arms = new Map<string, string>(); // runId → arm label
    const durations = new Map<string, number>(); // runId → what we measured

    const build = (model: string) =>
      Agent.create({ provider: mock({ reply: 'ok' }), model }).build();

    for (const agent of [build('fast-model'), build('slow-model')]) {
      agent.on('agentfootprint.agent.run_configured', (e) =>
        arms.set(e.meta.runId, `${e.payload.llm.provider}/${e.payload.llm.model}`),
      );
      agent.on('agentfootprint.agent.turn_end', (e) =>
        durations.set(e.meta.runId, e.payload.durationMs),
      );
      await agent.run({ message: 'hi' });
    }

    const byArm = [...durations.keys()].map((runId) => arms.get(runId));
    expect(byArm.sort()).toEqual(['mock/fast-model', 'mock/slow-model']);
  });

  it('a resumed-style second run is its own arm row (one manifest per runId)', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build();
    const manifests = watch(agent);

    await agent.run({ message: 'one' });
    await agent.run({ message: 'two' });

    expect(manifests).toHaveLength(2);
    expect(manifests[0]?.meta.runId).not.toBe(manifests[1]?.meta.runId);
  });

  it('names a memory by the strategy names it DECLARED', async () => {
    const memory = defineMemory({
      id: 'docs',
      type: MEMORY_TYPES.SEMANTIC,
      strategy: {
        kind: MEMORY_STRATEGIES.TOP_K,
        embedder: mockEmbedder(),
        retrieval: topK({ k: 3 }),
      },
      store: new InMemoryStore(),
      flavor: 'rag',
    });
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .memory(memory)
      .build();
    const manifests = watch(agent);

    await agent.run({ message: 'hi', identity: { conversationId: 'c1' } });

    expect(manifests[0]?.payload.memories).toEqual([
      {
        id: 'docs',
        type: 'semantic',
        strategy: 'topK',
        retrieval: 'topK',
        embedderId: 'mock',
        flavor: 'rag',
      },
    ]);
  });

  it('names the window strategy, the graph posture + scorer, and the evidence gate', async () => {
    const graph = skillGraph()
      .entry(defineSkill({ id: 'billing', description: 'refunds', body: 'b' }), {
        match: { intent: 'wants a refund', examples: ['refund my order'] },
      })
      .entry(defineSkill({ id: 'shipping', description: 'delivery', body: 's' }), {
        match: { intent: 'asks about delivery', examples: ['where is my parcel'] },
      })
      .classify(keywordScorer())
      .build();

    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .window(slidingWindow({ keepRecentTurns: 4 }))
      .skillGraph(graph, { strictness: 'guard', continuity: 'conversation' })
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .build();
    const manifests = watch(agent);

    await agent.run({ message: 'refund my order' });

    const m = manifests[0]?.payload as Manifest;
    expect(m.window).toBe('sliding-window');
    expect(m.skillGraph).toEqual({
      routing: 'guard',
      continuity: 'conversation',
      scorer: keywordScorer().name,
    });
    expect(m.evidenceGate).toBe('assist');
  });

  it('reports artifacts as PRESENT + which dials are on, never which store', async () => {
    const agent = Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'm',
      artifacts: { store: fakeArtifactStore(), recordings: true },
    }).build();
    const manifests = watch(agent);

    await agent.run({ message: 'hi' });

    expect(manifests[0]?.payload.artifacts).toEqual({ recordings: true });
  });
});

// ─── 3. SECURITY & CONTAINMENT — names only ──────────────────────────

/** Every one of these is configured INTO the agent below, and none of them may
 *  reach the manifest. A leaked endpoint travels into every recording. */
const SECRETS = [
  'sk-live-51H8xQqAaBbCcDdEe',
  'postgres://admin:hunter2@db.internal:5432/prod',
  'https://vault.internal.acme.corp/v1/secret',
  '/var/secrets/acme-prod-bucket',
  'acme-tenant-4471',
  'ops@acme.corp',
  'BEARER-9f8e7d6c5b4a',
];

describe('run manifest — security & containment', () => {
  it('carries no key, endpoint, connection string, path or principal', async () => {
    // Secrets on the provider object itself — the manifest reads `.name` and
    // nothing else. (`Object.assign` rather than a literal: a vendor adapter
    // carries fields like these, and an object literal would be rejected by
    // the port's excess-property check before this test could prove anything.)
    const leakyProvider: LLMProvider = Object.assign(
      {
        name: 'vault-llm',
        complete: async () => ({
          content: 'ok',
          toolCalls: [],
          usage: { input: 1, output: 1 },
          stopReason: 'stop',
        }),
      },
      {
        apiKey: 'sk-live-51H8xQqAaBbCcDdEe',
        endpoint: 'https://vault.internal.acme.corp/v1/secret',
      },
    );

    const agent = Agent.create({
      provider: leakyProvider,
      model: 'vault-model',
      artifacts: { store: fakeArtifactStore() },
    })
      .system(`Authenticate with BEARER-9f8e7d6c5b4a before answering.`)
      .memory(
        defineMemory({
          id: 'notes',
          type: MEMORY_TYPES.EPISODIC,
          strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 3 },
          // A store holding a connection string in the open.
          store: Object.assign(new InMemoryStore(), {
            connectionString: 'postgres://admin:hunter2@db.internal:5432/prod',
          }),
        }),
      )
      // A strategy holding its own credentials — only `.name` is read.
      .window(
        Object.assign(
          { name: 'sliding-window', plan: async () => undefined },
          { credentials: { token: 'BEARER-9f8e7d6c5b4a' } },
        ),
      )
      .build();
    const manifests = watch(agent);

    await agent.run({
      message: 'hi',
      identity: { conversationId: 'c1', principal: 'ops@acme.corp', tenant: 'acme-tenant-4471' },
    });

    const serialized = JSON.stringify(manifests[0]?.payload);
    for (const secret of SECRETS) {
      expect(serialized, `manifest leaked ${secret}`).not.toContain(secret);
    }
    // …while still naming what it is FOR.
    expect(manifests[0]?.payload.llm).toEqual({ provider: 'vault-llm', model: 'vault-model' });
    expect(manifests[0]?.payload.window).toBe('sliding-window');
  });

  it('names no identity in the payload, whoever the run was for', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build();
    const manifests = watch(agent);

    await agent.run({
      message: 'hi',
      identity: { conversationId: 'c1', principal: 'ops@acme.corp', tenant: 'acme-tenant-4471' },
    });

    const keys = Object.keys(manifests[0]?.payload ?? {});
    expect(keys).not.toContain('principal');
    expect(keys).not.toContain('tenant');
    expect(keys).not.toContain('sessionId');
  });
});

// ─── 4. EDGE — absence that must stay absent ─────────────────────────

describe('run manifest — edges', () => {
  it('a graph with NO cascade options is still reported as mounted', async () => {
    const graph = skillGraph()
      .entry(defineSkill({ id: 'billing', description: 'refunds', body: 'b' }))
      .build();
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .skillGraph(graph)
      .build();
    const manifests = watch(agent);

    await agent.run({ message: 'hi' });

    // Presence says "a graph routes this run"; the empty object says the
    // posture was never declared. Reading the cascade to decide the first
    // question would have reported no graph at all.
    expect(manifests[0]?.payload.skillGraph).toEqual({});
  });

  it('a hand-built memory declares no strategy, and none is invented', async () => {
    const real = defineMemory({
      id: 'notes',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 3 },
      store: new InMemoryStore(),
    });
    // What a consumer's own definition looks like: compiled halves, no
    // declared rule.
    const handBuilt = {
      ...real,
      id: 'hand-built',
      strategy: undefined,
      retrieval: undefined,
      embedderId: undefined,
    } as MemoryDefinition;

    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .memory(handBuilt)
      .build();
    const manifests = watch(agent);

    await agent.run({ message: 'hi', identity: { conversationId: 'c1' } });

    expect(manifests[0]?.payload.memories).toEqual([{ id: 'hand-built', type: 'episodic' }]);
  });
});

// ─── 5. REGRESSION — what it costs ───────────────────────────────────

describe('run manifest — cost', () => {
  it('is BOUNDED by the configuration, not by the turn', async () => {
    const graph = skillGraph()
      .entry(defineSkill({ id: 'billing', description: 'refunds', body: 'b' }), {
        match: { intent: 'wants a refund', examples: ['refund my order'] },
      })
      .entry(defineSkill({ id: 'shipping', description: 'delivery', body: 's' }), {
        match: { intent: 'asks about delivery', examples: ['where is my parcel'] },
      })
      .classify(keywordScorer())
      .build();
    const memoryOf = (id: string) =>
      defineMemory({
        id,
        type: MEMORY_TYPES.SEMANTIC,
        strategy: { kind: MEMORY_STRATEGIES.TOP_K, embedder: mockEmbedder(), retrieval: topK() },
        store: new InMemoryStore(),
        flavor: 'rag',
      });

    const agent = Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'a-fairly-long-model-name-2026-08-preview',
      artifacts: {
        store: fakeArtifactStore(),
        recordings: true,
        placement: { maxInlineChars: 50 },
      },
    })
      .memory(memoryOf('docs'))
      .memory(memoryOf('policies'))
      .window(slidingWindow({ keepRecentTurns: 4 }))
      .skillGraph(graph, { strictness: 'rails', continuity: 'conversation' })
      .namesAndNumbersFromEvidence({ posture: 'guard' })
      .build();
    const manifests = watch(agent);

    // A LONG turn: the manifest must not grow with it.
    await agent.run({ message: 'hi '.repeat(2_000), identity: { conversationId: 'c1' } });

    expect(JSON.stringify(manifests[0]?.payload).length).toBeLessThan(1_000);
  });

  it('is not built at all when nothing is listening', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build();
    const dispatcher = (agent as unknown as { getDispatcher(): EventDispatcher }).getDispatcher();
    const spy = vi.spyOn(dispatcher, 'dispatch');

    await agent.run({ message: 'hi' });

    expect(
      spy.mock.calls.filter((c) => c[0]?.type === 'agentfootprint.agent.run_configured'),
    ).toHaveLength(0);

    // …and one listener is all it takes to get it back.
    const manifests = watch(agent);
    await agent.run({ message: 'hi' });
    expect(manifests).toHaveLength(1);
  });
});

// ─── helpers ─────────────────────────────────────────────────────────

/** A store whose every identifying detail is a secret-looking VALUE — which is
 *  why the manifest reports that one exists and never which. */
function fakeArtifactStore(): ArtifactStore {
  return {
    endpoint: 'https://vault.internal.acme.corp/v1/secret',
    directory: '/var/secrets/acme-prod-bucket',
    put: async () => {
      throw new Error('not used');
    },
    head: async () => null,
    get: async () => null,
    delete: async () => undefined,
    list: async () => ({ artifacts: [] }),
  } as unknown as ArtifactStore;
}
