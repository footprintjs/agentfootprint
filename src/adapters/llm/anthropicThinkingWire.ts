/**
 * anthropicThinkingWire — the one translation of `LLMRequest.thinking` onto
 * the Messages body, in the shape each Claude model takes.
 *
 * Pattern: pure translation over a declaration (the `anthropicCacheWire.ts` twin).
 * Role:    Outer ring. Two jobs, one file — which mode each model takes is
 *          the `thinking` column of the ONE model table
 *          (`anthropicModels.ts` · `ANTHROPIC_MODELS`):
 *   1. `thinkingModeWith` — the ONE mode function an adapter declares
 *      (`LLMProvider.thinkingMode`) and builds its body with: the app's own
 *      answer for an id the table cannot read, else the table's.
 *   2. `anthropicThinkingPlan` — the `thinking` field a request gets on that
 *      model, or a typed refusal before anything is sent.
 *
 * Why it exists: `.thinking({ budget })` used to send
 * `{ type: 'enabled', budget_tokens }` to every model, and Claude 4.7 and later
 * reject that with HTTP 400 — every call of every agent that asked to think
 * failed. The models disagree, so the shape is decided per model, here, for
 * the three adapters that build this body (`anthropic()`, `browserAnthropic()`,
 * `invokeModelGateway()`).
 *
 * The rules, from Anthropic's documentation (fetched 2026-10-08):
 * - per-model thinking types and the ones each model rejects with a 400 —
 *   https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting
 *   ("Thinking support, defaults, and rejected configurations by model") and
 *   https://platform.claude.com/docs/en/build-with-claude/thinking ("Configuring thinking");
 * - "Claude 4.7 and later models do not support it [budget_tokens] and reject
 *   requests that use it, returning a 400 error"; deprecated but accepted on
 *   the Claude 4.6 models; the only mode on Claude 4.5 and earlier, where
 *   `type: "adaptive"` is a 400 —
 *   https://platform.claude.com/docs/en/build-with-claude/extended-thinking;
 * - `budget_tokens` at least 1,024 and below `max_tokens`; forced tool use is
 *   incompatible with manual (budget) thinking; while thinking, older models
 *   take no `temperature` but the default and Claude 4.7 and later reject a
 *   non-default one on every request — same pages ("Budget rules and
 *   tuning", "Limits and feature compatibility");
 * - `display` defaults to `"omitted"` (empty thinking text) on Claude 4.7 and
 *   later; `"summarized"` returns readable thinking on every adaptive model —
 *   https://platform.claude.com/docs/en/build-with-claude/thinking ("Controlling thinking display");
 * - model ids per platform —
 *   https://platform.claude.com/docs/en/about-claude/models/overview,
 *   https://platform.claude.com/docs/en/about-claude/model-deprecations,
 *   https://platform.claude.com/docs/en/build-with-claude/claude-on-amazon-bedrock-legacy,
 *   https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai.
 *
 * @example
 *   const modeOf = thinkingModeWith(undefined); // the table's answer, per model
 *   anthropicThinkingPlan({ thinking: { budget: 2048 } }, {
 *     model: 'claude-opus-5-5', provider: 'anthropic', maxTokensDefault: 4096, thinkingMode: modeOf,
 *   }); // { thinking: { type: 'adaptive', display: 'summarized' }, maxTokens: 4096 }
 */

import type { LLMRequest } from '../types.js';
import type { ThinkingMode } from '../../thinking/types.js';
import { UnsupportedThinkingError } from '../../thinking/errors.js';
import { anthropicThinkingMode } from './anthropicModels.js';

/**
 * An adapter's ONE mode function: the app's own answer for an id the table
 * cannot read (the adapter's `thinkingMode` option), else the table's. The
 * adapter declares it as `LLMProvider.thinkingMode` AND builds its body with
 * it, so what the agent checks at build and what reaches the wire cannot
 * disagree.
 *
 * @example
 *   const modeOf = thinkingModeWith((id) => (id === 'haiku-fast' ? 'budget' : undefined));
 *   modeOf('haiku-fast');      // 'budget' — the app's answer
 *   modeOf('claude-opus-5-5'); // 'adaptive' — the table's
 */
export function thinkingModeWith(
  own: ((model: string) => ThinkingMode | undefined) | undefined,
): (model: string) => ThinkingMode {
  if (own === undefined) return anthropicThinkingMode;
  return (model) => own(model) ?? anthropicThinkingMode(model);
}

// ─── The translation ────────────────────────────────────────────────

/** The `thinking` field of a Messages body, in the two shapes this wire sends. */
export type AnthropicThinkingParam =
  | { type: 'enabled'; budget_tokens: number }
  | { type: 'adaptive'; display: 'summarized' };

/** The smallest `budget_tokens` the API accepts. */
const MIN_BUDGET_TOKENS = 1024;
/** Visible-answer room kept above the budget when `max_tokens` would not exceed it. */
const ANSWER_ROOM_TOKENS = 1024;
const MODES: ReadonlySet<unknown> = new Set<ThinkingMode>(['adaptive', 'budget', 'none']);

/**
 * The `thinking` field and `max_tokens` for one request on one model, or
 * `undefined` when the request does not ask to think.
 *
 * - `'budget'`: `{ type: 'enabled', budget_tokens: budget }`.
 * - `'adaptive'`: `{ type: 'adaptive', display: 'summarized' }` — no budget
 *   (the wire has no field for one), and `display: 'summarized'` because
 *   `.thinking()` asks for readable thinking and these models otherwise
 *   return it empty.
 * - Either way `max_tokens` stays above the budget: one at or below it
 *   becomes `budget + 1024` (on an adaptive model the budget only sizes this).
 *
 * `thinkingMode` is the adapter's own mode function ({@link thinkingModeWith})
 * — the one it declares — never the table read on the side.
 *
 * @throws UnsupportedThinkingError — before anything is sent — when the model
 *   cannot think, when a budget model is given a budget `budget_tokens` does
 *   not accept or a forced tool choice, or when a non-default `temperature`
 *   rides along (rejected whenever thinking is on).
 * @throws TypeError when the adapter's `thinkingMode` option answers
 *   something other than `'adaptive'`, `'budget'` or `'none'`.
 */
export function anthropicThinkingPlan(
  req: Pick<LLMRequest, 'thinking' | 'temperature' | 'toolChoice' | 'tools' | 'maxTokens'>,
  args: {
    readonly model: string;
    readonly provider: string;
    readonly maxTokensDefault: number;
    readonly thinkingMode: (model: string) => ThinkingMode;
  },
): { readonly thinking: AnthropicThinkingParam; readonly maxTokens: number } | undefined {
  // Presence is the activation signal, as it always was (a JS caller's `null`
  // asks for nothing).
  if (!req.thinking) return undefined;
  const { model, provider } = args;
  const budget = req.thinking.budget;
  const refuse = (reason: UnsupportedThinkingError['reason'], detail: string): never => {
    throw new UnsupportedThinkingError({ provider, model, reason, detail });
  };
  const mode: unknown = args.thinkingMode(model);
  if (!MODES.has(mode)) {
    throw new TypeError(
      `the '${provider}' provider's thinkingMode('${model}') answered ${JSON.stringify(mode)}; ` +
        "a ThinkingMode is 'adaptive', 'budget' or 'none'.",
    );
  }
  if (mode === 'none') {
    refuse(
      'no-thinking',
      'this model has no thinking mode, so .thinking() cannot be honoured. Use a model that ' +
        'thinks (Claude 4.5 or later), or drop .thinking().',
    );
  }
  if (req.temperature !== undefined && req.temperature !== 1) {
    refuse(
      'temperature',
      `temperature ${req.temperature} cannot ride with thinking — Claude takes only the default ` +
        'temperature (1) while thinking, and Claude 4.7 and later reject any other value on ' +
        'every request. Leave temperature unset, or drop .thinking().',
    );
  }
  if (mode === 'budget') {
    if (!Number.isInteger(budget) || budget < MIN_BUDGET_TOKENS) {
      refuse(
        'budget',
        `budget ${budget} is not one budget_tokens accepts — a whole number of at least ` +
          `${MIN_BUDGET_TOKENS} tokens. Ask for .thinking({ budget: ${MIN_BUDGET_TOKENS} }) or more.`,
      );
    }
    // Only a choice that reaches the wire conflicts: the body sends
    // `tool_choice` only on a request that carries tools.
    if (req.toolChoice !== undefined && (req.tools?.length ?? 0) > 0) {
      refuse(
        'forced-tool-choice',
        'a forced tool choice cannot ride with budget thinking — this model takes tool_choice ' +
          "auto or none while thinking. .outputSchema(…, { strategy: 'tool-forced' }) sends one; " +
          "use { strategy: 'instruct' } here, or drop .thinking(). Opus 4.6 and Sonnet 4.6 also " +
          "take adaptive thinking, which allows it: declare them 'adaptive' with the adapter's " +
          'thinkingMode option.',
      );
    }
  }
  const asked = req.maxTokens ?? args.maxTokensDefault;
  return {
    thinking:
      mode === 'budget'
        ? { type: 'enabled', budget_tokens: budget }
        : { type: 'adaptive', display: 'summarized' },
    maxTokens: asked <= budget ? Math.ceil(budget) + ANSWER_ROOM_TOKENS : asked,
  };
}
