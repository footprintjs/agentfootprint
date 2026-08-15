/**
 * agentEngineSessions — the laws, not the plumbing.
 *
 * The plumbing (which methods are called, against the really-installed SDK) is
 * `google-surface-pin.test.ts`. What is here is the behaviour a session store
 * has to get right or lose somebody's conversation:
 *
 *   • an absent session and an UNREADABLE one are different facts, and only one
 *     of them may hydrate as `undefined`;
 *   • a write is not finished until the service says the operation is done;
 *   • **state is written by APPENDING AN EVENT, never by patching** — the law a
 *     field trial bought at the cost of a release (see below);
 *   • the SDK's own failure text never reaches the caller.
 *
 * ── The regression these tests exist to prevent ─────────────────────────────
 * 9.29.0 persisted with `sessions.patch({ updateMask: 'sessionState,ttl' })`.
 * Every test passed, because a double patches whatever it is handed. An
 * independent trial ran it against the live service (2026-08-14): the first
 * turn of a conversation stored, and every turn after it failed with
 *
 *   HTTP 400 — "Can't update the session state for session …, you can only
 *               update it by appending an event."
 *
 * So the double in this file no longer accepts a patch. `sessions.patch`
 * THROWS the service's own refusal shape, and the write tests assert the
 * adapter never reaches for it — which is the only way a suite of doubles can
 * hold a rule that lives on the server.
 *
 * Nothing here reaches Google or needs a credential.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  agentEngineSessions,
  DEFAULT_USER_ID,
  SESSION_STATE_KEY,
  SESSION_ID_KEY,
} from '../../../src/adapters/hosting/googleAgentEngine.js';
import { toEnvelope, UnreadableEnvelopeError } from '../../../src/hosting/index.js';
import type { CheckpointEnvelope } from '../../../src/hosting/index.js';
import type { AgentRunCheckpoint } from '../../../src/core/runCheckpoint.js';

// ── Fixtures ────────────────────────────────────────────────────────

function conversation(text: string, principal?: string): AgentRunCheckpoint {
  return {
    version: 1,
    runId: `run-${text.replace(/\W+/g, '-')}`,
    history: [
      { role: 'user', content: text },
      { role: 'assistant', content: `re: ${text}` },
    ],
    lastCompletedIteration: 1,
    originalInput: { message: text },
    checkpointedAt: 1_700_000_000_000,
    ...(principal !== undefined && { identity: { principal } }),
  } as AgentRunCheckpoint;
}

interface Call {
  readonly op: string;
  readonly params: Record<string, unknown>;
}

/**
 * The live service's refusal of a `sessionState` patch, in the shape a Gaxios
 * error arrives in. Quoted from the field trial's raw diagnostic.
 */
const PATCH_REFUSED = {
  code: 400,
  message:
    "Can't update the session state for session s1, you can only update it by appending an event.",
};

/** A double that records every call and answers from a tiny in-memory table. */
function fakeVertex(
  options: {
    sessions?: Record<string, Record<string, unknown>>;
    onPatch?: (params: Record<string, unknown>) => unknown;
    onAppend?: (params: Record<string, unknown>) => unknown;
    onCreate?: (params: Record<string, unknown>) => unknown;
    onGet?: (params: Record<string, unknown>) => unknown;
    onList?: (params: Record<string, unknown>) => unknown;
    onWait?: (params: Record<string, unknown>) => unknown;
    onDelete?: (params: Record<string, unknown>) => unknown;
  } = {},
) {
  const calls: Call[] = [];
  const store = options.sessions ?? {};
  const record =
    (op: string, handler?: (p: Record<string, unknown>) => unknown, fallback?: unknown) =>
    (params: Record<string, unknown>): Promise<unknown> => {
      calls.push({ op, params });
      if (handler) return Promise.resolve(handler(params));
      return Promise.resolve(fallback ?? {});
    };

  const notFound = (): never => {
    throw { code: 404 };
  };

  const client = {
    projects: {
      locations: {
        reasoningEngines: {
          sessions: {
            get: record('get', options.onGet, undefined) as never,
            // Answers what the LIVE service answers: state cannot be patched.
            patch: record(
              'patch',
              options.onPatch ??
                (() => {
                  throw PATCH_REFUSED;
                }),
              undefined,
            ) as never,
            appendEvent: record('appendEvent', options.onAppend, { data: {} }) as never,
            create: record('create', options.onCreate, { data: { done: true } }) as never,
            delete: record('delete', options.onDelete, { data: { done: true } }) as never,
            list: record('list', options.onList, { data: { sessions: [] } }) as never,
            operations: { wait: record('wait', options.onWait, { data: { done: true } }) as never },
          },
          memories: {} as never,
        },
      },
    },
  };

  // Default get/patch behaviour: read/write the little table.
  if (!options.onGet) {
    client.projects.locations.reasoningEngines.sessions.get = ((
      params: Record<string, unknown>,
    ) => {
      calls.push({ op: 'get', params });
      const found = store[String(params['name'])];
      if (found === undefined) return Promise.resolve(notFound());
      return Promise.resolve({ data: found });
    }) as never;
  }
  // Default appendEvent: the service's own semantics as the trial observed
  // them — no such session is a 404, and `actions.stateDelta` MERGES into
  // `sessionState` by top-level key rather than replacing the struct.
  if (!options.onAppend) {
    client.projects.locations.reasoningEngines.sessions.appendEvent = ((
      params: Record<string, unknown>,
    ) => {
      calls.push({ op: 'appendEvent', params });
      const name = String(params['name']);
      const session = store[name];
      if (session === undefined) return Promise.resolve(notFound());
      const event = params['requestBody'] as {
        actions?: { stateDelta?: Record<string, unknown> };
      };
      store[name] = {
        ...session,
        sessionState: {
          ...((session['sessionState'] as Record<string, unknown>) ?? {}),
          ...(event.actions?.stateDelta ?? {}),
        },
      };
      return Promise.resolve({ data: {} });
    }) as never;
  }
  if (!options.onCreate) {
    client.projects.locations.reasoningEngines.sessions.create = ((
      params: Record<string, unknown>,
    ) => {
      calls.push({ op: 'create', params });
      const name = `${String(params['parent'])}/sessions/${String(params['sessionId'])}`;
      store[name] = { name, ...(params['requestBody'] as object) };
      return Promise.resolve({ data: { name: 'op/1', done: true } });
    }) as never;
  }

  return { client: client as never, calls, store, ops: () => calls.map((c) => c.op) };
}

const CONNECTION = { project: 'p', location: 'us-central1', reasoningEngine: 'engine-1' } as const;
const NAME = 'projects/p/locations/us-central1/reasoningEngines/engine-1/sessions/s1';

// ── The reading law ─────────────────────────────────────────────────

describe('an absent session and an unreadable one are different facts', () => {
  it('a session that was never written hydrates as undefined', async () => {
    const fake = fakeVertex();
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await expect(sessions.hydrate('never-written')).resolves.toBeUndefined();
  });

  it('a session that exists but holds no state of ours hydrates as undefined', async () => {
    // Somebody else's session under the same engine. Nothing here ever claimed
    // to be one of our conversations, so it is an absence.
    const fake = fakeVertex({ sessions: { [NAME]: { name: NAME, sessionState: { other: 1 } } } });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await expect(sessions.hydrate('s1')).resolves.toBeUndefined();
  });

  it('a session holding something that is NOT an envelope is refused by name', async () => {
    const fake = fakeVertex({
      sessions: {
        [NAME]: { name: NAME, sessionState: { [SESSION_STATE_KEY]: 'a string, somehow' } },
      },
    });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    // NOT `undefined`: a conversation exists here and this runtime cannot read
    // it. Answering with a fresh start would be indistinguishable, from the
    // outside, from a brand-new user.
    await expect(sessions.hydrate('s1')).rejects.toBeInstanceOf(UnreadableEnvelopeError);
  });

  it('an envelope whose format this runtime does not know is refused, never half-read', async () => {
    const fake = fakeVertex({
      sessions: {
        [NAME]: {
          name: NAME,
          sessionState: {
            [SESSION_STATE_KEY]: { format: 'conversation-v9', data: {}, savedAt: 1 },
          },
        },
      },
    });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await expect(sessions.hydrate('s1')).rejects.toThrow(/format/i);
  });

  it('validates on the way IN too — a row it could not read back is never written', async () => {
    const fake = fakeVertex();
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await expect(
      sessions.persist('s1', { format: 'nonsense-v1', data: {}, savedAt: 1 } as never),
    ).rejects.toThrow();
    // Nothing reached the service at all.
    expect(fake.ops()).toEqual([]);
  });

  it('round-trips a conversation unchanged', async () => {
    const fake = fakeVertex();
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    const envelope = toEnvelope(conversation('hello'));
    await sessions.persist('s1', envelope);
    const back = await sessions.hydrate('s1');
    expect(back).toEqual(envelope);
  });
});

// ── The write law ───────────────────────────────────────────────────

describe('a write is not finished until the operation is', () => {
  it('waits on an un-done operation and stops when it reports done', async () => {
    let waits = 0;
    const fake = fakeVertex({
      onCreate: () => ({ data: { name: 'operations/abc', done: false } }),
      onWait: () => ({ data: { name: 'operations/abc', done: ++waits >= 2 } }),
    });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await sessions.persist('s1', toEnvelope(conversation('hi')));
    expect(waits).toBe(2);
    expect(fake.ops()).toEqual(['appendEvent', 'create', 'wait', 'wait']);
  });

  it('refuses rather than reporting a success it never saw land', async () => {
    const fake = fakeVertex({
      onCreate: () => ({ data: { name: 'operations/abc', done: false } }),
      onWait: () => ({ data: { name: 'operations/abc', done: false } }),
    });
    const sessions = agentEngineSessions({
      ...CONNECTION,
      _client: fake.client,
      operationTimeoutMs: 0,
    });
    await expect(sessions.persist('s1', toEnvelope(conversation('hi')))).rejects.toThrow(
      /did not finish/,
    );
  });

  it('an operation with no name is refused — there is nothing to confirm against', async () => {
    const fake = fakeVertex({ onCreate: () => ({ data: { done: false } }) });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await expect(sessions.persist('s1', toEnvelope(conversation('hi')))).rejects.toThrow(/no name/);
  });

  it('a failed operation raises WITHOUT the service’s own message', async () => {
    const fake = fakeVertex({
      onCreate: () => ({
        data: {
          name: 'operations/abc',
          done: true,
          error: { code: 7, message: 'PERMISSION DENIED for user secret@example.com token ya29.X' },
        },
      }),
    });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    const error = await sessions.persist('s1', toEnvelope(conversation('hi'))).catch((e) => e);
    expect(String(error)).toContain('code 7');
    expect(String(error)).not.toContain('ya29.X');
    expect(String(error)).not.toContain('secret@example.com');
  });

  it('appends BEFORE creating, so the steady state costs one call', async () => {
    const fake = fakeVertex({ sessions: { [NAME]: { name: NAME, userId: 'u1' } } });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await sessions.persist('s1', toEnvelope(conversation('hi')));
    expect(fake.ops()).toEqual(['appendEvent']);
  });

  it('a create that lost a race to another writer falls back to appending', async () => {
    let created = false;
    const fake = fakeVertex({
      onAppend: () => {
        if (!created) throw { code: 404 };
        return { data: {} };
      },
      onCreate: () => {
        created = true;
        // The other writer got there first.
        throw { code: 409 };
      },
    });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await sessions.persist('s1', toEnvelope(conversation('hi')));
    expect(fake.ops()).toEqual(['appendEvent', 'create', 'appendEvent']);
  });
});

// ── The write VERB — the field trial's own shape ────────────────────
//
// Finding 28 of the 2026-08-14 trial: 9.29.0 stored turn one and could never
// store turn two, because it patched. These are the tests that would have
// caught it with no Google account.

describe('session state is written by appending an event, never by patching', () => {
  it('a SECOND persist on an existing conversation succeeds — the trial’s exact failure', async () => {
    const fake = fakeVertex();
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });

    await sessions.persist('s1', toEnvelope(conversation('turn one')));
    // Turn two. Under 9.29.0 this was an HTTP 400 the caller could not act on
    // — the double now refuses a patch exactly as the service does, so a
    // regression fails here rather than in production.
    await sessions.persist('s1', toEnvelope(conversation('turn two')));

    expect(fake.ops()).toEqual(['appendEvent', 'create', 'appendEvent']);
    expect(fake.ops()).not.toContain('patch');
    const back = await sessions.hydrate('s1');
    expect(back?.data).toEqual(toEnvelope(conversation('turn two')).data);
  });

  it('ten turns keep answering the LAST envelope', async () => {
    const fake = fakeVertex();
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    for (let turn = 1; turn <= 10; turn++) {
      await sessions.persist('s1', toEnvelope(conversation(`turn ${turn}`)));
    }
    expect(fake.ops().filter((op) => op === 'create')).toHaveLength(1);
    expect(fake.ops()).not.toContain('patch');
    // `savedAt` is stamped by `toEnvelope` at call time, so the conversation
    // itself is what this compares.
    expect((await sessions.hydrate('s1'))?.data).toEqual(toEnvelope(conversation('turn 10')).data);
  });

  it('the appended event carries the envelope in actions.stateDelta, under our keys only', async () => {
    const fake = fakeVertex({ sessions: { [NAME]: { name: NAME, userId: 'u1' } } });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    const envelope = toEnvelope(conversation('hi'));
    await sessions.persist('s1', envelope);

    const event = fake.calls.find((c) => c.op === 'appendEvent')?.params['requestBody'] as {
      author?: string;
      invocationId?: string;
      timestamp?: string;
      actions?: { stateDelta?: Record<string, unknown> };
    };
    // The three the message marks Required, all present and all non-empty.
    expect(event.author).toBe('agentfootprint');
    expect(event.invocationId).toMatch(/\S/);
    expect(Number.isFinite(Date.parse(String(event.timestamp)))).toBe(true);
    // Two top-level keys as of 9.45.0, both namespaced to this library: the
    // envelope, and the caller's OWN session id. A delta merges by top-level
    // key, so a merging delta and a replacing one still agree for both of ours
    // and still leave another guest's keys alone. The second key exists because
    // the resource id is a lossy fold — the listing has to carry the id its
    // caller would recognise rather than the composed one.
    expect(Object.keys(event.actions?.stateDelta ?? {}).sort()).toEqual(
      [SESSION_STATE_KEY, SESSION_ID_KEY].sort(),
    );
    expect(
      Object.keys(event.actions?.stateDelta ?? {}).every((k) => k.startsWith('agentfootprint.')),
    ).toBe(true);
    expect(event.actions?.stateDelta?.[SESSION_STATE_KEY]).toEqual(envelope);
  });

  it('another guest’s keys in the same session survive our write', async () => {
    // A state delta merges by top-level key. This store owns exactly one, so
    // whoever else writes under the same session keeps theirs.
    const fake = fakeVertex({
      sessions: {
        [NAME]: { name: NAME, userId: 'u1', sessionState: { 'someone.else': { keep: true } } },
      },
    });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await sessions.persist('s1', toEnvelope(conversation('hi')));
    expect((fake.store[NAME]?.['sessionState'] as Record<string, unknown>)['someone.else']).toEqual(
      {
        keep: true,
      },
    );
  });

  it('each turn gets its own invocationId — a conversation is not one invocation', async () => {
    const fake = fakeVertex({ sessions: { [NAME]: { name: NAME, userId: 'u1' } } });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await sessions.persist('s1', toEnvelope(conversation('one')));
    await sessions.persist('s1', toEnvelope(conversation('two')));
    const ids = fake.calls
      .filter((c) => c.op === 'appendEvent')
      .map((c) => (c.params['requestBody'] as { invocationId?: string }).invocationId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('the event author is configurable, and it is not the owner', async () => {
    // The seeded `userId` matches the envelope's principal on purpose. It read
    // `'u1'` against an alice-signed conversation until 9.36.1, which is the
    // split-brain state itself — an index naming one person over a stored
    // conversation naming another — and `persist` refuses to produce it now.
    // Seeding it was seeding the defect; what this test is about is that the
    // event AUTHOR is a different thing from the owner, which the two visibly
    // different strings below say more plainly than the mismatch did.
    const fake = fakeVertex({ sessions: { [NAME]: { name: NAME, userId: 'alice' } } });
    const sessions = agentEngineSessions({
      ...CONNECTION,
      _client: fake.client,
      eventAuthor: 'billing-agent',
    });
    await sessions.persist('s1', toEnvelope(conversation('hi', 'alice')));
    const event = fake.calls.find((c) => c.op === 'appendEvent')?.params['requestBody'] as {
      author?: string;
    };
    expect(event.author).toBe('billing-agent');
    // `userId` was pinned at create and is untouched by an appended event —
    // and it is NOT the author.
    expect(fake.store[NAME]?.['userId']).toBe('alice');
    expect(fake.store[NAME]?.['userId']).not.toBe('billing-agent');
  });

  it('an append that fails for a reason OTHER than a missing session is refused, not re-created', async () => {
    // The dangerous repair would be "append failed, so create instead": on a
    // permission failure that turns one caller's refusal into a create that
    // may 409 forever, and hides the real cause. So a failed append asks the
    // resource whether it exists, and re-raises when it does.
    const fake = fakeVertex({
      sessions: { [NAME]: { name: NAME, userId: 'u1' } },
      onAppend: () => {
        throw {
          code: 403,
          message: 'caller lacks aiplatform.sessions.update on token ya29.SECRET',
        };
      },
    });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    const error = await sessions.persist('s1', toEnvelope(conversation('hi'))).catch((e) => e);
    expect(String(error)).toContain('sessions.appendEvent');
    expect(String(error)).toContain('HTTP 403');
    expect(String(error)).not.toContain('ya29.SECRET');
    expect(fake.ops()).toEqual(['appendEvent', 'get']);
    // Nothing was created behind the failure.
    expect(fake.ops()).not.toContain('create');
  });

  it('an append refused without a 404 on a session that is GONE still creates it', async () => {
    // The mirror of the test above, and the reason `missing()` exists: the
    // trial verified create-on-a-new-session and append-on-an-existing one,
    // and never measured what the service says when you append to a session
    // that is not there. So the first turn does not ride on a guessed status.
    let created = false;
    const fake = fakeVertex({
      onAppend: () => {
        if (!created) throw { code: 400, message: 'session not found in this engine' };
        return { data: {} };
      },
      onGet: () => {
        if (!created) throw { code: 404 };
        return { data: { name: NAME, userId: 'u1' } };
      },
      onCreate: () => {
        created = true;
        return { data: { name: 'op/1', done: true } };
      },
    });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await sessions.persist('s1', toEnvelope(conversation('hi')));
    expect(fake.ops()).toEqual(['appendEvent', 'get', 'create']);
  });

  it('the ttl is sent on create and never claimed to slide', async () => {
    const fake = fakeVertex();
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client, ttl: '172800s' });
    await sessions.persist('s1', toEnvelope(conversation('one')));
    await sessions.persist('s1', toEnvelope(conversation('two')));

    const create = fake.calls.find((c) => c.op === 'create')?.params['requestBody'] as {
      ttl?: string;
    };
    expect(create.ttl).toBe('172800s');
    // And no later call pretends to renew it — whether an appended event
    // renews the expiry is unmeasured, so nothing here says it does.
    const appends = fake.calls.filter((c) => c.op === 'appendEvent');
    expect(appends).toHaveLength(2);
    for (const append of appends) {
      expect(JSON.stringify(append.params)).not.toContain('172800s');
    }
  });

  it('retention() says the SERVICE deletes, and hands nothing to call (9.42.0)', () => {
    const fake = fakeVertex();
    const unarmed = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    const armed = agentEngineSessions({ ...CONNECTION, _client: fake.client, ttl: '604800s' });

    // No sweep arm, on purpose: a method that reported "the service handles
    // it" is a method somebody puts in a cron job, and a cron job that deletes
    // nothing is worse than no cron job — it looks like retention is running.
    expect(unarmed.retention().deletedBy).toBe('the-backend');
    expect(unarmed.retention()).not.toHaveProperty('forgetOlderThan');
    // The service's own read-only field, not one this adapter writes.
    expect(armed.retention().expiresOn).toBe('expireTime');
    expect(unarmed.retention().active).toBe(false);
    expect(armed.retention().active).toBe(true);
    // The two facts a caller has to plan around, in the answer rather than in
    // a doc somebody has to find: the floor, and create-only.
    expect(armed.retention().enableWith).toContain('24 HOURS');
    expect(armed.retention().enableWith).toContain('CREATE only');
  });

  it('retention() answers on a CLOSED store, and calls nothing to do it', () => {
    const fake = fakeVertex();
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client, ttl: '604800s' });
    sessions.close();

    // An operator asking "what expires these?" during a shutdown gets the
    // answer, not the guard that protects the data plane.
    expect(sessions.retention().active).toBe(true);
    expect(fake.calls).toEqual([]);
  });
});

// ── The userId law ──────────────────────────────────────────────────

describe('the immutable userId is resolved, never invented', () => {
  it('defaults to the principal the conversation was signed with', async () => {
    const fake = fakeVertex();
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await sessions.persist('s1', toEnvelope(conversation('hi', 'alice')));
    const create = fake.calls.find((c) => c.op === 'create');
    expect((create?.params['requestBody'] as { userId?: string }).userId).toBe('alice');
  });

  it('an anonymous conversation is stored under a stated placeholder, not a minted id', async () => {
    const fake = fakeVertex();
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await sessions.persist('s1', toEnvelope(conversation('hi')));
    const create = fake.calls.find((c) => c.op === 'create');
    expect((create?.params['requestBody'] as { userId?: string }).userId).toBe(DEFAULT_USER_ID);
  });

  it('a resolver that answers nothing is refused rather than guessed past', async () => {
    const fake = fakeVertex();
    const sessions = agentEngineSessions({
      ...CONNECTION,
      _client: fake.client,
      userId: () => '',
    });
    await expect(sessions.persist('s1', toEnvelope(conversation('hi')))).rejects.toThrow(
      /non-empty user id/,
    );
  });

  it('a fixed string serves every session', async () => {
    const fake = fakeVertex();
    const sessions = agentEngineSessions({
      ...CONNECTION,
      _client: fake.client,
      userId: 'one-service-account',
    });
    await sessions.persist('s1', toEnvelope(conversation('hi', 'alice')));
    const create = fake.calls.find((c) => c.op === 'create');
    expect((create?.params['requestBody'] as { userId?: string }).userId).toBe(
      'one-service-account',
    );
  });

  it('ownerOf answers undefined for a missing session AND for an anonymous one', async () => {
    const fake = fakeVertex({
      sessions: {
        [NAME]: { name: NAME, userId: DEFAULT_USER_ID },
        [`${NAME}b`]: { name: `${NAME}b`, userId: 'alice' },
      },
    });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    // The deliberate ambiguity: "no such session" and "nobody signed for it"
    // are the same answer, so neither is an oracle for which ids are real.
    await expect(sessions.ownerOf!('missing')).resolves.toBeUndefined();
    await expect(sessions.ownerOf!('s1')).resolves.toBeUndefined();
    await expect(sessions.ownerOf!('s1b')).resolves.toBe('alice');
  });
});

// ── Listing ─────────────────────────────────────────────────────────

describe('listByUser', () => {
  it('filters on the service’s own user_id field and maps the summaries', async () => {
    const envelope = toEnvelope(conversation('hi', 'alice'));
    const fake = fakeVertex({
      onList: () => ({
        data: {
          sessions: [
            {
              name: NAME,
              updateTime: '2026-08-01T00:00:00Z',
              sessionState: { [SESSION_STATE_KEY]: envelope },
            },
          ],
          nextPageToken: 'page-2',
        },
      }),
    });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    const page = await sessions.listByUser!('alice', { limit: 10 });

    expect(fake.calls[0]?.params['filter']).toBe('user_id="alice"');
    expect(page.sessions).toEqual([
      {
        sessionId: 's1',
        savedAt: Date.parse('2026-08-01T00:00:00Z'),
        format: 'conversation-v1',
        messageCount: 2,
      },
    ]);
    expect(page.cursor).toBe('page-2');
  });

  it('a user id with a quote in it cannot break out of the filter', async () => {
    const fake = fakeVertex({ onList: () => ({ data: { sessions: [] } }) });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await sessions.listByUser!('ali"ce');
    expect(fake.calls[0]?.params['filter']).toBe('user_id="ali\\"ce"');
  });

  it('a BACKSLASH is escaped too — otherwise it escapes our own escape', async () => {
    // The test above establishes that this grammar honours backslash escapes,
    // which is exactly what makes an unescaped backslash the way out of the
    // literal. `\` must become `\\` BEFORE the quote is escaped.
    const fake = fakeVertex({ onList: () => ({ data: { sessions: [] } }) });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await sessions.listByUser!('ali\\ce');
    expect(fake.calls[0]?.params['filter']).toBe('user_id="ali\\\\ce"');
  });

  it('the injection this closes: a crafted id stays one literal, not two clauses', async () => {
    // `\" OR user_id!=` under quote-only escaping renders as
    // `user_id="\\" OR user_id!=""` — a literal backslash, a quote that CLOSES
    // the literal, and an injected clause that matches every session with a
    // non-empty user id, handing back other people's conversation ids.
    const fake = fakeVertex({ onList: () => ({ data: { sessions: [] } }) });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await sessions.listByUser!('\\" OR user_id!=');
    const filter = String(fake.calls[0]?.params['filter']);
    expect(filter).toBe('user_id="\\\\\\" OR user_id!="');
    // Every quote after the opening one is escaped, so the literal runs to the
    // end and nothing in it is filter syntax.
    expect(filter.slice('user_id="'.length, -1)).not.toMatch(/(^|[^\\])(\\\\)*"/);
  });

  it('a user id ENDING in a backslash is a listing, not a censored 400', async () => {
    // The benign half of the same bug: the trailing backslash would swallow the
    // closing quote and the malformed filter comes back as a 400 whose text the
    // sanitizer withholds — a local error delivered as an unreadable remote one.
    const fake = fakeVertex({ onList: () => ({ data: { sessions: [] } }) });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await expect(sessions.listByUser!('alice\\')).resolves.toEqual({ sessions: [] });
    expect(fake.calls[0]?.params['filter']).toBe('user_id="alice\\\\"');
  });

  it('one unreadable row does not fail the whole listing', async () => {
    // A sidebar that 500s over one corrupt conversation is worse than one that
    // shows it with an honest zero — the transcript op refuses where a reader
    // can act on it.
    const fake = fakeVertex({
      onList: () => ({
        data: { sessions: [{ name: NAME, sessionState: { [SESSION_STATE_KEY]: 'junk' } }] },
      }),
    });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    const page = await sessions.listByUser!('alice');
    expect(page.sessions[0]).toMatchObject({ sessionId: 's1', format: 'unknown', messageCount: 0 });
  });
});

// ── Lifecycle, config and secrecy ───────────────────────────────────

describe('construction, closing and what errors may say', () => {
  it('close() is final — a later call refuses rather than reconnecting', async () => {
    const fake = fakeVertex();
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    sessions.close();
    sessions.close(); // idempotent
    await expect(sessions.hydrate('s1')).rejects.toThrow(/closed/);
  });

  it('forget() treats an already-missing session as the outcome it asked for', async () => {
    const fake = fakeVertex({
      onDelete: () => {
        throw { code: 404 };
      },
    });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await expect(sessions.forget('gone')).resolves.toBeUndefined();
  });

  it('a full resource name carries the project and location with it', () => {
    const fake = fakeVertex();
    const sessions = agentEngineSessions({
      location: 'europe-west4',
      reasoningEngine: 'projects/other/locations/europe-west4/reasoningEngines/9',
      _client: fake.client,
    });
    expect(sessions.parent).toBe('projects/other/locations/europe-west4/reasoningEngines/9');
  });

  it('two spellings of the location that disagree are refused, not arbitrated', () => {
    const fake = fakeVertex();
    expect(() =>
      agentEngineSessions({
        location: 'us-central1',
        reasoningEngine: 'projects/p/locations/europe-west4/reasoningEngines/9',
        _client: fake.client,
      }),
    ).toThrow(/disagree|Drop one/);
  });

  it('a missing reasoningEngine is refused with what it is and who creates it', () => {
    expect(() => agentEngineSessions({ ...CONNECTION, reasoningEngine: '' } as never)).toThrow(
      /control-plane/,
    );
  });

  it('the SDK’s own failure text never reaches the caller', async () => {
    const fake = fakeVertex({
      onGet: () => {
        throw new Error('403: request to https://…?token=ya29.SECRET failed for alice@corp.com');
      },
    });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    const error = await sessions.hydrate('s1').catch((e: unknown) => e);
    expect(String(error)).toContain('sessions.get');
    expect(String(error)).not.toContain('ya29.SECRET');
    expect(String(error)).not.toContain('alice@corp.com');
    // And the original is NOT attached as a cause, which would put it back in
    // every serializer that walks own properties.
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
      const { agentEngineSessions: isolated } = await import(
        '../../../src/adapters/hosting/googleAgentEngine.js'
      );
      expect(() => isolated(CONNECTION)).toThrow(/@googleapis\/aiplatform/);
      // And it names the split package rather than the 209 MB one.
      expect(() => isolated(CONNECTION)).toThrow(/SPLIT per-API package/);
    } finally {
      vi.doUnmock('../../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  });

  it('the client is built against the REGIONAL host, never the global default', () => {
    const built: Record<string, unknown>[] = [];
    agentEngineSessions({
      ...CONNECTION,
      location: 'europe-west4',
      _sdk: {
        aiplatform: (opts) => {
          built.push(opts as Record<string, unknown>);
          return { projects: { locations: { reasoningEngines: {} } } } as never;
        },
        auth: { GoogleAuth: class {} as never },
      },
    });
    expect(built[0]).toMatchObject({
      version: 'v1',
      rootUrl: 'https://europe-west4-aiplatform.googleapis.com/',
    });
  });
});

// ── The port, honoured ──────────────────────────────────────────────

describe('it really is a SessionLifecycle', () => {
  it('satisfies the port’s two required methods and both optional ones', () => {
    const fake = fakeVertex();
    const sessions: CheckpointEnvelope extends never
      ? never
      : ReturnType<typeof agentEngineSessions> = agentEngineSessions({
      ...CONNECTION,
      _client: fake.client,
    });
    expect(typeof sessions.hydrate).toBe('function');
    expect(typeof sessions.persist).toBe('function');
    expect(typeof sessions.listByUser).toBe('function');
    expect(typeof sessions.ownerOf).toBe('function');
  });
});
