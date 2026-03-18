/**
 * fallbackProvider — LLMProvider that tries providers in order until one succeeds.
 *
 * Wraps multiple LLMProviders into a single LLMProvider. On each chat() call,
 * tries providers in order. If one fails (rate limit, timeout, network error),
 * falls through to the next.
 *
 * Narrative integration: the response includes `model` from whichever provider
 * succeeded — recorders capture this via onLLMCall.model, so the narrative
 * reflects which provider actually answered. The onFallback callback fires
 * during traversal (not post-processing) for immediate observability.
 *
 * Usage:
 *   // Try Anthropic, fall back to OpenAI, then local Ollama
 *   const provider = fallbackProvider([
 *     new AnthropicAdapter({ model: 'claude-sonnet-4-20250514' }),
 *     new OpenAIAdapter({ model: 'gpt-4o' }),
 *     new OpenAIAdapter({ model: 'llama3', baseURL: 'http://localhost:11434/v1' }),
 *   ]);
 *
 *   const agent = Agent.create({ provider }).system('...').build();
 *
 *   // With observability
 *   const provider = fallbackProvider(
 *     [anthropicAdapter, openaiAdapter],
 *     {
 *       onFallback: (fromIndex, toIndex, error) =>
 *         console.warn(`Provider ${fromIndex} failed, trying ${toIndex}:`, error),
 *       shouldFallback: (error) => {
 *         // Only fall back on rate limits and network errors, not auth errors
 *         if (error instanceof LLMError) return error.statusCode === 429 || error.statusCode >= 500;
 *         return true;
 *       },
 *     },
 *   );
 */

import type { LLMProvider, LLMCallOptions, LLMResponse, LLMStreamChunk } from '../types/llm';
import type { Message } from '../types/messages';

export interface FallbackProviderOptions {
  /** Called when falling back from one provider to the next (during traversal). */
  onFallback?: (fromIndex: number, toIndex: number, error: unknown) => void;
  /** Only fall back if this returns true. Default: always fall back. */
  shouldFallback?: (error: unknown) => boolean;
}

export function fallbackProvider(
  providers: readonly LLMProvider[],
  options?: FallbackProviderOptions,
): LLMProvider {
  if (providers.length === 0) {
    throw new Error('[fallbackProvider] At least one provider is required.');
  }

  const { onFallback, shouldFallback = () => true } = options ?? {};

  return {
    chat: async (messages: Message[], callOptions?: LLMCallOptions): Promise<LLMResponse> => {
      let lastError: unknown;

      for (let i = 0; i < providers.length; i++) {
        try {
          return await providers[i].chat(messages, callOptions);
        } catch (error) {
          lastError = error;

          // Last provider — no more fallbacks
          if (i === providers.length - 1) break;

          // Check if we should fall back
          if (!shouldFallback(error)) break;

          // Notify observer during traversal (not post-processing)
          onFallback?.(i, i + 1, error);
        }
      }

      // All providers failed — throw the last error
      throw lastError;
    },

    // Stream falls back the same way
    chatStream: providers.some((p) => p.chatStream)
      ? async function* (messages: Message[], callOptions?: LLMCallOptions): AsyncIterable<LLMStreamChunk> {
          let lastError: unknown;

          for (let i = 0; i < providers.length; i++) {
            const provider = providers[i];
            if (!provider.chatStream) continue;

            try {
              yield* provider.chatStream(messages, callOptions);
              return; // Success — stop trying
            } catch (error) {
              lastError = error;
              if (i === providers.length - 1) break;
              if (!shouldFallback(error)) break;
              onFallback?.(i, i + 1, error);
            }
          }

          throw lastError;
        }
      : undefined,
  };
}
