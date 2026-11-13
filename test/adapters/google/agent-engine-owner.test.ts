/**
 * Agent Engine: the first party that signs a conversation stays its owner,
 * and a listing never hands out an id that opens nothing.
 *
 * Findings: r3-56-adapters-hosting-2 (a conversation that began anonymously
 * kept its owner only inside the latest envelope, so one anonymous turn erased
 * it and the next signer took the conversation over) and
 * r3-56-adapters-hosting-3 (a session saved before the store carried the
 * caller's own id was listed under its resource id, which no longer opens it).
 *
 * What is faked: the Vertex AI sessions API, at the SDK boundary (`_client`):
 * `get`, `create`, `appendEvent` (a state delta merges by top-level key, as
 * the module header records from the field trial), `list`, `delete`. Every
 * stored session goes through `JSON.stringify` / `JSON.parse` on the way in and
 * out, and a "reload" is a new store over the same rows. What is not shown:
 * the live service — in particular that its `appendEvent` merges by top-level
 * key, which the adapter's own header states from a field trial.
 */
import { describe, expect, it } from 'vitest';

import {
  agentEngineSessions,
  DEFAULT_USER_ID,
  SESSION_ID_KEY,
  SESSION_STATE_KEY,
} from '../../../src/adapters/hosting/googleAgentEngine.js';
import { safeResourceId } from '../../../src/adapters/google/aiPlatform.js';
import { Agent } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { envelopeOwner, standingAgent, toEnvelope } from '../../../src/hosting/index.js';
import type { HostHandler, HostRequest } from '../../../src/hosting/index.js';
import type { AgentRunCheckpoint } from '../../../src/core/runCheckpoint.js';

const PARENT = 'projects/p/locations/us-central1/reasoningEngines/engine-1';
const CONNECTION = { project: 'p', location: 'us-central1', reasoningEngine: 'engine-1' } as const;

function envelopeOf(text: string, principal?: string, conversationId?: string) {
  return toEnvelope({
    version: 1,
    runId: `run-${text.replace(/\W+/g, '-')}`,
    history: [{ role: 'user', content: text }],
    lastCompletedIteration: 1,
    originalInput: { message: text },
    checkpointedAt: 1,
    ...((principal !== undefined || conversationId !== undefined) && {
      identity: {
        conversationId: conversationId ?? 'c',
        ...(principal !== undefined && { principal }),
      },
    }),
  } as AgentRunCheckpoint);
}

type Row = {
  name: string;
  userId: string;
  updateTime: string;
  sessionState: Record<string, unknown>;
};

/** The rows as they would sit on Google's side: JSON text only. */
function service(initial: Row[] = []) {
  const rows = new Map<string, string>(initial.map((row) => [row.name, JSON.stringify(row)]));
  const read = (name: string): Row | undefined => {
    const text = rows.get(name);
    return text === undefined ? undefined : (JSON.parse(text) as Row);
  };
  let clock = 1_700_000_000_000;
  const sessions = {
    get: async ({ name }: { name: string }) => {
      const found = read(name);
      if (found === undefined) throw { code: 404 };
      return { data: found };
    },
    list: async () => ({ data: { sessions: [...rows.keys()].map((name) => read(name)!) } }),
    appendEvent: async ({ name, requestBody }: { name: string; requestBody: any }) => {
      const found = read(name);
      if (found === undefined) throw { code: 404 };
      found.sessionState = { ...found.sessionState, ...requestBody.actions.stateDelta };
      found.updateTime = new Date(++clock).toISOString();
      rows.set(name, JSON.stringify(found));
      return { data: {} };
    },
    create: async ({ sessionId, requestBody }: { sessionId: string; requestBody: any }) => {
      const name = `${PARENT}/sessions/${sessionId}`;
      if (rows.has(name)) throw { code: 409 };
      const row: Row = {
        name,
        userId: requestBody.userId,
        updateTime: new Date(++clock).toISOString(),
        sessionState: requestBody.sessionState,
      };
      rows.set(name, JSON.stringify(row));
      return { data: { name: 'op/1', done: true } };
    },
    delete: async () => ({ data: { done: true } }),
    operations: { wait: async () => ({ data: { done: true } }) },
  };
  /** A new store over the same rows — what a restart or another instance sees. */
  const store = () =>
    agentEngineSessions({
      ...CONNECTION,
      _client: {
        projects: { locations: { reasoningEngines: { sessions, memories: {} } } },
      } as never,
    });
  return { rows, read, store };
}

const outcome = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (err: { code?: string }) => err.code ?? 'error',
  );

// ── Contract 2, at the store ────────────────────────────────────────

describe('the first signer stays the owner (r3-56-adapters-hosting-2)', () => {
  it('anonymous, alice, anonymous, bob: bob is refused and alice still owns it, across reloads', async () => {
    const google = service();
    const turns: string[] = [];
    for (const principal of [undefined, 'alice', undefined, 'bob']) {
      // A new store per turn: every turn reads only what the service kept.
      turns.push(await outcome(google.store().persist('s1', envelopeOf('turn', principal))));
    }
    expect(turns).toEqual(['ok', 'ok', 'ok', 'ERR_SESSION_OWNERSHIP_CONFLICT']);
    const back = await google.store().hydrate('s1');
    expect(back?.data).toEqual(envelopeOf('turn', undefined).data);
    // alice may continue it.
    expect(await outcome(google.store().persist('s1', envelopeOf('again', 'alice')))).toBe('ok');
  });

  it('a conversation that began anonymously is marked so, and a first signer fills it in', async () => {
    const google = service();
    await google.store().persist('s1', envelopeOf('hi'));
    const row = google.read(`${PARENT}/sessions/s1`)!;
    expect(row.userId).toBe(DEFAULT_USER_ID);
    // The mark sits beside the two keys an older reader reads, and changes
    // neither of them.
    expect(Object.keys(row.sessionState).sort()).toEqual(
      ['agentfootprint.owner', SESSION_ID_KEY, SESSION_STATE_KEY].sort(),
    );
    expect(row.sessionState['agentfootprint.owner']).toBe('');
    expect(await outcome(google.store().persist('s1', envelopeOf('mine', 'alice')))).toBe('ok');
    expect(google.read(`${PARENT}/sessions/s1`)!.sessionState['agentfootprint.owner']).toBe(
      'alice',
    );
  });

  it('an anonymous turn costs no extra call and never touches the owner', async () => {
    const google = service();
    await google.store().persist('s1', envelopeOf('one', 'alice'));
    await google.store().persist('s1', envelopeOf('two'));
    expect(google.read(`${PARENT}/sessions/s1`)!.sessionState['agentfootprint.owner']).toBe(
      'alice',
    );
  });

  describe('an old session (written before the owner was kept) is read in the direction that refuses', () => {
    const old = (envelope: unknown): Row => ({
      name: `${PARENT}/sessions/s1`,
      userId: DEFAULT_USER_ID,
      updateTime: '2026-01-01T00:00:00Z',
      sessionState: { [SESSION_STATE_KEY]: envelope, [SESSION_ID_KEY]: 's1' },
    });

    it('names nobody: a signed turn is refused, an anonymous one is not', async () => {
      const google = service([old(envelopeOf('somebody'))]);
      expect(await outcome(google.store().persist('s1', envelopeOf('mine', 'bob')))).toBe(
        'ERR_SESSION_NOT_FOUND',
      );
      expect(await outcome(google.store().persist('s1', envelopeOf('more')))).toBe('ok');
      expect(await outcome(google.store().persist('s1', envelopeOf('mine', 'bob')))).toBe(
        'ERR_SESSION_NOT_FOUND',
      );
    });

    it('names alice: alice continues it, bob is refused', async () => {
      const google = service([old(envelopeOf('hers', 'alice'))]);
      expect(await outcome(google.store().persist('s1', envelopeOf('mine', 'bob')))).toBe(
        'ERR_SESSION_OWNERSHIP_CONFLICT',
      );
      expect(await outcome(google.store().persist('s1', envelopeOf('again', 'alice')))).toBe('ok');
      // …and from then on the owner is kept, so an anonymous turn cannot open it to bob.
      await google.store().persist('s1', envelopeOf('anon'));
      expect(await outcome(google.store().persist('s1', envelopeOf('mine', 'bob')))).toBe(
        'ERR_SESSION_OWNERSHIP_CONFLICT',
      );
    });
  });
});

// ── Contract 2, through the hosted door ─────────────────────────────

async function door(store: ReturnType<ReturnType<typeof service>['store']>) {
  let handler: HostHandler | undefined;
  const agent = Agent.create({ provider: mock({ reply: 'fine' }), model: 'mock' }).build();
  const handle = await standingAgent({
    agent,
    sessions: store,
    // Saves in the middle of the run too: on the release this patch follows,
    // that save dropped the owner, which is how a hosted turn naming nobody
    // erased it here (r3-45-hosting-1 meeting r3-56-adapters-hosting-2).
    durability: 'sync',
    host: {
      name: 'two-callers',
      capabilities: [],
      serve: async (incoming) => {
        handler = incoming;
        return { close: async () => undefined };
      },
    },
  });
  const send = async (request: HostRequest) => {
    let answer = 'none';
    await handler!(request, {
      emit: () => undefined,
      complete: () => (answer = 'ok'),
      fail: (err) => (answer = (err as { code?: string }).code ?? err.message),
    });
    return answer;
  };
  return { handle, send };
}

describe('through standingAgent at a door with no verifier', () => {
  it('alice, a caller naming nobody, then bob: bob cannot take the conversation over', async () => {
    const google = service();
    const turns: string[] = [];
    for (const userId of ['alice', undefined, 'bob']) {
      const { handle, send } = await door(google.store());
      try {
        turns.push(
          await send({ input: 'hello', sessionId: 's1', ...(userId !== undefined && { userId }) }),
        );
      } finally {
        await handle.close();
      }
    }
    expect(turns).toEqual(['ok', 'ok', 'ERR_SESSION_OWNERSHIP_CONFLICT']);
    expect(google.read(`${PARENT}/sessions/s1`)!.sessionState['agentfootprint.owner']).toBe(
      'alice',
    );
  });

  it('a caller naming nobody first, then alice, then nobody, then bob: alice keeps it', async () => {
    const google = service();
    const turns: string[] = [];
    for (const userId of [undefined, 'alice', undefined, 'bob']) {
      const { handle, send } = await door(google.store());
      try {
        turns.push(
          await send({ input: 'hello', sessionId: 's1', ...(userId !== undefined && { userId }) }),
        );
      } finally {
        await handle.close();
      }
    }
    expect(turns).toEqual(['ok', 'ok', 'ok', 'ERR_SESSION_OWNERSHIP_CONFLICT']);
    const stored = google.read(`${PARENT}/sessions/s1`)!.sessionState[SESSION_STATE_KEY];
    expect(envelopeOwner(stored)).toBe('alice');
  });
});

// ── Contract 4: a listing never hands out an id that opens nothing ──

describe('a listing hands out only ids that open their row (r3-56-adapters-hosting-3)', () => {
  /** A row as a release before the carried id wrote it: `resource` is what that release's fold made. */
  const legacy = (raw: string, envelope: unknown, resource = safeResourceId(raw)): Row => ({
    name: `${PARENT}/sessions/${resource}`,
    userId: 'alice',
    updateTime: '2026-01-01T00:00:00Z',
    sessionState: { [SESSION_STATE_KEY]: envelope },
  });

  it('every listed id opens its conversation; a row no id can open is left out', async () => {
    const google = service([
      // Before the raw id was carried, under an id the fold left alone.
      legacy('my-session', envelopeOf('a', 'alice')),
      // Before the raw id was carried, folded — but the conversation names its
      // own id, and that id folds back onto this exact resource.
      legacy('MySession', envelopeOf('b', 'alice', 'MySession')),
      // Folded, and nothing in it says what the caller's id was.
      legacy('a_b', envelopeOf('c', 'alice')),
      legacy('x'.repeat(70), envelopeOf('d', 'alice', 'not-its-id')),
      // A legal raw id that begins with the fold's own prefix, written before
      // the prefix was excluded: today even its raw id folds elsewhere.
      // (that release passed it through unchanged).
      legacy('id-abc', envelopeOf('e', 'alice', 'id-abc'), 'id-abc'),
    ]);
    // Written today, carrying its id.
    await google.store().persist('Today_1', envelopeOf('f', 'alice', 'Today_1'));

    const listed = (await google.store().listByUser('alice')).sessions.map((s) => s.sessionId);
    expect([...listed].sort()).toEqual(['MySession', 'Today_1', 'my-session'].sort());
    for (const id of listed) expect(await google.store().hydrate(id)).toBeDefined();
  });
});
