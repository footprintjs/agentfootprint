/**
 * Session retention — the port's optional member, its refusal, and the two
 * sweeps that ship in this folder.
 *
 * The laws being pinned:
 *   • A store that implements no `retention()` REFUSES BY NAME. It never
 *     answers `undefined`, and nothing quietly deletes nothing — a cleanup job
 *     whose call returned without complaining is indistinguishable from one
 *     that is working, and the difference surfaces the day somebody asks how
 *     long conversations are kept.
 *   • The two arms are told apart by `deletedBy`, and a caller branches once.
 *     One arm hands you something to CALL; the other hands you something to
 *     CONFIGURE, and nothing to call, deliberately — a method that reported
 *     "the backend handles it" is a method somebody puts in a cron job.
 *   • A sweep forgets sessions STRICTLY older than the cutoff, takes the owner
 *     index with them, is idempotent, and is bounded.
 *   • **A store that does not implement it is unaffected.** Additive means the
 *     composer never reaches for the member, so a two-method store built
 *     against 9.41 runs a turn on 9.42 with nothing changed.
 *
 * The mutation check this file is written to survive: break the feature
 * detection in `sessionRetention` — make it accept a store without the member
 * — and the first three tests below fail. That is the whole point of the door.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import {
  DEFAULT_SWEEP_LIMIT,
  memorySessions,
  sessionRetention,
  SessionRetentionUnavailableError,
  sqliteSessions,
  standingAgent,
  toEnvelope,
} from '../../src/hosting/index.js';
import type { CheckpointEnvelope, SessionLifecycle } from '../../src/hosting/index.js';
import { agentCoreSessions } from '../../src/adapters/hosting/agentcore.js';
import type { AgentRunCheckpoint } from '../../src/core/runCheckpoint.js';
import { inProcessHost } from './testHost.js';

// ─── fixtures ────────────────────────────────────────────────────────

const CUTOFF = 1_700_000_000_000;

function envelope(savedAt: number, principal?: string): CheckpointEnvelope {
  const base = toEnvelope({
    version: 1,
    runId: `run-${savedAt}`,
    history: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ],
    lastCompletedIteration: 1,
    originalInput: { message: 'hello' },
    checkpointedAt: savedAt,
    ...(principal !== undefined && { identity: { principal } }),
  } as unknown as AgentRunCheckpoint);
  return { ...base, savedAt } as CheckpointEnvelope;
}

/** The shape most stores in the world are: two methods and nothing else. */
function twoMethodStore(): SessionLifecycle {
  const rows = new Map<string, CheckpointEnvelope>();
  return {
    hydrate: (id) => Promise.resolve(rows.get(id)),
    persist: (id, env) => {
      rows.set(id, env);
      return Promise.resolve();
    },
  };
}

/** Seed three conversations around one cutoff, oldest first. */
async function seed(store: SessionLifecycle): Promise<void> {
  await store.persist('old', envelope(CUTOFF - 60_000, 'alice'));
  await store.persist('boundary', envelope(CUTOFF, 'alice'));
  await store.persist('fresh', envelope(CUTOFF + 60_000, 'alice'));
}

const sqliteAvailable = await (async (): Promise<boolean> => {
  try {
    const mod = (await import('node:sqlite')) as { DatabaseSync?: unknown };
    return typeof mod.DatabaseSync === 'function';
  } catch {
    return false;
  }
})();

const tempDir = mkdtempSync(join(tmpdir(), 'af-retention-'));
let nth = 0;

// ─── unit — the refusal, which is the load-bearing half ──────────────

describe('a store that cannot expire anything refuses BY NAME', () => {
  it('throws rather than answering undefined', () => {
    // THE mutation check. Feature detection that accepted a store without the
    // member would make this call return `undefined`, and every caller would
    // read that as "nothing to do".
    expect(() => sessionRetention(twoMethodStore())).toThrow(SessionRetentionUnavailableError);
  });

  it('names what is missing, what it is not, and where to get one', () => {
    let raised: SessionRetentionUnavailableError | undefined;
    try {
      sessionRetention(twoMethodStore(), 'the nightly retention job');
    } catch (err) {
      raised = err as SessionRetentionUnavailableError;
    }
    expect(raised).toBeDefined();
    expect(raised!.name).toBe('SessionRetentionUnavailableError');
    expect(raised!.code).toBe('ERR_SESSION_RETENTION_UNAVAILABLE');
    // The caller's own words, so an operator reading a log knows which job
    // stopped — the same reason the session-history refusals carry their op.
    expect(raised!.purpose).toBe('the nightly retention job');
    expect(raised!.message).toContain('the nightly retention job');
    expect(raised!.message).toContain('retention()');
    // The distinction the whole class exists for.
    expect(raised!.message).toContain('limitation of the store');
    // And a way forward, not just a complaint.
    expect(raised!.message).toContain('memorySessions()');
    expect(raised!.message).toContain('sqliteSessions({ file })');
    expect(raised!.message).toContain('additively');
  });

  it('teaches without naming anybody — no identity material in the refusal', () => {
    // Same law every refusal in this folder follows. There is no principal in
    // scope here at all, and there never should be: retention is about a
    // store, and a message that named a user would be an oracle for who is
    // signed in.
    const text = new SessionRetentionUnavailableError('a cleanup job').message;
    for (const leak of ['alice', 'bob', 'principal', 'token', 'Bearer']) {
      expect(text.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });

  it('refuses for a SHIPPED store that honestly cannot sweep', () => {
    // The event-backed AgentCore mode appends to a service and has no delete
    // on this shim's surface. It implements no retention member, and the
    // refusal is what a caller gets — never a sweep that reports zero.
    const store = agentCoreSessions({
      store: 'memory',
      memoryId: 'mem-1',
      _client: {
        createEvent: () => Promise.resolve(),
        listEvents: () => Promise.resolve({ events: [] }),
      },
    });
    expect(() => sessionRetention(store)).toThrow(SessionRetentionUnavailableError);
  });
});

// ─── unit — the two arms ─────────────────────────────────────────────

describe('the answer is discriminated, so a caller branches exactly once', () => {
  it('memorySessions says THIS STORE deletes, and hands back a sweep', () => {
    const policy = sessionRetention(memorySessions());
    expect(policy.deletedBy).toBe('this-store');
    if (policy.deletedBy !== 'this-store') throw new Error('unreachable');
    expect(typeof policy.forgetOlderThan).toBe('function');
  });

  it('the default sweep bound is stated, not hidden', () => {
    // A bound nobody can read is a bound nobody can plan around: the first
    // sweep of a neglected store is the biggest one it will ever do.
    expect(DEFAULT_SWEEP_LIMIT).toBe(1000);
  });
});

// ─── scenario — the sweep, on the two stores that ship here ──────────

const sweepingStores: readonly [string, () => SessionLifecycle][] = [
  ['memorySessions', () => memorySessions()],
  [
    "agentCoreSessions({ store: 'session-storage' })",
    () => agentCoreSessions({ store: 'session-storage', path: join(tempDir, `s-${++nth}.json`) }),
  ],
];

for (const [name, create] of sweepingStores) {
  describe(`${name} — the sweep forgets the old and nothing else`, () => {
    it('deletes strictly older, keeps the boundary and the fresh one', async () => {
      const store = create();
      await seed(store);
      const policy = sessionRetention(store);
      if (policy.deletedBy !== 'this-store') throw new Error('expected a sweeping store');

      const swept = await policy.forgetOlderThan(CUTOFF);

      expect(swept).toEqual({ forgotten: 1, more: false });
      expect(await store.hydrate('old')).toBeUndefined();
      // Strictly before, so passing the same cutoff twice is stable and a
      // conversation written exactly on the boundary survives.
      expect(await store.hydrate('boundary')).toBeDefined();
      expect(await store.hydrate('fresh')).toBeDefined();
    });

    it('a second sweep at the same cutoff is a no-op, not an error', async () => {
      const store = create();
      await seed(store);
      const policy = sessionRetention(store);
      if (policy.deletedBy !== 'this-store') throw new Error('expected a sweeping store');

      await policy.forgetOlderThan(CUTOFF);
      // A cleanup job runs on a schedule and most of its runs have nothing to
      // do. "Nothing to do" is not a failure.
      expect(await policy.forgetOlderThan(CUTOFF)).toEqual({ forgotten: 0, more: false });
    });

    it('a limit bounds the batch and says there is more', async () => {
      const store = create();
      await seed(store);
      const policy = sessionRetention(store);
      if (policy.deletedBy !== 'this-store') throw new Error('expected a sweeping store');

      const first = await policy.forgetOlderThan(CUTOFF + 120_000, { limit: 1 });
      expect(first).toEqual({ forgotten: 1, more: true });
      const second = await policy.forgetOlderThan(CUTOFF + 120_000, { limit: 1 });
      expect(second).toEqual({ forgotten: 1, more: true });
      const third = await policy.forgetOlderThan(CUTOFF + 120_000, { limit: 1 });
      expect(third).toEqual({ forgotten: 1, more: false });
      // The backlog really drained, in bounded steps.
      expect(await store.hydrate('fresh')).toBeUndefined();
    });

    it('an empty store sweeps to zero rather than refusing', async () => {
      const policy = sessionRetention(create());
      if (policy.deletedBy !== 'this-store') throw new Error('expected a sweeping store');
      expect(await policy.forgetOlderThan(CUTOFF)).toEqual({ forgotten: 0, more: false });
    });
  });
}

describe('memorySessions — the owner index goes with the conversation', () => {
  it('a swept session leaves neither an envelope nor an index row nor a listing row', async () => {
    const store = memorySessions();
    await seed(store);
    const policy = sessionRetention(store);
    if (policy.deletedBy !== 'this-store') throw new Error('expected a sweeping store');

    await policy.forgetOlderThan(CUTOFF);

    expect(await store.ownerOf!('old')).toBeUndefined();
    // A listing row that opens nothing is worse than a row that is gone.
    const page = await store.listByUser!('alice', { limit: 10 });
    expect(page.sessions.map((s) => s.sessionId).sort()).toEqual(['boundary', 'fresh']);
  });
});

describe.skipIf(!sqliteAvailable)('sqliteSessions — the sweep reaches the file', () => {
  it('forgets the old rows, keeps the rest, and the deletion survives a reopen', async () => {
    const file = join(tempDir, `db-${++nth}.db`);
    const store = sqliteSessions({ file });
    await seed(store);
    const policy = sessionRetention(store);
    if (policy.deletedBy !== 'this-store') throw new Error('expected a sweeping store');

    expect(await policy.forgetOlderThan(CUTOFF)).toEqual({ forgotten: 1, more: false });
    expect(await store.ownerOf('old')).toBeUndefined();
    store.close();

    // A store that deleted only from a cache would pass every assertion above.
    const reopened = sqliteSessions({ file });
    expect(await reopened.hydrate('old')).toBeUndefined();
    expect(await reopened.hydrate('boundary')).toBeDefined();
    reopened.close();
  });

  it('refuses by name on a closed store, like every other verb here', async () => {
    const store = sqliteSessions({ file: join(tempDir, `db-${++nth}.db`) });
    const policy = sessionRetention(store);
    if (policy.deletedBy !== 'this-store') throw new Error('expected a sweeping store');
    store.close();

    await expect(policy.forgetOlderThan(CUTOFF)).rejects.toThrow(/is closed/);
  });

  it('deletes the OLDEST first, so a bounded sweep drains a backlog from the far end', async () => {
    const store = sqliteSessions({ file: join(tempDir, `db-${++nth}.db`) });
    for (let n = 0; n < 5; n++) await store.persist(`s${n}`, envelope(CUTOFF - 5000 + n, 'alice'));
    const policy = sessionRetention(store);
    if (policy.deletedBy !== 'this-store') throw new Error('expected a sweeping store');

    await policy.forgetOlderThan(CUTOFF, { limit: 2 });

    expect(await store.hydrate('s0')).toBeUndefined();
    expect(await store.hydrate('s1')).toBeUndefined();
    expect(await store.hydrate('s2')).toBeDefined();
    store.close();
  });
});

// ─── integration — additive means additive ───────────────────────────

describe('a store that does not implement retention is UNAFFECTED', () => {
  it('a two-method store still serves a whole turn, and nothing asks it about retention', async () => {
    // The pin for "additive only". Every member read is recorded, and reading
    // `retention` at all is a hard failure — so if the composer ever grows a
    // retention probe on the turn path, this test names it rather than the
    // change landing silently. The other optional members ARE probed here
    // (`onWake`, the index pair) and always were; that is what feature
    // detection looks like from the store's side.
    const inner = twoMethodStore();
    const touched: string[] = [];
    const strict = new Proxy(inner, {
      get(target, property, receiver) {
        const key = String(property);
        touched.push(key);
        if (key === 'retention') {
          throw new Error('the composer reached for retention() on an ordinary turn');
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as SessionLifecycle;

    const agent = Agent.create({ provider: mock({ reply: 'hello back' }), model: 'm' }).build();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions: strict, host });

    const first = await host.deliver({ input: 'hi', sessionId: 'c1' });
    const second = await host.deliver({ input: 'again', sessionId: 'c1' });
    await handle.close();

    expect(first.output).toBe('hello back');
    expect(second.output).toBe('hello back');
    expect(touched).toContain('hydrate');
    expect(touched).toContain('persist');
    expect(touched).not.toContain('retention');
  });
});

process.on('exit', () => {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
