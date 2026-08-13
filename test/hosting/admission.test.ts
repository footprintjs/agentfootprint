/**
 * Admission + per-identity spend (9.26.0) — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * The laws being pinned:
 *   • THE ZERO-DELTA PIN — no `admission` option, no ledger, no listener, no
 *     behaviour change. Byte-identical to 9.25.
 *   • A refusal happens BEFORE the model is called — the cheapest refusal is
 *     the one made before any work.
 *   • Turns are counted at ADMISSION, not completion: a caller cannot hold N
 *     runs open under a limit of one.
 *   • Spend is attributed to the VERIFIED identity, per identity, and anonymous
 *     callers share one bucket (stated, not hidden).
 *   • `usd` is ABSENT rather than zero when nothing priced the window — "we did
 *     not measure that" is a different fact from "they spent nothing".
 *   • The window is rolling: an old turn ages out and the caller is admitted.
 *   • `{ queue: true }` runs the turn behind the session's other work instead
 *     of refusing it.
 *   • The refusal SENTENCE is the policy's, and names the limit.
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import {
  memorySessions,
  spendKeyFor,
  spendLedger,
  standingAgent,
  turnsPerHour,
} from '../../src/hosting/index.js';
import type { AdmissionContext, AdmissionPolicy } from '../../src/hosting/index.js';
import type { IdentityVerifier } from '../../src/hosting/index.js';
import { inProcessHost } from './testHost.js';

// ─── Helpers ─────────────────────────────────────────────────────────

const verifierFor = (byToken: Readonly<Record<string, string>>): IdentityVerifier => ({
  verify: (token) => {
    const userId = byToken[token];
    return userId === undefined
      ? Promise.reject(new Error('no'))
      : Promise.resolve({ userId, roles: ['member'] });
  },
});

function countingAgent(): { agent: Agent; calls: () => number } {
  let calls = 0;
  const agent = Agent.create({
    provider: {
      name: 'counting',
      complete: () => {
        calls += 1;
        return Promise.resolve({
          content: 'answered',
          toolCalls: [],
          usage: { input: 10, output: 5 },
        });
      },
    },
    model: 'm',
  }).build();
  return { agent, calls: () => calls };
}

/** A policy that records every context it saw and answers from a script. */
function spyPolicy(
  answers: readonly ('allow' | { queue: true } | { refuse: string })[],
): AdmissionPolicy & { seen: AdmissionContext[] } {
  const seen: AdmissionContext[] = [];
  let i = 0;
  return {
    seen,
    decide(context) {
      seen.push(context);
      return answers[Math.min(i++, answers.length - 1)] ?? 'allow';
    },
  };
}

// ─── 1. UNIT — the accountant ────────────────────────────────────────

describe('spendLedger — unit', () => {
  it('counts turns per caller and keeps them apart', () => {
    const ledger = spendLedger();
    ledger.admit('user:a');
    ledger.admit('user:a');
    ledger.admit('user:b');
    expect(ledger.read('user:a').turns).toBe(2);
    expect(ledger.read('user:b').turns).toBe(1);
    expect(ledger.read('user:nobody').turns).toBe(0);
  });

  it('sums tokens onto the caller MOST RECENT turn, and drops orphan usage', () => {
    const ledger = spendLedger();
    // Usage with no admitted turn behind it would otherwise invent a turn and
    // bill somebody for work nobody admitted.
    ledger.add('user:a', { inputTokens: 99, outputTokens: 99 });
    expect(ledger.read('user:a').turns).toBe(0);
    expect(ledger.read('user:a').inputTokens).toBe(0);

    ledger.admit('user:a');
    ledger.add('user:a', { inputTokens: 10, outputTokens: 4 });
    ledger.add('user:a', { inputTokens: 6, outputTokens: 1 });
    const spend = ledger.read('user:a');
    expect(spend.inputTokens).toBe(16);
    expect(spend.outputTokens).toBe(5);
  });

  it('usd is ABSENT when nothing priced the window, and present when something did', () => {
    const ledger = spendLedger();
    ledger.admit('user:a');
    ledger.add('user:a', { inputTokens: 100, outputTokens: 10 });
    // A zero here would read as "this caller has spent nothing" when the truth
    // is "nobody is counting".
    expect(ledger.read('user:a').usd).toBeUndefined();
    ledger.add('user:a', { usd: 0.0123 });
    expect(ledger.read('user:a').usd).toBeCloseTo(0.0123, 6);
  });

  it('is a ROLLING window — old turns age out', () => {
    let now = 1_000_000;
    const ledger = spendLedger({ windowMs: 1000, _now: () => now });
    ledger.admit('user:a');
    ledger.admit('user:a');
    expect(ledger.read('user:a').turns).toBe(2);
    now += 1001;
    expect(ledger.read('user:a').turns).toBe(0);
  });

  it('reports an INCOMPLETE window while the process is younger than it', () => {
    let now = 5_000;
    const ledger = spendLedger({ windowMs: 10_000, _now: () => now });
    expect(ledger.read('user:a').complete).toBe(false);
    now += 10_000;
    expect(ledger.read('user:a').complete).toBe(true);
  });

  it('is BOUNDED — a flood of distinct callers evicts the least recently seen', () => {
    const ledger = spendLedger({ maxCallers: 3 });
    for (const key of ['a', 'b', 'c', 'd', 'e']) ledger.admit(`user:${key}`);
    expect(ledger.size).toBeLessThanOrEqual(3);
    // The most recent survive; the oldest were forgotten (which admits them
    // where they might have been refused — the safe direction).
    expect(ledger.read('user:e').turns).toBe(1);
  });

  it('keys a verified caller by the PROVEN id and everyone else by one bucket', () => {
    expect(spendKeyFor({ userId: 'alice' })).toBe('user:alice');
    expect(spendKeyFor(undefined)).toBe('#anonymous');
  });
});

// ─── 2. UNIT — the shipped policy ────────────────────────────────────

describe('turnsPerHour — unit', () => {
  it('refuses a limit that is not a ceiling', () => {
    expect(() => turnsPerHour({ limit: 0 })).toThrow(/closed door/);
    expect(() => turnsPerHour({ limit: -1 })).toThrow(/positive integer/);
  });

  it('allows under the limit and refuses at it, naming the number', () => {
    const policy = turnsPerHour({ limit: 2 });
    const ctx = (turns: number): AdmissionContext => ({
      identity: { userId: 'alice' },
      recentSpend: { turns, inputTokens: 0, outputTokens: 0, windowMs: 3_600_000, complete: true },
    });
    expect(policy.decide(ctx(0))).toBe('allow');
    expect(policy.decide(ctx(1))).toBe('allow');
    const refused = policy.decide(ctx(2)) as { refuse: string };
    expect(refused.refuse).toContain('limit of 2 turns per hour');
    // A refusal that names the reset is one a client can act on.
    expect(refused.refuse).toContain('rolling');
  });

  it('bounds anonymous callers separately, and says the bucket is shared', () => {
    const policy = turnsPerHour({ limit: 100, anonymousLimit: 1 });
    const anon = (turns: number): AdmissionContext => ({
      recentSpend: { turns, inputTokens: 0, outputTokens: 0, windowMs: 3_600_000, complete: true },
    });
    expect(policy.decide(anon(0))).toBe('allow');
    const refused = policy.decide(anon(1)) as { refuse: string };
    expect(refused.refuse).toContain('Anonymous callers share');
    expect(refused.refuse).toContain('Signing in');
  });
});

// ─── 3. INTEGRATION — the door ───────────────────────────────────────

describe('standingAgent + admission — integration', () => {
  it('ZERO-DELTA: with no admission option, nothing is consulted and nothing changes', async () => {
    const { agent, calls } = countingAgent();
    const host = inProcessHost();
    await standingAgent({ agent, sessions: memorySessions(), host });
    for (let i = 0; i < 5; i += 1) {
      const reply = await host.deliver({ input: 'hi', sessionId: `s${i}` });
      expect(reply.output).toBe('answered');
    }
    expect(calls()).toBe(5);
  });

  it('a refusal happens BEFORE the model is called', async () => {
    const { agent, calls } = countingAgent();
    const host = inProcessHost();
    await standingAgent({
      agent,
      sessions: memorySessions(),
      host,
      admission: { decide: () => ({ refuse: 'not today' }) },
    });
    const reply = await host.deliver({ input: 'hi', sessionId: 's1' });
    expect(reply.code).toBe('ERR_ADMISSION_REFUSED');
    expect(reply.error).toContain('not today');
    expect(calls()).toBe(0);
  });

  it('counts turns per VERIFIED identity and refuses the one over budget', async () => {
    const { agent } = countingAgent();
    const host = inProcessHost();
    await standingAgent({
      agent,
      sessions: memorySessions(),
      host,
      identity: { verify: verifierFor({ 'tok-a': 'alice', 'tok-b': 'bob' }).verify },
      admission: turnsPerHour({ limit: 2 }),
    });
    const asAlice = (n: number) =>
      host.deliver({ input: 'hi', sessionId: `a${n}`, headers: { authorization: 'Bearer tok-a' } });

    expect((await asAlice(1)).output).toBe('answered');
    expect((await asAlice(2)).output).toBe('answered');
    expect((await asAlice(3)).code).toBe('ERR_ADMISSION_REFUSED');
    // Bob has his own budget — one person's traffic never bounds another's.
    const bob = await host.deliver({
      input: 'hi',
      sessionId: 'b1',
      headers: { authorization: 'Bearer tok-b' },
    });
    expect(bob.output).toBe('answered');
  });

  it('feeds the policy the tokens the run actually reported', async () => {
    const { agent } = countingAgent();
    const policy = spyPolicy(['allow', 'allow']);
    const host = inProcessHost();
    await standingAgent({
      agent,
      sessions: memorySessions(),
      host,
      identity: { verify: verifierFor({ t: 'alice' }).verify },
      admission: policy,
    });
    await host.deliver({ input: 'one', sessionId: 's', headers: { authorization: 'Bearer t' } });
    await host.deliver({ input: 'two', sessionId: 's', headers: { authorization: 'Bearer t' } });

    // Second decision sees the first turn's usage.
    expect(policy.seen).toHaveLength(2);
    expect(policy.seen[0]?.recentSpend.turns).toBe(0);
    expect(policy.seen[1]?.recentSpend.turns).toBe(1);
    expect(policy.seen[1]?.recentSpend.inputTokens).toBe(10);
    expect(policy.seen[1]?.recentSpend.outputTokens).toBe(5);
    // No pricing table ⇒ no money, and that is ABSENT rather than 0.
    expect(policy.seen[1]?.recentSpend.usd).toBeUndefined();
    expect(policy.seen[1]?.identity?.userId).toBe('alice');
    expect(policy.seen[1]?.sessionId).toBe('s');
  });

  it('{ queue: true } runs the turn instead of refusing a same-session collision', async () => {
    // Two turns of ONE session, in flight together. Under the default
    // 'reject' policy the second is a ConcurrentRunError; queueing runs it.
    let resolveFirst: (() => void) | undefined;
    let seen = 0;
    const agent = Agent.create({
      provider: {
        name: 'gated',
        complete: async () => {
          seen += 1;
          if (seen === 1) await new Promise<void>((r) => (resolveFirst = r));
          return { content: `turn-${seen}`, toolCalls: [], usage: { input: 1, output: 1 } };
        },
      },
      model: 'm',
    }).build();
    const host = inProcessHost();
    await standingAgent({
      agent,
      sessions: memorySessions(),
      host,
      admission: { decide: () => ({ queue: true }) },
    });
    const first = host.deliver({ input: 'a', sessionId: 'same' });
    // Give the first request time to become the active run.
    await new Promise((r) => setTimeout(r, 10));
    const second = host.deliver({ input: 'b', sessionId: 'same' });
    await new Promise((r) => setTimeout(r, 10));
    resolveFirst?.();
    const [one, two] = await Promise.all([first, second]);
    expect(one.output).toBe('turn-1');
    expect(two.output).toBe('turn-2');
    expect(two.code).toBeUndefined();
  });
});

// ─── 4. SECURITY — an unverified name never gets a budget ────────────

describe('standingAgent + admission — security', () => {
  it('an UNVERIFIED userId is not an identity, so it cannot mint its own budget', async () => {
    const { agent } = countingAgent();
    const host = inProcessHost();
    await standingAgent({
      agent,
      sessions: memorySessions(),
      host,
      // No verifier: nobody is proven, so everybody shares the anonymous
      // bucket. Otherwise a caller invents a new name per request and the
      // limit means nothing.
      admission: turnsPerHour({ limit: 1 }),
    });
    const one = await host.deliver({ input: 'hi', sessionId: 's1', userId: 'alice' });
    const two = await host.deliver({ input: 'hi', sessionId: 's2', userId: 'mallory' });
    expect(one.output).toBe('answered');
    expect(two.code).toBe('ERR_ADMISSION_REFUSED');
  });
});

// ─── 5. PROPERTY — admitted-at-admission, never at completion ────────

describe('standingAgent + admission — property', () => {
  it('for any N, exactly `limit` turns are admitted and the rest refused', async () => {
    for (const limit of [1, 2, 5]) {
      const { agent, calls } = countingAgent();
      const host = inProcessHost();
      await standingAgent({
        agent,
        sessions: memorySessions(),
        host,
        identity: { verify: verifierFor({ t: 'alice' }).verify },
        admission: turnsPerHour({ limit }),
      });
      let refused = 0;
      for (let i = 0; i < limit + 3; i += 1) {
        const reply = await host.deliver({
          input: 'hi',
          sessionId: `s${i}`,
          headers: { authorization: 'Bearer t' },
        });
        if (reply.code === 'ERR_ADMISSION_REFUSED') refused += 1;
      }
      expect(calls()).toBe(limit);
      expect(refused).toBe(3);
    }
  });
});

// ─── 6. PERFORMANCE — one decision per request ───────────────────────

describe('standingAgent + admission — performance', () => {
  it('consults the policy exactly once per turn', async () => {
    const { agent } = countingAgent();
    const policy = spyPolicy(['allow']);
    const host = inProcessHost();
    await standingAgent({ agent, sessions: memorySessions(), host, admission: policy });
    await host.deliver({ input: 'hi', sessionId: 's1' });
    expect(policy.seen).toHaveLength(1);
  });
});

// ─── 7. ROI — the honest boundary is stated ──────────────────────────

describe('admission — ROI', () => {
  it('the accounting is per-process, and the ledger says how long its window is', () => {
    // Documented rather than implied: two replicas keep two windows, so a
    // limit of 20 across three of them is a limit of 60. A deployment that
    // needs one number writes a `decide` that reads its own store — the seam
    // is the same one `turnsPerHour` uses.
    const ledger = spendLedger();
    expect(ledger.read('user:a').windowMs).toBe(3_600_000);
  });
});
