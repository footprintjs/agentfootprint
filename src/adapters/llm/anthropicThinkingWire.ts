/**
 * anthropicThinkingWire — which thinking request each Claude model takes, and
 * the one translation of `LLMRequest.thinking` onto the Messages body.
 *
 * Pattern: declaration + pure translation (the `anthropicCacheWire.ts` twin).
 * Role:    Outer ring. Two jobs, one file:
 *   1. `ANTHROPIC_THINKING_MODES` / `anthropicThinkingMode` — what every adapter
 *      on this wire DECLARES per model (`LLMProvider.thinkingMode`): ONE table,
 *      keyed by model family.
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
 *   anthropicThinkingMode('claude-opus-5-5');                            // 'adaptive'
 *   anthropicThinkingMode('us.anthropic.claude-sonnet-4-5-20250929-v1:0'); // 'budget'
 *   anthropicThinkingMode('claude-3-5-haiku@20241022');                   // 'none'
 *   anthropicThinkingMode('claude-opus-6');                               // 'adaptive' — unknown
 */

import type { LLMRequest } from '../types.js';
import type { ThinkingMode } from '../../thinking/types.js';
import { UnsupportedThinkingError } from '../../thinking/errors.js';

// ─── The declaration ────────────────────────────────────────────────

/**
 * Which thinking request each Claude model family takes, keyed by the family
 * id (the model id without a date, version or platform prefix — matching is
 * {@link anthropicThinkingMode}'s). The ONE table: a model is added here, and
 * nowhere else.
 */
export const ANTHROPIC_THINKING_MODES: Readonly<Record<string, ThinkingMode>> = Object.freeze({
  // Adaptive only — `budget_tokens` is a 400 (Claude 4.7 and later).
  'claude-fable-5-1': 'adaptive',
  'claude-mythos-5-1': 'adaptive',
  'claude-fable-5': 'adaptive',
  'claude-mythos-5': 'adaptive',
  'claude-opus-5-5': 'adaptive',
  'claude-opus-5': 'adaptive',
  'claude-opus-4-8': 'adaptive',
  'claude-opus-4-7': 'adaptive',
  'claude-sonnet-5-5': 'adaptive',
  'claude-sonnet-5': 'adaptive',
  'claude-haiku-5-5': 'adaptive',
  // Both modes: the budget is sent (deprecated on the 4.6 models, accepted).
  'claude-mythos-preview': 'budget',
  'claude-opus-4-6': 'budget',
  'claude-sonnet-4-6': 'budget',
  // Budget only — `type: 'adaptive'` is a 400.
  'claude-opus-4-5': 'budget',
  'claude-sonnet-4-5': 'budget',
  'claude-haiku-4-5': 'budget',
  'claude-opus-4-1': 'budget',
  'claude-opus-4': 'budget',
  'claude-sonnet-4': 'budget',
  'claude-3-7-sonnet': 'budget',
  // No thinking. Retired on the Claude API; still served by some platforms
  // (Vertex lists claude-3-5-haiku@20241022). Claude 1, 2 and Instant are
  // served nowhere and are not listed.
  'claude-3-5-sonnet': 'none',
  'claude-3-5-haiku': 'none',
  'claude-3-opus': 'none',
  'claude-3-sonnet': 'none',
  'claude-3-haiku': 'none',
});

/**
 * What may follow a family id and still name that family: nothing; a date
 * (`-20250929`, Vertex `@20251101`); the `-0` alias of an x.0 model
 * (`claude-opus-4-0`); `-latest`; a Bedrock version (`-v1`, `-v1:0`); or a
 * separator that starts a suffix (`:`, `[`). Never another version number —
 * so `claude-opus-4` does not claim `claude-opus-4-5`, or a future `-4-9`.
 */
const SAME_FAMILY = /^(?:$|-0(?![0-9])|-\d{8}(?![0-9])|-latest(?![a-z0-9])|-v\d|[@:[])/;

/**
 * The thinking mode a Claude model id takes on the Anthropic Messages wire.
 *
 * Reads the id from its `claude-` onward, so platform forms resolve like the
 * Claude API id: `anthropic.…` and `us.`/`eu.`/`global.`… Bedrock profiles,
 * inference-profile ARNs, Vertex `…@date` ids. An id no family matches
 * answers `'adaptive'` — the CURRENT behaviour: every Claude model since 4.7
 * takes adaptive thinking and rejects a budget, so a model released after
 * this table thinks instead of failing with a 400. A budget-only model this
 * table does not name would refuse adaptive instead; add its family above.
 */
export function anthropicThinkingMode(model: string): ThinkingMode {
  const id = model.toLowerCase();
  const start = id.indexOf('claude-');
  if (start < 0) return 'adaptive';
  const name = id.slice(start);
  // The longest family that names this id — at most one can, by SAME_FAMILY;
  // longest-wins keeps the answer independent of the table's order anyway.
  let match: readonly [string, ThinkingMode] | undefined;
  for (const entry of Object.entries(ANTHROPIC_THINKING_MODES)) {
    const family = entry[0];
    if (!name.startsWith(family) || !SAME_FAMILY.test(name.slice(family.length))) continue;
    if (match === undefined || family.length > match[0].length) match = entry;
  }
  return match === undefined ? 'adaptive' : match[1];
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
 * @throws UnsupportedThinkingError — before anything is sent — when the model
 *   cannot think, when a budget model is given a budget `budget_tokens` does
 *   not accept or a forced tool choice, or when a non-default `temperature`
 *   rides along (rejected whenever thinking is on).
 */
export function anthropicThinkingPlan(
  req: Pick<LLMRequest, 'thinking' | 'temperature' | 'toolChoice' | 'tools' | 'maxTokens'>,
  args: { readonly model: string; readonly provider: string; readonly maxTokensDefault: number },
): { readonly thinking: AnthropicThinkingParam; readonly maxTokens: number } | undefined {
  // Presence is the activation signal, as it always was (a JS caller's `null`
  // asks for nothing).
  if (!req.thinking) return undefined;
  const { model, provider } = args;
  const budget = req.thinking.budget;
  const refuse = (reason: UnsupportedThinkingError['reason'], detail: string): never => {
    throw new UnsupportedThinkingError({ provider, model, reason, detail });
  };
  const mode = anthropicThinkingMode(model);
  if (mode === 'none') {
    refuse(
      'no-thinking',
      'this model has no thinking mode, so .thinking() cannot be honoured. Use a model that ' +
        'thinks (Claude 3.7 Sonnet or any Claude 4 or 5 model), or drop .thinking().',
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
          "use { strategy: 'instruct' } here, or drop .thinking().",
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
