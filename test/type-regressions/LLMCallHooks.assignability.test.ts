/**
 * Compile-level regression test — the v7.8 addition of an OPTIONAL second
 * `hooks?: LLMCallHooks` parameter to `LLMProvider.complete()` /
 * `stream()` (src/adapters/types.ts) must stay NON-BREAKING.
 *
 * TypeScript permits a function with FEWER parameters to satisfy a
 * signature that declares more, so every provider written before v7.8 —
 * all six shipped adapters plus every consumer test double and BYO
 * provider — must still assign with an arity-1 `complete(req)`. And every
 * pre-v7.8 CALLER must still compile calling `complete(req)` with no
 * second argument.
 *
 * These assignments ARE the assertions: they fail to COMPILE if the
 * parameter is ever made required, or if the shape of `LLMCallHooks` /
 * `ResilienceReport` drifts away from what the decorators produce and the
 * declared event payloads consume.
 *
 * Lives under its own tsconfig (run via `npm run test:types`) so the REAL
 * TypeScript compiler checks the assignments, while its `.test.ts` name
 * also lets vitest exercise the (trivial) runtime assertions.
 */
import { describe, expect, it } from 'vitest';
import type {
  LLMCallHooks,
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  ResilienceReport,
} from '../../src/adapters/types.js';
import { withRetry } from '../../src/resilience/withRetry.js';

const response: LLMResponse = {
  content: 'ok',
  toolCalls: [],
  usage: { input: 1, output: 1 },
  stopReason: 'stop',
};

const request: LLMRequest = { messages: [{ role: 'user', content: 'hi' }], model: 'm' };

describe('LLMCallHooks — assignability (the v7.8 optional param stays non-breaking)', () => {
  it('an arity-1 OBJECT LITERAL provider still assigns', () => {
    // The shape every consumer test double and inline example uses.
    const legacy: LLMProvider = {
      name: 'legacy-literal',
      complete: async (_req: LLMRequest) => response,
    };
    expect(legacy.name).toBe('legacy-literal');
  });

  it('an arity-1 `class … implements LLMProvider` still assigns', () => {
    // The shape all six shipped adapters use (AnthropicProvider etc.).
    class LegacyAdapter implements LLMProvider {
      readonly name = 'legacy-class';
      async complete(_req: LLMRequest): Promise<LLMResponse> {
        return response;
      }
      async *stream(_req: LLMRequest): AsyncIterable<LLMChunk> {
        yield { tokenIndex: 0, content: '', done: true, response };
      }
    }
    const adapter: LLMProvider = new LegacyAdapter();
    expect(adapter.name).toBe('legacy-class');
  });

  it('a pre-v7.8 CALLER passing no hooks still compiles', async () => {
    const provider: LLMProvider = { name: 'p', complete: async () => response };
    // No second argument — the v7.8 param is optional.
    const res = await provider.complete(request);
    expect(res.content).toBe('ok');
  });

  it('the `wrapped.stream = (req) => inner.stream!(req)` pass-through shape still assigns', () => {
    // The exact idiom at withRetry.ts's stream pass-through: an arity-1
    // arrow assigned to the optional `stream` member.
    const inner: LLMProvider = {
      name: 'inner',
      complete: async () => response,
      stream: async function* () {
        yield { tokenIndex: 0, content: '', done: true, response };
      },
    };
    const wrapped: LLMProvider = { name: 'w', complete: async () => response };
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    wrapped.stream = (req: LLMRequest): AsyncIterable<LLMChunk> => inner.stream!(req);
    expect(wrapped.stream).toBeDefined();
  });

  it('a hooks-AWARE provider assigns too, and receives the hooks', async () => {
    let received: LLMCallHooks | undefined;
    const modern: LLMProvider = {
      name: 'modern',
      complete: async (_req: LLMRequest, hooks?: LLMCallHooks) => {
        received = hooks;
        return response;
      },
    };
    const hooks: LLMCallHooks = { onResilience: () => undefined };

    await modern.complete(request, hooks);

    expect(received).toBe(hooks);
  });

  it('every ResilienceReport arm is constructible with the declared fields', () => {
    // Field names are 1:1 with FallbackTriggeredPayload / ErrorRetriedPayload
    // / ErrorRecoveredPayload, so the call-site mapping is rename-free.
    const fellBack: ResilienceReport = {
      kind: 'fell-back',
      primary: 'a',
      fallback: 'b',
      reason: 'down',
    };
    const retried: ResilienceReport = {
      kind: 'retried',
      attempt: 2,
      maxAttempts: 3,
      lastError: 'boom',
      backoffMs: 200,
      reason: 'http-5xx',
    };
    const recovered: ResilienceReport = { kind: 'recovered', attempt: 2, totalDurationMs: 5 };

    expect([fellBack.kind, retried.kind, recovered.kind]).toEqual([
      'fell-back',
      'retried',
      'recovered',
    ]);
  });

  it('an arity-1 provider still composes through a decorator (hooks unused)', async () => {
    // Passing hooks to a decorator wrapping a provider that ignores the
    // second argument must be a no-op, not a type error or a crash.
    const legacy: LLMProvider = { name: 'legacy', complete: async () => response };
    const res = await withRetry(legacy).complete(request, { onResilience: () => undefined });
    expect(res.content).toBe('ok');
  });
});
