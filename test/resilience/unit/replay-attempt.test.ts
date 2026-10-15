/** A later transport attempt must not resurrect a leaf-approved omission. */
import { describe, expect, it, vi } from 'vitest';
import type {
  LLMCallHooks,
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../../../src/provider-contract/types.js';
import type { ReplayPreparation } from '../../../src/thinking/replay.js';
import { replayMessageFingerprint } from '../../../src/thinking/replayHistory.js';
import { withFallback } from '../../../src/resilience/withFallback.js';
import { withRetry } from '../../../src/resilience/withRetry.js';
import { replayAttempts } from '../../../src/resilience/replayAttempt.js';

const response: LLMResponse = {
  content: 'done',
  toolCalls: [],
  usage: { input: 1, output: 1 },
  stopReason: 'end_turn',
};
const chunk: LLMChunk = { content: '', tokenIndex: 0, done: true, response };
const retry = (provider: LLMProvider) => withRetry(provider, { initialDelayMs: 0, maxAttempts: 2 });
const stacks = [
  { name: 'retry', attempts: 2, wrap: (p: LLMProvider, _f: LLMProvider) => retry(p) },
  { name: 'fallback', attempts: 2, wrap: withFallback },
  {
    name: 'retry around fallback',
    attempts: 3,
    wrap: (p: LLMProvider, f: LLMProvider) => retry(withFallback(p, f)),
  },
  {
    name: 'fallback around retry',
    attempts: 3,
    wrap: (p: LLMProvider, f: LLMProvider) => withFallback(retry(p), f),
  },
] as const;
type Door = 'complete' | 'stream';

function request(): LLMRequest {
  return Object.freeze({
    model: 'fixture-model',
    systemPrompt: 'unchanged system',
    maxTokens: 123,
    messages: Object.freeze([
      Object.freeze({ role: 'user' as const, content: 'earlier question' }),
      Object.freeze({
        role: 'assistant' as const,
        content: 'earlier answer',
        thinkingBlocks: Object.freeze([
          Object.freeze({
            type: 'thinking' as const,
            content: 'private thought',
            signature: 'sig',
          }),
        ]),
      }),
      Object.freeze({ role: 'user' as const, content: 'continue' }),
    ]),
  });
}

describe('attempt report aggregation', () => {
  it('maps only terminal values while forwarding iterator next, return and throw unchanged', async () => {
    const attempts = replayAttempts(request());
    const plan = preparation(request(), true);
    attempts.hooks.onReplayPrepared(plan);
    const done = { done: true as const, value: undefined };
    const yielded = { done: false as const, value: chunk };
    const inner = {
      next: vi.fn(async () => yielded),
      return: vi.fn(async () => done),
      throw: vi.fn(async (_error: unknown) => done),
    };
    const wrapped = attempts.iterator(inner);
    const received = await wrapped.next();
    expect(received.value?.response?.replayOmissions).toEqual(plan.omissions);
    expect(chunk.response).toBe(response);
    expect(await wrapped.return?.()).toBe(done);
    const error = new Error('caller interruption');
    expect(await wrapped.throw?.(error)).toBe(done);
    expect(inner.next).toHaveBeenCalledOnce();
    expect(inner.return).toHaveBeenCalledOnce();
    expect(inner.throw).toHaveBeenCalledExactlyOnceWith(error);
    const quiet = replayAttempts(request()).iterator({ next: inner.next });
    expect(await quiet.next()).toBe(yielded);
    expect(quiet.return).toBeUndefined();
    expect(quiet.throw).toBeUndefined();
  });

  it('deduplicates observed and final reports by fields, retaining distinct blocks and only metadata', () => {
    const original = request();
    const plan = preparation(original, true);
    const omission = plan.omissions[0]!;
    const hook = vi.fn();
    const attempts = replayAttempts(original, { onReplayPrepared: hook });
    const extra = { ...omission, privateContent: 'do not retain model content' };
    attempts.hooks.onReplayPrepared({ ...plan, omissions: [extra] });
    const equivalent = {
      messageFingerprint: omission.messageFingerprint,
      reason: omission.reason,
      blockIndex: omission.blockIndex,
      messageIndex: omission.messageIndex,
    };
    const distinct = { ...omission, blockIndex: 1 };
    const answer = attempts.response({
      ...response,
      replayOmissions: [equivalent, distinct, distinct],
    });
    expect(answer.replayOmissions).toEqual([omission, distinct]);
    expect(JSON.stringify(answer.replayOmissions)).not.toContain('privateContent');
    expect(JSON.stringify(answer.replayOmissions)).not.toContain('do not retain');
    expect(hook).toHaveBeenCalledOnce();
    // Attaching reports never re-emits observation callbacks.
    expect(attempts.response(answer)).toBe(answer);
    expect(hook).toHaveBeenCalledOnce();
    expect(response.replayOmissions).toBeUndefined();
  });

  it('retains report metadata when the reliability owner replaces its current request', () => {
    const original = request();
    const attempts = replayAttempts(original);
    const plan = preparation(original, true);
    attempts.hooks.onReplayPrepared(plan);
    const next = {
      ...attempts.request,
      messages: [...attempts.request.messages, { role: 'user' as const, content: 'feedback' }],
    };
    attempts.replaceRequest(next);
    expect(attempts.request).toBe(next);
    expect(attempts.response(response).replayOmissions).toEqual(plan.omissions);
    expect(original.messages).toHaveLength(3);
  });

  it('does not retain a failed upstream persistence report', () => {
    const attempts = replayAttempts(request(), {
      onReplayPrepared: () => {
        throw new Error('write failed');
      },
    });
    expect(() => attempts.hooks.onReplayPrepared(preparation(request(), true))).toThrow(
      'write failed',
    );
    expect(attempts.response(response)).toBe(response);
  });

  for (const stack of stacks) {
    it(`${stack.name} attaches diagnostics only to the eventual terminal chunk`, async () => {
      const original = request();
      const plans: ReplayPreparation[] = [];
      const hook = vi.fn();
      let calls = 0;
      const prefix: LLMChunk = { content: 'visible', tokenIndex: 0, done: false };
      const p: LLMProvider = {
        name: 'scripted',
        complete: async () => response,
        async *stream(req, hooks) {
          calls++;
          if (calls === 1) {
            const plan = preparation(req, true);
            plans.push(plan);
            hooks?.onReplayPrepared?.(plan);
          }
          if (calls < stack.attempts) throw new Error('transport failed');
          yield prefix;
          yield chunk;
        },
      };
      const got = (await invoke(stack.wrap(p, p), 'stream', original, {
        onReplayPrepared: hook,
      })) as LLMChunk[];
      expect(got[0]).toBe(prefix);
      expect(got[0]?.response).toBeUndefined();
      expect(got[1]?.response?.replayOmissions).toEqual(plans[0]?.omissions);
      expect(hook).toHaveBeenCalledOnce();
      expect(calls).toBe(stack.attempts);
    });
  }
});

/** The leaf chooses and reports; the wrapper must not invent this decision. */
function preparation(req: LLMRequest, omit: boolean): ReplayPreparation {
  const original = req.messages[1]!;
  return {
    provider: 'fixture-leaf',
    model: req.model,
    request: omit
      ? {
          ...req,
          // A request-local leaf adjustment is NOT authority to change the next
          // leaf's model. Only the approved message retirement crosses attempts.
          model: 'leaf-resolved-model',
          messages: req.messages.map((message, index) =>
            index === 1 ? { ...message, thinkingBlocks: [] } : message,
          ),
        }
      : req,
    omissions: omit
      ? [
          {
            messageIndex: 1,
            blockIndex: 0,
            reason: 'prefix-changed',
            messageFingerprint: replayMessageFingerprint(original),
          },
        ]
      : [],
  };
}

function leaf(name: string, run: (req: LLMRequest, hooks?: LLMCallHooks) => void): LLMProvider {
  return {
    name,
    async complete(req, hooks) {
      run(req, hooks);
      return response;
    },
    async *stream(req, hooks) {
      run(req, hooks);
      yield chunk;
    },
  };
}

async function invoke(provider: LLMProvider, door: Door, req: LLMRequest, hooks?: LLMCallHooks) {
  if (door === 'complete') return provider.complete(req, hooks);
  const got: LLMChunk[] = [];
  for await (const item of provider.stream!(req, hooks)) got.push(item);
  return got;
}

for (const door of ['complete', 'stream'] as const) {
  describe(`${door}: approved replay retirement across attempts`, () => {
    for (const stack of stacks) {
      for (const externalHook of [true, false]) {
        it(`${stack.name} keeps the omission (${
          externalHook ? 'with' : 'without'
        } caller hook)`, async () => {
          const original = request();
          const before = JSON.stringify(original);
          const seen: LLMRequest[] = [];
          const plans: ReplayPreparation[] = [];
          const onReplayPrepared = vi.fn();
          const onResilience = vi.fn();
          const run = (req: LLMRequest, hooks?: LLMCallHooks) => {
            seen.push(req);
            const plan = preparation(req, seen.length === 1);
            plans.push(plan);
            hooks?.onReplayPrepared?.(plan);
            if (seen.length < stack.attempts) throw new Error('transport failed');
          };
          const provider = stack.wrap(leaf('first', run), leaf('other', run));
          const result = await invoke(
            provider,
            door,
            original,
            externalHook ? { onReplayPrepared, onResilience } : undefined,
          );

          const reported = { ...response, replayOmissions: plans[0]!.omissions };
          expect(result).toEqual(
            door === 'complete' ? reported : [{ ...chunk, response: reported }],
          );
          expect(seen).toHaveLength(stack.attempts);
          expect(seen[0]).toBe(original);
          for (const attempt of seen.slice(1)) {
            expect(attempt).not.toBe(original);
            expect(attempt.messages[1]!.thinkingBlocks).toEqual([]);
            expect(attempt.messages[0]).toBe(original.messages[0]);
            expect(attempt.messages[2]).toBe(original.messages[2]);
            expect(attempt.messages[1]!.content).toBe('earlier answer');
            expect(attempt.model).toBe(original.model);
            expect(attempt.systemPrompt).toBe(original.systemPrompt);
            expect(attempt.maxTokens).toBe(original.maxTokens);
          }
          expect(JSON.stringify(original)).toBe(before);
          expect(original.messages[1]!.thinkingBlocks).toHaveLength(1);
          expect(onReplayPrepared.mock.calls.map(([plan]) => plan)).toEqual(
            externalHook ? plans : [],
          );
          if (externalHook) expect(onResilience).toHaveBeenCalled();
        });
      }

      it(`${stack.name} preserves identity when no thinking is retired`, async () => {
        const original = request();
        const seen: LLMRequest[] = [];
        const onReplayPrepared = vi.fn();
        const run = (req: LLMRequest, hooks?: LLMCallHooks) => {
          seen.push(req);
          hooks?.onReplayPrepared?.(preparation(req, false));
          if (seen.length < stack.attempts) throw new Error('transport failed');
        };
        const result = await invoke(
          stack.wrap(leaf('first', run), leaf('other', run)),
          door,
          original,
          {
            onReplayPrepared,
          },
        );
        if (door === 'complete') expect(result).toBe(response);
        else {
          // Fallback's existing answeredStream may wrap the terminal chunk;
          // the no-omission response itself remains the same object.
          expect((result as LLMChunk[])[0]?.response).toBe(response);
          if (stack.name === 'retry') expect((result as LLMChunk[])[0]).toBe(chunk);
        }
        expect(seen).toHaveLength(stack.attempts);
        for (const attempt of seen) expect(attempt).toBe(original);
        expect(onReplayPrepared).toHaveBeenCalledTimes(stack.attempts);
      });

      it(`${stack.name} retries a failed persistence hook before transport`, async () => {
        const original = request();
        const seen: LLMRequest[] = [];
        const sent: LLMRequest[] = [];
        const onReplayPrepared = vi.fn((_plan: ReplayPreparation) => {
          if (onReplayPrepared.mock.calls.length === 1) throw new Error('persistence failed');
        });
        const run = (req: LLMRequest, hooks?: LLMCallHooks) => {
          seen.push(req);
          const plan = preparation(req, Boolean(req.messages[1]!.thinkingBlocks?.length));
          hooks?.onReplayPrepared?.(plan);
          sent.push(plan.request);
        };
        await invoke(stack.wrap(leaf('first', run), leaf('other', run)), door, original, {
          onReplayPrepared,
        });
        expect(seen).toEqual([original, original]);
        // The failed callback has not made the next attempt an omission-free
        // request that could bypass the failed durable write.
        for (const req of seen) expect(req).toBe(original);
        expect(onReplayPrepared).toHaveBeenCalledTimes(2);
        for (const [plan] of onReplayPrepared.mock.calls) expect(plan.omissions).toHaveLength(1);
        expect(sent).toHaveLength(1);
        expect(sent[0]!.messages[1]!.thinkingBlocks).toEqual([]);
      });
    }

    it('never prepares or calls an unused fallback', async () => {
      const secondary = vi.fn();
      const hook = vi.fn();
      const primary = leaf('first', (req, hooks) =>
        hooks?.onReplayPrepared?.(preparation(req, false)),
      );
      await invoke(withFallback(primary, leaf('other', secondary)), door, request(), {
        onReplayPrepared: hook,
      });
      expect(secondary).not.toHaveBeenCalled();
      expect(hook).toHaveBeenCalledTimes(1);
    });

    it('keeps attempt state local to each call on a reused wrapper', async () => {
      const original = request();
      const seen: LLMRequest[] = [];
      const provider = retry(
        leaf('first', (req, hooks) => {
          seen.push(req);
          const firstAttempt = seen.length % 2 === 1;
          hooks?.onReplayPrepared?.(preparation(req, firstAttempt));
          if (firstAttempt) throw new Error('transport failed');
        }),
      );
      await invoke(provider, door, original);
      await invoke(provider, door, original);
      expect(seen).toHaveLength(4);
      expect(seen[0]).toBe(original);
      expect(seen[2]).toBe(original);
      expect(seen[1]!.messages[1]!.thinkingBlocks).toEqual([]);
      expect(seen[3]!.messages[1]!.thinkingBlocks).toEqual([]);
    });
  });
}
