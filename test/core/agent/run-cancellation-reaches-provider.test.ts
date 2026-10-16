/**
 * A run's cancellation reaches the provider — and nothing late is billed.
 *
 * The threat is cost and abuse: an aborted or timed-out run used to stop the
 * traversal while the provider call in flight kept running (the agent never
 * put the run's signal on the request), and a run's `timeoutMs` never reached
 * the stages at all. These pin, end to end through a real `Agent` and
 * `LLMCall`, with a provider that IGNORES its signal (the worst case):
 *
 *   C1 the request carries a signal that fires with the run's     (both doors)
 *   C2 an abort mid-call rejects the run at once with the reason   (complete + stream)
 *   C3 the run's deadline (`timeoutMs`) fires that signal too,
 *      with or without a caller signal beside it
 *   C4 an answer that lands after the abort is not recorded: no
 *      `llm_end`, no usage, no cost tick
 *   C5 the decorators never retry, fall back from, or count
 *      against a breaker a cancelled call
 */

import { describe, expect, it } from 'vitest';
import { Agent, LLMCall, type LLMProvider, type LLMRequest } from '../../../src/index.js';
import { withCircuitBreaker, withFallback, withRetry } from '../../../src/doors/resilience.js';

const MODES = ['classic', 'dynamic', 'dynamic-grouped'] as const;

const ANSWER = {
  content: 'done',
  toolCalls: [],
  usage: { input: 11, output: 7 },
  stopReason: 'stop',
} as const;

/** A provider that holds its answer until released and IGNORES its signal. */
function heldProvider(streaming: boolean) {
  const seen: (AbortSignal | undefined)[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider: LLMProvider = {
    name: 'held',
    complete: async (req: LLMRequest) => {
      seen.push(req.signal);
      await held;
      return { ...ANSWER };
    },
    ...(streaming && {
      async *stream(req: LLMRequest) {
        seen.push(req.signal);
        yield { tokenIndex: 0, content: 'partial ', done: false };
        await held;
        yield { tokenIndex: 1, content: '', done: true, response: { ...ANSWER } };
      },
    }),
  };
  return { provider, seen, release: () => release() };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r));
};

async function untilCalled(seen: readonly unknown[]): Promise<void> {
  for (let i = 0; i < 400 && seen.length === 0; i++) {
    await new Promise<void>((r) => setImmediate(r));
  }
  expect(seen.length, 'the provider was never called').toBeGreaterThan(0);
}

describe('C1 + C2 — the run’s signal reaches the request, and an abort ends the run at once', () => {
  for (const mode of MODES) {
    for (const streaming of [false, true]) {
      it(`Agent (${mode}, ${streaming ? 'stream' : 'complete'})`, async () => {
        const { provider, seen, release } = heldProvider(streaming);
        const agent = Agent.create({ provider, model: 'm', reactMode: mode }).build();
        const controller = new AbortController();
        const reason = new Error('user left');
        const run = agent.run('hello', { signal: controller.signal });
        run.catch(() => undefined);
        await untilCalled(seen);
        const wire = seen[0];
        expect(wire, 'the request carried no signal').toBeDefined();
        expect(wire!.aborted).toBe(false);
        controller.abort(reason);
        expect(wire!.aborted).toBe(true);
        await expect(run).rejects.toBe(reason);
        release();
        await settle();
      });
    }
  }

  it('LLMCall', async () => {
    const { provider, seen, release } = heldProvider(false);
    const call = LLMCall.create({ provider, model: 'm' }).build();
    const controller = new AbortController();
    const reason = new Error('user left');
    const run = call.run({ message: 'hello' }, { signal: controller.signal });
    run.catch(() => undefined);
    await untilCalled(seen);
    expect(seen[0]).toBeDefined();
    controller.abort(reason);
    expect(seen[0]!.aborted).toBe(true);
    await expect(run).rejects.toBe(reason);
    release();
    await settle();
  });

  it('a signal handed only to the stages (`env.signal`) reaches the request too', async () => {
    const { provider, seen, release } = heldProvider(false);
    const agent = Agent.create({ provider, model: 'm' }).build();
    const controller = new AbortController();
    const reason = new Error('env abort');
    const run = agent.run('hello', { env: { signal: controller.signal } });
    run.catch(() => undefined);
    await untilCalled(seen);
    controller.abort(reason);
    expect(seen[0]!.aborted).toBe(true);
    await expect(run).rejects.toBe(reason);
    release();
    await settle();
  });
});

describe('C3 — the run’s deadline cancels the call in flight', () => {
  it('timeoutMs alone', async () => {
    const { provider, seen, release } = heldProvider(false);
    const agent = Agent.create({ provider, model: 'm' }).build();
    const run = agent.run('hello', { timeoutMs: 40 });
    run.catch(() => undefined);
    await untilCalled(seen);
    expect(seen[0], 'the deadline never reached the request').toBeDefined();
    await expect(run).rejects.toThrow('Execution timed out after 40ms');
    expect(seen[0]!.aborted).toBe(true);
    release();
    await settle();
  });

  it('timeoutMs beside a caller signal — the deadline still fires (it used to be ignored)', async () => {
    const { provider, seen, release } = heldProvider(true);
    const agent = Agent.create({ provider, model: 'm' }).build();
    const controller = new AbortController();
    const run = agent.run('hello', { signal: controller.signal, timeoutMs: 40 });
    run.catch(() => undefined);
    await untilCalled(seen);
    await expect(run).rejects.toThrow('Execution timed out after 40ms');
    expect(seen[0]!.aborted).toBe(true);
    expect(controller.signal.aborted).toBe(false);
    release();
    await settle();
  });
});

describe('C4 — an answer that lands after the abort is not recorded or billed', () => {
  for (const streaming of [false, true]) {
    it(`Agent (${streaming ? 'stream' : 'complete'})`, async () => {
      const { provider, seen, release } = heldProvider(streaming);
      const agent = Agent.create({ provider, model: 'm' }).build();
      const recorded: string[] = [];
      agent.on('*', (e) => {
        if (e.type === 'agentfootprint.stream.llm_end' || e.type.startsWith('agentfootprint.cost'))
          recorded.push(e.type);
      });
      const controller = new AbortController();
      const reason = new Error('user left');
      const run = agent.run('hello', { signal: controller.signal });
      run.catch(() => undefined);
      await untilCalled(seen);
      // The answer is released, then the abort fires in the same tick.
      release();
      controller.abort(reason);
      await expect(run).rejects.toBe(reason);
      await settle();
      expect(recorded).toEqual([]);
      const state = (agent.getLastSnapshot()?.sharedState ?? {}) as {
        totalInputTokens?: number;
        totalOutputTokens?: number;
      };
      expect(state.totalInputTokens ?? 0).toBe(0);
      expect(state.totalOutputTokens ?? 0).toBe(0);
    });
  }
});

describe('C5 — the decorators leave a cancelled call cancelled', () => {
  /** Fails AFTER the signal fired, with an error that would otherwise be retried. */
  function failsOnAbort() {
    let calls = 0;
    const provider: LLMProvider = {
      name: 'flaky',
      complete: (req) =>
        new Promise((_resolve, reject) => {
          calls++;
          req.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('socket hang up'), { status: 503 })),
          );
        }),
    };
    return { provider, calls: () => calls };
  }

  const request = (signal: AbortSignal): LLMRequest => ({
    model: 'm',
    messages: [{ role: 'user', content: 'hi' }],
    signal,
  });

  it('withRetry never asks again', async () => {
    const inner = failsOnAbort();
    const provider = withRetry(inner.provider, { maxAttempts: 5, initialDelayMs: 0 });
    const controller = new AbortController();
    const reason = new Error('stop');
    const pending = provider.complete(request(controller.signal));
    await settle();
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(inner.calls()).toBe(1);
  });

  it('withFallback never moves to the other side', async () => {
    const inner = failsOnAbort();
    let fallbackCalls = 0;
    const provider = withFallback(inner.provider, {
      name: 'other',
      complete: async () => {
        fallbackCalls++;
        return { ...ANSWER };
      },
    });
    const controller = new AbortController();
    const reason = new Error('stop');
    const pending = provider.complete(request(controller.signal));
    await settle();
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(fallbackCalls).toBe(0);
  });

  it('withCircuitBreaker never counts it as a vendor failure', async () => {
    const inner = failsOnAbort();
    const states: string[] = [];
    const provider = withCircuitBreaker(inner.provider, {
      failureThreshold: 2,
      onStateChange: (s) => states.push(s),
    });
    for (let i = 0; i < 3; i++) {
      const controller = new AbortController();
      const pending = provider.complete(request(controller.signal));
      pending.catch(() => undefined);
      await settle();
      controller.abort(new Error('stop'));
      await pending.catch(() => undefined);
    }
    expect(states).toEqual([]);
    expect(inner.calls()).toBe(3);
  });
});
