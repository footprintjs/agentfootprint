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
 *   • a patch without an update mask is a REPLACE, which would clear the
 *     immutable `userId` and silently stop every later write;
 *   • the SDK's own failure text never reaches the caller.
 *
 * Nothing here reaches Google or needs a credential.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  agentEngineSessions,
  DEFAULT_USER_ID,
  SESSION_STATE_KEY,
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

/** A double that records every call and answers from a tiny in-memory table. */
function fakeVertex(
  options: {
    sessions?: Record<string, Record<string, unknown>>;
    onPatch?: (params: Record<string, unknown>) => unknown;
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
            patch: record('patch', options.onPatch, undefined) as never,
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
  if (!options.onPatch) {
    client.projects.locations.reasoningEngines.sessions.patch = ((
      params: Record<string, unknown>,
    ) => {
      calls.push({ op: 'patch', params });
      const name = String(params['name']);
      if (store[name] === undefined) return Promise.resolve(notFound());
      store[name] = { ...store[name], ...(params['requestBody'] as object) };
      return Promise.resolve({ data: store[name] });
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
      onPatch: () => {
        throw { code: 404 };
      },
      onCreate: () => ({ data: { name: 'operations/abc', done: false } }),
      onWait: () => ({ data: { name: 'operations/abc', done: ++waits >= 2 } }),
    });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await sessions.persist('s1', toEnvelope(conversation('hi')));
    expect(waits).toBe(2);
    expect(fake.ops()).toEqual(['patch', 'create', 'wait', 'wait']);
  });

  it('refuses rather than reporting a success it never saw land', async () => {
    const fake = fakeVertex({
      onPatch: () => {
        throw { code: 404 };
      },
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
    const fake = fakeVertex({
      onPatch: () => {
        throw { code: 404 };
      },
      onCreate: () => ({ data: { done: false } }),
    });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await expect(sessions.persist('s1', toEnvelope(conversation('hi')))).rejects.toThrow(/no name/);
  });

  it('a failed operation raises WITHOUT the service’s own message', async () => {
    const fake = fakeVertex({
      onPatch: () => {
        throw { code: 404 };
      },
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

  it('patches BEFORE creating, so the steady state costs one call', async () => {
    const fake = fakeVertex({ sessions: { [NAME]: { name: NAME, userId: 'u1' } } });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await sessions.persist('s1', toEnvelope(conversation('hi')));
    expect(fake.ops()).toEqual(['patch']);
  });

  it('a patch always names an update mask — a maskless one would clear the immutable userId', async () => {
    const fake = fakeVertex({ sessions: { [NAME]: { name: NAME, userId: 'u1' } } });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await sessions.persist('s1', toEnvelope(conversation('hi')));
    const patch = fake.calls.find((c) => c.op === 'patch');
    expect(patch?.params['updateMask']).toBe('sessionState');
    // And the mask never claims `userId`, which the service refuses to change.
    expect(String(patch?.params['updateMask'])).not.toContain('userId');
  });

  it('a create that lost a race to another writer falls back to patching', async () => {
    let created = false;
    const fake = fakeVertex({
      onPatch: (p) => {
        if (!created) throw { code: 404 };
        return { data: { name: p['name'] } };
      },
      onCreate: () => {
        created = true;
        // The other writer got there first.
        throw { code: 409 };
      },
    });
    const sessions = agentEngineSessions({ ...CONNECTION, _client: fake.client });
    await sessions.persist('s1', toEnvelope(conversation('hi')));
    expect(fake.ops()).toEqual(['patch', 'create', 'patch']);
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
