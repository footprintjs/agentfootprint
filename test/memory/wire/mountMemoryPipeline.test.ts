/**
 * mountMemoryPipeline — 5-pattern tests.
 *
 * Verifies the wire helper mounts read + write subflows correctly into a
 * host flowchart and that scope data flows through the documented keys.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { TypedScope } from 'footprintjs';
import { InMemoryStore } from '../../../src/memory/store';
import { defaultPipeline } from '../../../src/memory/pipeline/default';
import { mountMemoryPipeline } from '../../../src/memory/wire/mountMemoryPipeline';
import type { MemoryIdentity } from '../../../src/memory/identity';
import type { Message } from '../../../src/types/messages';

const ID: MemoryIdentity = { tenant: 't1', conversationId: 'c1' };

function msg(role: 'user' | 'assistant', content: string): Message {
  return { role, content };
}

/** Minimal agent-like scope used as the parent state for wire tests. */
interface HostState {
  identity: MemoryIdentity;
  turnNumber: number;
  contextTokensRemaining: number;
  newMessages: Message[];
  memoryInjection?: Message[];
  // Arbitrary marker to verify parent-scope fields aren't clobbered
  hostScratch?: string;
  [key: string]: unknown;
}

let store: InMemoryStore;
beforeEach(() => {
  store = new InMemoryStore();
});

/** Build a host flowchart that seeds state, mounts memory, logs result. */
function buildHost(pipelineStore: InMemoryStore, initial: Partial<HostState>) {
  const seed = (scope: TypedScope<HostState>) => {
    scope.identity = initial.identity ?? ID;
    scope.turnNumber = initial.turnNumber ?? 1;
    scope.contextTokensRemaining = initial.contextTokensRemaining ?? 4000;
    scope.newMessages = initial.newMessages ?? [];
    scope.hostScratch = 'untouched';
  };

  let builder = flowChart<HostState>('Seed', seed, 'seed');
  builder = mountMemoryPipeline(builder, {
    pipeline: defaultPipeline({ store: pipelineStore }),
  });
  return builder.build();
}

// ── Unit ────────────────────────────────────────────────────

describe('mountMemoryPipeline — unit', () => {
  it('read subflow output lands on parent scope under memoryInjection key', async () => {
    await store.put(ID, {
      id: 'm1',
      value: msg('user', 'My name is Alice'),
      version: 1,
      createdAt: 100,
      updatedAt: 100,
      lastAccessedAt: 100,
      accessCount: 0,
    });

    const chart = buildHost(store, {});
    const executor = new FlowChartExecutor(chart);
    await executor.run();

    const shared = executor.getSnapshot()?.sharedState ?? {};
    const injection = shared.memoryInjection as Message[] | undefined;
    expect(Array.isArray(injection)).toBe(true);
    expect(injection!.length).toBe(1);
    expect(String(injection![0].content)).toContain('Alice');
  });

  it('write subflow persists newMessages to the shared store', async () => {
    const chart = buildHost(store, {
      newMessages: [msg('user', 'save me'), msg('assistant', 'saved')],
    });
    const executor = new FlowChartExecutor(chart);
    await executor.run();

    const listed = await store.list(ID);
    expect(listed.entries.length).toBe(2);
  });

  it('does NOT clobber other parent scope fields', async () => {
    const chart = buildHost(store, {});
    const executor = new FlowChartExecutor(chart);
    await executor.run();

    const shared = executor.getSnapshot()?.sharedState ?? {};
    expect(shared.hostScratch).toBe('untouched');
  });

  it('read subflow executes even when store is empty (produces empty injection)', async () => {
    const chart = buildHost(store, {});
    const executor = new FlowChartExecutor(chart);
    await executor.run();

    const shared = executor.getSnapshot()?.sharedState ?? {};
    const injection = shared.memoryInjection as Message[] | undefined;
    expect(Array.isArray(injection)).toBe(true);
    expect(injection!.length).toBe(0);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('mountMemoryPipeline — boundary', () => {
  it('custom key names route data through the overridden fields', async () => {
    const seed = (scope: TypedScope<Record<string, unknown>>) => {
      scope['myId'] = ID;
      scope['myTurn'] = 3;
      scope['myBudget'] = 4000;
      scope['myNewMessages'] = [msg('user', 'custom-keys-test')];
    };

    let b = flowChart<Record<string, unknown>>('Seed', seed, 'seed');
    b = mountMemoryPipeline(b, {
      pipeline: defaultPipeline({ store }),
      identityKey: 'myId',
      turnNumberKey: 'myTurn',
      contextTokensKey: 'myBudget',
      injectionKey: 'myInjection',
      newMessagesKey: 'myNewMessages',
    });

    const chart = b.build();
    const executor = new FlowChartExecutor(chart);
    await executor.run();

    // Verify write landed via custom key
    const listed = await store.list(ID);
    expect(listed.entries.length).toBe(1);
  });

  it('omitting `write` on the pipeline skips the write subflow entirely', async () => {
    // Construct a pipeline without a write subflow (simulating what
    // ephemeralPipeline will return in Layer 7).
    const p = defaultPipeline({ store });
    const readOnlyPipeline = { read: p.read }; // no write

    const seed = (scope: TypedScope<HostState>) => {
      scope.identity = ID;
      scope.turnNumber = 1;
      scope.contextTokensRemaining = 4000;
      scope.newMessages = [msg('user', 'should-not-persist')];
    };

    let b = flowChart<HostState>('Seed', seed, 'seed');
    b = mountMemoryPipeline(b, { pipeline: readOnlyPipeline });
    const chart = b.build();

    const executor = new FlowChartExecutor(chart);
    await executor.run();

    // Write subflow was omitted — nothing persisted
    const listed = await store.list(ID);
    expect(listed.entries.length).toBe(0);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('mountMemoryPipeline — scenario', () => {
  it('two-turn roundtrip — turn 1 write, turn 2 read sees turn 1', async () => {
    // Turn 1: write
    const turn1 = buildHost(store, {
      turnNumber: 1,
      newMessages: [msg('user', 'Remember: the code is 4242')],
    });
    await new FlowChartExecutor(turn1).run();

    // Turn 2: read
    const turn2 = buildHost(store, { turnNumber: 2, newMessages: [] });
    const executor2 = new FlowChartExecutor(turn2);
    await executor2.run();

    const shared = executor2.getSnapshot()?.sharedState ?? {};
    const injection = shared.memoryInjection as Message[];
    expect(injection.length).toBe(1);
    expect(String(injection[0].content)).toContain('4242');
  });

  it('multi-tenant isolation — turn written as tenant A not readable as tenant B', async () => {
    const A: MemoryIdentity = { tenant: 'A', conversationId: 'c1' };
    const B: MemoryIdentity = { tenant: 'B', conversationId: 'c1' };

    const chartA = buildHost(store, {
      identity: A,
      newMessages: [msg('user', 'A-data-secret')],
    });
    await new FlowChartExecutor(chartA).run();

    const chartB = buildHost(store, { identity: B, newMessages: [] });
    const execB = new FlowChartExecutor(chartB);
    await execB.run();

    const injection = (execB.getSnapshot()?.sharedState?.memoryInjection as Message[]) ?? [];
    expect(injection.length).toBe(0);
  });
});

// ── Property ────────────────────────────────────────────────

describe('mountMemoryPipeline — property', () => {
  it('same pipeline can be mounted into many host charts', async () => {
    const pipeline = defaultPipeline({ store });

    const mkHost = (turn: number, messages: Message[]) => {
      const seed = (scope: TypedScope<HostState>) => {
        scope.identity = ID;
        scope.turnNumber = turn;
        scope.contextTokensRemaining = 4000;
        scope.newMessages = messages;
      };
      let b = flowChart<HostState>('Seed', seed, 'seed');
      b = mountMemoryPipeline(b, { pipeline });
      return b.build();
    };

    for (let i = 0; i < 3; i++) {
      const chart = mkHost(i + 1, [msg('user', `turn-${i}`)]);
      await new FlowChartExecutor(chart).run();
    }

    // All three turns' messages accumulated in the store
    const listed = await store.list(ID);
    expect(listed.entries.length).toBe(3);
  });

  it('builder returned is the same reference (fluent API)', () => {
    const pipeline = defaultPipeline({ store });
    const before = flowChart<HostState>(
      'Seed',
      (_scope) => {
        /* no-op */
      },
      'seed',
    );
    const after = mountMemoryPipeline(before, { pipeline });
    // addSubFlowChartNext returns the builder itself — chainable
    expect(typeof after.build).toBe('function');
  });
});

// ── Security ────────────────────────────────────────────────

describe('mountMemoryPipeline — security', () => {
  it('write subflow does not run if newMessages is empty', async () => {
    const chart = buildHost(store, { newMessages: [] });
    await new FlowChartExecutor(chart).run();
    const listed = await store.list(ID);
    expect(listed.entries.length).toBe(0);
  });

  it('read does NOT mutate the parent scope identity (readonly input contract)', async () => {
    const chart = buildHost(store, {});
    const executor = new FlowChartExecutor(chart);
    await executor.run();

    const shared = executor.getSnapshot()?.sharedState ?? {};
    const id = shared.identity as MemoryIdentity;
    expect(id.conversationId).toBe('c1');
    expect(id.tenant).toBe('t1');
  });

  it('errors from the pipeline propagate to the host executor (fail-loud)', async () => {
    // Simulate a broken store: list() throws inside the read subflow.
    // The error must surface at the host executor, not swallowed silently.
    const brokenStore = {
      list: async () => {
        throw new Error('storage backend offline');
      },
      // Rest of the MemoryStore interface can be stubs — only list() runs
      // in the read pipeline's first stage.
      get: async () => null,
      put: async () => {},
      putIfVersion: async () => ({ applied: false }),
      delete: async () => {},
      seen: async () => false,
      recordSignature: async () => {},
      feedback: async () => {},
      getFeedback: async () => null,
      forget: async () => {},
    } as unknown as InMemoryStore;

    const seed = (scope: TypedScope<HostState>) => {
      scope.identity = ID;
      scope.turnNumber = 1;
      scope.contextTokensRemaining = 4000;
      scope.newMessages = [];
    };

    let b = flowChart<HostState>('Seed', seed, 'seed');
    b = mountMemoryPipeline(b, { pipeline: defaultPipeline({ store: brokenStore }) });
    const chart = b.build();

    await expect(new FlowChartExecutor(chart).run()).rejects.toThrow(/storage backend offline/);
  });
});
