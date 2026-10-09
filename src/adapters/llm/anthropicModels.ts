/**
 * anthropicModels — what each Claude model takes on the Anthropic wire: ONE
 * table, three facts per model family, each one a 400 when it is wrong.
 *
 * Pattern: declaration + one family matcher (the `anthropicCacheWire.ts` twin).
 * Role:    Outer ring. The facts the adapters declare and send from:
 *   - `thinking` — which thinking request the model takes (`'adaptive'`,
 *     `'budget'` or `'none'`; translated by `anthropicThinkingWire.ts`);
 *   - `forcedToolChoice` — whether it takes `tool_choice: { type: 'tool' }`
 *     (the `'tool-forced'` output strategy and the constrained pick send one);
 *   - `boundThinking` — whether its thinking blocks are bound to the
 *     conversation they were produced in (`anthropicThinkingReplay.ts`).
 *
 * A model is added here, and nowhere else.
 *
 * The facts, from Anthropic's documentation (fetched 2026-10-09):
 * - thinking per model — see `anthropicThinkingWire.ts` (unchanged from the
 *   9.141.0 table);
 * - "Forced tool use … works with adaptive thinking. The exceptions are Claude
 *   Opus 5.5, Claude Sonnet 5.5, Claude Fable 5.1, and Claude Mythos 5.1,
 *   which reject forced tool use on every request with a 400 error" —
 *   https://platform.claude.com/docs/en/build-with-claude/thinking ("Response
 *   prefill and forced tool use"); "Claude Haiku 5.5 accepts a forced
 *   `tool_choice`" — https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide;
 * - "On Claude Fable 5.1, Claude Opus 5.5, Claude Sonnet 5.5, and Claude Haiku
 *   5.5, a thinking block stays valid only while everything you sent before it
 *   is unchanged on later requests. Claude Mythos 5.1 and models before Claude
 *   Fable 5.1 don't run the prefix check" —
 *   https://platform.claude.com/docs/en/build-with-claude/preserved-thinking.
 *
 * @example
 *   anthropicModelFacts('claude-opus-5-5');
 *   // { thinking: 'adaptive', forcedToolChoice: false, boundThinking: true }
 *   anthropicModelFacts('us.anthropic.claude-haiku-4-5-20251001-v1:0');
 *   // { thinking: 'budget', forcedToolChoice: true, boundThinking: false }
 *   anthropicModelFacts('claude-opus-6'); // undefined — not in the table
 */

import type { ThinkingMode } from '../../thinking/types.js';

/** What one Claude model family takes on the wire. */
export interface AnthropicModelFacts {
  /** The thinking request it takes. */
  readonly thinking: ThinkingMode;
  /** Whether it takes a forced tool choice (`tool_choice: { type: 'tool' | 'any' }`). */
  readonly forcedToolChoice: boolean;
  /**
   * Whether its thinking blocks are bound to the conversation that produced
   * them: valid only while the system prompt, the tools and every earlier
   * message are unchanged (preserved thinking's prefix check).
   */
  readonly boundThinking: boolean;
}

const row = (
  thinking: ThinkingMode,
  forcedToolChoice = true,
  boundThinking = false,
): AnthropicModelFacts => Object.freeze({ thinking, forcedToolChoice, boundThinking });

/**
 * The facts per Claude model family, keyed by the family id (the model id
 * without a date, version or platform prefix — matching is
 * {@link anthropicModelFamily}'s). The ONE table.
 */
export const ANTHROPIC_MODELS: Readonly<Record<string, AnthropicModelFacts>> = Object.freeze({
  // Adaptive only — `budget_tokens` is a 400 (Claude 4.7 and later). Opus 5.5,
  // Sonnet 5.5, Fable 5.1 and Mythos 5.1 also reject a forced tool choice on
  // every request; Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku 5.5 run the
  // prefix check on replayed thinking (Mythos 5.1 does not).
  'claude-fable-5-1': row('adaptive', false, true),
  'claude-mythos-5-1': row('adaptive', false),
  'claude-fable-5': row('adaptive'),
  'claude-mythos-5': row('adaptive'),
  'claude-opus-5-5': row('adaptive', false, true),
  'claude-opus-5': row('adaptive'),
  'claude-opus-4-8': row('adaptive'),
  'claude-opus-4-7': row('adaptive'),
  'claude-sonnet-5-5': row('adaptive', false, true),
  'claude-sonnet-5': row('adaptive'),
  'claude-haiku-5-5': row('adaptive', true, true),
  // Takes both. Adaptive: its thinking `display` defaults to "omitted", which
  // a budget body cannot change, so a budget would return empty thinking.
  'claude-mythos-preview': row('adaptive'),
  // Takes both, the budget deprecated but accepted: the budget is sent, as
  // asked. On Opus 4.6 that means no thinking between tool calls — an app that
  // wants it declares the model 'adaptive' with the adapter's `thinkingMode`.
  'claude-opus-4-6': row('budget'),
  'claude-sonnet-4-6': row('budget'),
  // Budget only — `type: 'adaptive'` is a 400.
  'claude-opus-4-5': row('budget'),
  'claude-sonnet-4-5': row('budget'),
  'claude-haiku-4-5': row('budget'),
  'claude-opus-4-1': row('budget'),
  'claude-opus-4': row('budget'),
  'claude-sonnet-4': row('budget'),
  'claude-3-7-sonnet': row('budget'),
  // No thinking. Retired on the Claude API; still served by some platforms
  // (Vertex lists claude-3-5-haiku@20241022). Claude 1, 2 and Instant are
  // served nowhere and are not listed.
  'claude-3-5-sonnet': row('none'),
  'claude-3-5-haiku': row('none'),
  'claude-3-opus': row('none'),
  'claude-3-sonnet': row('none'),
  'claude-3-haiku': row('none'),
});

/** The thinking column of {@link ANTHROPIC_MODELS}, family → mode. */
export const ANTHROPIC_THINKING_MODES: Readonly<Record<string, ThinkingMode>> = Object.freeze(
  Object.fromEntries(Object.entries(ANTHROPIC_MODELS).map(([family, f]) => [family, f.thinking])),
);

/**
 * What may follow a family id and still name that family: nothing; a date
 * (`-20250929`, Vertex `@20251101`); the `-0` alias of an x.0 model
 * (`claude-opus-4-0`); `-latest`; a Bedrock version (`-v1`, `-v1:0`); or a
 * separator that starts a suffix (`:`, `[`). Never another version number —
 * so `claude-opus-4` does not claim `claude-opus-4-5`, or a future `-4-9`.
 */
const SAME_FAMILY = /^(?:$|-0(?![0-9])|-\d{8}(?![0-9])|-latest(?![a-z0-9])|-v\d|[@:[])/;

/**
 * The table family a Claude model id names, or `undefined` when none does.
 *
 * Reads the id from its `claude-` onward, so platform forms resolve like the
 * Claude API id: `anthropic.…` and `us.`/`eu.`/`global.`… Bedrock profiles,
 * inference-profile ARNs, Vertex `…@date` ids, and dotted aliases
 * (`claude-sonnet-4.5`).
 */
export function anthropicModelFamily(model: string): string | undefined {
  const id = model.toLowerCase();
  const start = id.indexOf('claude-');
  if (start < 0) return undefined;
  // `claude-sonnet-4.5` is `claude-sonnet-4-5`: no real id carries a dot after
  // `claude-`, so the spelling changes nothing it could be confused with.
  const name = id.slice(start).replace(/\./g, '-');
  // The longest family that names this id — at most one can, by SAME_FAMILY;
  // longest-wins keeps the answer independent of the table's order anyway.
  let match: string | undefined;
  for (const family of Object.keys(ANTHROPIC_MODELS)) {
    if (!name.startsWith(family) || !SAME_FAMILY.test(name.slice(family.length))) continue;
    if (match === undefined || family.length > match.length) match = family;
  }
  return match;
}

/** The table's facts for a model id, or `undefined` for an id it does not know. */
export function anthropicModelFacts(model: string): AnthropicModelFacts | undefined {
  const family = anthropicModelFamily(model);
  return family === undefined ? undefined : ANTHROPIC_MODELS[family];
}

/**
 * The thinking mode a Claude model id takes on the Anthropic Messages wire.
 *
 * An id no family matches answers `'adaptive'` — what every Claude model since
 * 4.7 takes (they reject a budget), so a model released after this table
 * thinks instead of failing with a 400.
 *
 * The cost of that default, named: an id that does not say which model it
 * serves — an application-inference-profile ARN, a gateway alias, a
 * deployment name — is read as adaptive too, and a budget-only model behind
 * it (Claude 4.5 and earlier) refuses adaptive. The adapters take a
 * `thinkingMode` option for exactly that (`anthropicThinkingWire.ts` ·
 * `thinkingModeWith`).
 *
 * @example
 *   anthropicThinkingMode('claude-opus-5-5');                            // 'adaptive'
 *   anthropicThinkingMode('us.anthropic.claude-sonnet-4-5-20250929-v1:0'); // 'budget'
 *   anthropicThinkingMode('claude-3-5-haiku@20241022');                   // 'none'
 *   anthropicThinkingMode('claude-opus-6');                               // 'adaptive' — unknown
 */
export function anthropicThinkingMode(model: string): ThinkingMode {
  return anthropicModelFacts(model)?.thinking ?? 'adaptive';
}

/**
 * Whether a Claude model id takes a forced tool choice. An id the table does
 * not know is NOT refused: the newest models disagree (Haiku 5.5 takes one,
 * Opus 5.5 does not), so the table makes no claim it cannot source, and the
 * API's own 400 names `tool_choice` until the model has a row.
 *
 * @example
 *   anthropicTakesForcedToolChoice('claude-opus-5-5');            // false
 *   anthropicTakesForcedToolChoice('anthropic.claude-haiku-5-5'); // true
 */
export function anthropicTakesForcedToolChoice(model: string): boolean {
  return anthropicModelFacts(model)?.forcedToolChoice ?? true;
}

/**
 * Whether a model's thinking blocks are bound to the conversation that
 * produced them. An id the table does not know is read as bound when the
 * adapter's mode function (`thinkingModeWith`) answers `'adaptive'` for it —
 * the conservative reading: holding back a block that would have been
 * accepted costs that block's reasoning, sending one that is bound costs a
 * 400. A budget model never is: none runs the check, and manual mode needs the
 * final turn's thinking sent back.
 *
 * @example
 *   const modeOf = thinkingModeWith((id) => (id === 'haiku-fast' ? 'budget' : undefined));
 *   anthropicBindsThinking('claude-opus-5-5', modeOf);   // true
 *   anthropicBindsThinking('claude-mythos-5-1', modeOf); // false — the table says so
 *   anthropicBindsThinking('haiku-fast', modeOf);        // false — declared a budget model
 *   anthropicBindsThinking('claude-opus-6', modeOf);     // true — unknown, adaptive
 */
export function anthropicBindsThinking(
  model: string,
  modeOf: (model: string) => ThinkingMode,
): boolean {
  const facts = anthropicModelFacts(model);
  return facts !== undefined ? facts.boundThinking : modeOf(model) === 'adaptive';
}
