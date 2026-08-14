/**
 * The missing half of the write-once rule (9.36.1).
 *
 * ── The defect, as a live trial found it ────────────────────────────────────
 * Two real transactions wrote the same fresh session concurrently. Both
 * `persist()` calls fulfilled; the second was genuinely retried. The result:
 *
 *     ownerOf(session)       = race-alice
 *     envelopeOwner(hydrate) = race-bob
 *
 * The write-once rule preserved the FIRST writer's top-level `owner` while
 * storing the SECOND writer's complete envelope — and an envelope carries its
 * own identity. So the ownership INDEX said Alice and the stored CONVERSATION
 * said Bob. Alice lists it, Alice opens it, and reads Bob's conversation.
 *
 * It was not one backend's bug. The same shape was in all four stores,
 * because the flaw was in the CONTRACT: write-once protected the index and
 * said nothing about the payload.
 *
 * The laws pinned here:
 *   • a DIFFERENT non-empty identity is REFUSED — index and envelope both;
 *   • an ABSENT identity is ALLOWED, because the contract blesses it in as
 *     many words ("a later turn carrying a leaner identity must not erase
 *     it"). An absence claims nobody and so contradicts nobody;
 *   • the refusal teaches and names NO principal, owner, conversation text or
 *     credential;
 *   • **the refusal cannot fire on a flow the composer blesses** — a verifying
 *     door refuses a foreign turn long before the store is asked.
 *
 * Every store is held to the behaviour by `session-lifecycle-conformance.test.ts`.
 * What is here is the rule itself, the refusal's own manners, and the composed
 * end-to-end flows.
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import {
  envelopeOwner,
  memorySessions,
  resolveSessionOwner,
  SessionOwnershipConflictError,
  standingAgent,
} from '../../src/hosting/index.js';
import type { CheckpointEnvelope, IdentityVerifier } from '../../src/hosting/index.js';
import { inProcessHost } from './testHost.js';

// ─── Fixtures ────────────────────────────────────────────────────────

const SECRET = 'SECRET-BOB-TEXT card 4111 1111 1111 1111';

function envelope(text: string, principal?: string): CheckpointEnvelope {
  return {
    format: 'conversation-v1',
    savedAt: 1_700_000_000_000,
    data: {
      version: 1,
      runId: 'run-1',
      history: [{ role: 'user', content: text }],
      lastCompletedIteration: 1,
      originalInput: { message: text },
      checkpointedAt: 1_700_000_000_000,
      ...(principal !== undefined && { identity: { principal } }),
    },
  } as CheckpointEnvelope;
}

const verifierFor = (byToken: Readonly<Record<string, string>>): IdentityVerifier => ({
  verify: (token) => {
    const userId = byToken[token];
    return userId === undefined
      ? Promise.reject(new Error('no such token'))
      : Promise.resolve({ userId });
  },
});

const plainAgent = (): Agent =>
  Agent.create({ provider: mock({ respond: () => 'answered' }), model: 'm' }).build();

// ─── unit — the rule, every row of its table ─────────────────────────

describe('resolveSessionOwner — the one owner-transition rule', () => {
  it('fills in when nothing is claimed yet: the first turn that SIGNS owns it', () => {
    expect(resolveSessionOwner('s', undefined, 'alice')).toBe('alice');
    expect(resolveSessionOwner('s', undefined, undefined)).toBeUndefined();
  });

  it('KEEPS the owner through a leaner turn — the case the contract blesses', () => {
    expect(resolveSessionOwner('s', 'alice', undefined)).toBe('alice');
  });

  it('keeps the owner through the ordinary turn', () => {
    expect(resolveSessionOwner('s', 'alice', 'alice')).toBe('alice');
  });

  it('REFUSES a different signer — the security case', () => {
    expect(() => resolveSessionOwner('s', 'alice', 'bob')).toThrow(SessionOwnershipConflictError);
  });

  it("reads '' as nobody on both sides, so an empty column is not a principal", () => {
    expect(resolveSessionOwner('s', '', 'alice')).toBe('alice');
    expect(resolveSessionOwner('s', 'alice', '')).toBe('alice');
    expect(resolveSessionOwner('s', '', '')).toBeUndefined();
  });
});

// ─── security — the refusal's own manners ────────────────────────────

describe('the ownership refusal teaches, and leaks nothing', () => {
  const raised = (): SessionOwnershipConflictError => {
    try {
      resolveSessionOwner('sess-42', 'alice@example.com', 'mallory@example.com');
      throw new Error('it did not refuse');
    } catch (err) {
      expect(err).toBeInstanceOf(SessionOwnershipConflictError);
      return err as SessionOwnershipConflictError;
    }
  };

  it('names NO principal, owner, conversation text or credential', () => {
    const text = `${raised().name}: ${raised().message}`;
    for (const secret of ['alice', 'mallory', 'example.com', SECRET]) {
      expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it('names the operation and says what to do instead', () => {
    const { message, code, sessionId } = raised();
    // The operation, so a log line says which call refused.
    expect(message).toContain('persist');
    // The caller's OWN string — the one thing repeating it teaches nobody.
    expect(message).toContain('sess-42');
    expect(sessionId).toBe('sess-42');
    // Two courses of action, not just a complaint.
    expect(message).toContain('NEW session id');
    expect(message).toContain('standingAgent');
    expect(code).toBe('ERR_SESSION_OWNERSHIP_CONFLICT');
  });
});

// ─── scenario — the field trial's exact shape, in a store ────────────

describe('the field trial’s split brain, in the smallest store', () => {
  it('the index and the stored conversation can no longer name different people', async () => {
    const sessions = memorySessions();
    await sessions.persist('race', envelope('alice speaking', 'race-alice'));

    await expect(sessions.persist('race', envelope(SECRET, 'race-bob'))).rejects.toBeInstanceOf(
      SessionOwnershipConflictError,
    );

    // The reported failure, asserted as the equality it should always have been.
    expect(await sessions.ownerOf?.('race')).toBe('race-alice');
    expect(envelopeOwner(await sessions.hydrate('race'))).toBe('race-alice');
    // And the half the original fix would have missed: Bob's conversation is
    // not sitting under Alice's name.
    expect(JSON.stringify(await sessions.hydrate('race'))).not.toContain(SECRET);
  });
});

// ─── integration — the composer, both doors ──────────────────────────

describe('the refusal cannot fire on a flow the composer blesses', () => {
  it('a VERIFYING door refuses a foreign turn at the door — the store is never asked', async () => {
    const sessions = memorySessions();
    const host = inProcessHost();
    await standingAgent({
      agent: plainAgent(),
      sessions,
      host,
      identity: { verify: verifierFor({ 'tok-a': 'alice', 'tok-b': 'bob' }).verify },
    });

    await host.deliver({
      input: 'bob speaking',
      sessionId: 's1',
      headers: { authorization: 'Bearer tok-b' },
    });
    const hijack = await host.deliver({
      input: 'mine now',
      sessionId: 's1',
      headers: { authorization: 'Bearer tok-a' },
    });

    // The DOOR's refusal, not the store's — the one indistinguishable answer,
    // raised before a byte of Bob's conversation is hydrated. A caller must
    // never be able to tell "somebody else's session" from "no such session",
    // and an ownership-conflict error escaping here would tell them.
    expect(hijack.code).toBe('ERR_SESSION_NOT_FOUND');
    expect(hijack.code).not.toBe('ERR_SESSION_OWNERSHIP_CONFLICT');
  });

  it('a request naming NOBODY still continues an owned session', async () => {
    const sessions = memorySessions();
    const host = inProcessHost();
    await standingAgent({ agent: plainAgent(), sessions, host });

    const first = await host.deliver({ input: 'hello', sessionId: 's1', userId: 'alice' });
    expect(first.output).toBe('answered');
    expect(await sessions.ownerOf?.('s1')).toBe('alice');

    const leaner = await host.deliver({ input: 'still me', sessionId: 's1' });
    expect(leaner.error).toBeUndefined();
    expect(leaner.output).toBe('answered');
    expect(await sessions.ownerOf?.('s1')).toBe('alice');
    expect((await sessions.listByUser?.('alice'))?.sessions.map((s) => s.sessionId)).toEqual([
      's1',
    ]);

    // ── And WHY this turn is never a conflict, which is worth pinning ──
    // The stored conversation still names alice. A continued run carries the
    // prior checkpoint's identity forward, so a request that names nobody does
    // NOT produce an envelope that names nobody — the composer keeps it.
    //
    // Two things follow, and both are load-bearing:
    //  1. this turn is the SAME signer, not an absence, so it could never have
    //     been the conflict case;
    //  2. the composer cannot leave an OWNED session's envelope ownerless, so
    //     the one state where the index and the envelope legitimately differ
    //     is not reachable through this door at all. A store used directly can
    //     still produce it, which is what the store-level cases above cover.
    expect(envelopeOwner(await sessions.hydrate('s1'))).toBe('alice');
  });

  it('and the owner is never locked out of their own conversation', async () => {
    const sessions = memorySessions();
    const host = inProcessHost();
    await standingAgent({ agent: plainAgent(), sessions, host });
    for (let turn = 0; turn < 4; turn++) {
      const reply = await host.deliver({ input: `turn ${turn}`, sessionId: 's1', userId: 'alice' });
      expect(reply.error).toBeUndefined();
    }
    expect(await sessions.ownerOf?.('s1')).toBe('alice');
  });
});

describe('the one flow that used to succeed and now refuses', () => {
  it('a HEADER-TRUST door: a different named user on one session id is refused', async () => {
    // Stated plainly because it is the behaviour change: at a door with NO
    // verifier, `HostRequest.userId` is believed, and two different believed
    // users on one session id is precisely how the split brain was produced.
    // It is refused now. That is a bug fix — the write that used to "succeed"
    // stored one person's conversation under another's name — and the way to
    // avoid ever meeting it is to configure a verifier, which refuses the same
    // turn at the door with the indistinguishable not-found instead.
    const sessions = memorySessions();
    const host = inProcessHost();
    await standingAgent({ agent: plainAgent(), sessions, host });

    await host.deliver({ input: 'alice speaking', sessionId: 's1', userId: 'alice' });
    const foreign = await host.deliver({ input: SECRET, sessionId: 's1', userId: 'bob' });

    expect(foreign.code).toBe('ERR_SESSION_OWNERSHIP_CONFLICT');
    // Nothing moved, and nothing of Bob's landed under Alice's name.
    expect(await sessions.ownerOf?.('s1')).toBe('alice');
    expect(JSON.stringify(await sessions.hydrate('s1'))).not.toContain(SECRET);
    // The refusal reaching a caller still carries no identity material.
    expect(foreign.error ?? '').not.toContain('alice');
    expect(foreign.error ?? '').not.toContain('bob');
  });
});
