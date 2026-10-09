/**
 * forcedToolChoice — whether a provider puts a forced tool choice on its wire
 * FOR A MODEL, and the one error for a model that does not take one.
 *
 * Pattern: capability declaration + its one reader (the `thinkingModeFor`
 *          twin). The adapter declares `LLMProvider.carriesForcedToolChoice`
 *          — a boolean when every model on its wire answers the same, a
 *          function of the model id when they disagree — and everything that
 *          sends `LLMRequest.toolChoice` asks HERE, with the model it will
 *          call: the agent's `'tool-forced'` output strategy at run start, the
 *          constrained pick (`constrainedEnumPick`), and `withFallback`.
 * Role:    Port-level, beside `types.ts`.
 *
 * Why per model: Claude Opus 5.5, Sonnet 5.5, Fable 5.1 and Mythos 5.1 reject
 * `tool_choice: { type: 'tool' | 'any' }` with HTTP 400 on every request, while
 * the other Claude models on the same wire take it
 * (https://platform.claude.com/docs/en/build-with-claude/thinking — "Response
 * prefill and forced tool use"). A per-adapter `true` sent it to all of them.
 *
 * @example
 * ```ts
 * import { anthropic, forcedToolChoiceFor } from 'agentfootprint/providers';
 *
 * forcedToolChoiceFor(anthropic(), 'claude-opus-5-5'); // false
 * forcedToolChoiceFor(anthropic(), 'claude-opus-5');   // true
 * ```
 */

import type { LLMProvider } from './types.js';

/**
 * Whether `provider` puts a forced tool choice on its wire for `model`.
 * Absence — or anything but `true` — means NO, as it always has: a choice that
 * quietly vanishes costs the guarantee it was asked for.
 */
export function forcedToolChoiceFor(
  provider: Pick<LLMProvider, 'carriesForcedToolChoice'>,
  model: string,
): boolean {
  const declared = provider.carriesForcedToolChoice;
  return typeof declared === 'function' ? declared(model) === true : declared === true;
}

/**
 * UnsupportedToolChoiceError — a forced tool choice for a model that rejects
 * one, refused by name BEFORE anything is sent.
 *
 * The vendor's answer is an HTTP 400 on every request, so asking again sends
 * the same request: `retryable: false`, which `withRetry`'s default policy
 * honours; `withFallback` does not move the call to its other side and
 * `withCircuitBreaker` does not count it, by default — the request is wrong,
 * not the vendor.
 *
 * @example
 * ```ts
 * import { UnsupportedToolChoiceError } from 'agentfootprint/providers';
 *
 * try {
 *   await provider.complete({ model: 'claude-opus-5-5', messages, tools, toolChoice });
 * } catch (err) {
 *   if (err instanceof UnsupportedToolChoiceError) console.error(err.model); // ask in words instead
 * }
 * ```
 */
export class UnsupportedToolChoiceError extends Error {
  /** The provider that answered for the model — `'anthropic'`, `'bedrock'`, … */
  readonly provider: string;
  /** The model the request named. */
  readonly model: string;
  /** Asking again cannot mend it — read by `withRetry`'s default predicate. */
  readonly retryable = false;

  constructor(args: { readonly provider: string; readonly model: string }) {
    super(
      `[${args.provider}] '${args.model}' takes no forced tool choice — the API rejects ` +
        `tool_choice { type: 'tool' } on every request to this model, with or without ` +
        `thinking. .outputSchema(…, { strategy: 'tool-forced' }) sends one; use ` +
        `{ strategy: 'instruct' } on this model, or a model that takes a forced choice.`,
    );
    this.name = 'UnsupportedToolChoiceError';
    this.provider = args.provider;
    this.model = args.model;
  }
}
