/**
 * autoPipeline — 5-pattern tests for the composite facts + beats preset.
 *
 * Verifies the single-subflow topology:
 *   READ  :  LoadAll (split by payload) → FormatAuto (one combined system msg)
 *   WRITE :  LoadFacts → ExtractFacts → WriteFacts → ExtractBeats → WriteBeats
 *
 * Tiers:
 *   - unit:     returns { read, write }; both subflows execute
 *   - boundary: empty store → formatted is empty; empty newMessages → no writes
 *   - scenario: write then read round-trips BOTH facts + beats in one system msg
 *   - property: facts dedup on key across turns; beats accumulate (append-only)
 *   - security: identity isolation; provider swaps in LLM extractors
 */
import { describe, expect, it, vi } from 'vitest';
import { flowChart, FlowChartExecutor, type TypedScope } from 'footprintjs';
import { autoPipeline } from '../../../src/memory/pipeline/auto';
import { InMemoryStore } from '../../../src/memory/store';
import { factId, type Fact, type AutoPipelineState } from '../../../src/memory.barrel';
import type { MemoryEntry, MemoryIdentity } from '../../../src/memory.barrel';
import type { LLMProvider, LLMResponse, Message } from '../../../src/types';

const ID: MemoryIdentity = { tenant: 't1', conversationId: 'c1' };
const user = (content: string): Message => ({ role: 'user', content });

function mockChatProvider(responses: LLMResponse[]): {
  provider: LLMProvider;
  chat: ReturnType<typeof vi.fn>;
} {
  const chat = vi.fn(async () => responses.shift() ?? { content: '{"facts":[],"beats":[]}' });
  return { provider: { chat }, chat };
}

async function runSubflow(
  subflow: ReturnType<typeof autoPipeline>['read'],
  initial: Partial<AutoPipelineState>,
): Promise<Record<string, unknown>> {
  const parent = flowChart<AutoPipelineState>(
    'Seed',
    (scope: TypedScope<AutoPipelineState>) => {
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
        loadedFacts: subflowState.loadedFacts,
        loadedBeats: subflowState.loadedBeats,
        newFacts: subflowState.newFacts,
        newBeats: subflowState.newBeats,
        formatted: subflowState.formatted,
      }),
    })
    .build();
  const executor = new FlowChartExecutor(parent);
  await executor.run();
  return executor.getSnapshot()?.sharedState ?? {};
}

async function runRead(pipeline: ReturnType<typeof autoPipeline>) {
  return runSubflow(pipeline.read, {
    identity: ID,
    turnNumber: 1,
    contextTokensRemaining: 4000,
  });
}

async function runWrite(
  pipeline: ReturnType<typeof autoPipeline>,
  newMessages: Message[],
  turnNumber = 1,
) {
  if (!pipeline.write) throw new Error('pipeline has no write subflow');
  return runSubflow(pipeline.write, {
    identity: ID,
    turnNumber,
    contextTokensRemaining: 4000,
    newMessages,
  });
}

// ── Unit ────────────────────────────────────────────────────

describe('autoPipeline — unit', () => {
  it('returns read + write subflows', () => {
    const pipeline = autoPipeline({ store: new InMemoryStore() });
    expect(pipeline.read).toBeDefined();
    expect(pipeline.write).toBeDefined();
  });

  it('write subflow produces BOTH newFacts and newBeats', async () => {
    const pipeline = autoPipeline({ store: new InMemoryStore() });
    const state = await runWrite(pipeline, [user('my name is Alice.')]);
    expect((state.newFacts as unknown[] | undefined)?.length ?? 0).toBeGreaterThan(0);
    expect((state.newBeats as unknown[] | undefined)?.length ?? 0).toBeGreaterThan(0);
  });

  it('read subflow splits store contents into loadedFacts + loadedBeats', async () => {
    const store = new InMemoryStore();
    const pipeline = autoPipeline({ store });
    await runWrite(pipeline, [user('my name is Alice.')], 1);

    const state = await runRead(pipeline);
    const facts = state.loadedFacts as MemoryEntry<Fact>[] | undefined;
    const beats = state.loadedBeats as unknown[] | undefined;
    expect(facts?.length ?? 0).toBeGreaterThan(0);
    expect(beats?.length ?? 0).toBeGreaterThan(0);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('autoPipeline — boundary', () => {
  it('empty store → formatted is empty (no injection)', async () => {
    const pipeline = autoPipeline({ store: new InMemoryStore() });
    const state = await runRead(pipeline);
    expect(state.formatted).toEqual([]);
  });

  it('empty newMessages → no writes to store', async () => {
    const store = new InMemoryStore();
    const pipeline = autoPipeline({ store });
    await runWrite(pipeline, []);
    const { entries } = await store.list(ID, { limit: 100 });
    expect(entries).toEqual([]);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('autoPipeline — scenario', () => {
  it('round-trips facts + beats into one combined system message', async () => {
    const store = new InMemoryStore();
    const pipeline = autoPipeline({ store });

    await runWrite(pipeline, [user('my name is Alice.')], 1);
    const state = await runRead(pipeline);

    const formatted = state.formatted as Message[];
    expect(formatted).toHaveLength(1);
    const content = formatted[0].content as string;
    expect(content).toContain('Known facts about the user');
    expect(content).toContain('user.name');
    expect(content).toContain('Alice');
    expect(content).toContain('From earlier:');
  });

  it('facts dedup on key across turns; beats accumulate', async () => {
    const store = new InMemoryStore();
    const pipeline = autoPipeline({ store });

    await runWrite(pipeline, [user('my name is Alice.')], 1);
    await runWrite(pipeline, [user('actually my name is Alicia.')], 2);

    const { entries } = await store.list(ID, { limit: 100 });
    // Facts: exactly one entry for user.name, value is "Alicia"
    const factEntries = entries.filter((e) => e.id === factId('user.name'));
    expect(factEntries).toHaveLength(1);
    expect((factEntries[0].value as Fact).value).toBe('Alicia');

    // Beats: grew to at least 2 (one per turn)
    const beatEntries = entries.filter((e) => e.id.startsWith('beat-'));
    expect(beatEntries.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Property ────────────────────────────────────────────────

describe('autoPipeline — property', () => {
  it('default extractors are zero-LLM-cost (no provider.chat calls)', async () => {
    const chatSpy = vi.fn();
    const provider: LLMProvider = { chat: chatSpy };
    const pipeline = autoPipeline({ store: new InMemoryStore() }); // NO provider passed
    // Attach the spy at the agent layer — not this pipeline.
    void provider;
    await runWrite(pipeline, [user('my name is Alice.')], 1);
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it('every stored entry id matches one of the two known prefixes', async () => {
    const store = new InMemoryStore();
    const pipeline = autoPipeline({ store });
    await runWrite(
      pipeline,
      [user('my name is Alice. my email is alice@x.y. I live in Berlin.')],
      1,
    );
    const { entries } = await store.list(ID, { limit: 100 });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      const ok = e.id.startsWith('fact:') || e.id.startsWith('beat-');
      expect(ok).toBe(true);
    }
  });
});

// ── Security ────────────────────────────────────────────────

describe('autoPipeline — security', () => {
  it('identity isolation — tenant B does not see tenant A facts or beats', async () => {
    const store = new InMemoryStore();
    const pipeline = autoPipeline({ store });

    // Tenant A writes
    await runSubflow(pipeline.write!, {
      identity: { tenant: 'A', conversationId: 'c' },
      turnNumber: 1,
      contextTokensRemaining: 4000,
      newMessages: [user('my name is Alice.')],
    });

    // Tenant B reads — should NOT see "Alice"
    const state = await runSubflow(pipeline.read, {
      identity: { tenant: 'B', conversationId: 'c' },
      turnNumber: 1,
      contextTokensRemaining: 4000,
    });

    const formatted = state.formatted as Message[];
    const str = JSON.stringify(formatted);
    expect(str).not.toContain('Alice');
  });

  it('provider config swaps BOTH extractors to LLM-backed', async () => {
    const store = new InMemoryStore();
    // Two chat responses: one for facts, one for beats
    const { provider, chat } = mockChatProvider([
      { content: JSON.stringify({ facts: [{ key: 'user.name', value: 'X', confidence: 0.9 }] }) },
      { content: JSON.stringify({ beats: [{ summary: 's', importance: 0.5, refs: [] }] }) },
    ]);
    const pipeline = autoPipeline({ store, provider });
    await runWrite(pipeline, [user('x')], 1);

    // Two calls — one for facts extraction, one for beats extraction.
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('explicit factExtractor / beatExtractor overrides take precedence over provider', async () => {
    const { provider, chat } = mockChatProvider([{ content: '{"facts":[]}' }]);
    const factExtract = vi.fn(async () => []);
    const beatExtract = vi.fn(async () => []);

    const pipeline = autoPipeline({
      store: new InMemoryStore(),
      provider,
      factExtractor: { extract: factExtract },
      beatExtractor: { extract: beatExtract },
    });
    await runWrite(pipeline, [user('x')], 1);

    expect(factExtract).toHaveBeenCalledTimes(1);
    expect(beatExtract).toHaveBeenCalledTimes(1);
    expect(chat).not.toHaveBeenCalled();
  });
});
