/**
 * memoryBankStore — the two named traps, and the isolation law.
 *
 * This adapter exists in a place where three different silent-wrongness modes
 * meet, and the tests are organised around them rather than around methods:
 *
 *   1. **The ranking inversion.** The service reports a DISTANCE (smaller is
 *      closer) and the port carries a cosine SCORE (higher is closer). Passed
 *      through, retrieval returns the least relevant memories first with a
 *      confident number in the right range.
 *   2. **The scope convention.** Scope matching is exact and scope is
 *      immutable, so a `get` by resource name would read another tenant's row
 *      unless the scope is re-checked on the way back.
 *   3. **The operations that have no primitive.** Emulating them in-process on
 *      a store whose whole point is being shared across a fleet is worse than
 *      refusing them.
 *   4. **The address.** Entry ids in this library are deliberately identity-free
 *      (`msg-<turn>-<index>`, `fact:<key>`, `snap-<turn>`), so an address built
 *      from the entry id alone is ONE row for every tenant that writes it. That
 *      one is tested against a faithful service double rather than a call
 *      recorder — see `fakeBank` — because the bug it guards is not "which call
 *      did we make" but "what does the bank end up holding".
 *
 * Nothing here reaches Google or needs a credential.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  MAX_PAGE_SIZE,
  memoryBankStore,
  scoreFromDistance,
} from '../../../src/adapters/memory/memoryBank.js';
import type { MemoryEntry } from '../../../src/memory/entry/index.js';
import type { MemoryIdentity } from '../../../src/memory/identity/index.js';

// ── Fixtures ────────────────────────────────────────────────────────

const CONNECTION = { project: 'p', location: 'us-central1', reasoningEngine: 'engine-1' } as const;
const PARENT = 'projects/p/locations/us-central1/reasoningEngines/engine-1';
const IDENTITY: MemoryIdentity = { tenant: 't1', principal: 'alice', conversationId: 'c1' };

function entry(id: string, value: unknown, extra: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id,
    value,
    version: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    lastAccessedAt: 1_700_000_000_000,
    accessCount: 0,
    ...extra,
  } as MemoryEntry;
}

/** A `Memory` as the service would hand one back, carrying our metadata. */
function memory(id: string, fact: string, scope: Record<string, string>, json = false) {
  return {
    name: `${PARENT}/memories/${id}`,
    fact,
    scope,
    metadata: {
      agentfootprint_id: { stringValue: id },
      agentfootprint_version: { doubleValue: 1 },
      agentfootprint_created_at: { doubleValue: 1_700_000_000_000 },
      agentfootprint_updated_at: { doubleValue: 1_700_000_000_000 },
      agentfootprint_json: { boolValue: json },
    },
  };
}

const FULL_SCOPE = { tenant: 't1', principal: 'alice', conversation: 'c1' };

interface Call {
  readonly op: string;
  readonly params: Record<string, unknown>;
}

function fakeVertex(handlers: Record<string, (p: Record<string, unknown>) => unknown> = {}) {
  const calls: Call[] = [];
  const method =
    (op: string, fallback: unknown) =>
    (params: Record<string, unknown>): Promise<unknown> => {
      calls.push({ op, params });
      const handler = handlers[op];
      return Promise.resolve(handler ? handler(params) : fallback);
    };
  const client = {
    projects: {
      locations: {
        reasoningEngines: {
          sessions: {} as never,
          memories: {
            create: method('create', { data: { done: true } }),
            get: method('get', undefined),
            patch: method('patch', { data: { done: true } }),
            delete: method('delete', { data: { done: true } }),
            list: method('list', { data: {} }),
            retrieve: method('retrieve', { data: { retrievedMemories: [] } }),
            operations: { wait: method('wait', { data: { done: true } }) },
          },
        },
      },
    },
  };
  return { client: client as never, calls, ops: () => calls.map((c) => c.op) };
}

const store = (
  handlers?: Record<string, (p: Record<string, unknown>) => unknown>,
  options: Record<string, unknown> = {},
) => {
  const fake = fakeVertex(handlers);
  return { fake, store: memoryBankStore({ ...CONNECTION, ...options, _client: fake.client }) };
};

/** A row as the service holds one. */
interface Row {
  name: string;
  fact?: string;
  scope: Record<string, string>;
  metadata?: Record<string, unknown>;
}

/**
 * A faithful-enough Memory Bank: rows in a map keyed by resource NAME, created
 * under a caller-supplied `memoryId`, **patched by name with no question about
 * whose row it is**, and retrieved by exact scope match.
 *
 * That one italicised behaviour is the service's, not a simplification — it is
 * why an adapter that addresses two identities' memories to one name silently
 * merges them, and why the addressing law is tested against a double that holds
 * state rather than against a recorder that lists calls.
 */
function fakeBank() {
  const rows = new Map<string, Row>();
  const memories = {
    create: ({ parent, memoryId, requestBody }: Record<string, never>) => {
      const name = `${String(parent)}/memories/${String(memoryId)}`;
      if (rows.has(name)) throw { code: 409 };
      rows.set(name, { ...(requestBody as unknown as Row), name });
      return Promise.resolve({ data: { done: true } });
    },
    get: ({ name }: Record<string, never>) => {
      const row = rows.get(String(name));
      if (row === undefined) throw { code: 404 };
      return Promise.resolve({ data: row });
    },
    patch: ({ name, requestBody }: Record<string, never>) => {
      const row = rows.get(String(name));
      if (row === undefined) throw { code: 404 };
      // The service writes what it was told, to the row it was named. It never
      // checks the caller's scope against the row's — that is our job.
      rows.set(String(name), { ...row, ...(requestBody as unknown as Row) });
      return Promise.resolve({ data: { done: true } });
    },
    delete: ({ name }: Record<string, never>) => {
      if (!rows.delete(String(name))) throw { code: 404 };
      return Promise.resolve({ data: { done: true } });
    },
    list: () => Promise.resolve({ data: {} }),
    retrieve: ({ requestBody }: Record<string, never>) => {
      const wanted = (requestBody as unknown as { scope: Record<string, string> }).scope;
      const hits = [...rows.values()].filter((row) => exactScope(row.scope, wanted));
      return Promise.resolve({ data: { retrievedMemories: hits.map((memory) => ({ memory })) } });
    },
    operations: { wait: () => Promise.resolve({ data: { done: true } }) },
  };
  const client = { projects: { locations: { reasoningEngines: { sessions: {}, memories } } } };
  return {
    client: client as never,
    rows,
    names: () => [...rows.keys()],
    /** The one row there is, when a test means to assert on exactly one. */
    only: (): Row => {
      if (rows.size !== 1) throw new Error(`expected one row, found ${rows.size}`);
      return [...rows.values()][0]!;
    },
  };
}

/** Scope matching as the service does it: same keys, same values, no subsets. */
function exactScope(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

const bankStore = (options: Record<string, unknown> = {}) => {
  const bank = fakeBank();
  return { bank, store: memoryBankStore({ ...CONNECTION, ...options, _client: bank.client }) };
};

// ── 1. THE RANKING INVERSION ────────────────────────────────────────

describe('the distance/similarity inversion is converted, never forwarded', () => {
  it('scoreFromDistance is strictly decreasing — closer really does score higher', () => {
    expect(scoreFromDistance(0)).toBe(1);
    expect(scoreFromDistance(0.1)).toBeGreaterThan(scoreFromDistance(0.5));
    expect(scoreFromDistance(0.5)).toBeGreaterThan(scoreFromDistance(10));
    expect(scoreFromDistance(10)).toBeGreaterThan(0);
  });

  it('an unranked row (simple retrieval reports no distance) scores 0 and sorts last', () => {
    expect(scoreFromDistance(undefined)).toBe(0);
    expect(scoreFromDistance(null)).toBe(0);
    expect(scoreFromDistance(Number.NaN)).toBe(0);
  });

  it('search returns the CLOSEST memory first — the whole point of the conversion', async () => {
    const { store: s } = store({
      retrieve: () => ({
        data: {
          retrievedMemories: [
            // Deliberately handed back worst-first, to prove the adapter is not
            // simply trusting the service's order.
            { distance: 0.9, memory: memory('far', 'a distant fact', FULL_SCOPE) },
            { distance: 0.1, memory: memory('near', 'the relevant fact', FULL_SCOPE) },
          ],
        },
      }),
    });
    const hits = await s.search(IDENTITY, [], { text: 'what?' });
    expect(hits.map((h) => h.entry.id)).toEqual(['near', 'far']);
    // And the number really is higher for the nearer one — a raw distance
    // would have been the other way round.
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it('the RAW distance is carried through unmodified, so nothing is hidden', async () => {
    const { store: s } = store({
      retrieve: () => ({
        data: { retrievedMemories: [{ distance: 0.42, memory: memory('m', 'f', FULL_SCOPE) }] },
      }),
    });
    const hits = await s.search(IDENTITY, [], { text: 'q' });
    expect(hits[0]!.entry.metadata?.['distance']).toBe(0.42);
    expect(hits[0]!.score).not.toBe(0.42);
  });

  it('minScore is REFUSED by name rather than measured against a scale it was not calibrated for', async () => {
    const { store: s, fake } = store();
    await expect(s.search(IDENTITY, [], { text: 'q', minScore: 0.8 })).rejects.toThrow(
      /DISTANCE .*not a cosine|does not accept `minScore`/s,
    );
    // And it refuses BEFORE spending a call.
    expect(fake.ops()).toEqual([]);
  });

  it('search without text refuses by name instead of ranking nothing', async () => {
    const { store: s, fake } = store();
    await expect(s.search(IDENTITY, [0.1, 0.2])).rejects.toThrow(/options\.text/);
    expect(fake.ops()).toEqual([]);
  });

  it('declares both capability bits, so corpus builders and retrievers can branch', () => {
    const { store: s } = store();
    expect(s.supportsVectorSearch).toBe(false);
    expect(s.ranksBy).toBe('server-text');
  });

  it('search sends similaritySearchParams; list sends simpleRetrievalParams', async () => {
    const { store: s, fake } = store();
    await s.search(IDENTITY, [], { text: 'q', k: 5 });
    await s.list(IDENTITY, { limit: 7 });
    const [search, list] = fake.calls;
    expect(
      (search!.params['requestBody'] as Record<string, unknown>)['similaritySearchParams'],
    ).toEqual({ searchQuery: 'q', topK: 5 });
    expect(
      (list!.params['requestBody'] as Record<string, unknown>)['simpleRetrievalParams'],
    ).toEqual({ pageSize: 7 });
  });

  it('a k above the service ceiling is clamped here rather than silently coerced there', async () => {
    const { store: s, fake } = store();
    await s.search(IDENTITY, [], { text: 'q', k: 500 });
    const body = fake.calls[0]!.params['requestBody'] as Record<string, Record<string, number>>;
    expect(body['similaritySearchParams']!['topK']).toBe(MAX_PAGE_SIZE);
  });
});

// ── 2. THE SCOPE CONVENTION ─────────────────────────────────────────

describe('scope: exact, immutable, and re-checked on the way back', () => {
  it('the default is the full identity tuple, matching every other store', async () => {
    const { store: s, fake } = store();
    await s.list(IDENTITY);
    expect((fake.calls[0]!.params['requestBody'] as Record<string, unknown>)['scope']).toEqual(
      FULL_SCOPE,
    );
  });

  it('scopeFor widens it — the shape a per-person memory bank actually needs', async () => {
    const { store: s, fake } = store(undefined, {
      scopeFor: (id: MemoryIdentity) => ({
        tenant: id.tenant ?? '_',
        principal: id.principal ?? '_',
      }),
    });
    await s.list(IDENTITY);
    expect((fake.calls[0]!.params['requestBody'] as Record<string, unknown>)['scope']).toEqual({
      tenant: 't1',
      principal: 'alice',
    });
  });

  it('an empty scope is refused — it is not "no scoping", it matches everyone else’s', async () => {
    const { store: s } = store(undefined, { scopeFor: () => ({}) });
    await expect(s.list(IDENTITY)).rejects.toThrow(/empty scope/);
  });

  it('a wildcard in a scope value becomes a NAME, since the service rejects one', async () => {
    const { store: s, fake } = store(undefined, { scopeFor: () => ({ tenant: 'a*b' }) });
    await s.list(IDENTITY);
    expect((fake.calls[0]!.params['requestBody'] as Record<string, unknown>)['scope']).toEqual({
      tenant: 'a_b',
    });
  });

  it('get() re-checks the scope, so a guessed id cannot read another tenant’s memory', async () => {
    const { store: s } = store({
      // The service happily answers a get by resource name, whoever asked.
      get: () => ({ data: memory('m1', 'someone else’s secret', { tenant: 'OTHER' }) }),
    });
    // The same `null` a missing memory answers: "exists but not yours" is an
    // oracle for which ids are real.
    await expect(s.get(IDENTITY, 'm1')).resolves.toBeNull();
  });

  it('get() returns the entry when the scope really does match', async () => {
    const { store: s } = store({
      get: () => ({ data: memory('m1', 'her flight is at 6', FULL_SCOPE) }),
    });
    const found = await s.get(IDENTITY, 'm1');
    expect(found).toMatchObject({ id: 'm1', value: 'her flight is at 6', version: 1 });
  });

  it('delete() is scope-checked too — the same guessed id must not remove somebody’s memory', async () => {
    const { store: s, fake } = store({
      get: () => ({ data: memory('m1', 'x', { tenant: 'OTHER' }) }),
    });
    await s.delete(IDENTITY, 'm1');
    expect(fake.ops()).toEqual(['get']);
    expect(fake.ops()).not.toContain('delete');
  });

  it('a missing memory reads as null rather than raising', async () => {
    const { store: s } = store({
      get: () => {
        throw { code: 404 };
      },
    });
    await expect(s.get(IDENTITY, 'nope')).resolves.toBeNull();
  });
});

// ── 2b. THE ADDRESSING LAW ──────────────────────────────────────────

describe('one entry id, two identities, two rows', () => {
  const ALICE: MemoryIdentity = { tenant: 't1', principal: 'alice', conversationId: 'c1' };
  const BOB: MemoryIdentity = { tenant: 't2', principal: 'bob', conversationId: 'c2' };

  it('two tenants writing the SAME entry id get their own row each', async () => {
    // The probe, in full. Under an identity-free address this ends with ONE
    // row: Bob's fact under Alice's immutable scope.
    const { store: s, bank } = bankStore();
    await s.put(ALICE, entry('pref-tone', 'alice likes short answers'));
    await s.put(BOB, entry('pref-tone', 'bob is allergic to peanuts'));

    expect(bank.rows.size).toBe(2);
    expect((await s.get(ALICE, 'pref-tone'))?.value).toBe('alice likes short answers');
    expect((await s.get(BOB, 'pref-tone'))?.value).toBe('bob is allergic to peanuts');
  });

  it('Bob’s accepted write is really there — list and forget both find it', async () => {
    // The three downstream symptoms of the merge, asserted as their absence:
    // a read that returns null, a listing that is empty, and an erasure that
    // deletes nothing while reporting success.
    const { store: s, bank } = bankStore();
    await s.put(ALICE, entry('pref-tone', 'alice likes short answers'));
    await s.put(BOB, entry('pref-tone', 'bob is allergic to peanuts'));

    expect((await s.list(BOB)).entries.map((e) => e.value)).toEqual(['bob is allergic to peanuts']);
    await s.forget(BOB);
    expect(bank.rows.size).toBe(1);
    expect(await s.get(BOB, 'pref-tone')).toBeNull();
    // And Alice, who asked for nothing, still has hers.
    expect((await s.get(ALICE, 'pref-tone'))?.value).toBe('alice likes short answers');
  });

  it('the library’s own identity-free entry ids are the ordinary case, not an edge one', async () => {
    // writeMessages, writeFacts and writeSnapshot all mint ids that carry no
    // identity. On the second user of any app that uses them, these ARE the
    // colliding ids.
    const { store: s, bank } = bankStore();
    for (const id of ['msg-3-0', 'fact:tone', 'snap-3']) {
      await s.put(ALICE, entry(id, `alice ${id}`));
      await s.put(BOB, entry(id, `bob ${id}`));
    }
    expect(bank.rows.size).toBe(6);
    for (const id of ['msg-3-0', 'fact:tone', 'snap-3']) {
      expect((await s.get(ALICE, id))?.value).toBe(`alice ${id}`);
      expect((await s.get(BOB, id))?.value).toBe(`bob ${id}`);
    }
  });

  it('the resource name is NOT the bare entry id — the regression this pins', async () => {
    const { store: s, bank } = bankStore();
    await s.put(ALICE, entry('pref-tone', 'x'));
    expect(bank.only().name).not.toBe(`${PARENT}/memories/pref-tone`);
    // Still legible, though: the entry id survives in the name, behind the
    // scope fingerprint that partitions it.
    expect(bank.only().name).toContain('pref-tone');
  });

  it('a widened scopeFor shares a row across conversations — and only that far', async () => {
    // The address is keyed on the resolved SCOPE, so widening it widens
    // sharing exactly as much as it widens retrieval, and not one row more.
    const { store: s, bank } = bankStore({
      scopeFor: (id: MemoryIdentity) => ({
        tenant: id.tenant ?? '_',
        principal: id.principal ?? '_',
      }),
    });
    const laterConversation: MemoryIdentity = { ...ALICE, conversationId: 'c9' };
    await s.put(ALICE, entry('fact:tone', 'short answers'));
    await s.put(laterConversation, entry('fact:tone', 'short answers, and no emoji'));
    await s.put(BOB, entry('fact:tone', 'peanut allergy'));

    expect(bank.rows.size).toBe(2);
    expect((await s.get(laterConversation, 'fact:tone'))?.value).toBe(
      'short answers, and no emoji',
    );
    expect((await s.get(BOB, 'fact:tone'))?.value).toBe('peanut allergy');
  });

  it('an id that differs only in case is a different memory, not the same one folded', async () => {
    // safeResourceId lowercases, which is lossy — so the fold must not be
    // allowed to merge two entries the caller kept apart.
    const { store: s, bank } = bankStore();
    await s.put(ALICE, entry('Tone', 'capital'));
    await s.put(ALICE, entry('tone', 'lower'));
    expect(bank.rows.size).toBe(2);
    expect((await s.get(ALICE, 'Tone'))?.value).toBe('capital');
    expect((await s.get(ALICE, 'tone'))?.value).toBe('lower');
  });

  it('put REFUSES a row whose scope is not this identity’s, rather than overwriting it', async () => {
    // Unreachable through the address — so it is forced here, by rewriting a
    // stored row's scope under the adapter. This is what a fingerprint
    // collision, or another tool writing under a name of ours, would look like.
    const { store: s, bank } = bankStore();
    await s.put(ALICE, entry('pref-tone', 'alice likes short answers'));
    const planted = bank.only();
    planted.scope = { tenant: 'someone', principal: 'else', conversation: 'x' };

    const error = await s.put(ALICE, entry('pref-tone', 'overwrite me')).catch((e: unknown) => e);
    expect((error as Error).name).toBe('MemoryScopeConflictError');
    expect(String(error)).toContain('pref-tone');
    // Refused means refused: the row is untouched and no second row appeared.
    expect(bank.rows.size).toBe(1);
    expect(bank.only().fact).toBe('alice likes short answers');
  });

  it('two writers racing a first write end with one row, not a failure', async () => {
    // Both read "absent", both create, one gets ALREADY EXISTS — which is a
    // race that RESOLVED, so it folds into the same scope-checked patch.
    const { store: s, bank } = bankStore();
    await Promise.all([
      s.put(ALICE, entry('pref-tone', 'first')),
      s.put(ALICE, entry('pref-tone', 'second')),
    ]);
    expect(bank.rows.size).toBe(1);
    expect(['first', 'second']).toContain(bank.only().fact);
  });
});

// ── 3. THE OPERATIONS WITH NO PRIMITIVE ─────────────────────────────

describe('the five operations this service cannot do are refused, not faked', () => {
  it.each([
    [
      'putIfVersion',
      (s: ReturnType<typeof memoryBankStore>) => s.putIfVersion(IDENTITY, entry('a', 'x'), 0),
    ],
    ['seen', (s: ReturnType<typeof memoryBankStore>) => s.seen(IDENTITY, 'sig')],
    [
      'recordSignature',
      (s: ReturnType<typeof memoryBankStore>) => s.recordSignature(IDENTITY, 'sig'),
    ],
    ['feedback', (s: ReturnType<typeof memoryBankStore>) => s.feedback(IDENTITY, 'a', 1)],
    ['getFeedback', (s: ReturnType<typeof memoryBankStore>) => s.getFeedback(IDENTITY, 'a')],
  ])('%s refuses by name, and says what to use instead', async (name, call) => {
    const { store: s, fake } = store();
    const error = await call(s).catch((e: unknown) => e);
    expect((error as Error).name).toBe('MemoryOperationUnsupportedError');
    expect(String(error)).toContain(name);
    // Refused locally: nothing is spent finding out.
    expect(fake.ops()).toEqual([]);
  });

  it('getFeedback refuses rather than answering null, which means something else', async () => {
    const { store: s } = store();
    // `null` is documented as "no feedback recorded", which callers treat
    // differently from "neutral" — and neither is "this store cannot".
    await expect(s.getFeedback(IDENTITY, 'a')).rejects.toThrow(/indistinguishable/);
  });
});

// ── Writes ──────────────────────────────────────────────────────────

describe('writes wait for their operation', () => {
  /** A `get` that answers with a memory of ours, so `put` takes the patch path. */
  const existing = () => ({ get: () => ({ data: memory('m1', 'the old fact', FULL_SCOPE) }) });

  it('reads before it writes — the read IS the tenant check, not an optimisation', async () => {
    const { store: s, fake } = store(existing());
    await s.put(IDENTITY, entry('m1', 'a fact'));
    expect(fake.ops()).toEqual(['get', 'patch']);
  });

  it('creates when the read finds nothing to overwrite', async () => {
    const { store: s, fake } = store({
      get: () => {
        throw { code: 404 };
      },
    });
    await s.put(IDENTITY, entry('m1', 'a fact'));
    expect(fake.ops()).toEqual(['get', 'create']);
  });

  it('the patch mask never claims the immutable scope', async () => {
    const { store: s, fake } = store(existing());
    await s.put(IDENTITY, entry('m1', 'a fact'));
    expect(fake.calls.find((c) => c.op === 'patch')!.params['updateMask']).toBe('fact,metadata');
  });

  it('the create names the SAME resource id the get and patch address', async () => {
    // Two spellings of one address would mean creating a row nothing ever
    // reads back — a write that lands somewhere no read looks.
    const { store: s, fake } = store({
      get: () => {
        throw { code: 404 };
      },
    });
    await s.put(IDENTITY, entry('m1', 'a fact'));
    const read = String(fake.calls.find((c) => c.op === 'get')!.params['name']);
    const created = String(fake.calls.find((c) => c.op === 'create')!.params['memoryId']);
    expect(read).toBe(`${PARENT}/memories/${created}`);
  });

  it('waits until the operation reports done', async () => {
    let waits = 0;
    const { store: s, fake } = store({
      get: () => {
        throw { code: 404 };
      },
      create: () => ({ data: { name: 'operations/x', done: false } }),
      wait: () => ({ data: { name: 'operations/x', done: ++waits >= 3 } }),
    });
    await s.put(IDENTITY, entry('m1', 'a fact'));
    expect(waits).toBe(3);
    expect(fake.ops()).toEqual(['get', 'create', 'wait', 'wait', 'wait']);
  });

  it('refuses rather than reporting a write it never saw land', async () => {
    const { store: s } = store(
      {
        get: () => {
          throw { code: 404 };
        },
        create: () => ({ data: { name: 'operations/x', done: false } }),
        wait: () => ({ data: { name: 'operations/x', done: false } }),
      },
      { operationTimeoutMs: 0 },
    );
    await expect(s.put(IDENTITY, entry('m1', 'a fact'))).rejects.toThrow(/did not finish/);
  });

  it('an already-expired entry is not written at all', async () => {
    const { store: s, fake } = store();
    await s.put(IDENTITY, entry('m1', 'stale', { ttl: Date.now() - 1000 }));
    expect(fake.ops()).toEqual([]);
  });

  it('an empty putMany costs no round trip — callers rely on that', async () => {
    const { store: s, fake } = store();
    await s.putMany(IDENTITY, []);
    expect(fake.ops()).toEqual([]);
  });
});

// ── Value mapping ───────────────────────────────────────────────────

describe('a MemoryEntry through the fact field and back', () => {
  it('a string value is stored as the fact itself — this store ranks sentences', async () => {
    const { store: s, fake } = store({
      get: () => {
        throw { code: 404 };
      },
    });
    await s.put(IDENTITY, entry('m1', 'she prefers aisle seats'));
    const body = fake.calls.find((c) => c.op === 'create')!.params['requestBody'] as Record<
      string,
      unknown
    >;
    expect(body['fact']).toBe('she prefers aisle seats');
    expect(
      (body['metadata'] as Record<string, Record<string, unknown>>)['agentfootprint_json'],
    ).toEqual({ boolValue: false });
  });

  it('a non-string value round-trips through JSON with its type restored', async () => {
    const { store: s } = store({
      get: () => ({ data: memory('m1', '{"seat":"aisle"}', FULL_SCOPE, true) }),
    });
    const found = await s.get<{ seat: string }>(IDENTITY, 'm1');
    expect(found?.value).toEqual({ seat: 'aisle' });
  });

  it('a row Memory Bank generated ITSELF is skipped, not dressed up as one of ours', async () => {
    // Memory Bank derives its own memories — a headline feature. Those carry a
    // fact and none of our metadata; inventing an id and a version for them
    // would make store.get() work by accident on rows nobody wrote.
    const { store: s } = store({
      retrieve: () => ({
        data: {
          retrievedMemories: [
            { distance: 0.1, memory: { name: `${PARENT}/memories/google-1`, fact: 'derived' } },
            { distance: 0.2, memory: memory('ours', 'written', FULL_SCOPE) },
          ],
        },
      }),
    });
    const hits = await s.search(IDENTITY, [], { text: 'q' });
    expect(hits.map((h) => h.entry.id)).toEqual(['ours']);
  });

  it('an entry ttl (a timestamp) becomes the service’s ttl (a duration)', async () => {
    const { store: s, fake } = store({
      get: () => {
        throw { code: 404 };
      },
    });
    await s.put(IDENTITY, entry('m1', 'x', { ttl: Date.now() + 3_600_000 }));
    const create = fake.calls.find((c) => c.op === 'create');
    const ttl = String((create!.params['requestBody'] as Record<string, unknown>)['ttl']);
    expect(ttl).toMatch(/^\d+s$/);
    expect(Number.parseInt(ttl, 10)).toBeGreaterThan(3500);
  });
});

// ── forget ──────────────────────────────────────────────────────────

describe('forget: erasure that really erases', () => {
  it('pages through the scope and deletes every memory in it', async () => {
    let page = 0;
    const { store: s, fake } = store({
      retrieve: () => {
        page += 1;
        return page === 1
          ? {
              data: {
                retrievedMemories: [{ memory: memory('a', 'x', FULL_SCOPE) }],
                nextPageToken: 'p2',
              },
            }
          : { data: { retrievedMemories: [{ memory: memory('b', 'y', FULL_SCOPE) }] } };
      },
    });
    await s.forget(IDENTITY);
    expect(fake.ops()).toEqual(['retrieve', 'delete', 'retrieve', 'delete']);
    expect(fake.calls.filter((c) => c.op === 'delete').map((c) => c.params['name'])).toEqual([
      `${PARENT}/memories/a`,
      `${PARENT}/memories/b`,
    ]);
  });

  it('a service that keeps handing back the same cursor does not loop forever', async () => {
    const { store: s, fake } = store({
      retrieve: () => ({
        data: {
          retrievedMemories: [{ memory: memory('a', 'x', FULL_SCOPE) }],
          nextPageToken: 'same',
        },
      }),
    });
    await s.forget(IDENTITY);
    // Erasure walks forward or it stops; it never spins.
    expect(fake.calls.filter((c) => c.op === 'retrieve')).toHaveLength(2);
  });

  it('never calls purge — its `force` flag defaults to a dry run', async () => {
    const { store: s, fake } = store();
    await s.forget(IDENTITY);
    expect(fake.ops()).not.toContain('purge');
  });
});

// ── Construction and secrecy ────────────────────────────────────────

describe('construction, closing and what errors may say', () => {
  it('close() is final', async () => {
    const { store: s } = store();
    await s.close();
    await expect(s.list(IDENTITY)).rejects.toThrow(/after close/);
  });

  it('the SDK’s own failure text never reaches the caller', async () => {
    const { store: s } = store({
      retrieve: () => {
        throw new Error('400 https://…?access_token=ya29.SECRET for alice@corp.com');
      },
    });
    const error = await s.list(IDENTITY).catch((e: unknown) => e);
    expect(String(error)).toContain('memories.retrieve');
    expect(String(error)).not.toContain('ya29.SECRET');
    expect(String(error)).not.toContain('alice@corp.com');
    expect((error as Error).cause).toBeUndefined();
  });

  it('a missing peer dependency refuses where the config was written', async () => {
    vi.resetModules();
    vi.doMock('../../../src/lib/lazyRequire.js', () => ({
      lazyRequire: () => {
        throw new Error('Cannot find module');
      },
    }));
    try {
      const { memoryBankStore: isolated } = await import(
        '../../../src/adapters/memory/memoryBank.js'
      );
      expect(() => isolated(CONNECTION)).toThrow(/@googleapis\/aiplatform/);
    } finally {
      vi.doUnmock('../../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  });
});
