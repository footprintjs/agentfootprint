/**
 * ephemeralPipeline — 5-pattern tests.
 *
 * Verifies the read-only preset. The core claim: after ANY number of
 * agent runs, the store has zero new entries.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { TypedScope } from 'footprintjs';
import { InMemoryStore } from '../../../src/memory/store';
import { ephemeralPipeline } from '../../../src/memory/pipeline/ephemeral';
import { mountMemoryRead, mountMemoryWrite } from '../../../src/memory/wire';
import type { MemoryIdentity } from '../../../src/memory/identity';
import type { MemoryEntry } from '../../../src/memory/entry';
import type { Message } from '../../../src/types/messages';

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

interface HostState {
  identity: MemoryIdentity;
  turnNumber: number;
  contextTokensRemaining: number;
  newMessages: Message[];
  memoryInjection: Message[];
  [key: string]: unknown;
}

let store: InMemoryStore;
beforeEach(() => {
  store = new InMemoryStore();
});

// ── Unit ────────────────────────────────────────────────────

describe('ephemeralPipeline — unit', () => {
  it('returns { read, write: undefined }', () => {
    const p = ephemeralPipeline({ store });
    expect(p.read).toBeDefined();
    expect(p.write).toBeUndefined();
  });

  it('read subflow loads pre-seeded entries into the prompt', async () => {
    await store.put(ID, makeEntry('seed1', msg('user', 'pre-seeded fact'), 100));
    const pipeline = ephemeralPipeline({ store });

    const seed = (scope: TypedScope<HostState>) => {
      scope.identity = ID;
      scope.turnNumber = 1;
      scope.contextTokensRemaining = 4000;
      scope.newMessages = [msg('user', 'ignored')];
      scope.memoryInjection = [];
    };

    let b = flowChart<HostState>('Seed', seed, 'seed');
    b = mountMemoryRead(b, { pipeline });
    // mountMemoryWrite is a no-op when pipeline.write is undefined — pin this
    b = mountMemoryWrite(b, { pipeline });
    const chart = b.build();

    const executor = new FlowChartExecutor(chart);
    await executor.run();

    const shared = executor.getSnapshot()?.sharedState ?? {};
    const injection = shared.memoryInjection as Message[];
    expect(injection.length).toBe(1);
    expect(String(injection[0].content)).toContain('pre-seeded fact');
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('ephemeralPipeline — boundary', () => {
  it('mountMemoryWrite with ephemeral pipeline is a no-op (no write stage added)', async () => {
    // Verified by the acceptance below — newMessages never reach the store.
    const pipeline = ephemeralPipeline({ store });
    expect(pipeline.write).toBeUndefined();
  });

  it('ephemeral read respects tier filter', async () => {
    await store.put(ID, { ...makeEntry('h', msg('user', 'hot-fact'), 100), tier: 'hot' });
    await store.put(ID, { ...makeEntry('c', msg('user', 'cold-fact'), 200), tier: 'cold' });

    const pipeline = ephemeralPipeline({ store, tiers: ['hot'] });

    const seed = (scope: TypedScope<HostState>) => {
      scope.identity = ID;
      scope.turnNumber = 1;
      scope.contextTokensRemaining = 4000;
      scope.newMessages = [];
      scope.memoryInjection = [];
    };

    let b = flowChart<HostState>('Seed', seed, 'seed');
    b = mountMemoryRead(b, { pipeline });
    const chart = b.build();

    const exec = new FlowChartExecutor(chart);
    await exec.run();
    const shared = exec.getSnapshot()?.sharedState ?? {};
    const out = String((shared.memoryInjection as Message[])[0]?.content ?? '');
    expect(out).toContain('hot-fact');
    expect(out).not.toContain('cold-fact');
  });
});

// ── Scenario (the key acceptance) ────────────────────────────

describe('ephemeralPipeline — scenario', () => {
  it('NOTHING persists to the store across any number of runs', async () => {
    // Pre-seed so read pipeline has something to return
    await store.put(ID, makeEntry('seed', msg('user', 'seeded'), 100));

    const pipeline = ephemeralPipeline({ store });

    // Run the chart 3 times — each turn attempts to write scope.newMessages
    // but since mountMemoryWrite no-ops on an ephemeral pipeline, nothing
    // new should be persisted.
    for (let i = 0; i < 3; i++) {
      const seed = (scope: TypedScope<HostState>) => {
        scope.identity = ID;
        scope.turnNumber = i + 1;
        scope.contextTokensRemaining = 4000;
        scope.newMessages = [
          msg('user', `turn-${i}-should-NOT-be-saved`),
          msg('assistant', `reply-${i}`),
        ];
        scope.memoryInjection = [];
      };

      let b = flowChart<HostState>('Seed', seed, 'seed');
      b = mountMemoryRead(b, { pipeline });
      b = mountMemoryWrite(b, { pipeline });
      const chart = b.build();

      await new FlowChartExecutor(chart).run();
    }

    // Store should STILL have only the original seeded entry.
    const listed = await store.list(ID);
    expect(listed.entries.length).toBe(1);
    expect(listed.entries[0].id).toBe('seed');
  });

  it('read-only agent with pre-seeded facts — answers without writing', async () => {
    // Seed a "system fact" the agent should be able to cite.
    await store.put(
      ID,
      makeEntry('policy', msg('user', 'Company policy: refunds within 30 days.'), 100),
    );

    const pipeline = ephemeralPipeline({ store });

    const seed = (scope: TypedScope<HostState>) => {
      scope.identity = ID;
      scope.turnNumber = 1;
      scope.contextTokensRemaining = 4000;
      scope.newMessages = [
        msg('user', 'Can I get a refund after 6 months?'),
        msg('assistant', 'Not per our policy'),
      ];
      scope.memoryInjection = [];
    };

    let b = flowChart<HostState>('Seed', seed, 'seed');
    b = mountMemoryRead(b, { pipeline });
    b = mountMemoryWrite(b, { pipeline });
    const chart = b.build();

    const exec = new FlowChartExecutor(chart);
    await exec.run();

    const shared = exec.getSnapshot()?.sharedState ?? {};
    const out = String((shared.memoryInjection as Message[])[0]?.content ?? '');
    expect(out).toContain('Company policy');

    // And confirm the conversation didn't get saved
    const listed = await store.list(ID);
    expect(listed.entries.length).toBe(1); // just the pre-seeded policy
  });
});

// ── Property ────────────────────────────────────────────────

describe('ephemeralPipeline — property', () => {
  it('write subflow is always undefined regardless of config', () => {
    const variations = [
      ephemeralPipeline({ store }),
      ephemeralPipeline({ store, loadCount: 50 }),
      ephemeralPipeline({ store, tiers: ['hot'] }),
      ephemeralPipeline({ store, reserveTokens: 1000, minimumTokens: 200 }),
    ];
    for (const p of variations) {
      expect(p.write).toBeUndefined();
    }
  });
});

// ── Security ────────────────────────────────────────────────

describe('ephemeralPipeline — security', () => {
  it('compliance-grade: no path from agent turn to stored entry', async () => {
    // Regulated environment: a session marked "ephemeral" must leave NO
    // trace in the store, even if a misconfigured wire layer tried to
    // mount the write subflow.
    const pipeline = ephemeralPipeline({ store });

    // Even if a consumer calls mountMemoryWrite, it's a no-op when
    // pipeline.write is undefined. Pin that contract.
    const seed = (scope: TypedScope<HostState>) => {
      scope.identity = ID;
      scope.turnNumber = 1;
      scope.contextTokensRemaining = 4000;
      scope.newMessages = [msg('user', 'SECRET DATA — MUST NOT PERSIST')];
      scope.memoryInjection = [];
    };

    let b = flowChart<HostState>('Seed', seed, 'seed');
    b = mountMemoryRead(b, { pipeline });
    b = mountMemoryWrite(b, { pipeline }); // attempts write — becomes no-op
    const chart = b.build();

    await new FlowChartExecutor(chart).run();

    const listed = await store.list(ID);
    expect(listed.entries.length).toBe(0);
    // Double-check: the secret never touched the store
    const allValues = listed.entries
      .map((e) => (typeof e.value === 'object' ? JSON.stringify(e.value) : ''))
      .join(' ');
    expect(allValues).not.toContain('SECRET DATA');
  });
});
