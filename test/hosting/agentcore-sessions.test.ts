/**
 * agentCoreSessions — where a conversation lives between requests.
 *
 * Two modes, one port, and two laws inherited rather than re-implemented: an
 * envelope whose `format` this runtime does not know is refused BY NAME, and a
 * stored session that is PRESENT but unreadable is refused by name too — never
 * answered with a fresh start. Both modes are asserted against both.
 *
 * `{ store: 'session-storage' }` is real: it writes a real file to a real temp
 * directory and reads it back, including across a fresh adapter instance, which
 * is what "survives a stop/resume" actually means.
 *
 * `{ store: 'memory' }` is **contract-mapped and injection-tested**: every AWS
 * interaction goes through the `_client` seam, and the SDK shim itself is
 * exercised with a fake `_sdk` module. No test here reaches AWS, and none
 * pretends to. What one field deployment DID reach is pinned as a fixture: the
 * mangled-blob shape the real service returned for an envelope written as an
 * object, which the old reader silently called "no session". See the
 * "an unreadable blob" block.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  agentCoreSessions,
  DEFAULT_SESSION_STORAGE_PATH,
  type AgentCoreSessionClientLike,
  type BedrockAgentCoreSessionSdkModule,
} from '../../src/hosting-providers.js';
import { toEnvelope, UnreadableEnvelopeError } from '../../src/hosting/index.js';
import type { CheckpointEnvelope } from '../../src/hosting/index.js';
import type { AgentRunCheckpoint } from '../../src/core/runCheckpoint.js';

// ── Fixtures ────────────────────────────────────────────────────────

function conversation(text: string): AgentRunCheckpoint {
  return {
    version: 1,
    runId: `run-${text.replace(/\W+/g, '-')}`,
    history: [
      { role: 'user', content: text },
      { role: 'assistant', content: `re: ${text}` },
    ],
    lastCompletedIteration: 1,
    originalInput: { message: text },
    checkpointedAt: Date.now(),
  } as AgentRunCheckpoint;
}

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

async function tempPath(name = 'session'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'afp-sessions-'));
  temps.push(dir);
  return join(dir, name);
}

/**
 * A fake `@aws-sdk/client-bedrock-agentcore` that records what it was sent.
 *
 * `listBlob` overrides what a `ListEvents` reply carries, which is how the
 * field's mangled-blob shape gets in front of the reader. Left out, the fake
 * echoes back the newest blob it was given — the service's actual job, and the
 * only way a round-trip test is a round trip rather than two assertions.
 * `listPayload` replaces the payload wholesale, for events shaped unlike ours.
 */
function fakeSdk(
  listBlob?: unknown,
  listPayload?: unknown,
): {
  module: BedrockAgentCoreSessionSdkModule;
  sent: { command: string; input: Record<string, unknown> }[];
  written: unknown[];
} {
  const sent: { command: string; input: Record<string, unknown> }[] = [];
  const written: unknown[] = [];
  const command = (name: string) =>
    class {
      readonly __name = name;
      constructor(readonly input: Record<string, unknown>) {}
    };
  const module: BedrockAgentCoreSessionSdkModule = {
    BedrockAgentCoreClient: class {
      constructor(readonly config: { region?: string }) {}
      async send(cmd: unknown): Promise<unknown> {
        const typed = cmd as { __name: string; input: Record<string, unknown> };
        sent.push({ command: typed.__name, input: typed.input });
        if (typed.__name === 'CreateEvent') {
          written.push((typed.input.payload as { blob: unknown }[])[0].blob);
          return {};
        }
        if (typed.__name === 'ListEvents') {
          if (listPayload !== undefined) {
            return { events: [{ eventId: 'e-1', payload: listPayload }] };
          }
          const blob =
            listBlob !== undefined
              ? listBlob
              : written[written.length - 1] ??
                JSON.stringify(toEnvelope(conversation('from the cloud')));
          return { events: [{ eventId: 'e-1', payload: [{ blob }] }] };
        }
        return {};
      }
    } as unknown as BedrockAgentCoreSessionSdkModule['BedrockAgentCoreClient'],
    CreateEventCommand: command('CreateEvent') as never,
    ListEventsCommand: command('ListEvents') as never,
  };
  return { module, sent, written };
}

/** An in-memory stand-in for AgentCore Memory's append-only event log. */
function fakeMemoryClient(): AgentCoreSessionClientLike & {
  readonly appended: { sessionId: string; actorId: string; envelope: CheckpointEnvelope }[];
} {
  const appended: { sessionId: string; actorId: string; envelope: CheckpointEnvelope }[] = [];
  return {
    appended,
    async createEvent({ actorId, sessionId, envelope }) {
      appended.push({ actorId, sessionId, envelope });
    },
    async listEvents({ sessionId, maxResults }) {
      // AgentCore lists newest-first.
      const mine = appended
        .filter((event) => event.sessionId === sessionId)
        .map((event, index) => ({ eventId: `e-${index}`, envelope: event.envelope }))
        .reverse();
      return { events: maxResults === undefined ? mine : mine.slice(0, maxResults) };
    },
  };
}

// ── unit: construction ──────────────────────────────────────────────

describe('agentCoreSessions — unit', () => {
  it('satisfies the SessionLifecycle port in both modes', () => {
    const file = agentCoreSessions({ store: 'session-storage' });
    const events = agentCoreSessions({
      store: 'memory',
      memoryId: 'm-1',
      _client: fakeMemoryClient(),
    });
    for (const sessions of [file, events]) {
      expect(typeof sessions.hydrate).toBe('function');
      expect(typeof sessions.persist).toBe('function');
    }
  });

  it('publishes the default file path rather than hiding it in a literal', () => {
    expect(DEFAULT_SESSION_STORAGE_PATH).toBe('/tmp/agentcore-session');
  });

  it("refuses { store: 'memory' } without a memoryId, at construction", () => {
    expect(() =>
      agentCoreSessions({ store: 'memory' } as unknown as Parameters<typeof agentCoreSessions>[0]),
    ).toThrow(/memoryId/);
  });

  it('constructing the memory mode with an injected client loads no AWS SDK', () => {
    // The lazy-require is the reason importing this subpath costs nothing. If a
    // future refactor hoists the require, this throws about the missing peer.
    expect(() =>
      agentCoreSessions({ store: 'memory', memoryId: 'm-1', _client: fakeMemoryClient() }),
    ).not.toThrow();
  });
});

// ── scenario: the file-backed store, for real ───────────────────────

describe("agentCoreSessions({ store: 'session-storage' })", () => {
  it('hydrates nothing for a session it has never seen', async () => {
    const sessions = agentCoreSessions({ store: 'session-storage', path: await tempPath() });
    expect(await sessions.hydrate('never-seen')).toBeUndefined();
  });

  it('round-trips a conversation through a real file', async () => {
    const path = await tempPath();
    const sessions = agentCoreSessions({ store: 'session-storage', path });
    const envelope = toEnvelope(conversation('hello'));
    await sessions.persist('c-1', envelope);
    expect(await sessions.hydrate('c-1')).toEqual(envelope);
  });

  it('survives losing the adapter — which is what surviving a restart means', async () => {
    const path = await tempPath();
    await agentCoreSessions({ store: 'session-storage', path }).persist(
      'c-1',
      toEnvelope(conversation('remember me')),
    );
    // A completely fresh adapter, as a resumed container would build.
    const revived = await agentCoreSessions({ store: 'session-storage', path }).hydrate('c-1');
    expect(revived?.data.history[0]).toMatchObject({ content: 'remember me' });
  });

  it('keeps sessions apart in one file', async () => {
    const path = await tempPath();
    const sessions = agentCoreSessions({ store: 'session-storage', path });
    await sessions.persist('a', toEnvelope(conversation('for a')));
    await sessions.persist('b', toEnvelope(conversation('for b')));
    expect((await sessions.hydrate('a'))?.data.history[0]).toMatchObject({ content: 'for a' });
    expect((await sessions.hydrate('b'))?.data.history[0]).toMatchObject({ content: 'for b' });
  });

  it('last write wins, as the port says', async () => {
    const path = await tempPath();
    const sessions = agentCoreSessions({ store: 'session-storage', path });
    await sessions.persist('c-1', toEnvelope(conversation('first')));
    await sessions.persist('c-1', toEnvelope(conversation('second')));
    expect((await sessions.hydrate('c-1'))?.data.history[0]).toMatchObject({ content: 'second' });
  });

  it('creates the directory when the configured path has one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'afp-sessions-'));
    temps.push(dir);
    const path = join(dir, 'nested', 'deeper', 'session');
    const sessions = agentCoreSessions({ store: 'session-storage', path });
    await sessions.persist('c-1', toEnvelope(conversation('deep')));
    expect(await sessions.hydrate('c-1')).toBeDefined();
  });

  it('leaves no temp file behind — a rename, not a truncate-in-place', async () => {
    const path = await tempPath();
    const sessions = agentCoreSessions({ store: 'session-storage', path });
    await sessions.persist('c-1', toEnvelope(conversation('x')));
    // The file is whole and parseable, and the write-then-rename means a kill
    // mid-write would have left the PREVIOUS conversation rather than rubble.
    const raw = await readFile(path, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    await expect(readFile(`${path}.${process.pid}.tmp`, 'utf8')).rejects.toThrow();
  });
});

// ── security / honesty: the envelope law is inherited, not re-done ──

describe('agentCoreSessions — the envelope law', () => {
  it('refuses an unknown format BY NAME rather than restoring half a conversation', async () => {
    const path = await tempPath();
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        sessions: { 'c-1': { format: 'conversation-v99', data: {}, savedAt: 1 } },
      }),
      'utf8',
    );
    const sessions = agentCoreSessions({ store: 'session-storage', path });
    // The words come from readEnvelope — the ONE implementation of this law.
    await expect(sessions.hydrate('c-1')).rejects.toThrow(/unknown checkpoint format/);
    await expect(sessions.hydrate('c-1')).rejects.toThrow(/conversation-v99/);
  });

  it('refuses an unknown format from the event store too, in the same words', async () => {
    const client = fakeMemoryClient();
    const sessions = agentCoreSessions({ store: 'memory', memoryId: 'm-1', _client: client });
    await sessions.persist('c-1', {
      format: 'conversation-v99',
      data: conversation('x'),
      savedAt: 1,
    } as unknown as CheckpointEnvelope);
    await expect(sessions.hydrate('c-1')).rejects.toThrow(/unknown checkpoint format/);
  });

  it('refuses a session file that is not JSON, saying where it is', async () => {
    const path = await tempPath();
    await writeFile(path, 'not json at all', 'utf8');
    const sessions = agentCoreSessions({ store: 'session-storage', path });
    // Starting every conversation over because a file would not parse is the
    // silent failure this refusal exists to prevent.
    await expect(sessions.hydrate('c-1')).rejects.toThrow(new RegExp(path));
  });
});

// ── integration: the event-backed store, through the injection seam ─

describe("agentCoreSessions({ store: 'memory' }) — injection-tested", () => {
  it('writes ONE event per persist and reads the newest one back', async () => {
    const client = fakeMemoryClient();
    const sessions = agentCoreSessions({ store: 'memory', memoryId: 'm-1', _client: client });
    await sessions.persist('c-1', toEnvelope(conversation('turn one')));
    await sessions.persist('c-1', toEnvelope(conversation('turn two')));
    expect(client.appended).toHaveLength(2);
    // Append-only: older turns stay where they are as the audit trail, and the
    // newest readable event IS the conversation.
    expect((await sessions.hydrate('c-1'))?.data.history[0]).toMatchObject({
      content: 'turn two',
    });
  });

  it('hydrates nothing for a session with no events', async () => {
    const sessions = agentCoreSessions({
      store: 'memory',
      memoryId: 'm-1',
      _client: fakeMemoryClient(),
    });
    expect(await sessions.hydrate('brand-new')).toBeUndefined();
  });

  it('keeps sessions apart by session id', async () => {
    const client = fakeMemoryClient();
    const sessions = agentCoreSessions({ store: 'memory', memoryId: 'm-1', _client: client });
    await sessions.persist('a', toEnvelope(conversation('for a')));
    await sessions.persist('b', toEnvelope(conversation('for b')));
    expect((await sessions.hydrate('a'))?.data.history[0]).toMatchObject({ content: 'for a' });
  });

  it('uses the configured actor, defaulting to one per deployed agent', async () => {
    const client = fakeMemoryClient();
    await agentCoreSessions({ store: 'memory', memoryId: 'm-1', _client: client }).persist(
      'c-1',
      toEnvelope(conversation('x')),
    );
    expect(client.appended[0].actorId).toBe('afp-standing-agent');

    const named = fakeMemoryClient();
    await agentCoreSessions({
      store: 'memory',
      memoryId: 'm-1',
      actorId: 'support-bot',
      _client: named,
    }).persist('c-1', toEnvelope(conversation('x')));
    expect(named.appended[0].actorId).toBe('support-bot');
  });

  it('makes a caller-supplied session id safe for AgentCore, and keeps long ones distinct', async () => {
    const client = fakeMemoryClient();
    const sessions = agentCoreSessions({ store: 'memory', memoryId: 'm-1', _client: client });
    await sessions.persist('user@example.com/thread #1', toEnvelope(conversation('x')));
    expect(client.appended[0].sessionId).toMatch(/^[A-Za-z0-9_-]+$/);

    // Two long ids sharing a prefix must not collapse into one conversation.
    const long = 'z'.repeat(200);
    await sessions.persist(`${long}a`, toEnvelope(conversation('a')));
    await sessions.persist(`${long}b`, toEnvelope(conversation('b')));
    const ids = client.appended.slice(1).map((event) => event.sessionId);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids.every((id) => id.length <= 99)).toBe(true);
  });
});

// ── the SDK shim, exercised with a fake SDK module ──────────────────

describe("agentCoreSessions({ store: 'memory' }) — the SDK mapping", () => {
  it('maps persist onto CreateEvent with the envelope as JSON TEXT', async () => {
    const { module, sent } = fakeSdk();
    const sessions = agentCoreSessions({
      store: 'memory',
      memoryId: 'm-1',
      region: 'us-west-2',
      _sdk: module,
    });
    await sessions.persist('c-1', toEnvelope(conversation('hello')));
    expect(sent[0].command).toBe('CreateEvent');
    expect(sent[0].input).toMatchObject({ memoryId: 'm-1', sessionId: 'c-1' });

    // THE FIX. A raw object here is what a field deployment lost conversations
    // to: the service stores its own host language's toString() of it and
    // returns a string nothing can decode. Text goes out, the same text comes
    // back.
    const blob = (sent[0].input.payload as { blob: unknown }[])[0].blob;
    expect(typeof blob).toBe('string');
    expect((JSON.parse(blob as string) as CheckpointEnvelope).format).toBe('conversation-v1');
  });

  it('round-trips a conversation through the shim, text out and text back', async () => {
    const { module } = fakeSdk();
    const sessions = agentCoreSessions({ store: 'memory', memoryId: 'm-1', _sdk: module });
    await sessions.persist('c-1', toEnvelope(conversation('remember this')));
    const revived = await sessions.hydrate('c-1');
    expect(revived?.data.history[0]).toMatchObject({ content: 'remember this' });
  });

  it('still accepts an object blob — a caller-supplied client may return one', async () => {
    const { module } = fakeSdk(toEnvelope(conversation('a real object')));
    const sessions = agentCoreSessions({ store: 'memory', memoryId: 'm-1', _sdk: module });
    expect((await sessions.hydrate('c-1'))?.data.history[0]).toMatchObject({
      content: 'a real object',
    });
  });

  it('maps hydrate onto ListEvents with payloads included and reads the blob back', async () => {
    const { module, sent } = fakeSdk();
    const sessions = agentCoreSessions({ store: 'memory', memoryId: 'm-1', _sdk: module });
    const revived = await sessions.hydrate('c-1');
    expect(sent[0].command).toBe('ListEvents');
    // Without includePayloads the events come back empty and every conversation
    // silently starts over.
    expect(sent[0].input).toMatchObject({ includePayloads: true, maxResults: 1 });
    expect(revived?.data.history[0]).toMatchObject({ content: 'from the cloud' });
  });

  it('says which SDK command is missing rather than failing obscurely', async () => {
    const { module } = fakeSdk();
    const stripped: BedrockAgentCoreSessionSdkModule = {
      BedrockAgentCoreClient: module.BedrockAgentCoreClient!,
    };
    const sessions = agentCoreSessions({ store: 'memory', memoryId: 'm-1', _sdk: stripped });
    await expect(sessions.persist('c-1', toEnvelope(conversation('x')))).rejects.toThrow(
      /CreateEventCommand/,
    );
  });

  it('says to update the SDK when the client class itself is absent', () => {
    expect(() => agentCoreSessions({ store: 'memory', memoryId: 'm-1', _sdk: {} })).toThrow(
      /BedrockAgentCoreClient/,
    );
  });

  it('an event carrying NO blob is an absence — and only that is a fresh start', async () => {
    const client: AgentCoreSessionClientLike = {
      createEvent: async () => undefined,
      listEvents: async () => ({ events: [{ eventId: 'e-1', envelope: null }] }),
    };
    const sessions = agentCoreSessions({ store: 'memory', memoryId: 'm-1', _client: client });
    // Nothing in that event ever claimed to be a session. Compare with the
    // describe below, where something did and could not be read.
    expect(await sessions.hydrate('c-1')).toBeUndefined();
  });
});

// ── the defect this release exists for: a mangled blob ──────────────
//
// Field-reproduced. Handed an OBJECT as an event's blob, the service stores its
// own host language's `toString()` rendering of it and returns THAT — not JSON,
// not decodable, and lossy, so there is nothing to migrate. The reader accepted
// only objects, so the string decoded to nothing and every stored conversation
// became invisible: `hydrate` answered "no session" and the agent started fresh
// over the top of a conversation that existed. Nobody sees that until a
// deployment boundary loses somebody's chat.
//
// Two halves are pinned here: the shim now writes JSON text (above), and a blob
// that is unreadable ANYWAY — a pre-7.22.1 envelope, or a service that mangles
// something else tomorrow — refuses LOUDLY instead of hydrating as undefined.

describe("agentCoreSessions({ store: 'memory' }) — an unreadable blob", () => {
  /** What the service actually returned for an envelope written as an object. */
  const MANGLED_BLOB =
    '{format=conversation-v1, data={version=1, runId=run-turn-one, history=[' +
    '{role=user, content=turn one}, {role=assistant, content=re: turn one}], ' +
    'lastCompletedIteration=1}, savedAt=1754000000000}';

  /** A client whose newest event carries exactly that. */
  function clientReturning(blob: unknown): AgentCoreSessionClientLike {
    return {
      createEvent: async () => undefined,
      listEvents: async () => ({ events: [{ eventId: 'e-1', envelope: blob }] }),
    };
  }

  it('is what the OLD reader silently called "no session" — pinned as the contrast', () => {
    // The pre-7.22.1 decode step, quoted so the regression has a shape a reader
    // can recognise rather than a description. It accepted objects only…
    const oldEnvelopeFromPayload = (payload: unknown): unknown => {
      if (!Array.isArray(payload)) return null;
      for (const part of payload) {
        const blob = (part as { blob?: unknown })?.blob;
        if (blob && typeof blob === 'object') return blob;
      }
      return null;
    };
    // …so the mangled string decoded to null…
    expect(oldEnvelopeFromPayload([{ blob: MANGLED_BLOB }])).toBeNull();
    // …and null was the same answer as "this session has never been used".
    // Two different facts, one answer, and the wrong one is a silent fresh
    // start on top of a live conversation.
  });

  it('refuses LOUDLY now, naming the session', async () => {
    const sessions = agentCoreSessions({
      store: 'memory',
      memoryId: 'm-1',
      _client: clientReturning(MANGLED_BLOB),
    });
    await expect(sessions.hydrate('c-1')).rejects.toBeInstanceOf(UnreadableEnvelopeError);
    await expect(sessions.hydrate('c-1')).rejects.toThrow(/session 'c-1'/);
    await expect(sessions.hydrate('c-1')).rejects.toThrow(/different facts/);
  });

  it('carries the code and a PREFIX of the blob, never the conversation', async () => {
    const sessions = agentCoreSessions({
      store: 'memory',
      memoryId: 'm-1',
      _client: clientReturning(MANGLED_BLOB),
    });
    const err = await sessions.hydrate('c-1').then(
      () => undefined,
      (e: unknown) => e as UnreadableEnvelopeError,
    );
    expect(err?.code).toBe('ERR_UNREADABLE_ENVELOPE');
    expect(err?.sessionId).toBe('c-1');
    // Enough to diagnose the mangling…
    expect(err?.storedPreview).toContain('format=conversation-v1');
    // …and not the conversation inside it.
    expect(err?.message).not.toContain('re: turn one');
  });

  it('names the session id the CALLER used, not the slug sent to the service', async () => {
    const sessions = agentCoreSessions({
      store: 'memory',
      memoryId: 'm-1',
      _client: clientReturning(MANGLED_BLOB),
    });
    // An incident is looked up by the id the application knows.
    await expect(sessions.hydrate('user@example.com/thread #1')).rejects.toThrow(
      /session 'user@example\.com\/thread #1'/,
    );
  });

  it('refuses through the real SDK shim too — the whole path, not just the seam', async () => {
    const { module } = fakeSdk(MANGLED_BLOB);
    const sessions = agentCoreSessions({ store: 'memory', memoryId: 'm-1', _sdk: module });
    await expect(sessions.hydrate('c-1')).rejects.toBeInstanceOf(UnreadableEnvelopeError);
  });

  it.each([
    ['JSON that is not an object', '"just a string"'],
    ['JSON null', 'null'],
    ['a number', 7],
    ['truncated JSON', '{"format":"conversation-v1","data":{'],
  ])('refuses %s the same way — present is not absent', async (_label, blob) => {
    const sessions = agentCoreSessions({
      store: 'memory',
      memoryId: 'm-1',
      _client: clientReturning(blob),
    });
    await expect(sessions.hydrate('c-1')).rejects.toBeInstanceOf(UnreadableEnvelopeError);
  });

  it.each([
    ['a payload with no blob key at all', [{ conversational: { text: 'hi' } }]],
    ['a blob key holding nothing', [{ blob: null }]],
    ['a payload that is not a list', 'not-a-list'],
  ])('%s is an ABSENCE — nothing there claimed to be a session', async (_label, payload) => {
    const { module } = fakeSdk(undefined, payload);
    const sessions = agentCoreSessions({ store: 'memory', memoryId: 'm-1', _sdk: module });
    expect(await sessions.hydrate('c-1')).toBeUndefined();
  });

  it('a JSON-text blob written by this release reads back with no refusal at all', async () => {
    const sessions = agentCoreSessions({
      store: 'memory',
      memoryId: 'm-1',
      _client: clientReturning(JSON.stringify(toEnvelope(conversation('healthy')))),
    });
    expect((await sessions.hydrate('c-1'))?.data.history[0]).toMatchObject({ content: 'healthy' });
  });
});

// ── the session id is a KEY, and two of them may never become one ────

/**
 * `safeSessionId` makes a caller's id legal for AgentCore, and the whole risk
 * of that job is that making something legal is easy to do by FOLDING — replace
 * every illegal character with `-` and `a:b`, `a/b` and `a-b` are one key, and
 * one key is one conversation. The id arrives in
 * `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id`, so it is chosen by whoever is
 * calling: a fold is not a rare accident, it is something a caller can go and
 * look for. Same defect class as the identity namespace fixed in 9.40.0, with
 * the collision moved from server-side identity to the whole key.
 *
 * These assert on the id the adapter actually SENT, because that string is the
 * storage key and nothing downstream can recover a distinction lost here.
 */
describe("agentCoreSessions({ store: 'memory' }) — the session id mapping is injective", () => {
  /** Ids chosen so that a plausible normalisation folds at least one pair. */
  const corpus = [
    'a-b',
    'a_b',
    'a:b',
    'a/b',
    'a%2Fb',
    'a.b',
    'a b',
    'AB',
    'ab',
    '..',
    './..',
    'ünïcødé-😀-id',
    `quote'and"double`,
    "'; DROP TABLE agent_sessions; --",
    '\0-ish-but-not-really',
    '_enc_a-b',
    '_enc_a_u002fb',
    'x'.repeat(400),
    `${'x'.repeat(400)}A`,
    `${'x'.repeat(400)}B`,
    `${'y'.repeat(400)}:1`,
    `${'y'.repeat(400)}-1`,
  ];

  it('maps every distinct id to a distinct storage key', async () => {
    const client = fakeMemoryClient();
    const sessions = agentCoreSessions({ store: 'memory', memoryId: 'm-1', _client: client });
    for (const id of corpus) {
      await sessions.persist(id, toEnvelope(conversation(id)));
    }
    const keys = client.appended.map((event) => event.sessionId);
    expect(new Set(keys).size).toBe(new Set(corpus).size);
  });

  it('answers each id with its OWN conversation', async () => {
    const client = fakeMemoryClient();
    const sessions = agentCoreSessions({ store: 'memory', memoryId: 'm-1', _client: client });
    for (const id of corpus) {
      await sessions.persist(id, toEnvelope(conversation(id)));
    }
    for (const id of corpus) {
      const back = await sessions.hydrate(id);
      expect(back?.data.history[0]).toMatchObject({ content: id });
    }
  });

  it('never sends a key AgentCore would reject, and never sends an over-long one', async () => {
    const client = fakeMemoryClient();
    const sessions = agentCoreSessions({ store: 'memory', memoryId: 'm-1', _client: client });
    for (const id of corpus) {
      await sessions.persist(id, toEnvelope(conversation(id)));
    }
    for (const key of client.appended.map((event) => event.sessionId)) {
      expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(key.length).toBeLessThanOrEqual(99);
    }
  });

  it('leaves an id that was already legal exactly as it found it', async () => {
    // The migration promise: this fix re-keys nothing that used to work. An id
    // already inside `[A-Za-z0-9_-]` was stored verbatim before and still is,
    // so no deployment loses a session to the encoder.
    const client = fakeMemoryClient();
    const sessions = agentCoreSessions({ store: 'memory', memoryId: 'm-1', _client: client });
    const legal = ['c-1', 'user_123', 'a-b', '9f8e7d6c-1234-4abc-9def-000000000000', 'A_-9'];
    for (const id of legal) {
      await sessions.persist(id, toEnvelope(conversation(id)));
    }
    expect(client.appended.map((event) => event.sessionId)).toEqual(legal);
  });
});

// ── a session id is data, not a property name ───────────────────────

describe("agentCoreSessions({ store: 'session-storage' }) — prototype names are not sessions", () => {
  // The file-backed mode keeps every session as a property of one JSON object,
  // and the session id arrives in a caller-controlled header. A bare lookup
  // therefore answers for ids that name `Object.prototype` members — so an
  // EMPTY store refused `constructor` by name, telling a caller their session
  // held "a STORED conversation this runtime cannot read". Permanently, for
  // that id, on a store that had never been written to.
  const prototypeNames = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'];

  for (const name of prototypeNames) {
    it(`answers undefined for '${name}' on a store that has never been written to`, async () => {
      const sessions = agentCoreSessions({
        store: 'session-storage',
        path: await tempPath(),
      });
      await expect(sessions.hydrate(name)).resolves.toBeUndefined();
    });
  }

  it('still round-trips a session whose id happens to be a prototype name', async () => {
    const sessions = agentCoreSessions({ store: 'session-storage', path: await tempPath() });
    for (const name of prototypeNames) {
      await sessions.persist(name, toEnvelope(conversation(`stored under ${name}`)));
    }
    for (const name of prototypeNames) {
      expect((await sessions.hydrate(name))?.data.history[0]).toMatchObject({
        content: `stored under ${name}`,
      });
    }
  });
});
