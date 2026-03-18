/**
 * resilientProvider — fallback + circuit breaker in one call.
 *
 * Combines fallbackProvider() with per-provider CircuitBreaker instances.
 * Each provider gets its own breaker. When a provider trips its breaker,
 * it's skipped instantly (no wasted latency on known-down providers).
 *
 * This addresses the "sequential" con of fallbackProvider — with circuit
 * breakers, a tripped provider is skipped in O(1) instead of waiting
 * for it to timeout.
 *
 * Usage:
 *   const provider = resilientProvider([
 *     new AnthropicAdapter({ model: 'claude-sonnet-4-20250514' }),
 *     new OpenAIAdapter({ model: 'gpt-4o' }),
 *     new OpenAIAdapter({ model: 'llama3', baseURL: 'http://localhost:11434/v1' }),
 *   ], {
 *     circuitBreaker: { threshold: 3, resetAfterMs: 30_000 },
 *     onFallback: (from, to, err) => console.warn('Switching provider', from, '→', to),
 *   });
 */

import type { LLMProvider, LLMCallOptions, LLMResponse, LLMStreamChunk } from '../types/llm';
import type { Message } from '../types/messages';
import { CircuitBreaker } from '../compositions/withCircuitBreaker';
import type { CircuitBreakerOptions } from '../compositions/withCircuitBreaker';
import type { FallbackProviderOptions } from './fallbackProvider';

export interface ResilientProviderOptions extends FallbackProviderOptions {
  /** Circuit breaker config — applied per provider. Default: threshold=3, resetAfterMs=30000. */
  circuitBreaker?: CircuitBreakerOptions;
}

export function resilientProvider(
  providers: readonly LLMProvider[],
  options?: ResilientProviderOptions,
): LLMProvider & { breakers: CircuitBreaker[] } {
  if (providers.length === 0) {
    throw new Error('[resilientProvider] At least one provider is required.');
  }

  const { onFallback, shouldFallback = () => true, circuitBreaker: cbOpts } = options ?? {};
  const breakers = providers.map(() => new CircuitBreaker(cbOpts ?? { threshold: 3, resetAfterMs: 30_000 }));

  return {
    breakers,

    chat: async (messages: Message[], callOptions?: LLMCallOptions): Promise<LLMResponse> => {
      let lastError: unknown;

      for (let i = 0; i < providers.length; i++) {
        const state = breakers[i].getState();

        // Skip tripped providers (O(1) — no wasted latency)
        if (state === 'open') {
          onFallback?.(i, i + 1, new Error(`Circuit breaker open for provider ${i}`));
          continue;
        }

        try {
          const result = await providers[i].chat(messages, callOptions);
          breakers[i].recordSuccess();
          return result;
        } catch (error) {
          lastError = error;
          breakers[i].recordFailure();

          if (i === providers.length - 1) break;
          if (!shouldFallback(error)) break;

          onFallback?.(i, i + 1, error);
        }
      }

      throw lastError ?? new Error('All providers failed (circuit breakers open)');
    },

    chatStream: providers.some((p) => p.chatStream)
      ? async function* (messages: Message[], callOptions?: LLMCallOptions): AsyncIterable<LLMStreamChunk> {
          let lastError: unknown;

          for (let i = 0; i < providers.length; i++) {
            const provider = providers[i];
            if (!provider.chatStream) continue;

            const state = breakers[i].getState();
            if (state === 'open') {
              onFallback?.(i, i + 1, new Error(`Circuit breaker open for provider ${i}`));
              continue;
            }

            try {
              yield* provider.chatStream(messages, callOptions);
              breakers[i].recordSuccess();
              return;
            } catch (error) {
              lastError = error;
              breakers[i].recordFailure();
              if (i === providers.length - 1) break;
              if (!shouldFallback(error)) break;
              onFallback?.(i, i + 1, error);
            }
          }

          throw lastError ?? new Error('All providers failed (circuit breakers open)');
        }
      : undefined,
  };
}
