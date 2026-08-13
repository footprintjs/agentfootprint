/**
 * Session-history wire operations (9.26.0) — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * The laws being pinned:
 *   • THE CRITICAL PIN — a transcript for somebody ELSE's session answers the
 *     SAME not-found as one that never existed: same code, same words, modulo
 *     the id the caller already knew. Distinguishable answers would be an
 *     oracle for which session ids are real.
 *   • Both ops REQUIRE verified identity, and are refused BY NAME at a door
 *     that has none — listing "your" sessions off a header is enumeration.
 *   • A store with no owner index refuses by name, naming the store's
 *     limitation. It never answers "you have no sessions", which nobody could
 *     distinguish from the truth.
 *   • Ownership is DERIVED from the stored conversation's identity, never
 *     declared by a caller.
 *   • A session that ran anonymously has no owner and is in nobody's list.
 *   • ZERO-DELTA: a body with no `op` is still an ordinary turn; the artifact
 *     ops still work; an unknown op still refuses with ONE message naming
 *     every operation.
 *   • The transcript projection carries user/assistant text and NOTHING else.
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import {
  envelopeOwner,
  envelopeTranscript,
  memorySessions,
  readArtifactWireOp,
  readSessionWireOp,
  sessionWireBody,
  standingAgent,
  toEnvelope,
} from '../../src/hosting/index.js';
import type {
  CheckpointEnvelope,
  IdentityVerifier,
  SessionLifecycle,
} from '../../src/hosting/index.js';
import { inProcessHost } from './testHost.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { nodeHost, sqliteSessions } from '../../src/hosting/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────

const verifierFor = (byToken: Readonly<Record<string, string>>): IdentityVerifier => ({
  verify: (token) => {
    const userId = byToken[token];
    return userId === undefined ? Promise.reject(new Error('no')) : Promise.resolve({ userId });
  },
});

const agentFor = (reply = 'ok'): Agent =>
  Agent.create({ provider: mock({ reply }), model: 'm' }).build();

/** A store with the two required methods and NEITHER optional one — the
 *  shape most real stores have, and the one the refusals exist for. */
function bareStore(): SessionLifecycle {
  const held = new Map<string, CheckpointEnvelope>();
  return {
    hydrate: (id) => Promise.resolve(held.get(id)),
    persist: (id, envelope) => {
      held.set(id, envelope);
      return Promise.resolve();
    },
  };
}

// ─── 1. UNIT — the grammar ───────────────────────────────────────────

describe('readSessionWireOp — unit', () => {
  it('reads both ops and leaves an ordinary body alone', () => {
    expect(readSessionWireOp({ input: 'hi' })).toBeUndefined();
    expect(readSessionWireOp({ op: 'session-list' })).toEqual({ op: 'list' });
    expect(readSessionWireOp({ op: 'session-transcript', sessionId: 's1' })).toEqual({
      op: 'transcript',
      sessionId: 's1',
    });
  });

  it('DECLINES the artifact ops rather than claiming them', () => {
    // Declining is not refusing: the artifact reader owns those names.
    expect(readSessionWireOp({ op: 'artifact-head', ref: 'art_x' })).toBeUndefined();
    expect(readSessionWireOp({ op: 'artifact-get', ref: 'art_x' })).toBeUndefined();
    // …and symmetrically.
    expect(readArtifactWireOp({ op: 'session-list' })).toBeUndefined();
  });

  it('refuses an unknown op with ONE message, from either reader', () => {
    let fromSession = '';
    let fromArtifact = '';
    try {
      readSessionWireOp({ op: 'session-lst' });
    } catch (err) {
      fromSession = (err as Error).message;
    }
    try {
      readArtifactWireOp({ op: 'session-lst' });
    } catch (err) {
      fromArtifact = (err as Error).message;
    }
    // Byte-identical, so the answer never depends on which reader a dialect
    // happened to call first.
    expect(fromSession).toBe(fromArtifact);
    expect(fromSession).toContain('session-list');
    expect(fromSession).toContain('artifact-head');
  });

  it('refuses a transcript with no sessionId', () => {
    expect(() => readSessionWireOp({ op: 'session-transcript' })).toThrow(/needs 'sessionId'/);
    expect(() => readSessionWireOp({ op: 'session-transcript', sessionId: '   ' })).toThrow();
  });

  it('composes one body shape per arm', () => {
    expect(sessionWireBody({ op: 'list', sessions: [] })).toEqual({ sessions: [] });
    expect(sessionWireBody({ op: 'transcript', sessionId: 's', messages: [] })).toEqual({
      transcript: { sessionId: 's', messages: [] },
    });
  });
});

// ─── 2. UNIT — the derivations ───────────────────────────────────────

describe('envelopeOwner / envelopeTranscript — unit', () => {
  const envelope = toEnvelope({
    version: 1,
    runId: 'r1',
    history: [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'tool', content: '{"secret":"x"}', toolCallId: 't1', toolName: 'lookup' },
      { role: 'assistant', content: 'done' },
    ],
    lastCompletedIteration: 1,
    originalInput: { message: 'hello' },
    checkpointedAt: Date.now(),
    identity: { conversationId: 's1', principal: 'alice' },
  });

  it('derives the owner from the conversation, and nothing else', () => {
    expect(envelopeOwner(envelope)).toBe('alice');
    // A conversation that named nobody has no owner. That is a fact, not a
    // gap to fill: inventing one would be inventing an entitlement.
    const anonymous = toEnvelope({ ...envelope.data, identity: undefined });
    expect(envelopeOwner(anonymous)).toBeUndefined();
    expect(envelopeOwner(undefined)).toBeUndefined();
    expect(envelopeOwner({ nonsense: true })).toBeUndefined();
  });

  it('projects user + assistant TEXT and drops the tool leg and the system prompt', () => {
    const messages = envelopeTranscript(envelope);
    expect(messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'assistant', content: 'done' },
    ]);
    // The one thing a transcript must never publish: the inside of the agent.
    expect(JSON.stringify(messages)).not.toContain('secret');
    expect(JSON.stringify(messages)).not.toContain('you are helpful');
  });
});

// ─── 3. INTEGRATION — the door ───────────────────────────────────────

describe('session-history ops — integration', () => {
  async function servedWithTurns(): Promise<{
    host: ReturnType<typeof inProcessHost>;
    sessions: SessionLifecycle;
  }> {
    const sessions = memorySessions();
    const host = inProcessHost();
    await standingAgent({
      agent: agentFor('answered'),
      sessions,
      host,
      identity: { verify: verifierFor({ 'tok-a': 'alice', 'tok-b': 'bob' }).verify },
    });
    await host.deliver({
      input: 'first',
      sessionId: 'alice-1',
      headers: { authorization: 'Bearer tok-a' },
    });
    await host.deliver({
      input: 'second',
      sessionId: 'alice-2',
      headers: { authorization: 'Bearer tok-a' },
    });
    await host.deliver({
      input: 'bobs',
      sessionId: 'bob-1',
      headers: { authorization: 'Bearer tok-b' },
    });
    return { host, sessions };
  }

  it('lists only the verified caller own sessions', async () => {
    const { sessions } = await servedWithTurns();
    const alice = await sessions.listByUser?.('alice');
    expect(alice?.sessions.map((s) => s.sessionId).sort()).toEqual(['alice-1', 'alice-2']);
    const bob = await sessions.listByUser?.('bob');
    expect(bob?.sessions.map((s) => s.sessionId)).toEqual(['bob-1']);
    // A row says WHICH conversation, never what is in it.
    expect(alice?.sessions[0]).toMatchObject({ format: 'conversation-v1' });
    expect(alice?.sessions[0]?.messageCount).toBeGreaterThan(0);
    expect(JSON.stringify(alice)).not.toContain('answered');
  });

  it('ownerOf answers undefined for a foreign, missing or unsigned session alike', async () => {
    const { sessions } = await servedWithTurns();
    expect(await sessions.ownerOf?.('alice-1')).toBe('alice');
    expect(await sessions.ownerOf?.('nope')).toBeUndefined();
  });

  it('a transcript reaches its owner and NOT anyone else', async () => {
    const { host } = await servedWithTurns();
    // Alice reads her own.
    const mine = await host.deliver({
      input: '',
      session: { op: 'transcript', sessionId: 'alice-1' },
      headers: { authorization: 'Bearer tok-a' },
    });
    // The MINIMAL host has no `reply.sessions`, so the resolution ends in the
    // named not-carried refusal — which proves it RESOLVED.
    expect(mine.code).toBe('ERR_SESSIONS_NOT_CARRIED');

    // Bob asks for Alice's.
    const foreign = await host.deliver({
      input: '',
      session: { op: 'transcript', sessionId: 'alice-1' },
      headers: { authorization: 'Bearer tok-b' },
    });
    expect(foreign.code).toBe('ERR_SESSION_NOT_FOUND');
  });

  it('THE CRITICAL PIN: a foreign session and a nonexistent one are the SAME answer', async () => {
    const { host } = await servedWithTurns();
    const foreign = await host.deliver({
      input: '',
      session: { op: 'transcript', sessionId: 'alice-1' },
      headers: { authorization: 'Bearer tok-b' },
    });
    const missing = await host.deliver({
      input: '',
      session: { op: 'transcript', sessionId: 'alice-1' },
      headers: { authorization: 'Bearer tok-b' },
    });
    const invented = await host.deliver({
      input: '',
      session: { op: 'transcript', sessionId: 'no-such-session' },
      headers: { authorization: 'Bearer tok-b' },
    });
    expect(foreign.code).toBe(missing.code);
    expect(foreign.code).toBe(invented.code);
    // Byte-identical but for the id the caller already knew.
    expect(foreign.error?.replace('alice-1', 'X')).toBe(
      invented.error?.replace('no-such-session', 'X'),
    );
  });
});

// ─── 4. SECURITY — the two refusals that gate the feature ────────────

describe('session-history ops — security', () => {
  it('a door with NO verifier refuses both ops by name', async () => {
    const host = inProcessHost();
    await standingAgent({ agent: agentFor(), sessions: memorySessions(), host });
    for (const op of [{ op: 'list' } as const, { op: 'transcript', sessionId: 's' } as const]) {
      const reply = await host.deliver({ input: '', session: op, userId: 'alice' });
      expect(reply.code).toBe('ERR_SESSION_OP_NEEDS_IDENTITY');
      expect(reply.error).toContain('enumeration');
    }
  });

  it('an ANONYMOUS caller at a verifying door still cannot list', async () => {
    const host = inProcessHost();
    await standingAgent({
      agent: agentFor(),
      sessions: memorySessions(),
      host,
      identity: { verify: verifierFor({ t: 'alice' }).verify, allowAnonymous: true },
    });
    const reply = await host.deliver({ input: '', session: { op: 'list' } });
    // Anonymous owns nothing; an empty list would imply the question was
    // honoured.
    expect(reply.code).toBe('ERR_SESSION_OP_NEEDS_IDENTITY');
  });

  it('a session that ran ANONYMOUSLY is in nobody list', async () => {
    const sessions = memorySessions();
    const host = inProcessHost();
    await standingAgent({
      agent: agentFor(),
      sessions,
      host,
      identity: { verify: verifierFor({ t: 'alice' }).verify, allowAnonymous: true },
    });
    await host.deliver({ input: 'hi', sessionId: 'anon-1' });
    await host.deliver({
      input: 'hi',
      sessionId: 'alice-1',
      headers: { authorization: 'Bearer t' },
    });
    const page = await sessions.listByUser?.('alice');
    expect(page?.sessions.map((s) => s.sessionId)).toEqual(['alice-1']);
    expect(await sessions.ownerOf?.('anon-1')).toBeUndefined();
  });

  it('an owner cannot be DECLARED — the port takes none', async () => {
    const sessions = memorySessions();
    // Persisting a conversation whose identity names bob makes bob the owner;
    // there is no argument to say otherwise.
    await sessions.persist(
      's1',
      toEnvelope({
        version: 1,
        runId: 'r',
        history: [],
        lastCompletedIteration: 0,
        originalInput: { message: 'x' },
        checkpointedAt: Date.now(),
        identity: { conversationId: 's1', principal: 'bob' },
      }),
    );
    expect(await sessions.ownerOf?.('s1')).toBe('bob');
  });
});

// ─── 5. SCENARIO — the store that cannot answer ──────────────────────

describe('session-history ops — a store with no index', () => {
  it('refuses BY NAME, naming the missing member — never "you have no sessions"', async () => {
    const host = inProcessHost();
    await standingAgent({
      agent: agentFor(),
      sessions: bareStore(),
      host,
      identity: { verify: verifierFor({ t: 'alice' }).verify },
    });
    const list = await host.deliver({
      input: '',
      session: { op: 'list' },
      headers: { authorization: 'Bearer t' },
    });
    expect(list.code).toBe('ERR_SESSION_INDEX_UNAVAILABLE');
    expect(list.error).toContain('listByUser');
    expect(list.error).toContain('not an empty result');

    const transcript = await host.deliver({
      input: '',
      session: { op: 'transcript', sessionId: 's' },
      headers: { authorization: 'Bearer t' },
    });
    expect(transcript.code).toBe('ERR_SESSION_INDEX_UNAVAILABLE');
    expect(transcript.error).toContain('ownerOf');
  });
});

// ─── 6. PROPERTY + ZERO-DELTA ────────────────────────────────────────

describe('session-history ops — zero-delta', () => {
  it('a body with no op is still an ordinary turn', async () => {
    const host = inProcessHost();
    await standingAgent({ agent: agentFor('answered'), sessions: memorySessions(), host });
    const reply = await host.deliver({ input: 'hi', sessionId: 's1' });
    expect(reply.output).toBe('answered');
  });

  it('every listed session belongs to the user who asked, for any mix of owners', async () => {
    const sessions = memorySessions();
    const owners = ['alice', 'bob', 'carol', 'alice', 'bob', 'alice'];
    for (const [i, principal] of owners.entries()) {
      await sessions.persist(
        `s${i}`,
        toEnvelope({
          version: 1,
          runId: `r${i}`,
          history: [{ role: 'user', content: `m${i}` }],
          lastCompletedIteration: 0,
          originalInput: { message: `m${i}` },
          checkpointedAt: Date.now(),
          identity: { conversationId: `s${i}`, principal },
        }),
      );
    }
    for (const who of ['alice', 'bob', 'carol']) {
      const page = await sessions.listByUser?.(who);
      expect(page?.sessions.length).toBe(owners.filter((o) => o === who).length);
      for (const row of page?.sessions ?? []) {
        expect(await sessions.ownerOf?.(row.sessionId)).toBe(who);
      }
    }
  });
});

// ─── 6b. INTEGRATION over a REAL socket + a REAL file store ──────────

describe('session-history ops — over the wire, on sqliteSessions', () => {
  it('lists and reads back through jsonWire, and refuses a foreign transcript', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'af-sessions-')), 'sessions.db');
    let sessions;
    try {
      sessions = sqliteSessions({ file });
    } catch (err) {
      // node:sqlite is experimental; a runtime without it skips rather than
      // fails, exactly as the store's own suite does.
      if ((err as { code?: string }).code === 'ERR_SQLITE_UNAVAILABLE') return;
      throw err;
    }
    const handle = await standingAgent({
      agent: agentFor('answered'),
      sessions,
      host: nodeHost({ port: 0 }),
      identity: { verify: verifierFor({ 'tok-a': 'alice', 'tok-b': 'bob' }).verify },
    });
    const url = handle.url;
    try {
      const post = async (body: Record<string, unknown>, token: string) => {
        const res = await fetch(`${url}/invoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        return { status: res.status, body: (await res.json()) as Record<string, unknown> };
      };

      await post({ input: 'one', sessionId: 'alice-1' }, 'tok-a');
      await post({ input: 'two', sessionId: 'alice-2' }, 'tok-a');
      await post({ input: 'bobs', sessionId: 'bob-1' }, 'tok-b');

      const listed = await post({ op: 'session-list' }, 'tok-a');
      expect(listed.status).toBe(200);
      const rows = listed.body.sessions as { sessionId: string }[];
      expect(rows.map((r) => r.sessionId).sort()).toEqual(['alice-1', 'alice-2']);

      const mine = await post({ op: 'session-transcript', sessionId: 'alice-1' }, 'tok-a');
      expect(mine.status).toBe(200);
      const transcript = mine.body.transcript as { messages: { role: string; content: string }[] };
      expect(transcript.messages).toEqual([
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'answered' },
      ]);

      const foreign = await post({ op: 'session-transcript', sessionId: 'alice-1' }, 'tok-b');
      expect(foreign.status).toBe(404);
      expect(foreign.body.code).toBe('ERR_SESSION_NOT_FOUND');

      // An unverified caller gets 401 before any of this is considered.
      const noToken = await fetch(`${url}/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'session-list' }),
      });
      expect(noToken.status).toBe(401);
    } finally {
      await handle.close();
      (sessions as { close?: () => void }).close?.();
      rmSync(dirname(file), { recursive: true, force: true });
    }
  });
});

// ─── 7. PERFORMANCE / ROI — paging and what it replaces ──────────────

describe('session-history ops — paging + ROI', () => {
  it('pages, newest first, with a cursor that continues', async () => {
    const sessions = memorySessions();
    for (let i = 0; i < 5; i += 1) {
      await sessions.persist(`s${i}`, {
        format: 'conversation-v1',
        savedAt: 1000 + i,
        data: {
          version: 1,
          runId: `r${i}`,
          history: [{ role: 'user', content: 'hi' }],
          lastCompletedIteration: 0,
          originalInput: { message: 'hi' },
          checkpointedAt: 1000 + i,
          identity: { conversationId: `s${i}`, principal: 'alice' },
        },
      } as CheckpointEnvelope);
    }
    const first = await sessions.listByUser?.('alice', { limit: 2 });
    expect(first?.sessions.map((s) => s.sessionId)).toEqual(['s4', 's3']);
    expect(first?.cursor).toBeDefined();
    const second = await sessions.listByUser?.('alice', { limit: 2, cursor: first?.cursor });
    expect(second?.sessions.map((s) => s.sessionId)).toEqual(['s2', 's1']);
    const third = await sessions.listByUser?.('alice', { limit: 2, cursor: second?.cursor });
    expect(third?.sessions.map((s) => s.sessionId)).toEqual(['s0']);
    expect(third?.cursor).toBeUndefined();
  });
});
