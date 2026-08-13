/**
 * Verified identity at the hosting door (9.26.0) — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * The laws being pinned:
 *   • THE ZERO-DELTA PIN — with no `identity` option, a request with a
 *     `userId` header behaves EXACTLY as it did in 9.25: same principal on the
 *     run, same answer, no refusal. Nothing about the door changes until an
 *     operator asks for it.
 *   • THE CRITICAL PIN — a request that NAMES a user without a verifiable
 *     token is refused when verification is configured. Never downgraded to
 *     anonymous, never served under the claimed name.
 *   • The token is never in an error, an event, or a reply body. Not
 *     truncated, not fingerprinted — the refusal names the CLASS.
 *   • A verified token's subject becomes the run's principal: the whole chain
 *     from the front door to `EventMeta.principal`.
 *   • Token proves A, header says B ⇒ refused. Neither is served.
 *   • Anonymous is closed by default and opened only by `allowAnonymous`.
 *   • `bearerToken` reads exactly one shape and declines the rest.
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/index.js';
import type { AgentfootprintEvent } from '../../src/events.js';
import { mock } from '../../src/llm-providers.js';
import {
  bearerToken,
  IdentityNotVerifiedError,
  memorySessions,
  standingAgent,
  verifyRequestIdentity,
} from '../../src/hosting/index.js';
import type { IdentityVerifier, VerifiedIdentity } from '../../src/hosting/index.js';
import { inProcessHost } from './testHost.js';

// ─── Helpers ─────────────────────────────────────────────────────────

/** The secret this suite refuses to ever see printed. */
const SECRET = 'ey-super-secret-token-value-abc123';

/** A verifier that accepts exactly one token and refuses everything else by
 *  class — the smallest honest implementation of the port. */
function fakeVerifier(
  accepted: Readonly<Record<string, VerifiedIdentity>>,
): IdentityVerifier & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    verify(token: string): Promise<VerifiedIdentity> {
      seen.push(token);
      const found = accepted[token];
      if (found === undefined) {
        return Promise.reject(new IdentityNotVerifiedError('unverifiable', false));
      }
      return Promise.resolve(found);
    },
  };
}

function agentFor(reply = 'ok'): Agent {
  return Agent.create({ provider: mock({ reply }), model: 'm' }).build();
}

// ─── 1. UNIT — the one extraction ────────────────────────────────────

describe('bearerToken — unit', () => {
  it('reads a Bearer credential, case-insensitively on the scheme', () => {
    expect(bearerToken({ authorization: `Bearer ${SECRET}` })).toBe(SECRET);
    expect(bearerToken({ authorization: `bearer ${SECRET}` })).toBe(SECRET);
    expect(bearerToken({ authorization: `BEARER   ${SECRET}  ` })).toBe(SECRET);
  });

  it('declines every other shape rather than half-reading it', () => {
    // A Basic credential handed to a JWT verifier would produce a confusing
    // refusal about the wrong thing.
    expect(bearerToken({ authorization: 'Basic dXNlcjpwYXNz' })).toBeUndefined();
    expect(bearerToken({ authorization: 'Bearer' })).toBeUndefined();
    expect(bearerToken({ authorization: 'Bearer   ' })).toBeUndefined();
    expect(bearerToken({})).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
  });
});

// ─── 2. UNIT — the composer's one answer to "who is this" ────────────

describe('verifyRequestIdentity — unit', () => {
  it('with no verifier configured, returns undefined and touches nothing', async () => {
    await expect(
      verifyRequestIdentity(undefined, { authorization: `Bearer ${SECRET}` }, 'claimed'),
    ).resolves.toBeUndefined();
  });

  it('refuses a claimed user with no token, naming the class', async () => {
    const verifier = fakeVerifier({});
    await expect(
      verifyRequestIdentity({ verify: verifier.verify }, {}, 'alice'),
    ).rejects.toMatchObject({
      code: 'ERR_IDENTITY_NOT_VERIFIED',
      failure: 'no-token',
      claimedUser: true,
    });
    // The verifier was never consulted: there was nothing to verify.
    expect(verifier.seen).toEqual([]);
  });

  it('refuses an anonymous request by default and admits it under allowAnonymous', async () => {
    const verifier = fakeVerifier({});
    await expect(
      verifyRequestIdentity({ verify: verifier.verify }, {}, undefined),
    ).rejects.toMatchObject({ failure: 'no-token', claimedUser: false });
    await expect(
      verifyRequestIdentity({ verify: verifier.verify, allowAnonymous: true }, {}, undefined),
    ).resolves.toBeUndefined();
  });

  it('refuses a verifier that resolved without naming a subject', async () => {
    // "Verified, subject unknown" is a state nothing downstream could act on.
    const empty: IdentityVerifier = { verify: () => Promise.resolve({ userId: '' }) };
    await expect(
      verifyRequestIdentity({ verify: empty.verify }, { authorization: 'Bearer t' }, undefined),
    ).rejects.toMatchObject({ failure: 'unverifiable' });
  });

  it('refuses when the token proves one user and the request names another', async () => {
    const verifier = fakeVerifier({ [SECRET]: { userId: 'alice' } });
    await expect(
      verifyRequestIdentity(
        { verify: verifier.verify },
        { authorization: `Bearer ${SECRET}` },
        'mallory',
      ),
    ).rejects.toMatchObject({ failure: 'claimed-another-user', claimedUser: true });
  });

  it('accepts a matching claim and hands back roles and claims', async () => {
    const verifier = fakeVerifier({
      [SECRET]: { userId: 'alice', roles: ['admin'], claims: { plan: 'pro' } },
    });
    await expect(
      verifyRequestIdentity(
        { verify: verifier.verify },
        { authorization: `Bearer ${SECRET}` },
        'alice',
      ),
    ).resolves.toEqual({ userId: 'alice', roles: ['admin'], claims: { plan: 'pro' } });
  });

  it('treats a verifier that threw something undescribed as unverifiable', async () => {
    // A verifier that failed in a way it did not describe has proven nothing.
    const broken: IdentityVerifier = { verify: () => Promise.reject(new Error('kaboom')) };
    await expect(
      verifyRequestIdentity({ verify: broken.verify }, { authorization: 'Bearer t' }, undefined),
    ).rejects.toMatchObject({ failure: 'unverifiable' });
  });
});

// ─── 3. INTEGRATION — the whole door ─────────────────────────────────

describe('standingAgent + identity — integration', () => {
  it('ZERO-DELTA: with no identity option, a userId header still becomes the principal', async () => {
    const agent = agentFor('answered');
    const events: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.agent.turn_start', (e) => events.push(e));
    const host = inProcessHost();
    await standingAgent({ agent, sessions: memorySessions(), host });

    const reply = await host.deliver({ input: 'hi', sessionId: 's1', userId: 'alice' });
    expect(reply.output).toBe('answered');
    expect((events[0] as { meta?: { principal?: string } }).meta?.principal).toBe('alice');
  });

  it('a claimed user with no token is refused once verification is configured', async () => {
    const verifier = fakeVerifier({ [SECRET]: { userId: 'alice' } });
    const host = inProcessHost();
    await standingAgent({
      agent: agentFor(),
      sessions: memorySessions(),
      host,
      identity: { verify: verifier.verify },
    });

    const reply = await host.deliver({ input: 'hi', sessionId: 's1', userId: 'alice' });
    expect(reply.code).toBe('ERR_IDENTITY_NOT_VERIFIED');
    expect(reply.output).toBeUndefined();
    expect(reply.error).toContain('presented no credential');
  });

  it('a verified token puts the PROVEN user on the run', async () => {
    const verifier = fakeVerifier({ [SECRET]: { userId: 'alice', roles: ['ops'] } });
    const agent = agentFor('done');
    const starts: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.agent.turn_start', (e) => starts.push(e));
    const host = inProcessHost();
    await standingAgent({
      agent,
      sessions: memorySessions(),
      host,
      identity: { verify: verifier.verify },
    });

    // No userId field at all — the token is the only thing that names anybody.
    const reply = await host.deliver({
      input: 'hi',
      sessionId: 's1',
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(reply.output).toBe('done');
    expect((starts[0] as { meta?: { principal?: string } }).meta?.principal).toBe('alice');
  });

  it('a token that does not verify is refused without the run starting', async () => {
    let llmCalls = 0;
    const agent = Agent.create({
      provider: {
        name: 'counting',
        complete: () => {
          llmCalls += 1;
          return Promise.resolve({
            content: 'x',
            toolCalls: [],
            usage: { input: 1, output: 1 },
            stopReason: 'stop' as const,
          });
        },
      },
      model: 'm',
    }).build();
    const host = inProcessHost();
    await standingAgent({
      agent,
      sessions: memorySessions(),
      host,
      identity: { verify: fakeVerifier({}).verify },
    });

    const reply = await host.deliver({
      input: 'hi',
      sessionId: 's1',
      headers: { authorization: 'Bearer forged' },
    });
    expect(reply.code).toBe('ERR_IDENTITY_NOT_VERIFIED');
    // The cheapest refusal is the one made before any model is called.
    expect(llmCalls).toBe(0);
  });
});

// ─── 3b. CONSTRUCTION — a half-spelled option is refused, not obeyed ─

describe('standingAgent + identity — construction', () => {
  it('refuses an identity bag with no verify, before a socket exists', async () => {
    // Fails closed either way — but a door that refuses EVERYBODY for a
    // configuration reason is an outage that takes an hour to diagnose from
    // the outside.
    await expect(
      standingAgent({
        agent: agentFor(),
        sessions: memorySessions(),
        host: inProcessHost(),
        identity: {} as unknown as { verify: IdentityVerifier['verify'] },
      }),
    ).rejects.toThrow(/without a `verify` function/);
  });

  it('refuses an admission bag with no decide', async () => {
    await expect(
      standingAgent({
        agent: agentFor(),
        sessions: memorySessions(),
        host: inProcessHost(),
        admission: {} as unknown as { decide: () => 'allow' },
      }),
    ).rejects.toThrow(/without a `decide` function/);
  });
});

// ─── 4. SECURITY — the token never travels ───────────────────────────

describe('standingAgent + identity — security', () => {
  it('THE SECRET NEVER APPEARS: not in the refusal, not in any event', async () => {
    const agent = agentFor();
    const seen: AgentfootprintEvent[] = [];
    agent.on('*', (e) => seen.push(e));
    const host = inProcessHost();
    await standingAgent({
      agent,
      sessions: memorySessions(),
      host,
      // A verifier that echoes the token into its own error — the WORST case,
      // and the one the composer has to be immune to.
      identity: {
        verify: (token: string) =>
          Promise.reject(new Error(`upstream rejected the token '${token}'`)),
      },
    });

    const reply = await host.deliver({
      input: 'hi',
      sessionId: 's1',
      headers: { authorization: `Bearer ${SECRET}` },
    });

    expect(reply.code).toBe('ERR_IDENTITY_NOT_VERIFIED');
    expect(reply.error ?? '').not.toContain(SECRET);
    // Not even a prefix of it.
    expect(reply.error ?? '').not.toContain(SECRET.slice(0, 8));
    expect(JSON.stringify(seen)).not.toContain(SECRET);
  });

  it('a refusal names the CLASS, which is what an operator acts on', () => {
    expect(new IdentityNotVerifiedError('expired', false).message).toContain('expired');
    expect(new IdentityNotVerifiedError('wrong-audience', false).message).toContain(
      'different audience',
    );
    expect(new IdentityNotVerifiedError('unverifiable', false).message).toContain(
      'could not be verified',
    );
    // …and deliberately says the same thing for every unverifiable shape, so
    // it is not an oracle for which half of a forgery to fix.
    expect(new IdentityNotVerifiedError('unverifiable', false).message).toContain(
      'naming which would tell whoever is probing',
    );
  });
});

// ─── 5. PROPERTY — the verifier's answer always wins ─────────────────

describe('standingAgent + identity — property', () => {
  it('for every (claimed, proven) pair, the run is either the PROVEN user or refused', async () => {
    const verifier = fakeVerifier({ [SECRET]: { userId: 'alice' } });
    const pairs: Array<[string | undefined, string | undefined]> = [
      [undefined, 'alice'],
      ['alice', 'alice'],
      ['mallory', undefined],
      ['bob', undefined],
    ];
    for (const [claimed, expected] of pairs) {
      const agent = agentFor('ok');
      const starts: AgentfootprintEvent[] = [];
      agent.on('agentfootprint.agent.turn_start', (e) => starts.push(e));
      const host = inProcessHost();
      await standingAgent({
        agent,
        sessions: memorySessions(),
        host,
        identity: { verify: verifier.verify },
      });
      const reply = await host.deliver({
        input: 'hi',
        sessionId: `s-${String(claimed)}`,
        ...(claimed !== undefined && { userId: claimed }),
        headers: { authorization: `Bearer ${SECRET}` },
      });
      if (expected === undefined) {
        expect(reply.code).toBe('ERR_IDENTITY_NOT_VERIFIED');
      } else {
        expect((starts[0] as { meta?: { principal?: string } }).meta?.principal).toBe(expected);
      }
    }
  });
});

// ─── 6. PERFORMANCE — one verification per request ───────────────────

describe('standingAgent + identity — performance', () => {
  it('verifies once per request, not once per hop', async () => {
    const verifier = fakeVerifier({ [SECRET]: { userId: 'alice' } });
    const host = inProcessHost();
    await standingAgent({
      agent: agentFor(),
      sessions: memorySessions(),
      host,
      identity: { verify: verifier.verify },
    });
    await host.deliver({
      input: 'hi',
      sessionId: 's1',
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(verifier.seen).toEqual([SECRET]);
  });
});

// ─── 7. ROI — what this replaces ─────────────────────────────────────

describe('standingAgent + identity — ROI', () => {
  it('the whole configuration is one option, and it reaches the memory namespace', async () => {
    // Before: every deployment wrote its own header-check middleware, and the
    // library had no way to know whether the userId it was handed meant
    // anything. After: one option, and the proven subject is the principal
    // every store already scopes on.
    const verifier = fakeVerifier({ [SECRET]: { userId: 'alice' } });
    const agent = agentFor('hi');
    const starts: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.agent.turn_start', (e) => starts.push(e));
    const host = inProcessHost();
    await standingAgent({
      agent,
      sessions: memorySessions(),
      host,
      identity: { verify: verifier.verify },
    });
    await host.deliver({
      input: 'q',
      sessionId: 'thread-1',
      headers: { authorization: `Bearer ${SECRET}` },
    });
    const meta = (starts[0] as { meta?: { principal?: string; sessionId?: string } }).meta;
    expect(meta?.principal).toBe('alice');
    expect(meta?.sessionId).toBe('thread-1');
  });
});
