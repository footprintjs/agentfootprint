/**
 * agentCoreSessions — where a conversation lives between requests.
 *
 * Two modes, one port, and one law inherited rather than re-implemented: an
 * envelope whose `format` this runtime does not know is refused BY NAME, never
 * half-restored. Both modes are asserted against that.
 *
 * `{ store: 'session-storage' }` is real: it writes a real file to a real temp
 * directory and reads it back, including across a fresh adapter instance, which
 * is what "survives a stop/resume" actually means.
 *
 * `{ store: 'memory' }` is **contract-mapped and injection-tested**: every AWS
 * interaction goes through the `_client` seam, and the SDK shim itself is
 * exercised with a fake `_sdk` module. No test here reaches AWS, and none
 * pretends to — real-cloud verification lands with a field deployment.
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
import { toEnvelope } from '../../src/hosting/index.js';
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
  /** A fake `@aws-sdk/client-bedrock-agentcore` that records what it was sent. */
  function fakeSdk() {
    const sent: { command: string; input: Record<string, unknown> }[] = [];
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
          if (typed.__name === 'ListEvents') {
            return {
              events: [
                {
                  eventId: 'e-1',
                  payload: [{ blob: toEnvelope(conversation('from the cloud')) }],
                },
              ],
            };
          }
          return {};
        }
      } as unknown as BedrockAgentCoreSessionSdkModule['BedrockAgentCoreClient'],
      CreateEventCommand: command('CreateEvent') as never,
      ListEventsCommand: command('ListEvents') as never,
    };
    return { module, sent };
  }

  it('maps persist onto CreateEvent with the envelope as the blob payload', async () => {
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
    expect((sent[0].input.payload as { blob: CheckpointEnvelope }[])[0].blob.format).toBe(
      'conversation-v1',
    );
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

  it('an unreadable payload is "no conversation", never a corrupted one', async () => {
    const client: AgentCoreSessionClientLike = {
      createEvent: async () => undefined,
      listEvents: async () => ({ events: [{ eventId: 'e-1', envelope: null }] }),
    };
    const sessions = agentCoreSessions({ store: 'memory', memoryId: 'm-1', _client: client });
    expect(await sessions.hydrate('c-1')).toBeUndefined();
  });
});
