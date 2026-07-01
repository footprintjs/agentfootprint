/**
 * withCredentialRetry — Convention 3 test types for the CredentialProvider
 * retry decorator (transient credential failures retry before failing closed).
 *
 * Decision record (why a decorator, not a reliability rule): the rules-based
 * reliability subsystem is LLM-call-scoped (`ReliabilityScope.request:
 * LLMRequest`; the gate chart loops around CallLLM with provider failover).
 * Credential resolution lives in the tool-dispatch loop — promoting it to a
 * chart-level gate is the deferred `sf-credential` node. The decorator mirrors
 * `resilience/withRetry`: same option vocabulary, same shared
 * `defaultShouldRetry` transience policy, consumer-wired `onRetry` visibility.
 *
 * Headline guarantees:
 *   • flaky-then-success → the tool runs (no fail-closed false negative)
 *   • exhausted retries  → byte-identical fail-closed behavior to unwrapped
 *   • `authorization-required` (3LO consent) is NEVER retried
 */

import { describe, it, expect } from 'vitest';
import { Agent, defineTool } from '../../src/index.js'
import { mock } from '../../src/llm-providers.js';
import {
  withCredentialRetry,
  staticTokens,
  bearer,
  type CredentialProvider,
  type CredentialResult,
} from '../../src/identity.js';

// ─── Helpers ─────────────────────────────────────────────────────────

/** A provider that follows a fixed plan: each call returns the next entry
 *  (a result) or throws it (an Error). */
function plannedProvider(plan: (CredentialResult | Error)[]): {
  provider: CredentialProvider;
  calls: () => number;
} {
  let i = 0;
  return {
    calls: () => i,
    provider: {
      id: 'planned',
      getCredential: () => {
        const step = plan[Math.min(i++, plan.length - 1)]!;
        if (step instanceof Error) return Promise.reject(step);
        return Promise.resolve(step);
      },
    },
  };
}

const issued = (token = 'tok'): CredentialResult => ({
  status: 'issued',
  credential: bearer(token),
});

const consent: CredentialResult = {
  status: 'authorization-required',
  authorizationUrl: 'https://idp.example/consent',
  sessionId: 'sess-1',
};

interface RunOut {
  answer: string;
  events: Array<{ name: string; payload: Record<string, unknown> }>;
}

/** Run a one-tool declare-and-push agent and capture all emit events. */
async function runAgentWith(credentials: CredentialProvider, tool: unknown): Promise<RunOut> {
  const events: RunOut['events'] = [];
  const probe = {
    id: 'probe',
    onEmit: (e: { name: string; payload: Record<string, unknown> }) =>
      events.push({ name: e.name, payload: e.payload }),
  };
  const agent = Agent.create({
    provider: mock({
      replies: [
        {
          content: 'calling',
          toolCalls: [
            { id: 'c1', name: (tool as { schema: { name: string } }).schema.name, args: {} },
          ],
        },
        { content: 'done', toolCalls: [] },
      ],
    }),
    model: 'mock',
    maxIterations: 3,
    credentials,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .tools([tool as any])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .recorder(probe as any)
    .build();
  const answer = await agent.run({ message: 'go' });
  return { answer: String(answer), events };
}

// ─── Unit ────────────────────────────────────────────────────────────
describe('withCredentialRetry — Unit', () => {
  it('returns the first issued result without retry', async () => {
    const { provider, calls } = plannedProvider([issued()]);
    const r = await withCredentialRetry(provider).getCredential({ service: 's' });
    expect(r.status).toBe('issued');
    expect(calls()).toBe(1);
  });

  it('retries thrown errors until success within maxAttempts (flaky-then-success)', async () => {
    const { provider, calls } = plannedProvider([new Error('blip1'), new Error('blip2'), issued()]);
    const seen: Array<{ attempt: number; delayMs: number; message: string }> = [];
    const wrapped = withCredentialRetry(provider, {
      maxAttempts: 3,
      initialDelayMs: 1,
      onRetry: (err, attempt, delayMs) =>
        seen.push({ attempt, delayMs, message: (err as Error).message }),
    });

    const r = await wrapped.getCredential({ service: 's' });

    expect(r.status).toBe('issued');
    expect(calls()).toBe(3);
    // onRetry fires BEFORE attempts 2 and 3, carrying the failed attempt's error.
    expect(seen.map((s) => s.attempt)).toEqual([2, 3]);
    expect(seen.map((s) => s.message)).toEqual(['blip1', 'blip2']);
  });

  it('throws the LAST error after exhausting maxAttempts (fail-closed)', async () => {
    const { provider, calls } = plannedProvider([
      new Error('blip1'),
      new Error('blip2'),
      new Error('blip3'),
    ]);
    const wrapped = withCredentialRetry(provider, { maxAttempts: 3, initialDelayMs: 1 });
    await expect(wrapped.getCredential({ service: 's' })).rejects.toThrow('blip3');
    expect(calls()).toBe(3);
  });

  it('skips retry for 4xx errors (except 429) and AbortError — same policy as withRetry', async () => {
    // 400 → no retry
    const e400 = Object.assign(new Error('bad request'), { status: 400 });
    const p400 = plannedProvider([e400, issued()]);
    await expect(
      withCredentialRetry(p400.provider, { initialDelayMs: 1 }).getCredential({ service: 's' }),
    ).rejects.toThrow('bad request');
    expect(p400.calls()).toBe(1);

    // 429 → retried (AgentCore ThrottlingException)
    const e429 = Object.assign(new Error('throttled'), { status: 429 });
    const p429 = plannedProvider([e429, issued()]);
    const r = await withCredentialRetry(p429.provider, { initialDelayMs: 1 }).getCredential({
      service: 's',
    });
    expect(r.status).toBe('issued');
    expect(p429.calls()).toBe(2);

    // AbortError → no retry
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const pAbort = plannedProvider([abort, issued()]);
    await expect(
      withCredentialRetry(pAbort.provider, { initialDelayMs: 1 }).getCredential({ service: 's' }),
    ).rejects.toThrow('aborted');
    expect(pAbort.calls()).toBe(1);
  });

  it('NEVER retries authorization-required — 3LO consent is a human flow, not a fault', async () => {
    const { provider, calls } = plannedProvider([consent, issued()]);
    const shouldRetryCalls: unknown[] = [];
    const wrapped = withCredentialRetry(provider, {
      initialDelayMs: 1,
      shouldRetry: (err) => {
        shouldRetryCalls.push(err);
        return true;
      },
    });

    const r = await wrapped.getCredential({ service: 's', mode: 'user' });

    expect(r.status).toBe('authorization-required');
    expect(calls()).toBe(1); // returned immediately, no second call
    expect(shouldRetryCalls).toEqual([]); // shouldRetry only ever sees THROWN errors
  });

  it('id is suffixed +retry; custom shouldRetry=false short-circuits; maxAttempts clamps to 1', async () => {
    const { provider } = plannedProvider([issued()]);
    expect(withCredentialRetry(provider).id).toBe('planned+retry');

    const pNo = plannedProvider([new Error('nope'), issued()]);
    await expect(
      withCredentialRetry(pNo.provider, { shouldRetry: () => false }).getCredential({
        service: 's',
      }),
    ).rejects.toThrow('nope');
    expect(pNo.calls()).toBe(1);

    const pClamp = plannedProvider([new Error('once'), issued()]);
    await expect(
      withCredentialRetry(pClamp.provider, { maxAttempts: 0, initialDelayMs: 1 }).getCredential({
        service: 's',
      }),
    ).rejects.toThrow('once');
    expect(pClamp.calls()).toBe(1);
  });
});

// ─── Property (backoff invariants) ───────────────────────────────────
describe('withCredentialRetry — Property', () => {
  it('delays follow min(maxDelayMs, initial·factor^(n-1)): non-decreasing and capped', async () => {
    for (const [initialDelayMs, backoffFactor, maxDelayMs] of [
      [1, 2, 4],
      [2, 3, 10],
      [1, 1, 10],
    ] as const) {
      const { provider } = plannedProvider([
        new Error('e1'),
        new Error('e2'),
        new Error('e3'),
        issued(),
      ]);
      const delays: number[] = [];
      await withCredentialRetry(provider, {
        maxAttempts: 4,
        initialDelayMs,
        backoffFactor,
        maxDelayMs,
        onRetry: (_e, _a, d) => delays.push(d),
      }).getCredential({ service: 's' });

      expect(delays).toHaveLength(3);
      delays.forEach((d, i) => {
        expect(d).toBe(Math.min(maxDelayMs, initialDelayMs * Math.pow(backoffFactor, i)));
        if (i > 0) expect(d).toBeGreaterThanOrEqual(delays[i - 1]!);
        expect(d).toBeLessThanOrEqual(maxDelayMs);
      });
    }
  });
});

// ─── Functional (agent happy path: flaky provider, tool still runs) ──
describe('withCredentialRetry — Functional', () => {
  it('a flaky-then-success provider still resolves the declared need and the tool runs', async () => {
    const SECRET = 'ghp_retry_secret_0001';
    let inner = 0;
    const flaky: CredentialProvider = {
      id: 'flaky-idp',
      getCredential: (req) => {
        inner++;
        if (inner === 1) {
          return Promise.reject(Object.assign(new Error('ETIMEDOUT: idp blip'), { status: 503 }));
        }
        return staticTokens({ github: SECRET }).getCredential(req);
      },
    };
    const retries: number[] = [];
    const credentials = withCredentialRetry(flaky, {
      maxAttempts: 3,
      initialDelayMs: 1,
      onRetry: (_e, attempt) => retries.push(attempt),
    });

    let appliedAuth = '';
    const tool = defineTool({
      name: 'list_repos',
      description: 'list',
      inputSchema: { type: 'object', properties: {} },
      needs: { credential: 'github' },
      execute: async (_args, ctx) => {
        appliedAuth = ctx.credential ? ctx.credential.toHeaders().authorization! : '(none)';
        return 'ok';
      },
    });

    const out = await runAgentWith(credentials, tool);

    expect(appliedAuth).toBe(`Bearer ${SECRET}`); // tool ran with the pushed credential
    expect(inner).toBe(2); // one blip + one success
    expect(retries).toEqual([2]); // per-attempt visibility, consumer-wired
    // The agent trace brackets the WHOLE retried resolution — exactly one
    // requested/acquired pair, no credential.failed, no new event types.
    const names = out.events.map((e) => e.name);
    expect(names.filter((n) => n === 'agentfootprint.credential.requested')).toHaveLength(1);
    expect(names.filter((n) => n === 'agentfootprint.credential.acquired')).toHaveLength(1);
    expect(names).not.toContain('agentfootprint.credential.failed');
  });
});

// ─── Integration (exhausted retries == unwrapped fail-closed parity) ─
describe('withCredentialRetry — Integration', () => {
  function alwaysFailing(): CredentialProvider {
    return {
      id: 'down-idp',
      getCredential: () =>
        Promise.reject(Object.assign(new Error('vault unreachable'), { status: 503 })),
    };
  }

  function needyTool(executed: { ran: boolean }): unknown {
    return defineTool({
      name: 'needs_cred',
      description: 'needs a credential',
      inputSchema: { type: 'object', properties: {} },
      needs: { credential: 'github' },
      execute: async () => {
        executed.ran = true;
        return 'should not run';
      },
    });
  }

  it('exhausted retries fail closed IDENTICALLY to an unwrapped throwing provider', async () => {
    const wrappedRan = { ran: false };
    const unwrappedRan = { ran: false };

    const wrappedOut = await runAgentWith(
      withCredentialRetry(alwaysFailing(), { maxAttempts: 2, initialDelayMs: 1 }),
      needyTool(wrappedRan),
    );
    const unwrappedOut = await runAgentWith(alwaysFailing(), needyTool(unwrappedRan));

    // Tool never executed in either world.
    expect(wrappedRan.ran).toBe(false);
    expect(unwrappedRan.ran).toBe(false);

    // Identical credential event sequences (requested → failed, once each)…
    const credEvents = (o: RunOut): Array<[string, unknown]> =>
      o.events
        .filter((e) => e.name.startsWith('agentfootprint.credential.'))
        .map((e) => [e.name, e.payload['reason']]);
    expect(credEvents(wrappedOut)).toEqual(credEvents(unwrappedOut));
    expect(credEvents(wrappedOut)).toEqual([
      ['agentfootprint.credential.requested', undefined],
      ['agentfootprint.credential.failed', 'vault unreachable'],
    ]);

    // …and the same error surfaced to the LLM as the tool result.
    const toolEnd = (o: RunOut): unknown =>
      o.events.find((e) => e.name === 'agentfootprint.stream.tool_end')?.payload['result'];
    expect(toolEnd(wrappedOut)).toBe("credential error for 'github': vault unreachable");
    expect(toolEnd(wrappedOut)).toEqual(toolEnd(unwrappedOut));
  });
});

// ─── Security ────────────────────────────────────────────────────────
describe('withCredentialRetry — Security', () => {
  it('passes the issued credential through by reference — never clones or serializes the secret', async () => {
    const cred = bearer('SECRET_TOK');
    const { provider } = plannedProvider([{ status: 'issued', credential: cred }]);
    const r = await withCredentialRetry(provider).getCredential({ service: 's' });
    expect(r.status).toBe('issued');
    if (r.status === 'issued') expect(r.credential).toBe(cred); // same object
  });

  it('rethrows the provider error UNALTERED — no new message surface for token echo', async () => {
    const original = Object.assign(new Error('clean message, no secrets'), { status: 503 });
    const { provider } = plannedProvider([original, original, original]);
    const wrapped = withCredentialRetry(provider, { maxAttempts: 2, initialDelayMs: 1 });
    await expect(wrapped.getCredential({ service: 's' })).rejects.toBe(original);
  });
});

// ─── Performance ─────────────────────────────────────────────────────
describe('withCredentialRetry — Performance', () => {
  it('zero-retry happy path adds negligible overhead — 2000 calls well under budget', async () => {
    const wrapped = withCredentialRetry(staticTokens({ s: 'tok' }));
    const start = Date.now();
    for (let i = 0; i < 2000; i++) await wrapped.getCredential({ service: 's' });
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

// ─── Load ────────────────────────────────────────────────────────────
describe('withCredentialRetry — Load', () => {
  it('500 concurrent resolutions (some flaky) all settle correctly', async () => {
    const results = await Promise.all(
      Array.from({ length: 500 }, (_, i) => {
        const plan =
          i % 5 === 0
            ? [Object.assign(new Error('blip'), { status: 503 }), issued(`t${i}`)]
            : [issued(`t${i}`)];
        const { provider } = plannedProvider(plan);
        return withCredentialRetry(provider, { initialDelayMs: 1 }).getCredential({
          service: 's',
        });
      }),
    );
    expect(results).toHaveLength(500);
    expect(results.every((r) => r.status === 'issued')).toBe(true);
  });
});
