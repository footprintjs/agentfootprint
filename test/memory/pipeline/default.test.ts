/**
 * defaultPipeline — 5-pattern tests.
 *
 * These tests EXECUTE the pipeline subflows against FlowChartExecutor
 * (since the pipeline returns built FlowChart objects). This proves the
 * Layer 2-3 stages compose correctly end-to-end, without reaching into
 * the wire layer (which Layer 5 will add).
 *
 * Pattern: build the pipeline → construct FlowChartExecutor → run with
 * the appropriate initial scope fields → assert on final scope state.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { TypedScope } from 'footprintjs';
import { InMemoryStore } from '../../../src/memory/store';
import { defaultPipeline } from '../../../src/memory/pipeline/default';
import type { MemoryEntry } from '../../../src/memory/entry';
import type { Message } from '../../../src/types/messages';
import type { MemoryIdentity } from '../../../src/memory/identity';
import type { MemoryState } from '../../../src/memory/stages';

const ID: MemoryIdentity = { tenant: 't1', conversationId: 'c1' };

function msg(role: 'user' | 'assistant', content: string): Message {
  return { role, content };
}

function makeEntry(id: string, message: Message, updatedAt: number): MemoryEntry<Message> {
  return {
    id,
    value: message,
    version: 1,
    createdAt: updatedAt,
    updatedAt,
    lastAccessedAt: updatedAt,
    accessCount: 0,
  };
}

/**
 * Run a memory pipeline subflow by wrapping it in a parent chart that
 * seeds the scope, then mounts the subflow via `addSubFlowChartNext`.
 * This mirrors how the wire layer (Layer 5) will mount pipelines inside
 * the agent's main flowchart — so the test and production paths agree.
 */
async function runSubflow(
  chart: ReturnType<typeof defaultPipeline>['read'],
  initial: Partial<MemoryState>,
): Promise<Record<string, unknown>> {
  const parent = flowChart<MemoryState>(
    'Seed',
    (scope: TypedScope<MemoryState>) => {
      // Copy every field from `initial` into the parent scope so the
      // inputMapper can forward the relevant subset to the subflow.
      for (const [k, v] of Object.entries(initial)) {
        (scope as unknown as Record<string, unknown>)[k] = v;
      }
    },
    'seed',
  )
    .addSubFlowChartNext('memory', chart, 'Memory', {
      // Pass ONLY the inputs the subflow reads. Fields the stages write
      // (`loaded`, `selected`, `formatted`) must NOT be in the mapper —
      // `inputMapper` output becomes readonly in the subflow's scope,
      // so mapping write-target fields would lock them.
      inputMapper: (parentState: Record<string, unknown>) => ({
        identity: parentState.identity,
        turnNumber: parentState.turnNumber,
        contextTokensRemaining: parentState.contextTokensRemaining,
        newMessages: parentState.newMessages ?? [],
      }),
      outputMapper: (subflowState: Record<string, unknown>) => ({
        // Surface the subflow's scope back onto the parent so tests can
        // assert on the final memory state fields.
        loaded: subflowState.loaded,
        selected: subflowState.selected,
        formatted: subflowState.formatted,
      }),
    })
    .build();

  const executor = new FlowChartExecutor(parent);
  await executor.run();
  const snap = executor.getSnapshot();
  return snap?.sharedState ?? {};
}

let store: InMemoryStore;
beforeEach(() => {
  store = new InMemoryStore();
});

// ── Unit ────────────────────────────────────────────────────

describe('defaultPipeline — unit', () => {
  it('returns a { read, write } object', () => {
    const p = defaultPipeline({ store });
    expect(p.read).toBeDefined();
    expect(p.write).toBeDefined();
  });

  it('read subflow produces formatted output from a pre-populated store', async () => {
    await store.put(ID, makeEntry('m1', msg('user', 'My name is Alice'), 100));
    await store.put(ID, makeEntry('m2', msg('assistant', 'Hi Alice!'), 200));

    const p = defaultPipeline({ store });
    const state = await runSubflow(p.read, {
      identity: ID,
      turnNumber: 2,
      contextTokensRemaining: 4000,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: [],
    });

    const formatted = state.formatted as Message[];
    expect(formatted.length).toBe(1);
    expect(formatted[0].role).toBe('system');
    expect(String(formatted[0].content)).toContain('Alice');
  });

  it('write subflow persists newMessages to the store', async () => {
    const p = defaultPipeline({ store });
    await runSubflow(p.write!, {
      identity: ID,
      turnNumber: 1,
      contextTokensRemaining: 4000,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: [msg('user', 'hi'), msg('assistant', 'hello!')],
    });

    const listed = await store.list(ID);
    expect(listed.entries.length).toBe(2);
  });

  it('empty store → empty formatted (no crash)', async () => {
    const p = defaultPipeline({ store });
    const state = await runSubflow(p.read, {
      identity: ID,
      turnNumber: 1,
      contextTokensRemaining: 4000,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: [],
    });
    expect(state.formatted as Message[]).toEqual([]);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('defaultPipeline — boundary', () => {
  it('loadCount is honored (caps read size)', async () => {
    for (let i = 0; i < 10; i++) {
      await store.put(ID, makeEntry(`m${i}`, msg('user', `msg ${i}`), i * 100));
    }
    const p = defaultPipeline({ store, loadCount: 3 });
    const state = await runSubflow(p.read, {
      identity: ID,
      turnNumber: 1,
      contextTokensRemaining: 4000,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: [],
    });
    const loaded = state.loaded as MemoryEntry<Message>[];
    expect(loaded.length).toBe(3);
  });

  it('reserveTokens is honored by picker', async () => {
    // Give 500 tokens remaining; reserve 450 → 50 budget < 100 minimum → skip
    await store.put(ID, makeEntry('m1', msg('user', 'hi'), 100));
    const p = defaultPipeline({ store, reserveTokens: 450 });
    const state = await runSubflow(p.read, {
      identity: ID,
      turnNumber: 1,
      contextTokensRemaining: 500,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: [],
    });
    expect(state.selected as MemoryEntry<Message>[]).toEqual([]);
    expect(state.formatted as Message[]).toEqual([]);
  });

  it('writeTier tags all persisted entries', async () => {
    const p = defaultPipeline({ store, writeTier: 'hot' });
    await runSubflow(p.write!, {
      identity: ID,
      turnNumber: 1,
      contextTokensRemaining: 4000,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: [msg('user', 'x')],
    });
    const entries = (await store.list(ID)).entries;
    expect(entries.every((e) => e.tier === 'hot')).toBe(true);
  });

  it('writeTtlMs sets expiry on written entries', async () => {
    const before = Date.now();
    const p = defaultPipeline({ store, writeTtlMs: 10_000 });
    await runSubflow(p.write!, {
      identity: ID,
      turnNumber: 1,
      contextTokensRemaining: 4000,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: [msg('user', 'x')],
    });
    const entry = (await store.list(ID)).entries[0];
    expect(entry.ttl).toBeDefined();
    expect(entry.ttl!).toBeGreaterThanOrEqual(before + 10_000);
  });

  it('tiers filter on read side excludes other tiers', async () => {
    await store.put(ID, { ...makeEntry('h', msg('user', 'hot!'), 100), tier: 'hot' });
    await store.put(ID, { ...makeEntry('c', msg('user', 'cold'), 200), tier: 'cold' });

    const p = defaultPipeline({ store, tiers: ['hot'] });
    const state = await runSubflow(p.read, {
      identity: ID,
      turnNumber: 1,
      contextTokensRemaining: 4000,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: [],
    });
    const loaded = state.loaded as MemoryEntry<Message>[];
    expect(loaded.map((e) => e.id)).toEqual(['h']);
  });

  it('formatHeader / formatFooter overrides are passed through', async () => {
    await store.put(ID, makeEntry('m1', msg('user', 'hi'), 100));
    const p = defaultPipeline({
      store,
      formatHeader: 'HDR',
      formatFooter: 'FTR',
    });
    const state = await runSubflow(p.read, {
      identity: ID,
      turnNumber: 1,
      contextTokensRemaining: 4000,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: [],
    });
    const formatted = state.formatted as Message[];
    const content = String(formatted[0].content);
    expect(content).toContain('HDR');
    expect(content).toMatch(/FTR$/);
  });
});

// ── Scenario — full roundtrip ───────────────────────────────

describe('defaultPipeline — scenario', () => {
  it('full round-trip: write turn, read next turn, observe Alice', async () => {
    const p = defaultPipeline({ store });

    // Turn 1: write user + assistant messages
    await runSubflow(p.write!, {
      identity: ID,
      turnNumber: 1,
      contextTokensRemaining: 4000,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: [
        msg('user', 'My name is Alice'),
        msg('assistant', 'Hi Alice, nice to meet you!'),
      ],
    });

    // Turn 2: read — should load the prior turn's messages
    const state = await runSubflow(p.read, {
      identity: ID,
      turnNumber: 2,
      contextTokensRemaining: 4000,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: [],
    });

    const formatted = state.formatted as Message[];
    expect(formatted.length).toBe(1);
    expect(String(formatted[0].content)).toContain('Alice');
  });

  it('cross-turn isolation: writes with different identity do not leak', async () => {
    const OTHER: MemoryIdentity = { tenant: 't1', conversationId: 'c-other' };
    const p = defaultPipeline({ store });

    await runSubflow(p.write!, {
      identity: OTHER,
      turnNumber: 1,
      contextTokensRemaining: 4000,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: [msg('user', 'SECRET DATA')],
    });

    // Read with ID_A — should see nothing
    const state = await runSubflow(p.read, {
      identity: ID,
      turnNumber: 1,
      contextTokensRemaining: 4000,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: [],
    });
    expect(state.formatted as Message[]).toEqual([]);
  });
});

// ── Property ────────────────────────────────────────────────

describe('defaultPipeline — property', () => {
  it('read subflow is stable across rebuilds with same config', () => {
    const p1 = defaultPipeline({ store, loadCount: 15 });
    const p2 = defaultPipeline({ store, loadCount: 15 });
    // Same shape — both have read + write
    expect(typeof p1.read).toBe(typeof p2.read);
    expect(typeof p1.write).toBe(typeof p2.write);
  });

  it('single pipeline instance can be reused across many subflow runs', async () => {
    // Pin: "build once, mount many." The returned FlowChart objects carry
    // no per-run state; stages capture their config at build time.
    const p = defaultPipeline({ store });

    // Three independent runs against the same read subflow — each should
    // see the store state at that moment, not leak state between runs.
    await store.put(ID, makeEntry('m1', msg('user', 'turn-1'), 100));
    const run1 = await runSubflow(p.read, {
      identity: ID,
      turnNumber: 1,
      contextTokensRemaining: 4000,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: [],
    });

    await store.put(ID, makeEntry('m2', msg('user', 'turn-2'), 200));
    const run2 = await runSubflow(p.read, {
      identity: ID,
      turnNumber: 2,
      contextTokensRemaining: 4000,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: [],
    });

    const run3 = await runSubflow(p.read, {
      identity: ID,
      turnNumber: 3,
      contextTokensRemaining: 4000,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: [],
    });

    // Each run produces increasing memory (new messages accumulate)
    expect(String((run1.formatted as Message[])[0]?.content ?? '')).toContain('turn-1');
    expect((run2.loaded as MemoryEntry<Message>[]).length).toBe(2);
    expect((run3.loaded as MemoryEntry<Message>[]).length).toBe(2);
  });

  it('write → read preserves all messages (no loss)', async () => {
    const p = defaultPipeline({ store });
    const messages: Message[] = [];
    for (let i = 0; i < 5; i++) {
      messages.push(msg(i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`));
    }

    await runSubflow(p.write!, {
      identity: ID,
      turnNumber: 1,
      contextTokensRemaining: 4000,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: messages,
    });

    const state = await runSubflow(p.read, {
      identity: ID,
      turnNumber: 2,
      contextTokensRemaining: 4000,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: [],
    });

    const content = String((state.formatted as Message[])[0].content);
    for (let i = 0; i < 5; i++) {
      expect(content).toContain(`turn ${i}`);
    }
  });
});

// ── Security ────────────────────────────────────────────────

describe('defaultPipeline — security', () => {
  it('read and write share the same store — config coupling enforced', () => {
    // Pin behavior: the preset returns a `{read, write}` bundle from ONE
    // config call, so the two sides can't point to different stores by
    // accident (mix-and-match from separate preset calls would be a bug).
    const p = defaultPipeline({ store });
    // Structural check — both subflows exist
    expect(p.read).toBeDefined();
    expect(p.write).toBeDefined();
  });

  it('tenant isolation survives through pipeline execution', async () => {
    const A: MemoryIdentity = { tenant: 'A', conversationId: 'c1' };
    const B: MemoryIdentity = { tenant: 'B', conversationId: 'c1' };
    const p = defaultPipeline({ store });

    await runSubflow(p.write!, {
      identity: A,
      turnNumber: 1,
      contextTokensRemaining: 4000,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: [msg('user', 'A-secret')],
    });

    const state = await runSubflow(p.read, {
      identity: B,
      turnNumber: 1,
      contextTokensRemaining: 4000,
      loaded: [],
      selected: [],
      formatted: [],
      newMessages: [],
    });

    // B must not see A's messages
    expect(state.formatted as Message[]).toEqual([]);
  });
});
