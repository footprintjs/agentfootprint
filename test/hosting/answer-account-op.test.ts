/**
 * The `answer-account` wire op (explain-answer af-3) — "Explain this answer",
 * served: `{ op: 'answer-account', ref }` returns the answer's plain-words
 * account, computed ON THE SERVER from the recording the ref names.
 *
 * The laws being pinned (design §6.3, §7.4; review R2-S1, R2-S4, R3-S1):
 *   • Opt-in: a host that did not pass `standingAgent({ answerAccounts })`
 *     answers the unknown-op refusal before reading anything.
 *   • Ownership first, on `artifact-get`'s own path: another user, an anonymous
 *     caller, a missing ref and a wrong-kind ref all get the ONE
 *     `ERR_ARTIFACT_NOT_FOUND`; a refused caller emits nothing, reads nothing
 *     and builds no lane.
 *   • R3-S1: the SILENT head runs before the cache, so a swept or expired
 *     recording is "not available" even when its account is cached.
 *   • The ceiling is refused by name before any read of the payload (413).
 *   • Exactly one `artifacts.resolved` fact on a miss (the sinked `get`), none
 *     on a hit, none for a wrong-kind ref; single-flight under concurrency.
 *   • Failed computations are never cached; joined waiters share the outcome.
 *   • Lane-free: the op answers while a run is in flight on the same session.
 *   • The response is the whole allow-listed account within its caps.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Agent, inMemoryArtifacts, recordingPutInput } from '../../src/index.js';
import type { ArtifactMeta, ArtifactScope, ArtifactStore } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, answerAccountPointerKey } from '../../src/observe.js';
import { showLeaves } from '../../src/lib/answer-account/shown.js';
import { ANSWER_ACCOUNT_TEMPLATE_SET_VERSION } from '../../src/lib/answer-account/templates.js';
import {
  answerAccounts,
  ANSWER_ACCOUNT_CACHE_MAX_BYTES,
  deepFreeze,
} from '../../src/hosting/answerAccounts.js';
import { memorySessions, standingAgent } from '../../src/hosting/index.js';
import type {
  AnswerAccountWireBody,
  ArtifactWireResult,
  IngressRecord,
} from '../../src/hosting/index.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';
import {
  ALICE,
  BOB,
  NEVER_MINTED,
  artifactEventsOf,
  fileStory,
  filedOf,
  filingHost,
  gatedProvider,
  harness,
  recordingAgent,
  recordingsOf,
  within,
  withoutRef,
  type Delivered,
  type FilingHost,
} from './turnArtifactsHarness.js';
import {
  deniedLeaves,
  fixtureA,
  FLAGSHIP_RUN_ID,
  NEO_DECLARATIONS,
} from '../lib/answer-account/helpers.js';

const { served, closeAll } = harness();
afterEach(closeAll);

// ─── Helpers ─────────────────────────────────────────────────────────

/** A store that counts the two reads the op may make. */
function countingStore(inner: ArtifactStore = inMemoryArtifacts()) {
  const counts = { head: 0, get: 0 };
  const store: ArtifactStore = {
    ...inner,
    put: (scope, input) => inner.put(scope, input),
    head: (scope, ref) => {
      counts.head += 1;
      return inner.head(scope, ref);
    },
    get: (scope, ref) => {
      counts.get += 1;
      return inner.get(scope, ref);
    },
    delete: (scope, ref) => inner.delete(scope, ref),
    list: (scope, options) => inner.list(scope, options),
  };
  return { store, counts };
}

/** Ask for one answer's account. */
function explain(
  host: FilingHost,
  sessionId: string | undefined,
  ref: string,
  headers?: Readonly<Record<string, string>>,
): Promise<Delivered> {
  return host.deliver({
    ...(sessionId !== undefined && { sessionId }),
    artifact: { op: 'account', ref },
    ...(headers !== undefined && { headers }),
  });
}

/** The `{ account, shown }` a resolved op carries — or a test failure naming what came back. */
function bodyOf(delivered: Delivered): AnswerAccountWireBody {
  const result = delivered.artifact as ArtifactWireResult | undefined;
  if (result?.op !== 'account' || result.answer === undefined) {
    throw new Error(`expected an answer account, got ${JSON.stringify(delivered).slice(0, 300)}`);
  }
  return result.answer;
}

const resolvedFacts = (events: () => { type: string }[]) =>
  events().filter((e) => e.type === 'agentfootprint.artifacts.resolved');

/** One answering turn on `sessionId`; returns the recording ticket it minted. */
async function answeredTurn(
  host: FilingHost,
  recordings: () => { ref: string }[],
  sessionId: string,
  headers?: Readonly<Record<string, string>>,
): Promise<string> {
  const before = recordings().length;
  const turn = await host.deliver({
    input: 'what is on the array?',
    sessionId,
    ...(headers !== undefined && { headers }),
  });
  expect(turn.error).toBeUndefined();
  expect(recordings().length).toBe(before + 1);
  return recordings()[recordings().length - 1]?.ref as string;
}

/** The flagship recording (reduced, every event at its index), put into `store` under a session. */
async function putFlagship(store: ArtifactStore, sessionId: string): Promise<string> {
  const minted = await store.put(
    { conversationId: sessionId },
    recordingPutInput(fixtureA(), { runId: FLAGSHIP_RUN_ID }),
  );
  return minted.meta.ref;
}

/** An agent that serves a store and never needs to run. */
const storeAgent = (store: ArtifactStore) =>
  Agent.create({ provider: mock({ reply: 'ok' }), model: 'm', artifacts: store }).build();

/**
 * A store whose `get` in ONE conversation waits until released — so a test can
 * hold that session's artifact ops in flight while another session is served.
 */
function gatedStore(gatedConversation: string) {
  const inner = inMemoryArtifacts();
  let release: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => (release = resolve));
  let waiting = 0;
  const store: ArtifactStore = {
    ...inner,
    put: (scope, input) => inner.put(scope, input),
    head: (scope, ref) => inner.head(scope, ref),
    get: async (scope, ref) => {
      if (scope.conversationId === gatedConversation) {
        waiting += 1;
        await opened;
      }
      return inner.get(scope, ref);
    },
    delete: (scope, ref) => inner.delete(scope, ref),
    list: (scope, options) => inner.list(scope, options),
  };
  return { store, release: () => release(), waiting: () => waiting };
}

/** A store that tells the truth about everything except `bytes`. */
function underReportingStore(claimed: number) {
  const inner = inMemoryArtifacts();
  const lie = (meta: ArtifactMeta): ArtifactMeta => ({ ...meta, bytes: claimed });
  let gets = 0;
  const store: ArtifactStore = {
    ...inner,
    put: (scope, input) => inner.put(scope, input),
    head: async (scope: ArtifactScope, ref) => {
      const meta = await inner.head(scope, ref);
      return meta === null ? null : lie(meta);
    },
    get: async (scope: ArtifactScope, ref) => {
      gets += 1;
      const record = await inner.get(scope, ref);
      return record === null ? null : { ...record, meta: lie(record.meta) };
    },
    delete: (scope, ref) => inner.delete(scope, ref),
    list: (scope, options) => inner.list(scope, options),
  };
  return { store, gets: () => gets };
}

/** Wait until `check()` holds, or fail after ~2 s. */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
}

// ─── The opt-in ──────────────────────────────────────────────────────

describe('answer-account — the opt-in', () => {
  it('a host that did not opt in answers the unknown-op refusal before reading anything', async () => {
    const { store, counts } = countingStore();
    const agent = storeAgent(store);
    const events = artifactEventsOf(agent);
    const { host } = await served(agent);
    const ref = await putFlagship(store, 's-1');

    const got = await explain(host, 's-1', ref);
    expect(got.code).toBe('ERR_INVALID_WIRE_OP');
    expect(got.error).toContain(`'answer-account'`);
    expect(got.error).toContain('answerAccounts');
    expect(counts).toEqual({ head: 0, get: 0 });
    expect(events()).toHaveLength(0);
  });

  it('refuses a half-spelled answerAccounts at boot, before a socket exists', async () => {
    const boot = (answer: unknown) =>
      standingAgent({
        agent: storeAgent(inMemoryArtifacts()),
        sessions: memorySessions(),
        host: filingHost(),
        answerAccounts: answer as never,
      });
    await expect(boot({ maxRecordingBytes: 0 })).rejects.toThrow(/maxRecordingBytes/);
    await expect(boot({ maxRecordingBytes: Number.POSITIVE_INFINITY })).rejects.toThrow(
      /maxRecordingBytes/,
    );
    await expect(boot({ cacheEntries: -1 })).rejects.toThrow(/cacheEntries/);
    await expect(boot({ cacheEntries: 1.5 })).rejects.toThrow(/cacheEntries/);
    await expect(boot({ declarations: { skills: { x: { label: '' } } } })).rejects.toThrow(
      /declarations/,
    );
    await expect(boot({ declaration: {} })).rejects.toThrow(/unknown key "declaration"/);
    await expect(boot('yes')).rejects.toThrow(/answerAccounts/);
  });

  it('`answerAccounts: true` opts in with every default', async () => {
    const store = inMemoryArtifacts();
    const { host } = await served(storeAgent(store), { extra: { answerAccounts: true } });
    const ref = await putFlagship(store, 's-1');
    const body = bodyOf(await explain(host, 's-1', ref));
    expect(body.account.kind).toBe('agentfootprint/answer-account');
  });
});

// ─── Ownership — the sibling's path, unchanged ──────────────────────

describe('answer-account — ownership (security)', () => {
  it('another user, an anonymous caller and a missing ref all get the ONE not-found — nothing read, nothing emitted', async () => {
    const { store, counts } = countingStore();
    const agent = recordingAgent(store);
    const recordings = recordingsOf(agent);
    const events = artifactEventsOf(agent);
    const { host } = await served(agent, {
      verify: true,
      allowAnonymous: true,
      extra: { answerAccounts: {} },
    });
    const ref = await answeredTurn(host, recordings, 'sA', ALICE);
    const eventsBefore = events().length;
    const readsBefore = { ...counts };

    const bob = await explain(host, 'sA', ref, BOB);
    const anonymous = await explain(host, 'sA', ref);
    const bobOwnSession = await explain(host, 'sB', ref, BOB);
    expect(bob.code).toBe('ERR_ARTIFACT_NOT_FOUND');
    expect(anonymous.code).toBe('ERR_ARTIFACT_NOT_FOUND');
    expect(bobOwnSession.code).toBe('ERR_ARTIFACT_NOT_FOUND');
    expect(counts).toEqual(readsBefore);
    expect(events().length).toBe(eventsBefore);

    // Same bytes as a ref that never existed, asked by the owner.
    const missing = await explain(host, 'sA', NEVER_MINTED, ALICE);
    expect(withoutRef(bob, ref)).toEqual(withoutRef(missing, NEVER_MINTED));
    expect(withoutRef(anonymous, ref)).toEqual(withoutRef(missing, NEVER_MINTED));

    // …and the owner is served.
    expect(bodyOf(await explain(host, 'sA', ref, ALICE)).account.kind).toBe(
      'agentfootprint/answer-account',
    );
  });

  it('a request with no session is taught (400), naming the op — not a 404', async () => {
    const store = inMemoryArtifacts();
    const { host } = await served(storeAgent(store), { extra: { answerAccounts: {} } });
    const got = await explain(host, undefined, NEVER_MINTED);
    expect(got.code).toBe('ERR_ARTIFACT_SESSION_REQUIRED');
    expect(got.error).toContain('answer-account');
  });

  it('a ref that is not a ref is refused (400) naming answer-account, the text never echoed', async () => {
    const { store, counts } = countingStore();
    const { host } = await served(storeAgent(store), { extra: { answerAccounts: {} } });
    const probe = 'run-1790361930311-2 OR 1=1';
    const got = await explain(host, 's-1', probe);
    expect(got.code).toBe('ERR_INVALID_WIRE_OP');
    expect(got.error).toContain(`'answer-account'`);
    expect(got.error).not.toContain(probe);
    expect(counts).toEqual({ head: 0, get: 0 });
  });

  it('a refused caller builds no lane: the factory is never called for them', async () => {
    const store = inMemoryArtifacts();
    let made = 0;
    const agentFactory = () => {
      made += 1;
      return recordingAgent(store);
    };
    const { host } = await served(
      { agentFactory },
      { verify: true, extra: { answerAccounts: {} } },
    );
    // Alice's turn builds her lane.
    const first = await host.deliver({ input: 'hi', sessionId: 'sA', headers: ALICE });
    expect(first.error).toBeUndefined();
    expect(made).toBe(1);

    const intoAlice = await explain(host, 'sA', NEVER_MINTED, BOB);
    const intoNobody = await explain(host, 's-nobody', NEVER_MINTED, BOB);
    expect(intoAlice.code).toBe('ERR_ARTIFACT_NOT_FOUND');
    expect(intoNobody.code).toBe('ERR_ARTIFACT_NOT_FOUND');
    expect(made).toBe(1);
  });

  it('a cached account is never served before the ownership check', async () => {
    const agent = recordingAgent(inMemoryArtifacts());
    const recordings = recordingsOf(agent);
    const { host } = await served(agent, { verify: true, extra: { answerAccounts: {} } });
    const ref = await answeredTurn(host, recordings, 'sA', ALICE);
    bodyOf(await explain(host, 'sA', ref, ALICE)); // now cached
    const bob = await explain(host, 'sA', ref, BOB);
    expect(bob.code).toBe('ERR_ARTIFACT_NOT_FOUND');
    expect(bob.artifact).toBeUndefined();
  });
});

// ─── The record: kind, size, readability ────────────────────────────

describe('answer-account — the record', () => {
  it('the owner gets { account, shown }, equal to accountForAnswer over the same recording', async () => {
    const store = inMemoryArtifacts();
    const { host } = await served(storeAgent(store), {
      extra: { answerAccounts: { declarations: NEO_DECLARATIONS } },
    });
    const ref = await putFlagship(store, 's-flag');
    const body = bodyOf(await explain(host, 's-flag', ref));

    const recording = fixtureA() as unknown as Recording;
    const expected = accountForAnswer(recording, NEO_DECLARATIONS, { runId: FLAGSHIP_RUN_ID });
    expect(JSON.parse(JSON.stringify(body.account))).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(body.shown).toEqual(showLeaves(expected, recording, NEO_DECLARATIONS));
    expect(body.account.summary.tone).toBe('warn');
  });

  it('a wrong-kind ref (a story the host filed) is the ONE not-found, and nothing is emitted', async () => {
    const agent = recordingAgent(inMemoryArtifacts());
    const events = artifactEventsOf(agent);
    const { host } = await served(agent, { extra: { answerAccounts: {} } });
    const story = filedOf(
      await host.deliver({ input: 'hi', sessionId: 'sA', onTurn: fileStory() }),
    );
    const before = events().length;

    const got = await explain(host, 'sA', story.ref);
    const missing = await explain(host, 'sA', NEVER_MINTED);
    expect(got.code).toBe('ERR_ARTIFACT_NOT_FOUND');
    expect(withoutRef(got, story.ref)).toEqual(withoutRef(missing, NEVER_MINTED));
    expect(events().length).toBe(before);
  });

  it('over the ceiling: 413 ERR_RECORDING_TOO_LARGE_FOR_ACCOUNT, the payload never read, nothing emitted, not cached', async () => {
    const { store, counts } = countingStore();
    const agent = storeAgent(store);
    const events = artifactEventsOf(agent);
    const { host } = await served(agent, {
      extra: { answerAccounts: { maxRecordingBytes: 1_000 } },
    });
    const ref = await putFlagship(store, 's-1');

    const first = await explain(host, 's-1', ref);
    const second = await explain(host, 's-1', ref);
    for (const got of [first, second]) {
      expect(got.code).toBe('ERR_RECORDING_TOO_LARGE_FOR_ACCOUNT');
      expect(got.error).toContain('1000 bytes');
      expect(got.error).not.toContain('array');
    }
    expect(counts.get).toBe(0);
    expect(counts.head).toBe(2);
    expect(events()).toHaveLength(0);
  });

  it('a store that UNDER-REPORTS bytes: the payload’s real size is refused (413) before any parse, and never cached', async () => {
    const { store, gets } = underReportingStore(10);
    const { host } = await served(storeAgent(store), {
      extra: { answerAccounts: { maxRecordingBytes: 1_000 } },
    });
    const ref = await putFlagship(store, 's-1');
    const parse = vi.spyOn(JSON, 'parse');
    try {
      const replies = await Promise.all([explain(host, 's-1', ref), explain(host, 's-1', ref)]);
      for (const got of replies) {
        expect(got.code).toBe('ERR_RECORDING_TOO_LARGE_FOR_ACCOUNT');
        expect(got.error).toContain('1000 bytes');
      }
      // Joined: one read. And nothing over the ceiling ever reached JSON.parse.
      expect(gets()).toBe(1);
      const bigParses = parse.mock.calls.filter(
        ([text]) => typeof text === 'string' && text.length > 1_000,
      );
      expect(bigParses).toHaveLength(0);
    } finally {
      parse.mockRestore();
    }
    // Not cached: the next request reads again.
    expect((await explain(host, 's-1', ref)).code).toBe('ERR_RECORDING_TOO_LARGE_FOR_ACCOUNT');
    expect(gets()).toBe(2);
  });

  it('an unreadable recording is the one not-found, and is never cached', async () => {
    const { store, counts } = countingStore();
    const { host } = await served(storeAgent(store), { extra: { answerAccounts: {} } });
    const minted = await store.put(
      { conversationId: 's-1' },
      { kind: 'recording/run', mediaType: 'application/json', data: '{"snapshot": [trunc' },
    );
    const ref = minted.meta.ref;
    const first = await explain(host, 's-1', ref);
    const second = await explain(host, 's-1', ref);
    expect(first.code).toBe('ERR_ARTIFACT_NOT_FOUND');
    expect(second.code).toBe('ERR_ARTIFACT_NOT_FOUND');
    // Each request tried again: a failure is not a cache entry.
    expect(counts.get).toBe(2);
  });

  it('a recording that parses but is not an object is the one not-found too', async () => {
    const store = inMemoryArtifacts();
    const { host } = await served(storeAgent(store), { extra: { answerAccounts: {} } });
    const minted = await store.put(
      { conversationId: 's-1' },
      { kind: 'recording/run', mediaType: 'application/json', data: '42' },
    );
    expect((await explain(host, 's-1', minted.meta.ref)).code).toBe('ERR_ARTIFACT_NOT_FOUND');
  });

  it('the ingress record names the op by its wire spelling', async () => {
    const store = inMemoryArtifacts();
    const records: IngressRecord[] = [];
    const { host } = await served(storeAgent(store), {
      extra: { answerAccounts: {}, onIngressDecision: (record) => records.push(record) },
    });
    const ref = await putFlagship(store, 's-1');
    bodyOf(await explain(host, 's-1', ref));
    await explain(host, 's-1', NEVER_MINTED);
    expect(records.map((r) => [r.door, r.op])).toEqual([
      ['artifact', 'answer-account'],
      ['artifact', 'answer-account'],
    ]);
  });

  it('an agent with no store is the teaching refusal, naming answer-account (501)', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build();
    const { host } = await served(agent, { extra: { answerAccounts: {} } });
    const got = await explain(host, 's-1', NEVER_MINTED);
    expect(got.code).toBe('ERR_NO_ARTIFACT_STORE');
    expect(got.error).toContain('answer-account');
  });
});

// ─── Cache, single-flight, and the one door fact ────────────────────

describe('answer-account — the cache and the one fact', () => {
  it('a miss emits exactly one artifacts.resolved (get), stamped with the caller’s session; a hit emits none', async () => {
    const { store, counts } = countingStore();
    const agent = recordingAgent(store);
    const recordings = recordingsOf(agent);
    const events = artifactEventsOf(agent);
    const { host } = await served(agent, { extra: { answerAccounts: {} } });
    const ref = await answeredTurn(host, recordings, 'sA');
    const before = resolvedFacts(events).length;
    const getsBefore = counts.get;

    const miss = bodyOf(await explain(host, 'sA', ref));
    const facts = resolvedFacts(events).slice(before);
    expect(facts).toHaveLength(1);
    const fact = facts[0] as unknown as {
      payload: Record<string, unknown>;
      meta: { sessionId?: string };
    };
    expect(fact.payload).toMatchObject({ ref, via: 'get', kind: 'recording/run' });
    expect(fact.payload.tool).toBeUndefined();
    expect(fact.meta.sessionId).toBe('sA');
    expect(counts.get - getsBefore).toBe(1);

    const hit = bodyOf(await explain(host, 'sA', ref));
    expect(resolvedFacts(events).slice(before)).toHaveLength(1);
    expect(counts.get - getsBefore).toBe(1);
    expect(hit).toEqual(miss);
  });

  it('ten concurrent requests → one store read, one fact, ten equal accounts', async () => {
    const { store, counts } = countingStore();
    const agent = storeAgent(store);
    const events = artifactEventsOf(agent);
    const { host } = await served(agent, {
      // Above the per-session in-flight bound's default (8): this pins the join.
      extra: { answerAccounts: {}, artifactOpsPerSession: 16 },
    });
    const ref = await putFlagship(store, 's-1');

    const replies = await Promise.all(Array.from({ length: 10 }, () => explain(host, 's-1', ref)));
    const bodies = replies.map(bodyOf);
    expect(counts.get).toBe(1);
    expect(resolvedFacts(events)).toHaveLength(1);
    for (const body of bodies) expect(body).toEqual(bodies[0]);
  });

  it('joined waiters of a failed computation all get the not-found; the next request tries again', async () => {
    const { store, counts } = countingStore();
    const { host } = await served(storeAgent(store), { extra: { answerAccounts: {} } });
    const minted = await store.put(
      { conversationId: 's-1' },
      { kind: 'recording/run', mediaType: 'application/json', data: 'not json' },
    );
    const replies = await Promise.all(
      Array.from({ length: 5 }, () => explain(host, 's-1', minted.meta.ref)),
    );
    for (const got of replies) expect(got.code).toBe('ERR_ARTIFACT_NOT_FOUND');
    expect(counts.get).toBe(1);
    await explain(host, 's-1', minted.meta.ref);
    expect(counts.get).toBe(2);
  });

  it('R3-S1: a cached account for a SWEPT recording answers not available', async () => {
    const store = inMemoryArtifacts();
    const { host } = await served(storeAgent(store), { extra: { answerAccounts: {} } });
    const ref = await putFlagship(store, 's-1');
    bodyOf(await explain(host, 's-1', ref)); // cached
    await store.delete({ conversationId: 's-1' }, ref);
    const got = await explain(host, 's-1', ref);
    expect(got.code).toBe('ERR_ARTIFACT_NOT_FOUND');
    expect(got.artifact).toBeUndefined();
  });

  it('R3-S1: a cached account for an EXPIRED recording answers not available', async () => {
    let now = 1_000_000;
    const store = inMemoryArtifacts({ retention: { ttlMs: 60_000 }, _now: () => now });
    const { host } = await served(storeAgent(store), { extra: { answerAccounts: {} } });
    const ref = await putFlagship(store, 's-1');
    bodyOf(await explain(host, 's-1', ref)); // cached
    now += 61_000;
    expect((await explain(host, 's-1', ref)).code).toBe('ERR_ARTIFACT_NOT_FOUND');
  });

  it('cacheEntries: 0 keeps single-flight and caches nothing — each request is a miss with its one fact', async () => {
    const { store, counts } = countingStore();
    const agent = storeAgent(store);
    const events = artifactEventsOf(agent);
    const { host } = await served(agent, { extra: { answerAccounts: { cacheEntries: 0 } } });
    const ref = await putFlagship(store, 's-1');
    bodyOf(await explain(host, 's-1', ref));
    bodyOf(await explain(host, 's-1', ref));
    expect(counts.get).toBe(2);
    expect(resolvedFacts(events)).toHaveLength(2);
  });
});

// ─── The cache, as a unit ───────────────────────────────────────────

describe('answerAccounts — the cache key and the bounds (unit)', () => {
  const scope = { conversationId: 's-1' };
  const ref = NEVER_MINTED;

  it('the key moves with the scope, the ref, the template-set version and the declarations digest', () => {
    const plain = answerAccounts({});
    const declared = answerAccounts({ declarations: NEO_DECLARATIONS });
    const base = plain.keyFor(scope, ref);
    expect(base).toContain(`@${ANSWER_ACCOUNT_TEMPLATE_SET_VERSION}`);
    expect(plain.keyFor(scope, ref)).toBe(base);
    expect(plain.keyFor({ conversationId: 's-2' }, ref)).not.toBe(base);
    expect(plain.keyFor({ ...scope, principal: 'alice' }, ref)).not.toBe(base);
    expect(plain.keyFor(scope, `art_${'Y'.repeat(22)}`)).not.toBe(base);
    expect(declared.keyFor(scope, ref)).not.toBe(base);
    // The digest is of the declarations' CONTENT, not of the object's key order.
    const reordered = answerAccounts({
      declarations: {
        routing: { appDecides: true },
        tools: { powerstore_get_volumes: { rowsAt: 'volumes' } },
        skills: { 'array-inventory': { label: 'array estate report' } },
        version: '1',
        id: 'neo-seo',
      },
    });
    expect(reordered.keyFor(scope, ref)).toBe(declared.keyFor(scope, ref));
    // A tuple field that looks like a separator cannot forge another key.
    expect(plain.keyFor({ conversationId: 'a', principal: 'b' }, ref)).not.toBe(
      plain.keyFor({ conversationId: 'a","b' }, ref),
    );
  });

  it('evicts the least recently used past cacheEntries', async () => {
    const service = answerAccounts({ cacheEntries: 2 });
    const load = () =>
      Promise.resolve({ data: JSON.stringify(fixtureA()), runId: FLAGSHIP_RUN_ID });
    await service.compute('k1', load);
    await service.compute('k2', load);
    expect(service.cached('k1')).toBeDefined(); // k1 now most recent
    await service.compute('k3', load);
    expect(service.cached('k2')).toBeUndefined();
    expect(service.cached('k1')).toBeDefined();
    expect(service.cached('k3')).toBeDefined();
  });

  it('a cached answer is frozen — one reader cannot edit what the next is served', async () => {
    const service = answerAccounts({});
    await service.compute('k', () =>
      Promise.resolve({ data: JSON.stringify(fixtureA()), runId: FLAGSHIP_RUN_ID }),
    );
    const cached = service.cached('k') as AnswerAccountWireBody;
    expect(Object.isFrozen(cached.account)).toBe(true);
    expect(Object.isFrozen(cached.account.summary.sentence)).toBe(true);
    expect(() => {
      (cached.account as { unread: number }).unread = 99;
    }).toThrow(TypeError);
  });

  it('deepFreeze recurses into an object that is already (shallowly) frozen, and ends a cycle', () => {
    const inner = { editable: 1 };
    const shallow = Object.freeze({ inner });
    const cyclic: Record<string, unknown> = { shallow };
    cyclic.self = cyclic;
    deepFreeze(cyclic);
    expect(Object.isFrozen(cyclic)).toBe(true);
    expect(Object.isFrozen(inner)).toBe(true);
    expect(() => {
      inner.editable = 2;
    }).toThrow(TypeError);
  });

  it('bounds the whole cache by bytes too', () => {
    expect(ANSWER_ACCOUNT_CACHE_MAX_BYTES).toBe(8 * 1024 * 1024);
  });
});

// ─── The per-session in-flight bound (artifact ops together) ────────

describe('artifact ops — a per-session in-flight bound (429)', () => {
  it('over the bound, ONE session is refused by name while another session is served', async () => {
    const gate = gatedStore('s-busy');
    const { host } = await served(storeAgent(gate.store), {
      extra: { answerAccounts: {}, artifactOpsPerSession: 2 },
    });
    const busyRef = await putFlagship(gate.store, 's-busy');
    const calmRef = await putFlagship(gate.store, 's-calm');

    // Two ops in flight on s-busy — one get, one account — held at the store.
    const held = [
      host.deliver({ sessionId: 's-busy', artifact: { op: 'get', ref: busyRef } }),
      explain(host, 's-busy', busyRef),
    ];
    await until(() => gate.waiting() === 2);

    // A third, of any kind — head included — is refused, and names no session.
    for (const op of ['head', 'get', 'account'] as const) {
      const over = await host.deliver({ sessionId: 's-busy', artifact: { op, ref: busyRef } });
      expect(over.code).toBe('ERR_ARTIFACT_OPS_BUSY');
      expect(over.error).toContain('artifactOpsPerSession');
      expect(over.error).not.toContain('s-busy');
    }
    // Another session is served meanwhile.
    expect(bodyOf(await explain(host, 's-calm', calmRef)).account.kind).toBe(
      'agentfootprint/answer-account',
    );

    gate.release();
    const [got, account] = await Promise.all(held);
    expect(got.error).toBeUndefined();
    expect(bodyOf(account).account.kind).toBe('agentfootprint/answer-account');
    // The slots came back: s-busy is served again.
    const again = await host.deliver({
      sessionId: 's-busy',
      artifact: { op: 'head', ref: busyRef },
    });
    expect(again.error).toBeUndefined();
  });

  it('a caller refused at ownership spends no slot and is told not-found, never busy', async () => {
    const gate = gatedStore('sA');
    const agent = recordingAgent(gate.store);
    const recordings = recordingsOf(agent);
    const { host } = await served(agent, {
      verify: true,
      extra: { answerAccounts: {}, artifactOpsPerSession: 1 },
    });
    const ref = await answeredTurn(host, recordings, 'sA', ALICE);
    const alice = explain(host, 'sA', ref, ALICE);
    await until(() => gate.waiting() === 1);
    const bob = await explain(host, 'sA', ref, BOB);
    expect(bob.code).toBe('ERR_ARTIFACT_NOT_FOUND');
    gate.release();
    expect(bodyOf(await alice).account.kind).toBe('agentfootprint/answer-account');
  });

  it('refuses a bound that cannot mean anything at boot; Infinity is the explicit “no bound”', async () => {
    const boot = (value: number) =>
      standingAgent({
        agent: storeAgent(inMemoryArtifacts()),
        sessions: memorySessions(),
        host: filingHost(),
        artifactOpsPerSession: value,
      });
    await expect(boot(0)).rejects.toThrow(/artifactOpsPerSession/);
    await expect(boot(1.5)).rejects.toThrow(/artifactOpsPerSession/);
    await expect(boot(Number.NaN)).rejects.toThrow(/artifactOpsPerSession/);
    const unbounded = await boot(Number.POSITIVE_INFINITY);
    await unbounded.close();
  });
});

// ─── Lane-free ───────────────────────────────────────────────────────

describe('answer-account — never queued behind a run', () => {
  it('answers while a run is in flight on the SAME session', async () => {
    const gate = gatedProvider('ok');
    const agent = recordingAgent(inMemoryArtifacts(), gate.provider);
    const recordings = recordingsOf(agent);
    const { host } = await served(agent, { extra: { answerAccounts: {} } });
    const ref = await answeredTurn(host, recordings, 'sA');

    const held = gate.arm();
    const running = host.deliver({ input: 'second question', sessionId: 'sA' });
    await held.started;
    try {
      const got = await within(explain(host, 'sA', ref), 2_000);
      // Settled while the run is still held — it never queued behind it.
      expect(got.settled).toBe(true);
      if (got.settled) expect(bodyOf(got.value).account.kind).toBe('agentfootprint/answer-account');
    } finally {
      held.release();
    }
    expect((await running).error).toBeUndefined();
  });
});

// ─── The response: allow-listed and bounded ─────────────────────────

describe('answer-account — the response is allow-listed and bounded', () => {
  it('the flagship response carries no denied leaf and stays within its caps', async () => {
    const store = inMemoryArtifacts();
    const { host } = await served(storeAgent(store), {
      extra: { answerAccounts: { declarations: NEO_DECLARATIONS } },
    });
    const ref = await putFlagship(store, 's-flag');
    const body = bodyOf(await explain(host, 's-flag', ref));
    const text = JSON.stringify(body);
    expect(JSON.stringify(body.account).length).toBeLessThanOrEqual(128 * 1024);
    expect(JSON.stringify(body.shown).length).toBeLessThanOrEqual(64 * 1024);
    expect(text.length).toBeLessThanOrEqual(192 * 1024);
    const denied = deniedLeaves(fixtureA() as unknown as Recording, NEO_DECLARATIONS);
    expect(denied.length).toBeGreaterThan(0);
    for (const leaf of denied) {
      expect(text.includes(JSON.stringify(leaf).slice(1, -1)), leaf.slice(0, 80)).toBe(false);
    }
    // Exactly two keys leave: the account and its show-me leaves.
    expect(Object.keys(body).sort()).toEqual(['account', 'shown']);
  });

  it('every pointer a row prints is found in `shown` under answerAccountPointerKey — the key the lens uses', async () => {
    const store = inMemoryArtifacts();
    const { host } = await served(storeAgent(store), {
      extra: { answerAccounts: { declarations: NEO_DECLARATIONS } },
    });
    const ref = await putFlagship(store, 's-flag');
    const body = bodyOf(await explain(host, 's-flag', ref));
    let looked = 0;
    for (const row of body.account.rows) {
      for (const line of [row.heading, ...row.lines, ...(row.more ? [row.more] : [])]) {
        for (const pointer of line.pointers) {
          looked += 1;
          expect(
            body.shown[answerAccountPointerKey(pointer)],
            JSON.stringify(pointer),
          ).toBeDefined();
        }
      }
    }
    expect(looked).toBeGreaterThan(10);
  });
});

// ─── The fence: the op reaches the account and nothing that calls a model ──

describe('answer-account — the import fence (no model is called)', () => {
  it('hosting/answerAccounts imports only the account folder, the artifact types and node:crypto', () => {
    const source = readFileSync(resolve(__dirname, '../../src/hosting/answerAccounts.ts'), 'utf8');
    const imports = [...source.matchAll(/^import[^;]*?from '([^']+)';/gms)].map((m) => m[1]);
    expect(imports.sort()).toEqual(
      [
        '../artifacts/types.js',
        '../lib/answer-account/account.js',
        '../lib/answer-account/declarations.js',
        '../lib/answer-account/shown.js',
        '../lib/answer-account/templates.js',
        '../lib/answer-account/types.js',
        '../recorders/observability/recordRun.js',
        './artifactWire.js',
        './errors.js',
        'node:crypto',
      ].sort(),
    );
  });
});
