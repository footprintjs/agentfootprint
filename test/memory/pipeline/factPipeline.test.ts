/**
 * factPipeline — 5-pattern tests for the preset.
 *
 * Verifies the read + write subflows are wired correctly:
 *   - READ  :  LoadFacts → FormatFacts
 *   - WRITE :  LoadFacts → ExtractFacts → WriteFacts
 *
 * Tiers:
 *   - unit:     both subflows are buildable FlowCharts
 *   - boundary: empty store → read produces empty formatted
 *   - scenario: write then read round-trips facts; update overwrites
 *   - property: stored ids always start with `fact:`
 *   - security: LLM extractor sees existing facts via loadedFacts
 */
import { describe, expect, it, vi } from 'vitest';
import { flowChart, FlowChartExecutor, type TypedScope } from 'footprintjs';
import { factPipeline } from '../../../src/memory/pipeline/fact';
import { InMemoryStore } from '../../../src/memory/store';
import {
  patternFactExtractor,
  llmFactExtractor,
  factId,
  type Fact,
  type FactPipelineState,
} from '../../../src/memory/facts';
import type { MemoryEntry } from '../../../src/memory/entry';
import type { LLMProvider, Message } from '../../../src/types';
import type { MemoryIdentity } from '../../../src/memory/identity';

const ID: MemoryIdentity = { tenant: 't1', conversationId: 'c1' };
const user = (content: string): Message => ({ role: 'user', content });

/**
 * Run a memory subflow by wrapping it in a parent chart that seeds the
 * scope, then mounts the subflow via `addSubFlowChartNext`. Mirrors the
 * pattern from defaultPipeline.test.ts — matches how the wire layer
 * mounts pipelines inside the agent's flowchart.
 */
async function runSubflow(
  subflow: ReturnType<typeof factPipeline>['read'],
  initial: Partial<FactPipelineState>,
): Promise<Record<string, unknown>> {
  const parent = flowChart<FactPipelineState>(
    'Seed',
    (scope: TypedScope<FactPipelineState>) => {
      for (const [k, v] of Object.entries(initial)) {
        (scope as unknown as Record<string, unknown>)[k] = v;
      }
    },
    'seed',
  )
    .addSubFlowChartNext('mem', subflow, 'Memory', {
      inputMapper: (parentState: Record<string, unknown>) => ({
        identity: parentState.identity,
        turnNumber: parentState.turnNumber,
        contextTokensRemaining: parentState.contextTokensRemaining,
        newMessages: parentState.newMessages ?? [],
      }),
      outputMapper: (subflowState: Record<string, unknown>) => ({
        loaded: subflowState.loaded,
        loadedFacts: subflowState.loadedFacts,
        newFacts: subflowState.newFacts,
        formatted: subflowState.formatted,
      }),
    })
    .build();

  const executor = new FlowChartExecutor(parent);
  await executor.run();
  const snap = executor.getSnapshot();
  return snap?.sharedState ?? {};
}

async function runRead(
  pipeline: ReturnType<typeof factPipeline>,
): Promise<Record<string, unknown>> {
  return runSubflow(pipeline.read, {
    identity: ID,
    turnNumber: 1,
    contextTokensRemaining: 4000,
  });
}

async function runWrite(
  pipeline: ReturnType<typeof factPipeline>,
  newMessages: Message[],
  turnNumber = 1,
): Promise<Record<string, unknown>> {
  if (!pipeline.write) throw new Error('pipeline has no write subflow');
  return runSubflow(pipeline.write, {
    identity: ID,
    turnNumber,
    contextTokensRemaining: 4000,
    newMessages,
  });
}

// ── Unit ────────────────────────────────────────────────────

describe('factPipeline — unit', () => {
  it('returns read + write subflows', () => {
    const pipeline = factPipeline({ store: new InMemoryStore() });
    expect(pipeline.read).toBeDefined();
    expect(pipeline.write).toBeDefined();
  });

  it('read subflow writes scope.formatted (may be empty on empty store)', async () => {
    const pipeline = factPipeline({ store: new InMemoryStore() });
    const state = await runRead(pipeline);
    expect(Array.isArray(state.formatted)).toBe(true);
  });

  it('write subflow writes scope.newFacts after extraction', async () => {
    const pipeline = factPipeline({ store: new InMemoryStore() });
    const state = await runWrite(pipeline, [user('my name is Alice.')]);
    const newFacts = state.newFacts as MemoryEntry<Fact>[] | undefined;
    expect(newFacts).toBeDefined();
    expect(newFacts!.length).toBeGreaterThan(0);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('factPipeline — boundary', () => {
  it('empty store → read emits no formatted messages (empty array)', async () => {
    const pipeline = factPipeline({ store: new InMemoryStore() });
    const state = await runRead(pipeline);
    expect(state.formatted).toEqual([]);
  });

  it('write with no messages → no facts written', async () => {
    const store = new InMemoryStore();
    const pipeline = factPipeline({ store });
    await runWrite(pipeline, []);
    const { entries } = await store.list<Fact>(ID, { limit: 100 });
    expect(entries).toEqual([]);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('factPipeline — scenario', () => {
  it('write-then-read round-trips a fact', async () => {
    const store = new InMemoryStore();
    const pipeline = factPipeline({ store });

    await runWrite(pipeline, [user('my name is Alice.')], 1);

    const state = await runRead(pipeline);
    const formatted = state.formatted as Message[];
    expect(formatted).toHaveLength(1);
    const content = formatted[0].content as string;
    expect(content).toContain('user.name');
    expect(content).toContain('Alice');
  });

  it('same key written twice overwrites — dedup via stable ids', async () => {
    const store = new InMemoryStore();
    const pipeline = factPipeline({ store });

    await runWrite(pipeline, [user('my name is Alice.')], 1);
    await runWrite(pipeline, [user('actually my name is Alicia.')], 2);

    const { entries } = await store.list<Fact>(ID, { limit: 100 });
    const names = entries.filter((e) => e.id === factId('user.name'));
    expect(names).toHaveLength(1);
    expect(names[0].value.value).toBe('Alicia');
  });

  it('tier + TTL flow through to written entries', async () => {
    const store = new InMemoryStore();
    const pipeline = factPipeline({
      store,
      writeTier: 'hot',
      writeTtlMs: 60_000,
    });
    await runWrite(pipeline, [user('my name is Alice.')], 1);
    const entry = await store.get<Fact>(ID, factId('user.name'));
    expect(entry?.tier).toBe('hot');
    expect(typeof entry?.ttl).toBe('number');
  });
});

// ── Property ────────────────────────────────────────────────

describe('factPipeline — property', () => {
  it('every persisted entry id starts with fact: prefix', async () => {
    const store = new InMemoryStore();
    const pipeline = factPipeline({ store });
    await runWrite(
      pipeline,
      [user('my name is Alice. my email is alice@x.y. I live in Berlin. I prefer tea.')],
      1,
    );
    const { entries } = await store.list<Fact>(ID, { limit: 100 });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.id.startsWith('fact:')).toBe(true);
    }
  });
});

// ── Security ────────────────────────────────────────────────

describe('factPipeline — security', () => {
  it('LLM extractor sees existing facts via loadedFacts on write side', async () => {
    const store = new InMemoryStore();
    const now = Date.now();
    const seeded: MemoryEntry<Fact> = {
      id: factId('user.name'),
      value: { key: 'user.name', value: 'Alice', confidence: 0.95 },
      version: 1,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
    };
    await store.put(ID, seeded);

    const chatSpy = vi.fn(async () => ({ content: '{"facts":[]}' }));
    const provider: LLMProvider = { chat: chatSpy };
    const pipeline = factPipeline({
      store,
      extractor: llmFactExtractor({ provider }),
    });

    await runWrite(pipeline, [user('hi again')], 2);

    expect(chatSpy).toHaveBeenCalledTimes(1);
    const call = chatSpy.mock.calls[0];
    const userMsg = (call[0] as Message[])[1].content as string;
    expect(userMsg).toContain('Previously known facts');
    expect(userMsg).toContain('user.name');
    expect(userMsg).toContain('"Alice"');
  });

  it('pattern extractor works end-to-end without any LLM calls', async () => {
    const store = new InMemoryStore();
    // Explicit pattern extractor to be sure no LLM is invoked.
    const pipeline = factPipeline({ store, extractor: patternFactExtractor() });
    await runWrite(pipeline, [user('my name is Alice.')], 1);
    const entry = await store.get<Fact>(ID, factId('user.name'));
    expect(entry?.value.value).toBe('Alice');
  });
});
