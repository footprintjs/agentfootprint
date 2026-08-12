/**
 * TOOL SESSIONS — the teardown registrar and the key derivation (9.7.0).
 *
 * The tier is the part of this feature that a bug hides in quietly: every law
 * here is one whose violation looks like nothing at all from inside the run —
 * a cleanup that ran twice, a cleanup that never ran, a session torn down
 * across a pause, a key narrow enough to hand one sandbox to two people.
 *
 * 7-pattern matrix:
 *   unit        — each law in isolation (at-most-once, first-wins, reverse
 *                 order, timeout, never-throws)
 *   scenario    — a session opened, reused across calls, and released at the
 *                 scope that owns it
 *   integration — the firing matrix through the tier's real public methods
 *   property    — the key grammar over a table of identity shapes, including
 *                 every absence
 *   security    — sessionId ALONE never keys a session; the raw key never
 *                 reaches the wire (only its digest)
 *   regression  — the shapes that motivated the design: a repeat registration
 *                 replacing a live handle, an idle session never swept, an
 *                 unbounded tier
 *   performance — n/a for correctness, but the LRU bound is pinned because it
 *                 is what stops a standing process from growing forever
 */

import { describe, expect, it, vi } from 'vitest';

import {
  ToolSessionTier,
  ToolTeardownTimeoutError,
  hashSessionKey,
  toolSessionKey,
  type ToolSessionReport,
} from '../../src/core/toolSessions.js';
import type { ToolExecutionContext } from '../../src/core/tools.js';
import { unconfiguredCredentialProvider } from '../../src/identity/types.js';

/** A context carrying exactly the facts a test cares about. */
function ctx(facts: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    toolCallId: 'call-1',
    iteration: 0,
    credentials: unconfiguredCredentialProvider(),
    hasCredentials: false,
    ...facts,
  };
}

const origin = (over: Partial<Parameters<ToolSessionTier['register']>[0]> = {}) => ({
  tool: 'run_code',
  toolCallId: 'call-1',
  runId: 'run-1',
  ...over,
});

// ─── unit: the laws ───────────────────────────────────────────────────────

describe('teardown registrar — the laws', () => {
  it('law 1 — a registration fires AT MOST ONCE, ever', async () => {
    const tier = new ToolSessionTier();
    const cleanup = vi.fn();
    tier.register(origin(), cleanup, { scope: 'run', key: 'k' });

    await tier.fireRun('run-1');
    await tier.fireRun('run-1');
    await tier.fireShutdown();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('law 2 — a second registration under one key keeps the FIRST cleanup', async () => {
    const tier = new ToolSessionTier();
    const first = vi.fn();
    const second = vi.fn();
    tier.register(origin(), first, { scope: 'run', key: 'k' });
    tier.register(origin({ toolCallId: 'call-2' }), second, { scope: 'run', key: 'k' });

    await tier.fireRun('run-1');

    // The first is the one holding the live handle. Replacing it would drop
    // that handle on the floor and close something nobody is using.
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('law 3 — cleanups run in REVERSE registration order', async () => {
    const tier = new ToolSessionTier();
    const order: string[] = [];
    tier.register(origin(), () => void order.push('a'), { scope: 'run', key: 'a' });
    tier.register(origin(), () => void order.push('b'), { scope: 'run', key: 'b' });
    tier.register(origin(), () => void order.push('c'), { scope: 'run', key: 'c' });

    await tier.fireRun('run-1');

    expect(order).toEqual(['c', 'b', 'a']);
  });

  it('law 4 — a cleanup that never settles is ABANDONED at the budget, and says so', async () => {
    const reports: ToolSessionReport[] = [];
    const tier = new ToolSessionTier({ timeoutMs: 20, report: (r) => void reports.push(r) });
    tier.register(origin(), () => new Promise<void>(() => {}), { scope: 'run', key: 'k' });

    await tier.fireRun('run-1');

    const failed = reports.find((r) => r.kind === 'close-failed');
    expect(failed?.errorClass).toBe(new ToolTeardownTimeoutError('x', 20).name);
    // Unbounded teardown is how a container stop becomes a wait for SIGKILL.
    expect(failed?.error).toMatch(/did not finish within 20ms/);
  });

  it('law 5 — a throwing cleanup never reaches the caller, and is never silent', async () => {
    const reports: ToolSessionReport[] = [];
    const tier = new ToolSessionTier({ report: (r) => void reports.push(r) });
    const after = vi.fn();
    tier.register(
      origin(),
      () => {
        throw new Error('vendor Stop exploded');
      },
      { scope: 'run', key: 'boom' },
    );
    tier.register(origin(), after, { scope: 'run', key: 'ok' });

    // Never rethrows...
    await expect(tier.fireRun('run-1')).resolves.toBeUndefined();
    // ...and one broken cleanup does not prevent the next.
    expect(after).toHaveBeenCalledTimes(1);
    // "Swallowed AND silent" is the difference between a passive recorder and
    // a sandbox somebody is still paying for.
    const failed = reports.find((r) => r.kind === 'close-failed');
    expect(failed?.error).toContain('vendor Stop exploded');
    expect(failed?.errorClass).toBe('Error');
  });

  it('an unfired registration stays live — teardown is not garbage collection', async () => {
    const tier = new ToolSessionTier();
    tier.register(origin({ runId: 'run-1' }), () => {}, { scope: 'run', key: 'a' });
    tier.register(origin({ runId: 'run-2' }), () => {}, { scope: 'run', key: 'b' });

    await tier.fireRun('run-1');

    expect(tier.liveCount()).toBe(1);
  });
});

// ─── integration: the firing matrix ───────────────────────────────────────

describe('the firing matrix — each scope fires at its own site and no other', () => {
  it("'call' fires for its own toolCallId only", async () => {
    const tier = new ToolSessionTier();
    const mine = vi.fn();
    const theirs = vi.fn();
    tier.register(origin({ toolCallId: 'call-1' }), mine, { scope: 'call', key: 'c1' });
    tier.register(origin({ toolCallId: 'call-2' }), theirs, { scope: 'call', key: 'c2' });

    await tier.fireCall('call-1');

    expect(mine).toHaveBeenCalledTimes(1);
    expect(theirs).not.toHaveBeenCalled();
  });

  it("'run' fires for its own runId only — one run never ends another's session", async () => {
    const tier = new ToolSessionTier();
    const mine = vi.fn();
    const theirs = vi.fn();
    tier.register(origin({ runId: 'run-1' }), mine, { scope: 'run', key: 'a' });
    tier.register(origin({ runId: 'run-2' }), theirs, { scope: 'run', key: 'b' });

    await tier.fireRun('run-1');

    expect(mine).toHaveBeenCalledTimes(1);
    expect(theirs).not.toHaveBeenCalled();
  });

  it("REGRESSION — 'run' with NO id fires for the TURN, which may span two runs", async () => {
    // A pause and its resume are one turn across two run ids: `resume()` builds
    // a fresh executor with a fresh id. Filtering on the id would leave every
    // session a paused turn had opened alive forever, and the failure would
    // look like nothing at all — the run answered fine.
    const tier = new ToolSessionTier();
    const beforeThePause = vi.fn();
    tier.register(origin({ runId: 'run-1' }), beforeThePause, { scope: 'run', key: 'a' });

    await tier.fireRun(); // the resume's terminal, under runId 'run-2'

    expect(beforeThePause).toHaveBeenCalledTimes(1);
  });

  it("'session' fires per sessionId, and answers HOW MANY it closed", async () => {
    const tier = new ToolSessionTier();
    const a = vi.fn();
    const b = vi.fn();
    tier.register(origin({ sessionId: 's-1' }), a, { scope: 'session', key: 'a' });
    tier.register(origin({ sessionId: 's-2' }), b, { scope: 'session', key: 'b' });

    // A number, so a composition root can log what happened instead of hoping.
    await expect(tier.fireSession('s-1')).resolves.toBe(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it("'shutdown' fires EVERYTHING, whatever scope it asked for", async () => {
    const tier = new ToolSessionTier();
    const perCall = vi.fn();
    const perRun = vi.fn();
    const perSession = vi.fn();
    tier.register(origin(), perCall, { scope: 'call', key: 'a' });
    tier.register(origin(), perRun, { scope: 'run', key: 'b' });
    tier.register(origin({ sessionId: 's' }), perSession, { scope: 'session', key: 'c' });

    await expect(tier.fireShutdown()).resolves.toBe(3);
    expect(perCall).toHaveBeenCalledTimes(1);
    expect(perRun).toHaveBeenCalledTimes(1);
    expect(perSession).toHaveBeenCalledTimes(1);
  });

  it('the default scope is run — a tool that says nothing gets the turn', async () => {
    const tier = new ToolSessionTier();
    const cleanup = vi.fn();
    tier.register(origin(), cleanup);

    await tier.fireCall('call-1');
    expect(cleanup).not.toHaveBeenCalled();
    await tier.fireRun('run-1');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

// ─── regression: idle sweep and the LRU bound ─────────────────────────────

describe('the backstops under an operator who never closes a session', () => {
  it('an idle session is swept on the NEXT interaction — lazily, with no timer', async () => {
    let clock = 1_000;
    const reports: ToolSessionReport[] = [];
    const cleanup = vi.fn();
    const tier = new ToolSessionTier({
      idleMs: 100,
      now: () => clock,
      report: (r) => void reports.push(r),
    });
    tier.register(origin(), cleanup, { scope: 'session', key: 'cold' });

    clock += 500;
    // Any interaction is the sweep's trigger. A library that installed an
    // interval here would keep the host process alive — the same reason
    // `shutdownOn` refuses to grab signals by default.
    tier.sweepIdle();
    await tier.settled();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(reports.find((r) => r.kind === 'closed')?.reason).toBe('idle');
  });

  it('a REUSED session is not idle — re-registration is the liveness signal', async () => {
    let clock = 1_000;
    const cleanup = vi.fn();
    const tier = new ToolSessionTier({ idleMs: 100, now: () => clock });
    tier.register(origin(), cleanup, { scope: 'session', key: 'warm' });

    clock += 80;
    tier.register(origin(), cleanup, { scope: 'session', key: 'warm' }); // a call reused it
    clock += 80; // 160ms since the FIRST registration, 80 since the touch
    tier.sweepIdle();
    await tier.settled();

    expect(cleanup).not.toHaveBeenCalled();
  });

  it('the live count is BOUNDED — the coldest is evicted, and says why', async () => {
    let clock = 0;
    const reports: ToolSessionReport[] = [];
    const closed: string[] = [];
    const tier = new ToolSessionTier({
      maxLive: 2,
      now: () => ++clock,
      report: (r) => void reports.push(r),
    });
    for (const key of ['a', 'b', 'c']) {
      tier.register(origin({ sessionId: key }), () => void closed.push(key), {
        scope: 'session',
        key,
      });
    }
    await tier.settled();

    // 'a' is the coldest. Without this, a standing process that never calls
    // closeToolSessions grows one sandbox per conversation, forever.
    expect(closed).toEqual(['a']);
    expect(reports.find((r) => r.kind === 'closed')?.reason).toBe('evicted');
    expect(tier.liveCount()).toBe(2);
  });
});

// ─── scenario + reporting ─────────────────────────────────────────────────

describe('what a session leaves behind', () => {
  it('opened once, reused twice, closed once — and register() ANSWERS which', async () => {
    const reports: ToolSessionReport[] = [];
    const tier = new ToolSessionTier({ report: (r) => void reports.push(r) });
    const register = () =>
      tier.register(origin(), () => {}, {
        scope: 'run',
        key: 'k',
        runnerId: 'local-code-runner',
        label: 'python',
      });

    // `register()` answers rather than reports, so the caller — still inside
    // `tool.execute`, still holding the scope — emits with the REAL stage id.
    // Routing these through the tier would have stamped a live, mid-stage event
    // with the teardown pseudo-stage.
    expect(register()).toMatchObject({ outcome: 'started', calls: 1 });
    expect(register()).toMatchObject({ outcome: 'reused', calls: 2 });
    expect(register()).toMatchObject({ outcome: 'reused', calls: 3 });

    await tier.fireRun('run-1');

    // The tier reports only what happens after the last stage: the close.
    expect(reports.map((r) => r.kind)).toEqual(['closed']);
    expect(reports[0]).toMatchObject({
      reason: 'run-end',
      runnerId: 'local-code-runner',
      label: 'python',
    });
    expect(typeof reports[0]?.durationMs).toBe('number');
  });

  it('SECURITY — a report carries the key DIGEST, never the key', async () => {
    const reports: ToolSessionReport[] = [];
    const tier = new ToolSessionTier({ report: (r) => void reports.push(r) });
    const key = 't=acme-corp/p=ada@example.com/s=sess-abc';
    tier.register(origin(), () => {}, { scope: 'run', key });
    await tier.fireRun('run-1');

    for (const report of reports) {
      // The key composes tenant, principal and the hosting sessionId. On the
      // wire it would be a user identifier in every exporter's payload.
      expect(JSON.stringify(report)).not.toContain('acme-corp');
      expect(JSON.stringify(report)).not.toContain('ada@example.com');
      expect(report.keyHash).toBe(hashSessionKey(key));
    }
  });

  it('the digest is stable and short — two rows join without naming anybody', () => {
    const a = hashSessionKey('t=acme/p=ada/s=s1');
    expect(hashSessionKey('t=acme/p=ada/s=s1')).toBe(a);
    expect(hashSessionKey('t=acme/p=bob/s=s1')).not.toBe(a);
    expect(a.length).toBeLessThanOrEqual(12);
  });
});

// ─── property + security: the key grammar ─────────────────────────────────

describe('toolSessionKey — the isolation boundary', () => {
  const table: ReadonlyArray<{
    readonly what: string;
    readonly ctx: ToolExecutionContext;
    readonly scope: 'call' | 'run' | 'session';
    readonly key: string | undefined;
  }> = [
    {
      what: 'call scope is always available — a toolCallId is the one thing every door has',
      ctx: ctx(),
      scope: 'call',
      key: 'c=call-1',
    },
    {
      what: 'run scope with no identity collapses the absent fields to _',
      ctx: ctx({ runId: 'r1' }),
      scope: 'run',
      key: 't=_/p=_/r=r1',
    },
    {
      what: 'run scope composes tenant + principal + run',
      ctx: ctx({
        runId: 'r1',
        identity: { conversationId: 'c', tenant: 'acme', principal: 'ada' },
      }),
      scope: 'run',
      key: 't=acme/p=ada/r=r1',
    },
    {
      what: 'session scope composes tenant + principal + SESSION',
      ctx: ctx({
        runId: 'r1',
        sessionId: 's1',
        identity: { conversationId: 'c', tenant: 'acme', principal: 'ada' },
      }),
      scope: 'session',
      key: 't=acme/p=ada/s=s1',
    },
    {
      what: 'run scope with NO run refuses rather than guessing',
      ctx: ctx(),
      scope: 'run',
      key: undefined,
    },
    {
      what: 'session scope with NO session refuses rather than falling back to the run',
      ctx: ctx({ runId: 'r1' }),
      scope: 'session',
      key: undefined,
    },
  ];

  for (const row of table) {
    it(row.what, () => {
      expect(toolSessionKey(row.ctx, row.scope)).toBe(row.key);
    });
  }

  it("'shutdown' is not a key scope — it is when everything goes", () => {
    expect(toolSessionKey(ctx({ runId: 'r1' }), 'shutdown')).toBeUndefined();
  });

  it('SECURITY — a sessionId ALONE never keys a session', () => {
    // The hosting port says why in its own words: a sessionId is caller data,
    // and anyone who can reach the host can put someone else's there. Two
    // principals inside one session id must not share a sandbox.
    const ada = ctx({ sessionId: 's1', identity: { conversationId: 'c', principal: 'ada' } });
    const bob = ctx({ sessionId: 's1', identity: { conversationId: 'c', principal: 'bob' } });
    expect(toolSessionKey(ada, 'session')).not.toBe(toolSessionKey(bob, 'session'));
    expect(toolSessionKey(ada, 'session')).toContain('p=ada');
  });

  it('SECURITY — two tenants inside one session id do not share a sandbox either', () => {
    const one = ctx({ sessionId: 's1', identity: { conversationId: 'c', tenant: 'acme' } });
    const two = ctx({ sessionId: 's1', identity: { conversationId: 'c', tenant: 'globex' } });
    expect(toolSessionKey(one, 'session')).not.toBe(toolSessionKey(two, 'session'));
  });

  it('REGRESSION — a synthesized conversationId never leaks into the key', () => {
    // `scope.runIdentity` defaults to `{ conversationId: '<runId>' }`. Only
    // tenant and principal compose the key, so a run that named no identity
    // produces a key that says so rather than one that looks specific.
    const anonymous = ctx({ runId: 'run-9' });
    expect(toolSessionKey(anonymous, 'run')).toBe('t=_/p=_/r=run-9');
  });
});
