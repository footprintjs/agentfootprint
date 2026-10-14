/**
 * nativeOutputSchema — whether a provider puts a structured-output format
 * (`LLMRequest.outputFormat`) on its wire FOR A MODEL, and the one error for
 * a model or adapter that does not.
 *
 * Pattern: capability declaration + its one reader (the `forcedToolChoice.ts`
 *          twin). The adapter declares `LLMProvider.carriesNativeOutputSchema`
 *          plus `supportsNativeOutputSchema(model)`, and everything that sends
 *          `LLMRequest.outputFormat` asks HERE with the model it will call:
 *          the agent's `'native'` output strategy at run start and again at
 *          request assembly.
 * Role:    Port-level, beside `types.ts`.
 *
 * Why per model: Anthropic's structured outputs are available on the models
 * its page lists — Claude Haiku 4.5, Sonnet 4.5, Opus 4.5 and every later
 * model — and not on Opus 4.1 and earlier
 * (https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
 * The per-model facts are the `nativeOutputSchema` column of
 * `llm/anthropicModels.ts · ANTHROPIC_MODELS`.
 *
 * @example
 * ```ts
 * import { anthropic, nativeOutputSchemaFor } from 'agentfootprint/providers';
 *
 * nativeOutputSchemaFor(anthropic(), 'claude-haiku-4-5'); // true
 * nativeOutputSchemaFor(anthropic(), 'claude-opus-4-1');  // false
 * ```
 */

import type { LLMProvider } from './types.js';

/**
 * Whether `provider` puts a structured-output format on its wire for `model`.
 * Absence — or anything but `true` — means NO: a format that quietly vanishes
 * costs the guarantee it was asked for.
 */
export function nativeOutputSchemaFor(
  provider: Pick<LLMProvider, 'carriesNativeOutputSchema' | 'supportsNativeOutputSchema'>,
  model: string,
): boolean {
  return (
    provider.carriesNativeOutputSchema === true &&
    (provider.supportsNativeOutputSchema === undefined ||
      provider.supportsNativeOutputSchema(model) === true)
  );
}

/**
 * UnsupportedNativeOutputError — a structured-output format for a model or
 * adapter that does not take one, refused by name BEFORE anything is sent.
 *
 * Asking again sends the same request: `retryable: false`, which `withRetry`'s
 * default policy honours; `withFallback` does not move the call to its other
 * side and `withCircuitBreaker` does not count it (`requestRefusal.ts`).
 *
 * @example
 * ```ts
 * import { UnsupportedNativeOutputError } from 'agentfootprint/providers';
 *
 * try {
 *   await agent.run('…');
 * } catch (err) {
 *   if (err instanceof UnsupportedNativeOutputError) console.error(err.provider, err.model);
 * }
 * ```
 */
export class UnsupportedNativeOutputError extends Error {
  /** The provider that answered for the model — `'anthropic'`, `'bedrock'`, … */
  readonly provider: string;
  /** The model the request named. */
  readonly model: string;
  /** Asking again cannot mend it — read by `withRetry`'s default predicate. */
  readonly retryable = false;

  constructor(args: { readonly provider: string; readonly model: string }) {
    super(
      `[${args.provider}] '${args.model}' does not take a native structured-output format on ` +
        `this adapter. .outputSchema(…, { strategy: 'native' }) requires it; use ` +
        `{ strategy: 'instruct' } here, or a provider and model that take one ` +
        `(anthropic() or browserAnthropic() with Claude Haiku 4.5, Sonnet 4.5, Opus 4.5 or later).`,
    );
    this.name = 'UnsupportedNativeOutputError';
    this.provider = args.provider;
    this.model = args.model;
  }
}
