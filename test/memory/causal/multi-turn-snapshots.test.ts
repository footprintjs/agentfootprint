/**
 * Multi-turn causal snapshots — regression for the turn-overwrite bug.
 *
 * BUG: the Agent's seed stage re-seeds `turnNumber = 1` on every `run()`,
 * and `writeSnapshot` used id `snap-{scope.turnNumber}` verbatim — so turn 2
 * of the SAME conversation silently replaced turn 1's snapshot (decision
 * evidence destroyed). FIX: the effective turn is anchored on the STORE
 * (`max(hostTurn, maxStoredSnapshotTurn + 1)`), the only per-conversation
 * source of truth that survives runs, Agent instances, and processes.
 *
 * Covers: unit (stage-level derivation rules), functional (3-turn agent),
 * integration (cross-instance shared store — the canonical loan-officer
 * shape), security (cross-conversation isolation), boundary (no-op turns,
 * pagination, gap preservation), compat (single-turn ids unchanged).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  Agent,
  defineMemory,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  SNAPSHOT_PROJECTIONS,
  InMemoryStore,
  mockEmbedder,
  mock,
} from '../../../src/index.js';
import { writeSnapshot } from '../../../src/memory/causal/writeSnapshot.js';
import type { SnapshotEntry } from '../../../src/memory/causal/types.js';
import type { MemoryState } from '../../../src/memory/stages/types.js';
import type { MemoryEntry } from '../../../src/memory/entry/types.js';
import type { LLMMessage } from '../../../src/adapters/types.js';

const ID = { tenant: 'acme', conversationId: 'conv-multi' };

function turnMessages(query: string, answer: string): LLMMessage[] {
  return [
    { role: 'user', content: query },
    { role: 'assistant', content: answer },
  ];
}

function makeScope(partial?: Partial<MemoryState>): MemoryState {
  return {
    identity: ID,
    turnNumber: 1,
    contextTokensRemaining: 4000,
    loaded: [],
    selected: [],
    formatted: [],
    newMessages: [],
    ...partial,
  };
}

let store: InMemoryStore;
beforeEach(() => {
  store = new InMemoryStore({ embedder: mockEmbedder() });
});

function stage() {
  return writeSnapshot({ store, embedder: mockEmbedder() });
}

async function snap(turn: number): Promise<MemoryEntry<SnapshotEntry> | null> {
  return store.get<SnapshotEntry>(ID, `snap-${turn}`);
}

// ─── Unit — turn derivation rules at the stage level ────────────────

describe('writeSnapshot — multi-turn derivation (unit)', () => {
  it('host stuck at turnNumber=1 (the Agent seed shape) still produces distinct, ordered snapshots', async () => {
    const write = stage();
    await write(makeScope({ newMessages: turnMessages('q-one', 'a-one') }) as never);
    await write(makeScope({ newMessages: turnMessages('q-two', 'a-two') }) as never);
    await write(makeScope({ newMessages: turnMessages('q-three', 'a-three') }) as never);

    const [s1, s2, s3] = [await snap(1), await snap(2), await snap(3)];
    expect(s1?.value.query).toBe('q-one'); // turn 1 evidence SURVIVES turn 2+3
    expect(s2?.value.query).toBe('q-two');
    expect(s3?.value.query).toBe('q-three');
    expect(s1?.source?.turn).toBe(1);
    expect(s2?.source?.turn).toBe(2);
    expect(s3?.source?.turn).toBe(3);
    // Ordered: creation times never go backwards across turns.
    expect(s2!.createdAt).toBeGreaterThanOrEqual(s1!.createdAt);
    expect(s3!.createdAt).toBeGreaterThanOrEqual(s2!.createdAt);
  });

  it('respects a host that tracks turnNumber correctly (gaps preserved)', async () => {
    const write = stage();
    await write(makeScope({ turnNumber: 5, newMessages: turnMessages('q5', 'a5') }) as never);
    // Turn 6 wrote no snapshot; host says 7.
    await write(makeScope({ turnNumber: 7, newMessages: turnMessages('q7', 'a7') }) as never);

    expect((await snap(5))?.value.query).toBe('q5');
    expect(await snap(6)).toBeNull();
    expect((await snap(7))?.value.query).toBe('q7');
  });

  it('derives max+1 (not count+1) when stored turns have gaps', async () => {
    const write = stage();
    await write(makeScope({ turnNumber: 1, newMessages: turnMessages('q1', 'a1') }) as never);
    await write(makeScope({ turnNumber: 3, newMessages: turnMessages('q3', 'a3') }) as never);
    // Stale host counter (1) + stored {snap-1, snap-3} → next must be 4,
    // never a collision with the live snap-3.
    await write(
      makeScope({ turnNumber: 1, newMessages: turnMessages('q-next', 'a-next') }) as never,
    );

    expect((await snap(3))?.value.query).toBe('q3'); // untouched
    expect((await snap(4))?.value.query).toBe('q-next');
  });

  it('keeps the single-turn id byte-compatible (empty store → snap-1)', async () => {
    await stage()(makeScope({ newMessages: turnMessages('only', 'turn') }) as never);
    const entry = await snap(1);
    expect(entry).not.toBeNull();
    expect(entry?.id).toBe('snap-1');
    expect((await store.list(ID)).entries.length).toBe(1);
  });

  it('no-op turns (empty newMessages — pause mid-flight) do not consume a turn number', async () => {
    const write = stage();
    await write(makeScope({ newMessages: [] }) as never); // paused turn — nothing to persist
    expect((await store.list(ID)).entries.length).toBe(0);

    await write(makeScope({ newMessages: turnMessages('after-resume', 'done') }) as never);
    expect((await snap(1))?.value.query).toBe('after-resume');
  });

  it('non-numeric/absent turnNumber falls back to store-derived turn', async () => {
    const write = stage();
    await write(
      makeScope({
        turnNumber: undefined as unknown as number,
        newMessages: turnMessages('q1', 'a1'),
      }) as never,
    );
    await write(
      makeScope({
        turnNumber: Number.NaN,
        newMessages: turnMessages('q2', 'a2'),
      }) as never,
    );
    expect((await snap(1))?.value.query).toBe('q1');
    expect((await snap(2))?.value.query).toBe('q2');
  });

  it('scans past non-snapshot entries and across list() pages', async () => {
    // 1005 episodic-style entries (> one 1000-entry page) sharing the
    // namespace must be ignored by the snap-{n} scan and force the
    // cursor loop through a second page.
    const now = Date.now();
    const filler: MemoryEntry<LLMMessage>[] = [];
    for (let i = 0; i < 1005; i++) {
      filler.push({
        id: `msg-1-${i}`,
        value: { role: 'user', content: `m${i}` },
        version: 1,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
        accessCount: 0,
      });
    }
    await store.putMany(ID, filler);
    await store.put<SnapshotEntry>(ID, {
      id: 'snap-42',
      value: {
        query: 'old',
        finalContent: 'old',
        iterations: 0,
        decisions: [],
        toolCalls: [],
        durationMs: 0,
        tokenUsage: { input: 0, output: 0 },
      },
      version: 1,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
    });

    await stage()(makeScope({ newMessages: turnMessages('new', 'answer') }) as never);
    expect((await snap(43))?.value.query).toBe('new');
  });
});

// ─── Functional — full agent, 3 turns of one conversation ───────────

function causalMemory(s: InMemoryStore) {
  return defineMemory({
    id: 'causal',
    type: MEMORY_TYPES.CAUSAL,
    strategy: { kind: MEMORY_STRATEGIES.TOP_K, topK: 1, threshold: 0.5, embedder: mockEmbedder() },
    store: s,
    projection: SNAPSHOT_PROJECTIONS.DECISIONS,
  });
}

describe('multi-turn conversation — full agent (functional)', () => {
  it('3 runs of the same agent + conversation persist 3 ordered snapshots, each with its own evidence', async () => {
    let call = 0;
    const agent = Agent.create({
      provider: mock({
        respond: () => {
          call++;
          return {
            content: `answer-${call}`,
            toolCalls: [],
            usage: { input: call * 10, output: call },
            stopReason: 'stop',
          };
        },
      }),
      model: 'mock',
      maxIterations: 1,
    })
      .memory(causalMemory(store))
      .build();

    await agent.run({ message: 'question-1', identity: ID });
    await agent.run({ message: 'question-2', identity: ID });
    await agent.run({ message: 'question-3', identity: ID });

    const snaps = [await snap(1), await snap(2), await snap(3)];
    expect(snaps.map((s) => s?.value.query)).toEqual(['question-1', 'question-2', 'question-3']);
    expect(snaps.map((s) => s?.value.finalContent)).toEqual(['answer-1', 'answer-2', 'answer-3']);
    // Per-turn evidence: each snapshot carries ITS turn's token usage,
    // not an accumulation and not the last turn's.
    expect(snaps.map((s) => s?.value.tokenUsage)).toEqual([
      { input: 10, output: 1 },
      { input: 20, output: 2 },
      { input: 30, output: 3 },
    ]);
    expect(snaps.map((s) => s?.source?.turn)).toEqual([1, 2, 3]);
  });
});

// ─── Integration — cross-instance continuity (loan-officer shape) ───

describe('cross-instance conversation — shared store (integration)', () => {
  it('a SECOND Agent instance on the same store + identity appends snap-2 (snap-1 intact)', async () => {
    // The canonical loan-officer example: Monday's underwriter and
    // Friday's support agent are DIFFERENT Agent instances sharing one
    // store + identity. An in-process turn counter could never fix this
    // — only the store-anchored derivation does.
    const memory = causalMemory(store);
    const monday = Agent.create({
      provider: mock({ reply: 'REJECT loan #42: credit 580 < 600.' }),
      model: 'mock',
      maxIterations: 1,
    })
      .memory(memory)
      .build();
    const friday = Agent.create({
      provider: mock({ reply: 'It was rejected for low credit score.' }),
      model: 'mock',
      maxIterations: 1,
    })
      .memory(memory)
      .build();

    await monday.run({ message: 'Should we approve loan #42?', identity: ID });
    await friday.run({ message: 'Why was loan #42 rejected?', identity: ID });

    const s1 = await snap(1);
    const s2 = await snap(2);
    expect(s1?.value.query).toBe('Should we approve loan #42?');
    expect(s1?.value.finalContent).toBe('REJECT loan #42: credit 580 < 600.');
    expect(s2?.value.query).toBe('Why was loan #42 rejected?');
  });
});

// ─── Security — cross-conversation isolation ────────────────────────

describe('cross-conversation isolation (security)', () => {
  it('turn counting is per-conversation: A gets snap-1+snap-2, B independently gets snap-1', async () => {
    const idA = { tenant: 'acme', conversationId: 'conv-A' };
    const idB = { tenant: 'acme', conversationId: 'conv-B' };
    let call = 0;
    const agent = Agent.create({
      provider: mock({
        respond: () => {
          call++;
          return {
            content: `r${call}`,
            toolCalls: [],
            usage: { input: 1, output: 1 },
            stopReason: 'stop',
          };
        },
      }),
      model: 'mock',
      maxIterations: 1,
    })
      .memory(causalMemory(store))
      .build();

    await agent.run({ message: 'A turn 1', identity: idA });
    await agent.run({ message: 'A turn 2', identity: idA });
    await agent.run({ message: 'B turn 1', identity: idB });

    const a1 = await store.get<SnapshotEntry>(idA, 'snap-1');
    const a2 = await store.get<SnapshotEntry>(idA, 'snap-2');
    const b1 = await store.get<SnapshotEntry>(idB, 'snap-1');
    expect(a1?.value.query).toBe('A turn 1');
    expect(a2?.value.query).toBe('A turn 2');
    // B starts its own sequence at 1 — A's turns don't leak into B's numbering.
    expect(b1?.value.query).toBe('B turn 1');
    expect(await store.get(idB, 'snap-2')).toBeNull();
    expect((await store.list(idA)).entries.length).toBe(2);
    expect((await store.list(idB)).entries.length).toBe(1);
  });
});
