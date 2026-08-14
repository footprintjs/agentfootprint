/**
 * firestoreSessions — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * The laws being pinned:
 *   • Ownership is DERIVED from the stored envelope, and established ONCE. The
 *     first turn that signs owns the conversation: a later turn with a leaner
 *     identity must not erase it, and a later turn with a DIFFERENT identity
 *     must not take it — including when the two turns race.
 *   • `ownerOf` answers `undefined` for BOTH "no such session" and "a session
 *     nobody signed for". The ambiguity is the point; a store that told them
 *     apart would be an oracle for which session ids are real.
 *   • `listByUser` is a SERVER-SIDE query with a real Firestore cursor. Never a
 *     client-side sort, never an offset — the defect a field trial of another
 *     Firestore adapter named in its own report.
 *   • Unreadable ≠ absent. A document that is present and cannot be read is
 *     refused BY NAME; only a session that was never written hydrates as
 *     `undefined`.
 *   • A session id is OPAQUE — slashes, unicode, 2000 characters — and the
 *     document name it maps to is always legal, always the same, and never the
 *     same for two different ids.
 *   • Nothing is truncated. A conversation too big for one document is refused
 *     by name before the write.
 *   • Errors name the project, database, collection and failure — never a
 *     credential, and never the SDK's own text.
 *
 * The double these run against is `./firestoreDouble.ts`, and its docstring is
 * the other half of this file: it records which SHAPE each fake member has and
 * which line of `firestore.d.ts` (9.0.0) says so. Those line numbers were read in
 * a scratch install outside this repository — the package is deliberately not a
 * devDependency here — so nothing re-checks them on this machine. A double that
 * answered something the real client never answers would make every assertion
 * below worthless, which is why the provenance is stated rather than implied.
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { askHuman, isPaused } from '../../src/core/pause.js';
import {
  memorySessions,
  readPausedRun,
  SessionOwnershipConflictError,
  standingAgent,
  toEnvelope,
  toPausedEnvelope,
  UnreadableEnvelopeError,
} from '../../src/hosting/index.js';
import {
  DEFAULT_SESSION_COLLECTION,
  EnvelopeTooLargeError,
  FIRESTORE_MAX_ENVELOPE_BYTES,
  FirestoreIndexMissingError,
  firestoreSessions,
} from '../../src/hosting-providers.js';
// Not on the public barrel — see the note there. The suite reaches for the
// module path the same way the SQLite suite reaches for its `node:sqlite` shape.
import {
  documentIdFor,
  firestoreFailure,
  grpcStatusOf,
} from '../../src/adapters/hosting/firestoreSessions.js';
import type { AgentRunCheckpoint } from '../../src/core/runCheckpoint.js';
import { fakeFirestore, grpcError, type FakeStore } from './firestoreDouble.js';
import { inProcessHost } from './testHost.js';

// ─── Fixtures ────────────────────────────────────────────────────────

/** gRPC status 9. The one an operator can fix, and the reason it has a class. */
const FAILED_PRECONDITION = 9;

function checkpoint(overrides: Partial<AgentRunCheckpoint> = {}): AgentRunCheckpoint {
  return {
    version: 1,
    runId: 'run-1',
    history: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ],
    lastCompletedIteration: 1,
    originalInput: { message: 'hello' },
    checkpointedAt: 1_700_000_000_000,
    ...overrides,
  } as AgentRunCheckpoint;
}

/** An envelope, optionally signed by somebody. */
function envelope(principal?: string, savedAtOverride?: number) {
  const base = toEnvelope(
    checkpoint(
      principal === undefined
        ? {}
        : ({ identity: { principal } } as unknown as Partial<AgentRunCheckpoint>),
    ),
  );
  return savedAtOverride === undefined
    ? base
    : ({ ...base, savedAt: savedAtOverride } as typeof base);
}

/** A store wired to a fresh double, with the double alongside. */
function storeWith(...args: Parameters<typeof fakeFirestore>) {
  const fake = fakeFirestore(...args);
  return { fake, sessions: firestoreSessions({ _sdk: fake.sdk }) };
}

// ─── unit — the port, and the shapes it reads ────────────────────────

describe('firestoreSessions — the two required methods', () => {
  it('stores a conversation and reads it back whole', async () => {
    const { sessions, fake } = storeWith();
    await sessions.persist('s1', envelope('alice'));

    expect(fake.store.size).toBe(1);
    const stored = await sessions.hydrate('s1');
    expect(stored).toBeDefined();
    expect(stored!.format).toBe(envelope('alice').format);
    expect((stored as { data: AgentRunCheckpoint }).data.history).toHaveLength(2);
  });

  it('a session that was never written hydrates as undefined — not an error', async () => {
    const { sessions } = storeWith();
    await expect(sessions.hydrate('never-seen')).resolves.toBeUndefined();
  });

  it('the document carries the RAW session id beside the hashed name', async () => {
    const { sessions, fake } = storeWith();
    await sessions.persist('tenant/a/session:1', envelope('alice'));

    const [name, row] = [...fake.store.entries()][0]!;
    // The NAME is the hash — a slash could never have been one.
    expect(name).toBe(documentIdFor('tenant/a/session:1'));
    expect(name).not.toContain('/');
    // The FIELD is the id, because a listing has to hand back something that
    // can be fed to hydrate.
    expect(row['sessionId']).toBe('tenant/a/session:1');
  });

  it('the envelope is stored as a JSON STRING, and the listing columns beside it', async () => {
    const { sessions, fake } = storeWith();
    await sessions.persist('s1', envelope('alice'));
    const row = [...fake.store.values()][0]!;

    expect(typeof row['envelope']).toBe('string');
    expect(row['owner']).toBe('alice');
    expect(row['messageCount']).toBe(2);
    expect(typeof row['savedAt']).toBe('number');
    expect(typeof row['format']).toBe('string');
  });

  it('an unsigned conversation stores owner as NULL, never undefined', async () => {
    // The default client throws on `undefined`, and a missing field cannot be
    // told apart from a field the store failed to write.
    const { sessions, fake } = storeWith();
    await sessions.persist('s1', envelope());
    expect([...fake.store.values()][0]!['owner']).toBeNull();
  });

  it('forget removes it, and forgetting nothing is not an error', async () => {
    const { sessions, fake } = storeWith();
    await sessions.persist('s1', envelope('alice'));
    await sessions.forget('s1');
    expect(fake.store.size).toBe(0);
    await expect(sessions.forget('s1')).resolves.toBeUndefined();
    await expect(sessions.hydrate('s1')).resolves.toBeUndefined();
  });

  it('connection settings really reach the client, and are omitted when unset', () => {
    const explicit = fakeFirestore();
    firestoreSessions({ _sdk: explicit.sdk, project: 'p-1', database: 'db-2' });
    expect(explicit.calls[0]).toBe('new Firestore({"projectId":"p-1","databaseId":"db-2"})');

    const ambient = fakeFirestore();
    firestoreSessions({ _sdk: ambient.sdk });
    // No `undefined` keys — the client is left to read the environment.
    expect(ambient.calls[0]).toBe('new Firestore({})');
  });

  it('the default collection is named, and a custom one is honoured', async () => {
    const { sessions, fake } = storeWith();
    expect(sessions.collection).toBe(DEFAULT_SESSION_COLLECTION);
    await sessions.persist('s1', envelope('alice'));
    expect(fake.calls).toContain('Firestore.collection');

    const custom = fakeFirestore();
    expect(firestoreSessions({ _sdk: custom.sdk, collection: 'chat_sessions' }).collection).toBe(
      'chat_sessions',
    );
  });
});

// ─── unit — the refusals that are ours, not the service's ────────────

describe('firestoreSessions — construction refuses what it cannot honour', () => {
  it('a pre-built client together with connection settings is refused, not ignored', () => {
    const fake = fakeFirestore();
    const client = new fake.sdk.Firestore();
    // `_sdk` rides along because a pre-built client does NOT remove the need for
    // the module: `FieldPath.documentId()` is a static on it and there is no
    // string spelling of `__name__` the client accepts. In production that is
    // free — anyone holding a client has the package installed. Here it is what
    // lets this path be tested at all, since the package is deliberately not a
    // devDependency (see the surface pin's `notInstalled`).
    expect(() => firestoreSessions({ firestore: client, _sdk: fake.sdk, project: 'p' })).toThrow(
      /'project'/,
    );
    expect(() => firestoreSessions({ firestore: client, _sdk: fake.sdk, database: 'd' })).toThrow(
      /'database'/,
    );
    // Alone, it is fine.
    expect(() => firestoreSessions({ firestore: client, _sdk: fake.sdk })).not.toThrow();
  });

  it('a collection name Firestore could not address is refused by name', () => {
    const fake = fakeFirestore();
    for (const bad of ['', '   ', 'a/b', '.', '..', '__x__']) {
      expect(() => firestoreSessions({ _sdk: fake.sdk, collection: bad }), bad).toThrow(TypeError);
    }
    expect(() => firestoreSessions({ _sdk: fake.sdk, collection: 'chat_sessions' })).not.toThrow();
  });

  it('close() is final, and every method says which verb it refused', async () => {
    const { sessions, fake } = storeWith();
    await sessions.close();
    expect(fake.terminated()).toBe(true);

    await expect(sessions.hydrate('s')).rejects.toThrow(/hydrate a session/);
    await expect(sessions.persist('s', envelope('a'))).rejects.toThrow(/persist a session/);
    await expect(sessions.listByUser('a')).rejects.toThrow(/list a user/);
    await expect(sessions.ownerOf('s')).rejects.toThrow(/read a session/);
    await expect(sessions.forget('s')).rejects.toThrow(/forget a session/);
    // Idempotent.
    await expect(sessions.close()).resolves.toBeUndefined();
  });

  it('close() does NOT terminate a client the caller passed in', async () => {
    const fake = fakeFirestore();
    const client = new fake.sdk.Firestore();
    const sessions = firestoreSessions({ firestore: client, _sdk: fake.sdk });
    await sessions.close();
    // This store did not open it and does not get to decide when it stops.
    expect(fake.terminated()).toBe(false);
  });

  it('documentIdFor still answers on a closed store — it touches nothing', async () => {
    const { sessions } = storeWith();
    const before = sessions.documentIdFor('s1');
    await sessions.close();
    expect(sessions.documentIdFor('s1')).toBe(before);
  });
});

// ─── scenario — ownership, established once ──────────────────────────

describe('firestoreSessions — ownership is derived, and established once', () => {
  it('the first turn that signs owns it', async () => {
    const { sessions } = storeWith();
    await sessions.persist('s1', envelope('alice'));
    await expect(sessions.ownerOf('s1')).resolves.toBe('alice');
  });

  it('a later turn with a LEANER identity does not erase the owner', async () => {
    const { sessions, fake } = storeWith();
    await sessions.persist('s1', envelope('alice'));
    // The same conversation, persisted by a path that lost the principal.
    await sessions.persist('s1', envelope());

    await expect(sessions.ownerOf('s1')).resolves.toBe('alice');
    expect([...fake.store.values()][0]!['owner']).toBe('alice');
  });

  it('a later turn with a DIFFERENT identity is REFUSED — index and envelope both', async () => {
    const { sessions, fake } = storeWith();
    await sessions.persist('s1', envelope('alice'));

    // 9.36.1. Until then this write SUCCEEDED and only the `owner` column was
    // protected — which is how a live trial ended up with `ownerOf` naming
    // alice over a document whose `envelope` was mallory's whole conversation.
    // Keeping the index while storing the payload is not "not moving" the
    // owner; it is moving the CONVERSATION out from under her.
    await expect(sessions.persist('s1', envelope('mallory'))).rejects.toBeInstanceOf(
      SessionOwnershipConflictError,
    );

    // Ownership by writing would undo every check made against this index one
    // turn later. These are the assertions that say it cannot happen.
    await expect(sessions.ownerOf('s1')).resolves.toBe('alice');
    await expect(sessions.listByUser('mallory')).resolves.toEqual({ sessions: [] });
    // THE HALF THAT WAS NEVER CHECKED, and the reason the defect shipped: the
    // stored document is still alice's, not merely labelled alice.
    const row = [...fake.store.values()][0]!;
    expect(row['owner']).toBe('alice');
    expect(String(row['envelope'])).toContain('alice');
    expect(String(row['envelope'])).not.toContain('mallory');
  });

  it('a conversation that gains an identity on turn TWO records it', async () => {
    // The other side of write-once: never-set is not the same as set-to-nobody,
    // and an adapter that simply never wrote `owner` after the first turn would
    // leave this conversation ownerless forever.
    const { sessions } = storeWith();
    await sessions.persist('s1', envelope());
    await expect(sessions.ownerOf('s1')).resolves.toBeUndefined();

    await sessions.persist('s1', envelope('alice'));
    await expect(sessions.ownerOf('s1')).resolves.toBe('alice');
  });

  it('everything EXCEPT the owner is last-write-wins', async () => {
    const { sessions, fake } = storeWith();
    await sessions.persist('s1', envelope('alice', 1000));
    await sessions.persist('s1', envelope('alice', 2000));
    const row = [...fake.store.values()][0]!;
    expect(row['savedAt']).toBe(2000);
    expect(row['owner']).toBe('alice');
  });

  it('a full set() REPLACES the document — a stale field does not linger', async () => {
    const seed: FakeStore = new Map([
      [documentIdFor('s1'), { owner: 'alice', legacyField: 'from an older release' }],
    ]);
    const { sessions, fake } = storeWith({ seed });
    await sessions.persist('s1', envelope('alice'));
    expect([...fake.store.values()][0]).not.toHaveProperty('legacyField');
  });

  it('ownerOf cannot tell a missing session from an unowned one', async () => {
    const { sessions } = storeWith();
    await sessions.persist('anonymous', envelope());
    // Both `undefined`, deliberately: telling them apart would hand a caller an
    // oracle for which session ids are real.
    await expect(sessions.ownerOf('anonymous')).resolves.toBeUndefined();
    await expect(sessions.ownerOf('never-existed')).resolves.toBeUndefined();
  });
});

// ─── integration — the concurrency the transaction exists for ────────

describe('firestoreSessions — the write is a transaction, and that is why', () => {
  it('reads BEFORE it writes, in one transaction', async () => {
    const { sessions, fake } = storeWith();
    await sessions.persist('s1', envelope('alice'));

    const txCalls = fake.calls.filter(
      (c) => c.startsWith('Transaction.') || c.endsWith('Transaction'),
    );
    expect(txCalls).toEqual(['Firestore.runTransaction', 'Transaction.get', 'Transaction.set']);
  });

  const interleaveOwner = (owner: string) => ({
    interleave: (store: FakeStore) => {
      store.set(documentIdFor('s1'), {
        sessionId: 's1',
        owner,
        savedAt: 1,
        format: 'x',
        envelope: `{"who":"${owner}"}`,
        messageCount: 0,
      });
    },
  });

  it('another container committing an owner underneath us does not lose it', async () => {
    // The whole point. Our transaction reads "no owner", another turn commits
    // `alice`, and a store that just wrote its own answer would overwrite her.
    // Firestore aborts and re-runs the function; the second attempt sees alice
    // — and, since 9.36.1, ACTS on what it saw rather than only preserving the
    // column. Seeing it and refusing is a stricter proof of the same retry
    // than seeing it and keeping it was.
    const { sessions, fake } = storeWith(interleaveOwner('alice'));

    await expect(sessions.persist('s1', envelope('mallory'))).rejects.toBeInstanceOf(
      SessionOwnershipConflictError,
    );

    expect(fake.attempts()).toBe(2);
    await expect(sessions.ownerOf('s1')).resolves.toBe('alice');
    // The other container's document survived whole — an aborted transaction
    // writes nothing at all.
    expect([...fake.store.values()][0]?.['envelope']).toBe('{"who":"alice"}');
  });

  it('…and a concurrent turn from the SAME person still lands', async () => {
    // The case the retry actually protects in production: two containers
    // persisting turns of ONE person's conversation. The interleave still
    // aborts and re-runs, the second attempt sees the same owner, and the
    // write goes through — so the refusal above is about a DIFFERENT signer
    // and not about contention.
    const { sessions, fake } = storeWith(interleaveOwner('alice'));

    await sessions.persist('s1', envelope('alice'));

    expect(fake.attempts()).toBe(2);
    await expect(sessions.ownerOf('s1')).resolves.toBe('alice');
    expect(String([...fake.store.values()][0]?.['envelope'])).toContain('alice');
  });

  it('with no interference the write is ONE attempt — the retry is not the normal path', async () => {
    const { sessions, fake } = storeWith();
    await sessions.persist('s1', envelope('alice'));
    expect(fake.attempts()).toBe(1);
  });
});

// ─── integration — a real run, stored and resumed ────────────────────

describe('firestoreSessions — a paused run survives a new process', () => {
  it('stores a pause and resumes it through a store that never saw the first', async () => {
    const shared: FakeStore = new Map();
    const first = storeWith({ seed: shared });

    const approve = vi.fn();
    const ask = defineTool({
      name: 'ask',
      description: 'asks a person',
      parameters: { type: 'object', properties: {} },
      execute: () => {
        approve();
        return askHuman({ question: 'ok?' });
      },
    });
    const agent = Agent.create({
      // One tool call, then — after the person's answer is in the restored
      // history — content. Scripting a second tool call would be scripting a
      // model that ignored its own history.
      provider: mock({ replies: [{ toolCalls: [{ id: 't1', name: 'ask', args: {} }] }] }),
      model: 'test-model',
      maxIterations: 3,
    })
      .system('terse')
      .tool(ask)
      .build();

    const out = await agent.run({ message: 'go' });
    expect(isPaused(out)).toBe(true);
    if (!isPaused(out)) throw new Error('expected a pause');

    await first.sessions.persist(
      'p1',
      toPausedEnvelope({
        checkpoint: out.checkpoint,
        conversation: agent.checkpoint()!,
        pending: { pauseData: out.pauseData },
      }),
    );
    await first.sessions.close();

    // A NEW store, on the same documents — the whole claim of a fleet store.
    const second = firestoreSessions({ _sdk: fakeFirestore({ seed: shared }).sdk });
    const paused = readPausedRun(await second.hydrate('p1'));
    expect(paused).toBeDefined();

    // A FRESH agent, the way a new process would build one — it answers with
    // content, because the restored conversation already holds the tool call and
    // its now-decided result.
    const reborn = Agent.create({
      provider: mock({ replies: [{ content: 'done' }] }),
      model: 'test-model',
      maxIterations: 3,
    })
      .system('terse')
      .tool(ask)
      .build();

    const resumed = await reborn.resume(paused!.checkpoint, { approved: true });
    expect(isPaused(resumed)).toBe(false);
    // The tool that ran before the pause did not run a second time.
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it('drives a standing agent end to end, the same as any other store', async () => {
    const fake = fakeFirestore();
    const sessions = firestoreSessions({ _sdk: fake.sdk });
    const host = inProcessHost();
    const handle = await standingAgent({
      agentFactory: () =>
        Agent.create({
          provider: mock({ replies: [{ content: 'hi' }, { content: 'again' }] }),
          model: 'test-model',
        })
          .system('terse')
          .build(),
      host,
      sessions,
    });
    try {
      const first = await host.deliver({ input: 'one', sessionId: 'c1', userId: 'alice' });
      expect(first.error).toBeUndefined();
      await host.deliver({ input: 'two', sessionId: 'c1', userId: 'alice' });

      // Two turns, ONE document — and the second turn read the first back,
      // which is the only thing a session store is for.
      expect(fake.store.size).toBe(1);
      const stored = await sessions.hydrate('c1');
      expect(stored).toBeDefined();
    } finally {
      await handle.close();
      await sessions.close();
    }
  });
});

// ─── unit + property — listByUser is indexed, cursored, server-side ──

describe('firestoreSessions — listByUser', () => {
  /** Seed n conversations for one owner, newest last. */
  async function seedOwned(sessions: ReturnType<typeof firestoreSessions>, n: number) {
    for (let i = 0; i < n; i++) {
      await sessions.persist(`s${i}`, envelope('alice', 1000 + i));
    }
  }

  it('asks the SERVER for the filter, the order and the page — not the client', async () => {
    const { sessions, fake } = storeWith();
    await seedOwned(sessions, 3);
    fake.calls.length = 0;
    await sessions.listByUser('alice', { limit: 2 });

    // where → orderBy(savedAt) → orderBy(__name__) → limit → get. No `startAfter`
    // on a first page, and crucially no read of anything the query did not
    // select: a client-side sort would show up here as a bare `Query.get` with
    // no ordering in front of it.
    expect(fake.calls.filter((c) => c.startsWith('Query.'))).toEqual([
      'Query.where',
      'Query.orderBy',
      'Query.orderBy',
      'Query.limit',
      'Query.get',
    ]);
  });

  it('asks for limit + 1, so "another page?" is a fact rather than a guess', async () => {
    const fake = fakeFirestore();
    const sessions = firestoreSessions({ _sdk: fake.sdk });
    await seedOwned(sessions, 5);

    // Exactly the page size available ⇒ no cursor, because the probe row came
    // back empty. A store that asked for `limit` alone would have to guess.
    const exact = await sessions.listByUser('alice', { limit: 5 });
    expect(exact.sessions).toHaveLength(5);
    expect(exact.cursor).toBeUndefined();
  });

  it('pages with a real cursor, newest first, with no row skipped or repeated', async () => {
    const { sessions } = storeWith();
    await seedOwned(sessions, 7);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result: { sessions: readonly { sessionId: string }[]; cursor?: string } =
        await sessions.listByUser('alice', { limit: 3, cursor });
      seen.push(...result.sessions.map((s) => s.sessionId));
      cursor = result.cursor;
      if (cursor === undefined) break;
    }

    // Newest first, every conversation exactly once.
    expect(seen).toEqual(['s6', 's5', 's4', 's3', 's2', 's1', 's0']);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('the cursor is a real Firestore cursor — startAfter, never an offset', async () => {
    const { sessions, fake } = storeWith();
    await seedOwned(sessions, 4);
    const first = await sessions.listByUser('alice', { limit: 2 });
    fake.calls.length = 0;
    await sessions.listByUser('alice', { limit: 2, cursor: first.cursor });

    expect(fake.calls).toContain('Query.startAfter');
    // The cursor carries the ordered fields' values: savedAt, then the document
    // NAME (the hash) — not a row number, which is the shape that skips rows
    // when an older conversation is written to between two pages.
    const [savedAt, docId] = first.cursor!.split(':');
    expect(Number(savedAt)).toBe(1002);
    expect(docId).toBe(documentIdFor('s2'));
  });

  it('a cursor this store did not mint restarts at the top rather than throwing', async () => {
    const { sessions } = storeWith();
    await seedOwned(sessions, 3);
    for (const junk of ['', 'nonsense', ':abc', 'abc:', 'NaN:x']) {
      const page = await sessions.listByUser('alice', { cursor: junk });
      expect(page.sessions.length, junk).toBe(3);
    }
  });

  it('a cursor whose NAME half this store never mints stops before the SDK', async () => {
    // Both halves are shape-checked, not just the `savedAt`. A document-name
    // half this store did not mint is caller-supplied material on its way into a
    // builder that throws synchronously — `sqliteSessions` ids, for one, may
    // legitimately be path-shaped, and the client rejects a slash outright.
    const { sessions, fake } = storeWith();
    await seedOwned(sessions, 3);
    const foreign = [
      '1000:tenant/a/session:1', // a path-shaped id from another store
      `1000:${'Z'.repeat(64)}`, // right length, not hex
      `1000:${'A'.repeat(64)}`, // hex, but this store mints lowercase
      '1000:sess_01HQ', // a plausible id that is not a sha-256
      `1000:${'a'.repeat(63)}`, // one short
      `1000:${'a'.repeat(65)}`, // one long
    ];
    for (const cursor of foreign) {
      fake.calls.length = 0;
      const page = await sessions.listByUser('alice', { cursor });
      expect(page.sessions.length, cursor).toBe(3);
      // Never handed to the client at all — which is what makes "restarts at the
      // top" a promise the store keeps rather than one the SDK gets to break.
      expect(fake.calls, cursor).not.toContain('Query.startAfter');
    }
  });

  it('a builder refusal is sanitised exactly like a failed get()', async () => {
    // `startAfter` is the one SDK call in `listByUser` that is not `get()`, and
    // it throws SYNCHRONOUSLY. It lives inside the same `try`, so an SDK message
    // cannot escape through it — every call in the method is sanitised or none
    // of the sanitising means anything.
    const fake = fakeFirestore({
      failStartAfterWith: grpcError(3, 'must be a plain document ID: alice/conversation-7'),
    });
    const sessions = firestoreSessions({ _sdk: fake.sdk });
    await sessions.persist('s1', envelope('alice'));

    const err = (await sessions
      .listByUser('alice', { cursor: `1000:${documentIdFor('s1')}` })
      .catch((e: unknown) => e)) as Error;

    expect(fake.calls).toContain('Query.startAfter');
    expect(err.name).toBe('FirestoreApiError');
    expect(err.message).toContain('listing a user');
    expect(err.message).toContain('INVALID_ARGUMENT');
    expect(err.message).not.toContain('plain document ID');
    expect(err.message).not.toContain('conversation-7');
  });

  it('the double models `id` as a PROPERTY on both shapes, never a method', async () => {
    // `readonly id: string` on DocumentSnapshot (firestore.d.ts 1617) and on
    // DocumentReference (1442). The cursor reads the SNAPSHOT one, off a
    // QueryDocumentSnapshot that inherits it (1667). An `id()` method would be
    // the same lie shape as an `exists()` method.
    //
    // The cursor tests above already fail on that mutation — checked, not
    // assumed. This one earns its place by naming the shape instead of catching
    // a symptom, and by covering `DocumentReference.id`, which no cursor reads.
    const fake = fakeFirestore();
    const client = new fake.sdk.Firestore();
    const ref = client.collection('c').doc('d');
    expect(typeof ref.id).toBe('string');
    const snapshot = await ref.get();
    expect(typeof snapshot.id).toBe('string');
    expect(snapshot.id).toBe('d');
  });

  it('the cursor carries the last document‘s STORED savedAt, not the listing summary', async () => {
    const { sessions, fake } = storeWith();
    await seedOwned(sessions, 4);
    const page = await sessions.listByUser('alice', { limit: 2 });

    const [savedAt, docId] = page.cursor!.split(':');
    // Read straight out of the store, so this cannot pass by happening to agree
    // with a summary the listing computed for display.
    expect(fake.store.get(docId!)).toBeDefined();
    expect(Number(savedAt)).toBe(fake.store.get(docId!)!['savedAt']);
  });

  it('a last row with no numeric savedAt yields NO cursor rather than `0:`', async () => {
    // `0` is the SUMMARY's fallback — a display hint that must never throw. As
    // an ORDERING key it is a lie: `startAfter(0, …)` on a descending listing
    // positions past the end, so the caller is told there is another page and
    // then handed an empty one. No cursor ends the listing too, but honestly.
    const foreign: FakeStore = new Map([
      ['a'.repeat(64), { owner: 'alice', savedAt: 3000, sessionId: 'x' }],
      ['b'.repeat(64), { owner: 'alice', savedAt: '2500', sessionId: 'y' }],
      ['c'.repeat(64), { owner: 'alice', savedAt: 2000, sessionId: 'z' }],
    ]);
    const { sessions } = storeWith({ seed: foreign });
    const page = await sessions.listByUser('alice', { limit: 2 });

    expect(page.sessions.map((s) => s.sessionId)).toEqual(['x', 'y']);
    // The summary says 0 for that row, and always will — that is its job.
    expect(page.sessions[1]!.savedAt).toBe(0);
    expect(page.cursor).toBeUndefined();

    // The control: the same page boundary with a NUMBER there does mint one, so
    // the absence above is caused by the field and not by the seeding.
    const numeric: FakeStore = new Map([
      ['a'.repeat(64), { owner: 'alice', savedAt: 3000, sessionId: 'x' }],
      ['b'.repeat(64), { owner: 'alice', savedAt: 2500, sessionId: 'y' }],
      ['c'.repeat(64), { owner: 'alice', savedAt: 2000, sessionId: 'z' }],
    ]);
    const control = storeWith({ seed: numeric });
    const controlPage = await control.sessions.listByUser('alice', { limit: 2 });
    expect(controlPage.cursor).toBe(`2500:${'b'.repeat(64)}`);
  });

  it('a conversation nobody signed for appears in nobody‘s list', async () => {
    const { sessions } = storeWith();
    await sessions.persist('anon', envelope());
    await sessions.persist('owned', envelope('alice'));
    const page = await sessions.listByUser('alice');
    expect(page.sessions.map((s) => s.sessionId)).toEqual(['owned']);
  });

  it('a row written by something that is not this store lists honestly, never as a hash', async () => {
    // `sessionId: ''` says "this row does not say". Substituting the document
    // name would hand a caller an id that opens nothing.
    const seed: FakeStore = new Map([['some-other-doc', { owner: 'alice', savedAt: 5 }]]);
    const { sessions } = storeWith({ seed });
    const page = await sessions.listByUser('alice');
    expect(page.sessions).toEqual([
      { sessionId: '', savedAt: 5, format: 'unknown', messageCount: 0 },
    ]);
  });

  it('a missing composite index is refused by NAME, with the index in the message', async () => {
    const fake = fakeFirestore({ failQueryWith: grpcError(FAILED_PRECONDITION, 'needs an index') });
    const sessions = firestoreSessions({ _sdk: fake.sdk, collection: 'chat_sessions' });

    const err = await sessions.listByUser('alice').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FirestoreIndexMissingError);
    const message = (err as Error).message;
    expect(message).toContain('chat_sessions');
    expect(message).toContain('owner Ascending');
    expect(message).toContain('savedAt Descending');
    expect(message).toContain('gcloud firestore indexes composite create');
  });

  it('the index refusal names the DATABASE, and prints --database in the command', async () => {
    // The teaching failure this guards: an operator on a named database follows
    // a `gcloud` line with no `--database`, gcloud assumes `(default)`, the index
    // lands somewhere else and the listing keeps failing with this same error.
    const named = fakeFirestore({ failQueryWith: grpcError(FAILED_PRECONDITION) });
    const onNamed = firestoreSessions({ _sdk: named.sdk, database: 'chat-db' });
    const err = (await onNamed
      .listByUser('alice')
      .catch((e: unknown) => e)) as FirestoreIndexMissingError;

    expect(err).toBeInstanceOf(FirestoreIndexMissingError);
    expect(err.database).toBe('chat-db');
    expect(err.message).toContain("in database 'chat-db'");
    expect(err.message).toContain("--database='chat-db'");
  });

  it('on the default database the flag is still printed, spelled (default)', async () => {
    // gcloud would have assumed it — printing it anyway costs nothing and makes
    // the command self-describing on the day somebody adds a second database.
    const fake = fakeFirestore({ failQueryWith: grpcError(FAILED_PRECONDITION) });
    const sessions = firestoreSessions({ _sdk: fake.sdk });
    const err = (await sessions
      .listByUser('alice')
      .catch((e: unknown) => e)) as FirestoreIndexMissingError;

    expect(err.database).toBe('(default)');
    expect(err.message).toContain("--database='(default)'");
  });

  it('with a caller-built client the database is NOT guessed — the flag says so', async () => {
    // This store did not construct the client, so it cannot read the database
    // back off it. Printing `(default)` here would be the same wrong-fix bug one
    // layer in, so the message prints a placeholder nobody can paste blind.
    const fake = fakeFirestore({ failQueryWith: grpcError(FAILED_PRECONDITION) });
    const client = new fake.sdk.Firestore();
    const sessions = firestoreSessions({ firestore: client, _sdk: fake.sdk });
    const err = (await sessions
      .listByUser('alice')
      .catch((e: unknown) => e)) as FirestoreIndexMissingError;

    expect(err.database).toBeUndefined();
    expect(err.message).toContain(
      "--database='<the database your Firestore client was built for>'",
    );
    expect(err.message).toContain('did not build the Firestore client');
    expect(err.message).not.toContain('(default)');
  });
});

// ─── security — what is refused, and what never leaves ───────────────

describe('firestoreSessions — unreadable is never answered with a fresh start', () => {
  it('a document whose payload is not text is refused BY NAME', async () => {
    const seed: FakeStore = new Map([[documentIdFor('s1'), { envelope: { not: 'a string' } }]]);
    const { sessions } = storeWith({ seed });
    await expect(sessions.hydrate('s1')).rejects.toBeInstanceOf(UnreadableEnvelopeError);
  });

  it('a document whose payload is not JSON is refused BY NAME', async () => {
    const seed: FakeStore = new Map([[documentIdFor('s1'), { envelope: 'not json{' }]]);
    const { sessions } = storeWith({ seed });
    await expect(sessions.hydrate('s1')).rejects.toBeInstanceOf(UnreadableEnvelopeError);
  });

  it('an envelope whose format this runtime does not know is refused on the way OUT', async () => {
    const seed: FakeStore = new Map([
      [
        documentIdFor('s1'),
        { envelope: JSON.stringify({ format: 'from-the-future-v9', data: {} }) },
      ],
    ]);
    const { sessions } = storeWith({ seed });
    await expect(sessions.hydrate('s1')).rejects.toThrow();
  });

  it('and on the way IN — a row this store could not read back is never written', async () => {
    const { sessions, fake } = storeWith();
    await expect(
      sessions.persist('s1', { format: 'from-the-future-v9', data: {} } as never),
    ).rejects.toThrow();
    expect(fake.store.size).toBe(0);
  });

  it('a conversation too large for one document is refused before the write, never truncated', async () => {
    const { sessions, fake } = storeWith();
    const huge = toEnvelope(
      checkpoint({
        history: [{ role: 'user', content: 'x'.repeat(FIRESTORE_MAX_ENVELOPE_BYTES) }],
      } as unknown as Partial<AgentRunCheckpoint>),
    );

    const err = await sessions.persist('s1', huge).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EnvelopeTooLargeError);
    expect((err as Error).message).toMatch(/nothing was truncated/i);
    // Nothing was sent.
    expect(fake.store.size).toBe(0);
    expect(fake.calls).not.toContain('Firestore.runTransaction');
  });

  it('a failure names the operation, collection and gRPC status — and no SDK text', async () => {
    const secret = 'private_key=-----BEGIN PRIVATE KEY----- and user_id=alice';
    const fake = fakeFirestore({ failReadWith: grpcError(7, secret) });
    const sessions = firestoreSessions({ _sdk: fake.sdk, collection: 'chat_sessions' });

    const err = (await sessions.hydrate('s1').catch((e: unknown) => e)) as Error;
    expect(err.name).toBe('FirestoreApiError');
    expect(err.message).toContain('chat_sessions');
    expect(err.message).toContain('PERMISSION_DENIED');
    expect(err.message).not.toContain(secret);
    expect(err.message).not.toContain('PRIVATE KEY');
    // The original is not attached as `cause`, which would carry it into every
    // serializer that walks own properties.
    expect(JSON.stringify(err)).not.toContain('PRIVATE KEY');
    expect((err as { cause?: unknown }).cause).toBeUndefined();
  });

  it('a gRPC code is read as a gRPC status, never as an HTTP one', () => {
    // The trap that made this file carry its own sanitizer: the Vertex column
    // reads `code` as HTTP, so a Firestore NOT_FOUND would arrive as "HTTP 5".
    expect(grpcStatusOf(grpcError(5))).toBe('NOT_FOUND');
    expect(grpcStatusOf(grpcError(9))).toBe('FAILED_PRECONDITION');
    expect(grpcStatusOf({ status: 'UNAUTHENTICATED' })).toBe('UNAUTHENTICATED');
    expect(grpcStatusOf({ code: 404 })).toBeUndefined();
    expect(grpcStatusOf(undefined)).toBeUndefined();
  });

  it('a failure with no recognisable status still refuses, without inventing one', () => {
    const err = firestoreFailure('reading a session', 'c', new Error('boom'));
    expect(err.message).toContain('reading a session');
    expect(err.message).not.toContain('boom');
    expect(err.message).not.toMatch(/\(undefined\)/);
  });
});

// ─── property — the document name, over every id anybody has ─────────

describe('firestoreSessions — the document name is legal, stable and injective', () => {
  const CORPUS = [
    's1',
    'tenant/a/session:1',
    '4f3c9a2e-1111-2222-3333-444455556666',
    '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    'user@example.com',
    'ünïcödé — 会話',
    '.',
    '..',
    '__proto__',
    '__name__',
    '',
    '/'.repeat(20),
    'x'.repeat(2000),
    '\n\t ',
  ];

  it('every id maps to a name Firestore will accept', () => {
    for (const raw of CORPUS) {
      const id = documentIdFor(raw);
      expect(id, raw).toMatch(/^[0-9a-f]{64}$/);
      // The four rules a document name has to satisfy, checked rather than
      // argued: no slash, not `.` or `..`, not `__…__`, under 1500 bytes.
      expect(id).not.toContain('/');
      expect(id === '.' || id === '..').toBe(false);
      expect(/^__.*__$/.test(id)).toBe(false);
      expect(Buffer.byteLength(id, 'utf8')).toBeLessThan(1500);
    }
  });

  it('the same id always maps to the same name — these are long-lived addresses', () => {
    for (const raw of CORPUS) expect(documentIdFor(raw)).toBe(documentIdFor(raw));
  });

  it('no two different ids share a name, including ids that differ only past 1500 bytes', () => {
    const pairs: readonly [string, string][] = [
      ['a', 'b'],
      ['x'.repeat(2000) + 'a', 'x'.repeat(2000) + 'b'],
      ['ab', 'a b'],
      ['Alice', 'alice'],
      ['s1', 's1 '],
    ];
    for (const [left, right] of pairs) {
      expect(documentIdFor(left), `${left} vs ${right}`).not.toBe(documentIdFor(right));
    }
    expect(new Set(CORPUS.map(documentIdFor)).size).toBe(CORPUS.length);
  });

  it('the domain separator means a prefix cannot be shifted into the id', () => {
    // `domain + "a" + "bc"` and `domain + "ab" + "c"` must not collide. With a
    // NUL between them they cannot, because a NUL is the one byte the domain
    // does not contain.
    expect(documentIdFor('a\u0000bc')).not.toBe(documentIdFor('ab\u0000c'));
  });

  it('a stored id round-trips: listed, then hydrated', async () => {
    const { sessions } = storeWith();
    for (const raw of ['tenant/a/session:1', 'ünïcödé — 会話', 'x'.repeat(2000)]) {
      await sessions.persist(raw, envelope('alice'));
    }
    const page = await sessions.listByUser('alice');
    for (const row of page.sessions) {
      await expect(sessions.hydrate(row.sessionId)).resolves.toBeDefined();
    }
  });

  it('the store‘s own documentIdFor is the module function — one mapping, not two', () => {
    const { sessions } = storeWith();
    expect(sessions.documentIdFor('s1')).toBe(documentIdFor('s1'));
  });
});

// ─── performance — one page is one query, whatever the store holds ───

describe('firestoreSessions — a listing does not grow with the collection', () => {
  it('reads ONE page whether the owner has 5 conversations or 200', async () => {
    // The defect this adapter exists not to reproduce: a field-validated
    // Firestore adapter read every document for one owner, sorted in the client
    // and applied an offset. That cost grows with the person's history. This
    // asserts the shape rather than a duration — a call count is the honest
    // measurement here, and it does not flake on a busy runner.
    const small = storeWith();
    for (let i = 0; i < 5; i++) await small.sessions.persist(`s${i}`, envelope('alice', 1000 + i));
    small.fake.calls.length = 0;
    await small.sessions.listByUser('alice', { limit: 10 });
    const smallQueries = small.fake.calls.filter((c) => c === 'Query.get').length;

    const large = storeWith();
    for (let i = 0; i < 200; i++)
      await large.sessions.persist(`s${i}`, envelope('alice', 1000 + i));
    large.fake.calls.length = 0;
    const page = await large.sessions.listByUser('alice', { limit: 10 });
    const largeQueries = large.fake.calls.filter((c) => c === 'Query.get').length;

    expect(smallQueries).toBe(1);
    expect(largeQueries).toBe(1);
    // And it did not READ two hundred documents to show ten.
    expect(page.sessions).toHaveLength(10);
    expect(large.fake.calls.filter((c) => c === 'DocumentReference.get')).toHaveLength(0);
  });

  it('a turn costs ONE transaction and no extra read', async () => {
    const { sessions, fake } = storeWith();
    await sessions.persist('s1', envelope('alice'));
    fake.calls.length = 0;
    await sessions.persist('s1', envelope('alice'));

    expect(fake.calls.filter((c) => c === 'Firestore.runTransaction')).toHaveLength(1);
    // The owner is read INSIDE the transaction, not by a separate get before it.
    expect(fake.calls.filter((c) => c === 'DocumentReference.get')).toHaveLength(0);
  });
});

// ─── the refusal, with no package installed ──────────────────────────

describe('firestoreSessions — when @google-cloud/firestore is not installed', () => {
  it('refuses by name with the install line, and never falls back to memory', async () => {
    vi.resetModules();
    vi.doMock('../../src/lib/lazyRequire.js', () => ({
      lazyRequire: () => {
        throw new Error("Cannot find module '@google-cloud/firestore'");
      },
    }));
    try {
      const { firestoreSessions: isolated } = await import(
        '../../src/adapters/hosting/firestoreSessions.js'
      );
      expect(() => isolated()).toThrow(/npm install @google-cloud\/firestore/);
      // A store that silently forgot everything is indistinguishable, from the
      // outside, from a brand-new user.
      expect(() => isolated()).toThrow(/OPTIONAL peer dependency/);
    } finally {
      vi.doUnmock('../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  });

  it('refuses a package that resolves but is missing what this adapter calls', async () => {
    vi.resetModules();
    vi.doMock('../../src/lib/lazyRequire.js', () => ({
      lazyRequire: () => ({ Firestore: function Fake() {} }),
    }));
    try {
      const { firestoreSessions: isolated } = await import(
        '../../src/adapters/hosting/firestoreSessions.js'
      );
      expect(() => isolated()).toThrow(/FieldPath\.documentId/);
    } finally {
      vi.doUnmock('../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  });

  it('importing the hosting door does NOT load the package', async () => {
    // Zero cost when unused, and it has to be a fact rather than an intention:
    // `lazyRequire` hides the specifier from bundlers, and a stray top-level
    // import anywhere on this path would undo that for every consumer.
    vi.resetModules();
    const loaded: string[] = [];
    vi.doMock('../../src/lib/lazyRequire.js', () => ({
      lazyRequire: (specifier: string) => {
        loaded.push(specifier);
        throw new Error('not loaded in this test');
      },
    }));
    try {
      await import('../../src/doors/hosting.js');
      expect(loaded).not.toContain('@google-cloud/firestore');
    } finally {
      vi.doUnmock('../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  });
});

// ─── ROI — the store is swappable, which is the point of the port ────

describe('firestoreSessions — the same port, so the store is one argument', () => {
  it('answers the port the same way memorySessions does', async () => {
    const stores = [memorySessions(), storeWith().sessions];
    for (const store of stores) {
      await expect(store.hydrate('nope')).resolves.toBeUndefined();
      await store.persist('s1', envelope('alice'));
      expect((await store.hydrate('s1'))?.format).toBe(envelope('alice').format);
      await expect(store.ownerOf!('s1')).resolves.toBe('alice');
      const page = await store.listByUser!('alice');
      expect(page.sessions.map((s) => s.sessionId)).toEqual(['s1']);
      await expect(store.ownerOf!('nope')).resolves.toBeUndefined();
    }
  });
});
