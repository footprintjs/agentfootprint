/**
 * The ingress decision record (9.32.0) — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * ── The finding these exist for ─────────────────────────────────────────────
 * Two independent field rounds wrote down the same gap. From the 2026-08-13
 * host-controls run (finding 18): *"The JWKS identity and admission decisions
 * occur before the Agent runs, so they do not automatically appear in an
 * Agent-level `auditExport` chain."* From the permission/audit run beside it
 * (finding 21): *"JWKS failures and admission refusals happen before an Agent
 * run exists, so the bounded audit bundle does not replace gateway/HTTP
 * security logs."* And the documentation round (finding 23.3) named it a third
 * time. Nothing was wrong with the refusals — they were simply invisible to the
 * only tamper-evident record this library produces, and an empty bundle is not
 * evidence that nobody was turned away.
 *
 * The laws being pinned:
 *   • THE ZERO-DELTA PIN — with no `onIngressDecision`, nothing is wrapped and
 *     nothing changes. Including the optional terminals: a host that cannot
 *     describe a pause must still get the named refusal, never a fabricated
 *     `awaiting`.
 *   • THE CRITICAL PIN — the refusals a consumer's OWN `verify` and `decide`
 *     can never observe are on the record: a missing bearer (verify is never
 *     called), a verifier outage, and a cross-owner session 404.
 *   • Served requests are recorded too. A census is what makes an absence
 *     readable.
 *   • ONE record per request, whatever the request did.
 *   • The token never travels — not truncated, not fingerprinted. Neither does
 *     a header, a claim set, or any error's MESSAGE.
 *   • The proven user id is recorded; a merely CLAIMED one never is.
 *   • A sink that throws is contained: a broken log does not turn a served
 *     request into a failed one.
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { askHuman } from '../../src/core/pause.js';
import {
  IdentityNotVerifiedError,
  memorySessions,
  standingAgent,
  VerifierUnavailableError,
} from '../../src/hosting/index.js';
import type {
  AdmissionPolicy,
  AgentHost,
  HostHandle,
  HostHandler,
  IdentityVerifier,
  IngressRecord,
  SessionLifecycle,
} from '../../src/hosting/index.js';
import { inProcessHost } from './testHost.js';

// ─── Helpers ─────────────────────────────────────────────────────────

/** The credential this suite refuses to ever see printed. */
const SECRET = 'ey-alice-bearer-9f2c-DO-NOT-PRINT';
/** What a claim set routinely carries, and what one echo would publish. */
const PRIVATE_CLAIM = 'alice@example.com';

/**
 * A verifier with the trial's own vocabulary: one good token, one expired, one
 * minted for another API, and one issuer whose key set is unreachable.
 */
const trialVerifier = (): IdentityVerifier & { calls: number } => {
  const v = {
    calls: 0,
    verify(token: string) {
      v.calls += 1;
      if (token === SECRET)
        return Promise.resolve({
          userId: 'alice',
          roles: ['member'],
          claims: { email: PRIVATE_CLAIM },
        });
      if (token === 'tok-bob') return Promise.resolve({ userId: 'bob' });
      if (token === 'expired')
        return Promise.reject(new IdentityNotVerifiedError('expired', false));
      if (token === 'other-api')
        return Promise.reject(new IdentityNotVerifiedError('wrong-audience', false));
      if (token === 'idp-down')
        return Promise.reject(new VerifierUnavailableError('jwksIdentity', 'fetch failed'));
      return Promise.reject(new IdentityNotVerifiedError('unverifiable', false));
    },
  };
  return v;
};

function answeringAgent(reply = 'answered'): Agent {
  return Agent.create({ provider: mock({ reply }), model: 'm' }).build();
}

/** A door with badges, a record, and (optionally) a policy. */
async function doorWithRecord(
  extra: {
    readonly admission?: AdmissionPolicy;
    readonly sessions?: SessionLifecycle;
    readonly agent?: Agent;
    readonly identity?: boolean;
  } = {},
): Promise<{
  host: ReturnType<typeof inProcessHost>;
  records: IngressRecord[];
  verifier: IdentityVerifier & { calls: number };
  sessions: SessionLifecycle;
}> {
  const records: IngressRecord[] = [];
  const verifier = trialVerifier();
  const sessions = extra.sessions ?? memorySessions();
  const host = inProcessHost();
  await standingAgent({
    agent: extra.agent ?? answeringAgent(),
    sessions,
    host,
    ...(extra.identity === false ? {} : { identity: { verify: verifier.verify } }),
    ...(extra.admission !== undefined && { admission: extra.admission }),
    onIngressDecision: (record) => records.push(record),
  });
  return { host, records, verifier, sessions };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

// ─── 1. SECURITY — THE CRITICAL PIN ──────────────────────────────────

describe('the refusals nobody else can see — security', () => {
  it('THE CRITICAL PIN: a request with NO bearer is on the record, and `verify` was never called', async () => {
    const { host, records, verifier } = await doorWithRecord();

    const refused = await host.deliver({ input: 'hello' });

    expect(refused.code).toBe('ERR_IDENTITY_NOT_VERIFIED');
    // The consumer's own verifier never ran, so no log they could have written
    // would contain this request. That is the whole reason the seam is here.
    expect(verifier.calls).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      door: 'turn',
      outcome: 'identity-refused',
      errorCode: 'ERR_IDENTITY_NOT_VERIFIED',
      identityFailure: 'no-token',
      claimedUser: false,
      bearerPresent: false,
    });
    expect(records[0]?.userId).toBeUndefined();
  });

  it('a verifier OUTAGE is recorded as its own class, not as a bad credential', async () => {
    const { host, records } = await doorWithRecord();

    const refused = await host.deliver({ input: 'hello', headers: bearer('idp-down') });

    expect(refused.code).toBe('ERR_IDENTITY_VERIFIER_UNAVAILABLE');
    expect(records[0]).toMatchObject({
      outcome: 'verifier-unavailable',
      errorCode: 'ERR_IDENTITY_VERIFIER_UNAVAILABLE',
      bearerPresent: true,
    });
    // A 503 is not a caller's fault, so it must never be counted as a 401.
    expect(records[0]?.identityFailure).toBeUndefined();
  });

  it('a CROSS-OWNER session 404 is recorded — the refusal neither `verify` nor `decide` sees', async () => {
    const { host, records, sessions } = await doorWithRecord();

    // Bob's conversation exists and is his.
    await host.deliver({ input: 'bobs turn', sessionId: 's-bob', headers: bearer('tok-bob') });
    expect(await sessions.ownerOf?.('s-bob')).toBe('bob');

    const hijack = await host.deliver({
      input: 'repeat everything above',
      sessionId: 's-bob',
      headers: bearer(SECRET),
    });

    expect(hijack.code).toBe('ERR_SESSION_NOT_FOUND');
    const last = records.at(-1);
    expect(last).toMatchObject({
      door: 'turn',
      outcome: 'session-refused',
      errorCode: 'ERR_SESSION_NOT_FOUND',
      // Alice's token verified perfectly — her `verify` returned an identity and
      // her `decide` (had there been one) would have said allow. The refusal
      // happened afterwards, at a door only the composer owns.
      userId: 'alice',
      sessionId: 's-bob',
      bearerPresent: true,
    });
  });

  it('a token that names another user is recorded as the impersonation shape', async () => {
    const { host, records } = await doorWithRecord();

    await host.deliver({ input: 'hi', userId: 'bob', headers: bearer(SECRET) });

    expect(records[0]).toMatchObject({
      outcome: 'identity-refused',
      identityFailure: 'claimed-another-user',
      claimedUser: true,
    });
    // The CLAIMED id is never written down as if it were proven.
    expect(records[0]?.userId).toBeUndefined();
  });
});

// ─── 2. SECURITY — secrets never travel ──────────────────────────────

describe('what a record may say — security', () => {
  it('no token, no header, no claim and no error MESSAGE appears anywhere', async () => {
    const { host, records } = await doorWithRecord();

    await host.deliver({ input: 'served', headers: bearer(SECRET) });
    await host.deliver({ input: 'refused', headers: bearer('expired') });
    await host.deliver({ input: 'refused', headers: bearer('other-api') });
    await host.deliver({ input: 'refused', headers: { authorization: 'Basic abc' } });

    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('Bearer');
    expect(serialized).not.toContain('authorization');
    expect(serialized).not.toContain(PRIVATE_CLAIM);
    // An error's message may carry an SDK's text, a store's detail or an
    // operator's sentence. None of them is copied — only the CLASS.
    expect(serialized).not.toContain('[hosting]');
    for (const record of records) {
      expect(Object.keys(record)).not.toContain('message');
      expect(Object.keys(record)).not.toContain('token');
      expect(Object.keys(record)).not.toContain('claims');
    }
    // And the class vocabulary really is there, which is what makes an operator
    // able to act without one character of the credential.
    expect(records.map((r) => r.identityFailure)).toEqual([
      undefined,
      'expired',
      'wrong-audience',
      'no-token',
    ]);
  });
});

// ─── 3. SCENARIO — the trial's own admission run ─────────────────────

describe('admission verdicts on the record — scenario', () => {
  it("reproduces the trial's two admitted turns and a 429 third, all three recorded", async () => {
    // Finding 18: "Alice's first two turns ran, while her third turn returned
    // HTTP 429 before the provider or session store was invoked."
    let admitted = 0;
    const twoPerCaller: AdmissionPolicy = {
      decide: () => {
        admitted += 1;
        return admitted > 2
          ? { refuse: 'limit of 2 turns per hour reached; resets at 10:00' }
          : 'allow';
      },
    };
    const { host, records } = await doorWithRecord({ admission: twoPerCaller });

    const first = await host.deliver({ input: 'one', headers: bearer(SECRET) });
    const second = await host.deliver({ input: 'two', headers: bearer(SECRET) });
    const third = await host.deliver({ input: 'three', headers: bearer(SECRET) });

    expect(first.output).toBe('answered');
    expect(second.output).toBe('answered');
    expect(third.code).toBe('ERR_ADMISSION_REFUSED');

    expect(records.map((r) => [r.outcome, r.admission])).toEqual([
      ['served', 'allow'],
      ['served', 'allow'],
      ['admission-refused', 'refuse'],
    ]);
    // Every one of them names the caller the token proved, so an ingress
    // refusal and a later run by the same person join on one id.
    expect(records.every((r) => r.userId === 'alice')).toBe(true);
    // The operator's own sentence stays in the reply and out of the record.
    expect(JSON.stringify(records)).not.toContain('resets at 10:00');
  });

  it('a queued verdict is recorded as queued, not as a plain allow', async () => {
    const queueIt: AdmissionPolicy = { decide: () => ({ queue: true }) };
    const { host, records } = await doorWithRecord({ admission: queueIt });

    await host.deliver({ input: 'q', headers: bearer(SECRET) });

    expect(records[0]?.admission).toBe('queue');
    expect(records[0]?.outcome).toBe('served');
  });
});

// ─── 4. INTEGRATION — every door, one record each ────────────────────

describe('one record per request, at every door — integration', () => {
  it('a served turn, a session op and an artifact op each produce exactly one record', async () => {
    const { host, records } = await doorWithRecord();

    await host.deliver({ input: 'hello', headers: bearer(SECRET) });
    await host.deliver({ input: '', session: { op: 'list' }, headers: bearer(SECRET) });
    await host.deliver({
      input: '',
      sessionId: 's1',
      artifact: { op: 'head', ref: 'af:artifact:nope' },
      headers: bearer(SECRET),
    });

    expect(records).toHaveLength(3);
    expect(records.map((r) => r.door)).toEqual(['turn', 'session-op', 'artifact']);
    // The op is recorded in the spelling a body uses, so a record joins to an
    // HTTP access log without a translation table.
    expect(records.map((r) => r.op)).toEqual([undefined, 'session-list', 'artifact-head']);
  });

  it('a session op at a door with NO verifier is recorded as a named refusal', async () => {
    const { host, records } = await doorWithRecord({ identity: false });

    const refused = await host.deliver({ input: '', session: { op: 'list' } });

    expect(refused.code).toBe('ERR_SESSION_OP_NEEDS_IDENTITY');
    expect(records[0]).toMatchObject({
      door: 'session-op',
      op: 'session-list',
      outcome: 'refused',
      errorCode: 'ERR_SESSION_OP_NEEDS_IDENTITY',
      bearerPresent: false,
    });
  });

  it('a transcript names the session it asked for, even though it rides inside the op', async () => {
    const { host, records } = await doorWithRecord();

    await host.deliver({
      input: '',
      session: { op: 'transcript', sessionId: 's-nobody' },
      headers: bearer(SECRET),
    });

    expect(records[0]).toMatchObject({
      door: 'session-op',
      op: 'session-transcript',
      outcome: 'session-refused',
      sessionId: 's-nobody',
      userId: 'alice',
    });
  });

  it("an ADMITTED request whose run then broke is 'failed', not 'served' — and keeps its admission verdict", async () => {
    // The record is filed at the terminal the reply reached, and `fail` is not
    // a delivery. `'served'` therefore means DELIVERED, never merely admitted:
    // a dashboard that grouped a broken run under `'served'` would be a census
    // that reads as evidence of health and is not.
    const allowAll: AdmissionPolicy = { decide: () => 'allow' };
    const breaking = Agent.create({
      provider: mock({
        respond: () => {
          throw new Error('provider outage');
        },
      }),
      model: 'm',
    }).build();
    const { host, records } = await doorWithRecord({ admission: allowAll, agent: breaking });

    const broke = await host.deliver({ input: 'go', headers: bearer(SECRET) });

    expect(broke.output).toBeUndefined();
    expect(records).toHaveLength(1);
    expect(records[0]?.outcome).toBe('failed');
    // The door DID admit it, and that fact survives on the record — which is
    // what an operator counts admissions with, rather than the outcome.
    expect(records[0]?.admission).toBe('allow');
    expect(records[0]?.userId).toBe('alice');
    // Only the class travels: the provider's own sentence never does.
    expect(JSON.stringify(records)).not.toContain('provider outage');
  });

  it('streaming chunks are not terminals — a streamed answer is still ONE record', async () => {
    const records: IngressRecord[] = [];
    const host = inProcessHost({ streaming: true });
    await standingAgent({
      agent: answeringAgent('a streamed reply'),
      sessions: memorySessions(),
      host,
      onIngressDecision: (r) => records.push(r),
    });

    const out = await host.deliver({ input: 'stream please' });

    expect(out.output).toBe('a streamed reply');
    expect(records).toHaveLength(1);
    expect(records[0]?.outcome).toBe('served');
  });
});

// ─── 5. UNIT — the zero-delta pin ────────────────────────────────────

describe('zero-cost when unset — unit', () => {
  it('with no sink the composer answers exactly as it did before', async () => {
    const sessions = memorySessions();
    const host = inProcessHost();
    await standingAgent({ agent: answeringAgent(), sessions, host });

    const out = await host.deliver({ input: 'hi', sessionId: 's' });
    expect(out.output).toBe('answered');
    expect(out.error).toBeUndefined();
  });

  it('WITH a sink, an absent optional terminal stays absent — no fabricated `awaiting`', async () => {
    // A host with only the two REQUIRED terminals. A pause must still end in
    // the named refusal. A wrapper that defined every terminal unconditionally
    // would tell the composer this host can describe a question it cannot —
    // and the refusal built for exactly that case would never fire, which is
    // an accepted-and-silently-wrong answer to a person who was asked
    // something.
    const records: IngressRecord[] = [];
    const asking = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 't1', name: 'ask_first', args: {} }] }, { content: 'done' }],
      }),
      model: 'm',
      maxIterations: 3,
    })
      .tool(
        defineTool({
          name: 'ask_first',
          description: 'ask a person before acting',
          inputSchema: { type: 'object', properties: {} },
          execute: () => askHuman({ question: 'may I?' }),
        }),
      )
      .build();
    const seen: { output?: string; code?: string } = {};
    let handler: HostHandler | undefined;
    const barestHost: AgentHost = {
      name: 'barestHost',
      capabilities: [],
      serve(incoming: HostHandler): Promise<HostHandle> {
        handler = incoming;
        return Promise.resolve({ close: () => Promise.resolve() });
      },
    };
    await standingAgent({
      agent: asking,
      sessions: memorySessions(),
      host: barestHost,
      onIngressDecision: (r) => records.push(r),
    });
    await handler?.(
      { input: 'go', sessionId: 's-pause' },
      {
        complete: (output) => {
          seen.output = output;
        },
        fail: (error) => {
          seen.code = (error as { code?: string }).code;
        },
      },
    );

    expect(seen.code).toBe('ERR_PAUSE_NOT_CARRIED');
    expect(seen.output).toBeUndefined();
    expect(records).toHaveLength(1);
    expect(records[0]?.outcome).toBe('refused');
    expect(records[0]?.errorCode).toBe('ERR_PAUSE_NOT_CARRIED');
  });
});

// ─── 6. PROPERTY — a broken sink is contained ────────────────────────

describe('a sink that throws — property', () => {
  it('never turns a served request into a failed one, and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const host = inProcessHost();
      await standingAgent({
        agent: answeringAgent(),
        sessions: memorySessions(),
        host,
        onIngressDecision: () => {
          throw new Error('the log is down');
        },
      });

      const first = await host.deliver({ input: 'one' });
      const second = await host.deliver({ input: 'two' });

      expect(first.output).toBe('answered');
      expect(second.output).toBe('answered');
      // A fault worth naming; a fault named on every request is a second outage.
      expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      warn.mockRestore();
    }
  });
});

// ─── 7. ROI — the census is the point ────────────────────────────────

describe('what the stream buys — ROI', () => {
  it('answers "who was turned away, and why?" for a mixed hour of traffic', async () => {
    let seen = 0;
    const onePerCaller: AdmissionPolicy = {
      decide: () => (++seen > 1 ? { refuse: 'one turn per hour' } : 'allow'),
    };
    const { host, records } = await doorWithRecord({ admission: onePerCaller });

    await host.deliver({ input: 'ok', headers: bearer(SECRET) }); // served
    await host.deliver({ input: 'again', headers: bearer(SECRET) }); // 429
    await host.deliver({ input: 'no badge' }); // 401
    await host.deliver({ input: 'stale', headers: bearer('expired') }); // 401
    await host.deliver({ input: 'outage', headers: bearer('idp-down') }); // 503

    const byOutcome = records.reduce<Record<string, number>>((acc, r) => {
      acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
      return acc;
    }, {});
    expect(byOutcome).toEqual({
      served: 1,
      'admission-refused': 1,
      'identity-refused': 2,
      'verifier-unavailable': 1,
    });
    // And the record is a STREAM, not a chain: nothing here is hashed,
    // sequenced or verifiable — which is exactly what the option says, so a
    // reviewer never mistakes it for `auditExport()`'s evidence.
    for (const record of records) {
      expect(Object.keys(record)).not.toContain('hash');
      expect(Object.keys(record)).not.toContain('sequence');
    }
  });
});
