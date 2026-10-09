/**
 * UnsupportedThinkingError — a request to think that the model cannot take,
 * refused by name BEFORE anything is sent.
 *
 * Models on one wire disagree about thinking (see `ThinkingMode`), and the
 * vendor's answer to the wrong shape is an HTTP 400 on every call — a 400
 * that reads like a transient failure, gets retried, and fails identically.
 * So the refusal happens here instead, with the fix in the message:
 *
 * - at `Agent.build()`, when the provider DECLARES (`LLMProvider.thinkingMode`)
 *   that a model the agent will call cannot think (`reason: 'no-thinking'`);
 * - in the adapter, before the request leaves, for a model chosen at run time
 *   and for the combinations the wire rejects whenever thinking is on
 *   (`'budget'`, `'temperature'`, `'forced-tool-choice'`).
 *
 * `retryable: false` — asking again sends the same request — so `withRetry`'s
 * default policy never retries it.
 *
 * @example
 * ```ts
 * import { UnsupportedThinkingError } from 'agentfootprint/providers';
 *
 * try {
 *   agent = Agent.create({ provider, model }).thinking({ budget: 4000 }).build();
 * } catch (err) {
 *   if (err instanceof UnsupportedThinkingError) console.error(err.model, err.reason);
 * }
 * ```
 */
export class UnsupportedThinkingError extends Error {
  /** The provider that answered for the model — `'anthropic'`, `'browser-anthropic'`, … */
  readonly provider: string;
  /** The model the request named. */
  readonly model: string;
  /**
   * Why the request cannot be sent:
   * - `'no-thinking'` — the model cannot think at all;
   * - `'budget'` — the budget is not one the model's `budget_tokens` accepts;
   * - `'temperature'` — a temperature other than the default, which the wire
   *   rejects while thinking is on;
   * - `'forced-tool-choice'` — a forced tool choice, which budget thinking rejects.
   */
  readonly reason: 'no-thinking' | 'budget' | 'temperature' | 'forced-tool-choice';
  /** Asking again cannot mend it — read by `withRetry`'s default predicate. */
  readonly retryable = false;

  constructor(args: {
    readonly provider: string;
    readonly model: string;
    readonly reason: UnsupportedThinkingError['reason'];
    /** The sentence after `thinking on '<model>':` — what is wrong and the fix. */
    readonly detail: string;
  }) {
    super(`[${args.provider}] thinking on '${args.model}': ${args.detail}`);
    this.name = 'UnsupportedThinkingError';
    this.provider = args.provider;
    this.model = args.model;
    this.reason = args.reason;
  }
}
