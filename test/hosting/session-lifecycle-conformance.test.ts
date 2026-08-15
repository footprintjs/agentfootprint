/**
 * Every store in this repository, against the ONE battery.
 *
 * The reason this file exists is worth stating plainly, because it is the
 * finding, not the fixture:
 *
 *   A split-brain ownership defect — `ownerOf(session)` naming the first
 *   writer while the stored envelope carried the SECOND writer's entire
 *   conversation — was live in FOUR stores at once. All four were tested. None
 *   of the tests could see it, because every store was tested against its own
 *   doubles, so a flaw in the PORT's semantics was invisible to all of them
 *   simultaneously.
 *
 * So the laws moved out of the four suites and into `sessionLifecycleConformance`,
 * which is exported from `agentfootprint/hosting` for stores nobody here has
 * written. This file is the in-tree binding: six harnesses, one battery, one
 * `it()` per case per store.
 *
 * Where a store cannot satisfy a case it DECLARES it by name with the reason,
 * and the declaration is asserted below — a store cannot quietly acquire a new
 * exemption, and a declaration that has become untrue is reported as STALE
 * rather than going on suppressing nothing.
 *
 * Nothing here reaches a network. The Firestore harness uses this directory's
 * own double; the managed-service harness uses a small fake in this file.
 *
 * ── The fifth store, enrolled late (9.42.0) ─────────────────────────────────
 * `agentCoreSessions` is a shipped `SessionLifecycle` and appeared here ZERO
 * times, in BOTH its modes, from the day this file was written — and its
 * absence was not declared anywhere, which is precisely the shape this suite
 * exists to refuse one level down. A battery whose own roster can quietly omit
 * a store is a battery that proves what it happened to be pointed at.
 *
 * Both modes are enrolled, separately, because they are two different stores
 * behind one factory: one keeps a JSON file it owns, the other appends events
 * to a service. Enrolling only the cheap one would have repeated the original
 * mistake with fewer characters.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  envelopeOwner,
  formatConformanceReport,
  memorySessions,
  runSessionLifecycleCase,
  runSessionLifecycleConformance,
  sessionLifecycleConformance,
  sqliteSessions,
} from '../../src/hosting/index.js';
import type {
  CheckpointEnvelope,
  SessionLifecycle,
  SessionStoreHarness,
} from '../../src/hosting/index.js';
import { agentCoreSessions } from '../../src/adapters/hosting/agentcore.js';
import type { AgentCoreSessionClientLike } from '../../src/adapters/hosting/agentcore.js';
import { firestoreSessions } from '../../src/hosting-providers.js';
import {
  agentEngineSessions,
  DEFAULT_USER_ID,
  SESSION_STATE_KEY,
} from '../../src/adapters/hosting/googleAgentEngine.js';
import { fakeFirestore } from './firestoreDouble.js';

// ─── memory ──────────────────────────────────────────────────────────

const memoryHarness: SessionStoreHarness = {
  name: 'memorySessions',
  createStore: () => memorySessions(),
  // The Map is closed over, so there is no reaching into it — but this store
  // does not validate on the way in either, which is the same door: write
  // bytes it will hand straight back.
  corrupt: (store, sessionId) => void store.persist(sessionId, { not: 'an envelope' } as never),
};

// ─── sqlite ──────────────────────────────────────────────────────────

/** One temp directory for every file this suite opens; removed at the end. */
const tempDir = mkdtempSync(join(tmpdir(), 'af-conformance-'));
let sqliteNth = 0;
/** The store does not publish its own path, so the harness remembers it beside
 *  the instance rather than asking the store for an accessor nothing else
 *  wants. */
const sqliteFiles = new WeakMap<object, string>();

const sqliteHarness: SessionStoreHarness = {
  name: 'sqliteSessions',
  createStore: () => {
    const file = join(tempDir, `s-${++sqliteNth}.db`);
    const store = sqliteSessions({ file });
    sqliteFiles.set(store, file);
    return store;
  },
  disposeStore: (store) => (store as { close(): void }).close(),
  corrupt: (store, sessionId) => {
    // Behind the store's back, through a SECOND connection to the same file —
    // which is exactly how a corrupt row arrives in the field: something that
    // is not this store wrote to it.
    const raw = openRaw(sqliteFiles.get(store as object)!);
    raw
      .prepare('UPDATE agent_sessions SET envelope = ? WHERE session_id = ?')
      .run('{not json at all', sessionId);
    raw.close();
  },
};

interface RawDb {
  prepare(sql: string): { run(...params: unknown[]): unknown };
  close(): void;
}

function openRaw(file: string): RawDb {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (f: string) => RawDb };
  return new DatabaseSync(file);
}

// ─── firestore, against this directory's double ──────────────────────

const firestoreStores = new WeakMap<object, ReturnType<typeof fakeFirestore>>();

const firestoreHarness: SessionStoreHarness = {
  name: 'firestoreSessions (double)',
  createStore: () => {
    const fake = fakeFirestore();
    const store = firestoreSessions({ _sdk: fake.sdk });
    firestoreStores.set(store, fake);
    return store;
  },
  corrupt: (store, sessionId) => {
    const fake = firestoreStores.get(store as object)!;
    const documentId = (store as { documentIdFor(id: string): string }).documentIdFor(sessionId);
    const row = fake.store.get(documentId);
    if (row !== undefined) fake.store.set(documentId, { ...row, envelope: '{not json at all' });
  },
};

// ─── the managed session service, against a small fake ───────────────

const CONNECTION = { project: 'p', location: 'us-central1', reasoningEngine: 'engine-1' } as const;
const PARENT = `projects/p/locations/us-central1/reasoningEngines/engine-1`;

/**
 * The slice of the service this store touches, with the semantics the field
 * trial measured: `userId` is pinned at CREATE and never changes, state is
 * written by APPENDING an event, creating a name that exists is ALREADY_EXISTS,
 * and a listing filters on the service's own `user_id`.
 */
function fakeService() {
  const rows = new Map<string, Record<string, unknown>>();
  let clock = 1_700_000_000_000;
  const stamp = (): string => new Date(++clock).toISOString();
  const notFound = (): never => {
    throw { code: 404 };
  };

  const sessions = {
    get: ({ name }: { name: string }) => {
      const found = rows.get(name);
      if (found === undefined) return Promise.resolve(notFound());
      return Promise.resolve({ data: found });
    },
    patch: () => {
      throw { code: 400, message: 'you can only update it by appending an event.' };
    },
    appendEvent: ({
      name,
      requestBody,
    }: {
      name: string;
      requestBody: Record<string, unknown>;
    }) => {
      const session = rows.get(name);
      if (session === undefined) return Promise.resolve(notFound());
      const actions = (requestBody as { actions?: { stateDelta?: Record<string, unknown> } })
        .actions;
      rows.set(name, {
        ...session,
        updateTime: stamp(),
        sessionState: {
          ...((session['sessionState'] as Record<string, unknown>) ?? {}),
          ...(actions?.stateDelta ?? {}),
        },
      });
      return Promise.resolve({ data: {} });
    },
    create: ({
      parent,
      sessionId,
      requestBody,
    }: {
      parent: string;
      sessionId: string;
      requestBody: Record<string, unknown>;
    }) => {
      const name = `${parent}/sessions/${sessionId}`;
      // The service's own answer to two writers opening one conversation.
      if (rows.has(name)) throw { code: 409, message: 'ALREADY_EXISTS' };
      rows.set(name, { name, createTime: stamp(), updateTime: stamp(), ...requestBody });
      return Promise.resolve({ data: { name: 'op/1', done: true } });
    },
    delete: ({ name }: { name: string }) => {
      if (!rows.has(name)) return Promise.resolve(notFound());
      rows.delete(name);
      return Promise.resolve({ data: { done: true } });
    },
    list: ({
      filter,
      pageSize,
      pageToken,
    }: {
      filter?: string;
      pageSize?: number;
      pageToken?: string;
    }) => {
      const wanted = /^user_id="(.*)"$/.exec(filter ?? '')?.[1]?.replace(/\\(.)/g, '$1');
      const all = [...rows.values()]
        .filter((row) => row['userId'] === wanted)
        .sort((a, b) => String(b['updateTime']).localeCompare(String(a['updateTime'])));
      const from = Number.parseInt(pageToken ?? '0', 10) || 0;
      const size = pageSize ?? 50;
      const page = all.slice(from, from + size);
      const next = from + page.length;
      return Promise.resolve({
        data: {
          sessions: page,
          // A token only when there really is another page — a service that
          // always returns one would make the cursor law untestable.
          ...(next < all.length && { nextPageToken: String(next) }),
        },
      });
    },
    operations: { wait: () => Promise.resolve({ data: { done: true } }) },
  };

  return {
    rows,
    client: {
      projects: { locations: { reasoningEngines: { sessions, memories: {} } } },
    } as never,
  };
}

const services = new WeakMap<object, ReturnType<typeof fakeService>>();

const agentEngineHarness: SessionStoreHarness = {
  name: 'agentEngineSessions (fake service)',
  createStore: () => {
    const service = fakeService();
    const store = agentEngineSessions({ ...CONNECTION, _client: service.client });
    services.set(store, service);
    return store;
  },
  corrupt: (store, sessionId) => {
    const service = services.get(store as object)!;
    const name = `${PARENT}/sessions/${sessionId}`;
    const row = service.rows.get(name);
    if (row !== undefined) {
      service.rows.set(name, { ...row, sessionState: { [SESSION_STATE_KEY]: 'not an envelope' } });
    }
  },
  declared: {
    // Not a defect and not a gap in the battery: a genuine ceiling of the
    // backing service, written down so it can be argued with. The service
    // requires a `userId` at create and refuses to change it afterwards, so a
    // conversation that ran anonymously on turn one is stored under the
    // anonymous placeholder forever. Its real owner IS recorded — in the
    // envelope, where `persist` reads it to refuse a foreign signer — but the
    // service-side index that `ownerOf` and `listByUser` answer from cannot be
    // moved. Such a session appears in nobody's list until it is written under
    // a new id.
    'list-by-user-is-newest-first':
      'the service orders a listing by its own immutable update_time, and that is also what ' +
      'this adapter reports as savedAt, so a timestamp carried inside the envelope cannot ' +
      'influence the order — the two coincide whenever a session is written because it ' +
      'changed, and diverge only when an older conversation is re-persisted',
    'ownership-fills-in-on-a-later-signed-turn':
      'the service pins userId at create and refuses to change it, so a conversation that ' +
      'ran anonymously cannot be moved into somebody’s index on a later turn',
  },
};

// ─── the container runtime's two session stores ──────────────────────
//
// One factory, two genuinely different stores: a JSON file this container
// owns, and an append-only event log in a service. They are enrolled
// separately because a harness that covered "the cheap one" would leave the
// other exactly as unproven as both of them were before 9.42.0.

/** Where the file-backed mode writes. One file per store, removed at the end. */
let agentCoreNth = 0;
const agentCoreFiles = new WeakMap<object, string>();

const agentCoreFileHarness: SessionStoreHarness = {
  name: "agentCoreSessions({ store: 'session-storage' })",
  createStore: () => {
    const path = join(tempDir, `agentcore-${++agentCoreNth}.json`);
    const store = agentCoreSessions({ store: 'session-storage', path });
    agentCoreFiles.set(store, path);
    return store;
  },
  corrupt: (store, sessionId) => {
    // Behind the store's back, straight into the file — which is how a corrupt
    // session really arrives here: a container wrote to the same path, or a
    // half-finished write survived. The FILE stays valid JSON; the one session
    // inside it is not an envelope, which is the case that must refuse rather
    // than answer "no conversation".
    writeFileSync(
      agentCoreFiles.get(store as object)!,
      JSON.stringify({ version: 1, sessions: { [sessionId]: 'not an envelope' } }),
      'utf8',
    );
  },
};

/**
 * The slice of AgentCore Memory the event-backed mode touches, with the
 * semantics the adapter is written against: events are APPENDED, listed
 * NEWEST FIRST, and the newest one is the conversation.
 *
 * Deliberately keyed by the id the store actually sends — so the mapping from
 * a caller's opaque session id to an AgentCore id is under test rather than
 * bypassed by a fake that keys on the original.
 */
function fakeEventLog(): {
  client: AgentCoreSessionClientLike;
  events: Map<string, unknown[]>;
} {
  const events = new Map<string, unknown[]>();
  return {
    events,
    client: {
      createEvent: ({ actorId, sessionId, envelope }) => {
        const key = `${actorId}/${sessionId}`;
        // JSON TEXT, the way the shipped shim writes it — the service returns
        // an object blob as its own host language's `toString()`, which is the
        // defect 7.22.1 was released for.
        events.set(key, [...(events.get(key) ?? []), JSON.stringify(envelope)]);
        return Promise.resolve();
      },
      listEvents: ({ actorId, sessionId, maxResults }) => {
        const key = `${actorId}/${sessionId}`;
        const newestFirst = [...(events.get(key) ?? [])].reverse();
        const page = maxResults === undefined ? newestFirst : newestFirst.slice(0, maxResults);
        return Promise.resolve({
          events: page.map((envelope, index) => ({ eventId: `e-${index}`, envelope })),
        });
      },
    },
  };
}

const agentCoreLogs = new WeakMap<object, ReturnType<typeof fakeEventLog>>();

const agentCoreMemoryHarness: SessionStoreHarness = {
  name: "agentCoreSessions({ store: 'memory' })",
  createStore: () => {
    const log = fakeEventLog();
    const store = agentCoreSessions({
      store: 'memory',
      memoryId: 'mem-conformance',
      _client: log.client,
    });
    agentCoreLogs.set(store, log);
    return store;
  },
  corrupt: (store, sessionId) => {
    const log = agentCoreLogs.get(store as object)!;
    // The store's OWN key, computed the way the store computes it — the fake
    // holds one entry and this session is the only one in it, so corrupting
    // "the newest event of the only conversation" needs no id mapping and
    // makes no assumption about one.
    for (const [key, stored] of log.events) {
      if (stored.length === 0) continue;
      log.events.set(key, [...stored.slice(0, -1), 'not an envelope at all']);
      return;
    }
    throw new Error(`nothing stored for '${sessionId}' to corrupt`);
  },
};

// ─── the run ─────────────────────────────────────────────────────────

const HARNESSES = [
  memoryHarness,
  sqliteHarness,
  firestoreHarness,
  agentEngineHarness,
  agentCoreFileHarness,
  agentCoreMemoryHarness,
];

/**
 * `node:sqlite` ships from Node 22.5; this repository's CI matrix also runs
 * Node 20, where `sqliteSessions()` cannot be CONSTRUCTED at all.
 *
 * That is a missing runtime, not a store failing a law, so it is the one thing
 * the suite's own `declared` mechanism must NOT be used for: a declaration says
 * "this store cannot satisfy this case", and answers a question about the port.
 * Here there is no store to ask. The battery is skipped WHOLE, and visibly —
 * the same `describe.skipIf` shape `sqliteSessions.test.ts` already uses — so a
 * runner reports it as skipped rather than as quietly absent.
 */
const sqliteAvailable = await (async (): Promise<boolean> => {
  try {
    const mod = (await import('node:sqlite')) as { DatabaseSync?: unknown };
    return typeof mod.DatabaseSync === 'function';
  } catch {
    return false;
  }
})();

for (const harness of HARNESSES) {
  const on = harness === sqliteHarness && !sqliteAvailable ? describe.skip : describe;
  on(`SessionLifecycle conformance — ${harness.name}`, () => {
    for (const testCase of sessionLifecycleConformance) {
      it(testCase.name, async () => {
        const outcome = await runSessionLifecycleCase(testCase, harness);
        if (outcome.status === 'failed') {
          throw new Error(
            `${harness.name} broke a promise of the port.\n` +
              `  law: ${outcome.law}\n` +
              `  ${outcome.error.message}`,
          );
        }
        // A declaration that has become true-by-accident is reported, not
        // honoured. Otherwise a store carries an exemption it no longer needs
        // and the next real failure inherits it.
        if (outcome.status === 'declared' && !outcome.stillFails) {
          throw new Error(
            `${harness.name} DECLARES '${testCase.name}' and now passes it. ` +
              `Remove the declaration — a suppression nobody revisits is how a fixed defect ` +
              `keeps its exemption.`,
          );
        }
        expect(['passed', 'not-applicable', 'declared']).toContain(outcome.status);
      });
    }
  });
}

describe.skipIf(!sqliteAvailable)('the one-call entry point an out-of-tree store uses', () => {
  it('runs the whole battery and reports what happened, per store', async () => {
    // The shape a consumer actually reaches for — `if (!report.ok) throw` — so
    // the counts and the formatter are exercised rather than merely exported.
    const report = await runSessionLifecycleConformance(sqliteHarness);

    expect(report.store).toBe('sqliteSessions');
    expect(report.ok).toBe(true);
    expect(report.failed).toBe(0);
    expect(report.outcomes).toHaveLength(sessionLifecycleConformance.length);
    // Every case is accounted for exactly once — a report that lost a row
    // would understate a store the same way a silent skip does.
    expect(report.passed + report.declared + report.notApplicable + report.failed).toBe(
      sessionLifecycleConformance.length,
    );

    const text = formatConformanceReport(report);
    expect(text).toContain('sqliteSessions');
    expect(text).toContain('contested-write-leaves-no-split-brain');
  });

  it('a store with a stated limitation is conformant WITH LIMITS, and the report says which', async () => {
    const report = await runSessionLifecycleConformance(agentEngineHarness);
    expect(report.ok).toBe(true);
    expect(report.declared).toBe(2);
    const text = formatConformanceReport(report);
    // Declared cases are printed with their reason. A limitation nobody can
    // read in the output is a limitation nobody will ever argue with.
    expect(text).toContain('declared  ownership-fills-in-on-a-later-signed-turn');
    expect(text).toContain('pins userId at create');
    expect(text).not.toContain('STALE');
  });

  it('a store that breaks a law is reported as FAILED, with the law it broke', async () => {
    // The formatter's own load-bearing branch, against a store built to fail:
    // last-write-wins on the owner, which is the defect this release removed.
    const lastWriterWins: SessionStoreHarness = {
      name: 'last-writer-wins',
      createStore: (): SessionLifecycle => {
        const rows = new Map<string, CheckpointEnvelope>();
        return {
          hydrate: (id) => Promise.resolve(rows.get(id)),
          persist: (id, env) => {
            rows.set(id, env);
            return Promise.resolve();
          },
          ownerOf: (id) => Promise.resolve(envelopeOwner(rows.get(id))),
        };
      },
    };
    const report = await runSessionLifecycleConformance(lastWriterWins);
    expect(report.ok).toBe(false);
    expect(report.outcomes.filter((o) => o.status === 'failed').map((o) => o.case)).toContain(
      'ownership-is-not-taken-by-a-different-signer',
    );
    const text = formatConformanceReport(report);
    expect(text).toContain('FAILED');
    expect(text).toContain('law:');
  });
});

describe('what enrolling the container runtime’s two stores actually proved', () => {
  // Numbers, not `report.ok`. A store enrolled with every case reported
  // `not-applicable` would be "ok" and would have proved nothing — the exact
  // vacuous shape this whole suite exists to refuse — so each mode's split is
  // written down, and turning one of these proofs into a skip has to be a
  // deliberate edit here.
  it('the file-backed mode holds every law a key/value store owes, and declares nothing', async () => {
    const report = await runSessionLifecycleConformance(agentCoreFileHarness);
    expect(formatConformanceReport(report)).toContain('0 FAILED');
    expect(report.declared).toBe(0);
    // Reading, writing, an unreadable session refused rather than answered as
    // absent, opaque ids, its retention sweep, and feature detection.
    expect(report.passed).toBe(6);
    // It keeps no owner index and no listing — six ownership cases, the
    // listing, and `forget`, none of which the port demands of it.
    expect(report.notApplicable).toBe(10);
  });

  it('the event-backed mode holds the same laws, minus the retention it cannot honestly offer', async () => {
    const report = await runSessionLifecycleConformance(agentCoreMemoryHarness);
    expect(formatConformanceReport(report)).toContain('0 FAILED');
    expect(report.declared).toBe(0);
    expect(report.passed).toBe(5);
    expect(report.notApplicable).toBe(11);
    // The one difference between the two modes, asserted rather than implied:
    // this store has no way to delete an event it wrote, so it implements no
    // retention member and the case is n/a — never a sweep that reports zero.
    const retention = report.outcomes.find((o) => o.case.startsWith('retention-'))!;
    expect(retention.status).toBe('not-applicable');
    expect(formatConformanceReport(report)).toContain('no retention() on this store');
  });

  it('no session store in this repository is missing from the roster', () => {
    // The crude guard the original omission needed. `agentCoreSessions` was a
    // shipped `SessionLifecycle` that appeared here zero times and was not
    // declared anywhere — so a factory whose name ends in `Sessions`, exported
    // from either hosting folder, must be NAMED in this file. Cruder than a
    // type-level check and a better guardrail: the failure it catches is
    // somebody adding a store on a Friday and enrolling it "next week".
    const roots = ['src/hosting', 'src/adapters/hosting'];
    const factories = new Set<string>();
    for (const root of roots) {
      const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../..', root);
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
        const text = readFileSync(join(dir, entry.name), 'utf8');
        for (const match of text.matchAll(/^export function (\w*Sessions)\(/gm)) {
          factories.add(match[1]!);
        }
      }
    }
    // If this ever finds nothing, the test would pass vacuously.
    expect(factories.size).toBeGreaterThanOrEqual(5);
    const thisFile = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    for (const factory of factories) {
      expect(thisFile, `${factory} ships and is not enrolled in the battery`).toContain(factory);
    }
  });
});

describe('the declarations are the whole list, and each one is argued', () => {
  it('no store has a declaration this file does not name', () => {
    // A new declaration has to be added HERE, deliberately, beside the reason.
    // That is the difference between a limitation somebody accepted and a
    // failing case somebody silenced on a Friday.
    const declarations = HARNESSES.flatMap((harness) =>
      Object.entries(harness.declared ?? {}).map(([name]) => `${harness.name}: ${name}`),
    );
    expect(declarations).toEqual([
      'agentEngineSessions (fake service): list-by-user-is-newest-first',
      'agentEngineSessions (fake service): ownership-fills-in-on-a-later-signed-turn',
    ]);
  });

  it('every case in the battery is named in the conformance README', () => {
    // Same drift as the ledger, one file over, and found the same way: two cases
    // were added and the README that an out-of-tree adapter author reads as the
    // list of obligations still described fourteen. A battery whose published
    // list is shorter than the battery is a set of obligations somebody will
    // meet in full and still fail.
    const readme = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../src/hosting/conformance/README.md'),
      'utf8',
    );
    for (const testCase of sessionLifecycleConformance) {
      expect(
        readme,
        `the battery holds '${testCase.name}' and the README never names it`,
      ).toContain(testCase.name);
    }
  });

  it('every declared limitation is named in the public status ledger', () => {
    // docs/ADAPTER_STATUS.md is what somebody evaluating an adapter reads INSTEAD
    // of the code, so a limitation the harness declares and the ledger omits is
    // the ledger being wrong in the one direction that flatters us.
    //
    // This test exists because that happened. A mis-attributed limitation was
    // moved OFF the wrong adapter and never onto the right one, so it left the
    // ledger entirely — and the ledger went on asserting a COUNT ('declares one
    // limitation') that its own source of truth contradicted. A correction that
    // deletes a true fact is still a regression.
    const ledger = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/ADAPTER_STATUS.md'),
      'utf8',
    );
    for (const harness of HARNESSES) {
      for (const [name, reason] of Object.entries(harness.declared ?? {})) {
        expect(
          ledger,
          `${harness.name} declares '${name}' (${reason.slice(0, 60)}…) and ` +
            `docs/ADAPTER_STATUS.md never names it. A declaration a reader cannot ` +
            `find in the ledger is a limitation nobody will ever argue with.`,
        ).toContain(name);
      }
    }
  });

  it('every declaration says WHY, in a sentence', () => {
    for (const harness of HARNESSES) {
      for (const [name, reason] of Object.entries(harness.declared ?? {})) {
        expect(reason.length, `${harness.name}/${name} declared with no reason`).toBeGreaterThan(
          30,
        );
      }
    }
  });
});

describe('the battery covers what it claims to', () => {
  it('holds every case the port names, each with a law', () => {
    // A battery that quietly lost a case would pass every store trivially —
    // the same vacuous-pass shape `no-vendor-names` guards against.
    expect(sessionLifecycleConformance.length).toBe(16);
    for (const testCase of sessionLifecycleConformance) {
      expect(testCase.law.length, `${testCase.name} has no law`).toBeGreaterThan(20);
    }
    expect(sessionLifecycleConformance.map((c) => c.name)).toContain(
      'contested-write-leaves-no-split-brain',
    );
  });

  it('a case that cannot run and was not declared FAILS rather than skipping', async () => {
    // The suite's own load-bearing rule, executable. A harness with no
    // `corrupt` hook and no declaration must not quietly report a pass.
    const silent: SessionStoreHarness = {
      name: 'no-corrupt-hook',
      createStore: () => memorySessions(),
    };
    const unreadable = sessionLifecycleConformance.find(
      (c) => c.name === 'unreadable-is-not-absent',
    )!;
    const outcome = await runSessionLifecycleCase(unreadable, silent);
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error.message).toContain('DECLARE this case by name');
    }
  });

  it('a case about an optional member the store lacks is n/a, not a pass', async () => {
    const keyValueOnly: SessionStoreHarness = {
      name: 'two-methods-only',
      createStore: (): SessionLifecycle => {
        const rows = new Map<string, never>();
        return {
          hydrate: (id) => Promise.resolve(rows.get(id)),
          persist: (id, envelope) => {
            rows.set(id, envelope as never);
            return Promise.resolve();
          },
        };
      },
    };
    const owned = sessionLifecycleConformance.find(
      (c) => c.name === 'ownership-is-not-taken-by-a-different-signer',
    )!;
    const outcome = await runSessionLifecycleCase(owned, keyValueOnly);
    expect(outcome.status).toBe('not-applicable');
    // And the two REQUIRED methods are still held to their promises.
    const roundTrip = sessionLifecycleConformance.find(
      (c) => c.name === 'persist-hydrate-round-trip',
    )!;
    expect((await runSessionLifecycleCase(roundTrip, keyValueOnly)).status).toBe('passed');
  });
});

// The temp directory outlives every case, so it is removed once, at the end.
// A file left behind is not a failure worth failing the suite over.
process.on('exit', () => {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
