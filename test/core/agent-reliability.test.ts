/**
 * Agent reliability — integration tests for v2.11.5.
 *
 * Tests the consumer-facing surface:
 *   `Agent.create(...).reliability({...}).build().run(...)`
 *
 * Covers four real consumer paths through the wiring:
 *
 *   P1  Happy path — reliability configured but call succeeds first try
 *        → ReAct loop completes, returns final answer (no fail-fast)
 *   P2  Retry success — provider throws once, post-decide retries, succeeds
 *        → final answer returned; attempt counter reached 2
 *   P3  Fail-fast — post-decide rule routes to fail-fast on error
 *        → Agent.run() throws ReliabilityFailFastError with kind/reason/cause
 *   P4  Pre-check fail-fast — pre-check rule routes to fail-fast before call
 *        → Agent.run() throws with phase='pre-check'
 *
 * Streaming + reliability semantics (first-chunk arbitration) is covered
 * separately at the helper level in test/reliability/. This file
 * exercises the AgentBuilder → Agent → ReliabilityFailFastError loop
 * end-to-end via the public surface.
 */

import { describe, expect, it } from 'vitest';
import { Agent } from '../../src/core/Agent.js';
import { ReliabilityFailFastError } from '../../src/reliability/types.js';
import type { LLMProvider, LLMResponse, LLMRequest } from '../../src/adapters/types.js';

// ─── Test helpers ─────────────────────────────────────────────────

/** Provider that succeeds on every call. */
function okProvider(reply: string): LLMProvider {
  return {
    name: 'mock',
    complete: async (): Promise<LLMResponse> => ({
      content: reply,
      toolCalls: [],
      usage: { input: 1, output: 1 },
      stopReason: 'end_turn',
    }),
  };
}

/** Provider that throws the given error N times, then succeeds. Returns
 *  the captured call count via `getCalls()`. */
function flakyProvider(opts: { failTimes: number; error: Error; successReply: string }): {
  provider: LLMProvider;
  getCalls: () => number;
} {
  let calls = 0;
  const provider: LLMProvider = {
    name: 'flaky',
    complete: async (_req: LLMRequest): Promise<LLMResponse> => {
      calls += 1;
      if (calls <= opts.failTimes) throw opts.error;
      return {
        content: opts.successReply,
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'end_turn',
      };
    },
  };
  return { provider, getCalls: () => calls };
}

/** Provider that always throws. */
function alwaysThrowsProvider(error: Error): LLMProvider {
  return {
    name: 'broken',
    complete: async (): Promise<LLMResponse> => {
      throw error;
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Agent.reliability — integration', () => {
  it('P1 happy path — reliability configured, first-call success → final answer', async () => {
    const agent = Agent.create({ provider: okProvider('hello'), model: 'mock' })
      .system('You echo.')
      .reliability({
        postDecide: [
          {
            when: (s) => s.error !== undefined,
            then: 'fail-fast',
            kind: 'unrecoverable',
          },
        ],
      })
      .build();

    const result = await agent.run({ message: 'hi' });
    expect(result).toBe('hello');
  });

  it('P2 retry success — provider throws once, postDecide retries, second call succeeds', async () => {
    const transient = new Error('Service Unavailable');
    (transient as Error & { status?: number }).status = 503;
    const flaky = flakyProvider({
      failTimes: 1,
      error: transient,
      successReply: 'recovered',
    });

    const agent = Agent.create({ provider: flaky.provider, model: 'mock' })
      .system('You echo.')
      .reliability({
        postDecide: [
          {
            when: (s) => s.errorKind === '5xx-transient' && s.attempt < 3,
            then: 'retry',
            kind: 'transient-retry',
          },
          {
            when: (s) => s.error !== undefined,
            then: 'fail-fast',
            kind: 'unrecoverable',
          },
        ],
      })
      .build();

    const result = await agent.run({ message: 'go' });
    expect(result).toBe('recovered');
    // 1 fail + 1 success = 2 calls
    expect(flaky.getCalls()).toBe(2);
  });

  it('P3 fail-fast — postDecide routes to fail-fast on error → ReliabilityFailFastError thrown', async () => {
    const fatal = new Error('schema violation');
    const agent = Agent.create({
      provider: alwaysThrowsProvider(fatal),
      model: 'mock',
    })
      .system('You echo.')
      .reliability({
        postDecide: [
          {
            when: (s) => s.error !== undefined,
            then: 'fail-fast',
            kind: 'unrecoverable',
            label: 'unrecoverable error',
          },
        ],
      })
      .build();

    await expect(agent.run({ message: 'go' })).rejects.toThrow(ReliabilityFailFastError);

    // Re-run to inspect the error fields (rejects.toThrow only checks
    // the constructor; we want kind/reason/payload structure too).
    let caught: ReliabilityFailFastError | undefined;
    try {
      await agent.run({ message: 'go' });
    } catch (e) {
      if (e instanceof ReliabilityFailFastError) caught = e;
    }
    expect(caught).toBeInstanceOf(ReliabilityFailFastError);
    expect(caught?.kind).toBe('unrecoverable');
    expect(caught?.reason).toMatch(/reliability-post-decide/);
    expect(caught?.payload?.phase).toBe('post-decide');
    // `cause` is reconstructed at the API boundary from message+name
    // captured into scope (Error instances don't structuredClone cleanly).
    // Identity (===) won't match the original; message + name do.
    expect(caught?.cause?.message).toBe(fatal.message);
    expect(caught?.cause?.name).toBe(fatal.name);
  });

  it('P4 pre-check fail-fast — preCheck rule fires before any provider call', async () => {
    const ok = okProvider('should-not-be-called');
    let providerCalled = false;
    const tracking: LLMProvider = {
      name: ok.name,
      complete: async (req) => {
        providerCalled = true;
        return ok.complete(req);
      },
    };

    const agent = Agent.create({ provider: tracking, model: 'mock' })
      .system('You echo.')
      .reliability({
        preCheck: [
          {
            // Always-fire: cumulative cost would exceed cap, etc. The
            // predicate doesn't read scope here — just always returns
            // true to exercise the pre-check fail-fast path.
            when: () => true,
            then: 'fail-fast',
            kind: 'cost-cap-exceeded',
            label: 'budget would be exceeded',
          },
        ],
      })
      .build();

    let caught: ReliabilityFailFastError | undefined;
    try {
      await agent.run({ message: 'go' });
    } catch (e) {
      if (e instanceof ReliabilityFailFastError) caught = e;
    }

    expect(caught).toBeInstanceOf(ReliabilityFailFastError);
    expect(caught?.kind).toBe('cost-cap-exceeded');
    expect(caught?.payload?.phase).toBe('pre-check');
    expect(providerCalled).toBe(false);
  });

  it('builder rejects double .reliability() call', () => {
    expect(() =>
      Agent.create({ provider: okProvider('x'), model: 'mock' })
        .reliability({})
        .reliability({}),
    ).toThrow(/already set/);
  });
});
