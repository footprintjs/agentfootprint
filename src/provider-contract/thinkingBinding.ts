/**
 * Whether a model's thinking is bound to the context it was written under —
 * `bound`, `unbound` or `unknown` — and who said so. The one reader of
 * {@link LLMProvider.thinkingBinding}.
 *
 * Absence means unbound, so every provider that never heard of the capability
 * (OpenAI-family, Gemini, Ollama, a hand-written mock) keeps its exact
 * request path. The Anthropic-wire adapters answer per model from their table,
 * `unknown` for an id the table cannot place, and take an app's statement for
 * such an id through their `thinkingBinding` option (`by: 'app'`). A
 * declaration that throws or answers something else reads as `unknown`.
 *
 * @example
 *   thinkingBindingOf(anthropic(), 'claude-haiku-5-5'); // { binding: 'bound', by: 'provider' }
 *   thinkingBindingOf(anthropic(), 'claude-opus-6');    // { binding: 'unknown', by: 'provider' }
 *   thinkingBindingOf(openai(), 'gpt-5');               // { binding: 'unbound', by: 'provider' }
 */
import type { LLMProvider, ThinkingBinding } from './types.js';

export type { ThinkingBinding } from './types.js';

const UNBOUND: ThinkingBinding = Object.freeze({ binding: 'unbound', by: 'provider' });
const UNKNOWN: ThinkingBinding = Object.freeze({ binding: 'unknown', by: 'provider' });

export function thinkingBindingOf(
  provider: Pick<LLMProvider, 'thinkingBinding'>,
  model: string,
): ThinkingBinding {
  if (provider.thinkingBinding === undefined) return UNBOUND;
  let answer: Partial<ThinkingBinding> | undefined;
  try {
    answer = provider.thinkingBinding(model) as Partial<ThinkingBinding> | undefined;
  } catch {
    // A declaration that throws is not evidence either way: unknown, which
    // records and never refuses. The run itself is not failed by it.
    return UNKNOWN;
  }
  const binding = answer?.binding;
  // A malformed answer is not evidence either way: unknown.
  if (binding !== 'bound' && binding !== 'unbound' && binding !== 'unknown') return UNKNOWN;
  return {
    binding,
    by: answer?.by === 'app' ? 'app' : 'provider',
    ...(typeof answer?.family === 'string' && { family: answer.family }),
    ...(typeof answer?.model === 'string' && { model: answer.model }),
    ...(answer?.appStatement === 'failed' && { appStatement: 'failed' as const }),
  };
}
