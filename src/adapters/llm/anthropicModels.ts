/**
 * anthropicModels — what each Claude model takes on the Anthropic wire: ONE
 * table of thinking, tool-choice and documented replay-prefix facts.
 *
 * Pattern: declaration + shared family lookup with explicit matching policies.
 * Role:    Outer ring. The facts the adapters declare and send from:
 *   - `thinking` — which thinking request the model takes (`'adaptive'`,
 *     `'budget'` or `'none'`; translated by `anthropicThinkingWire.ts`);
 *   - `forcedToolChoice` — whether it takes `tool_choice: { type: 'tool' }`
 *     (the `'tool-forced'` output strategy and the constrained pick send one).
 *
 * A model is added here, and nowhere else.
 *
 * The facts, from Anthropic's documentation (fetched 2026-10-09):
 * - thinking per model — see `anthropicThinkingWire.ts` (unchanged from the
 *   9.141.0 table);
 * - Opus 5.5, Sonnet 5.5, Fable 5.1 and Mythos 5.1 reject forced tools:
 *   https://platform.claude.com/docs/en/build-with-claude/thinking ("Response
 *   prefill and forced tool use"); Haiku 5.5 accepts them:
 *   https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide.
 * - Prefix binding is documented for Fable 5.1, Opus 5.5, Sonnet 5.5 and
 *   Haiku 5.5, not inferred for other families:
 *   https://platform.claude.com/docs/en/build-with-claude/preserved-thinking.
 *
 * @example
 *   anthropicModelFacts('claude-opus-5-5');
 *   // { thinking: 'adaptive', forcedToolChoice: false, thinkingPrefixBinding: true }
 *   anthropicModelFacts('us.anthropic.claude-haiku-4-5-20251001-v1:0');
 *   // { thinking: 'budget', forcedToolChoice: true }
 *   anthropicModelFacts('claude-opus-6'); // undefined — not in the table
 */

import type { ThinkingMode } from '../../thinking/types.js';

/** What one Claude model family takes on the wire. */
export interface AnthropicModelFacts {
  /** The thinking request it takes. */
  readonly thinking: ThinkingMode;
  /** Whether it takes a forced tool choice (`tool_choice: { type: 'tool' | 'any' }`). */
  readonly forcedToolChoice: boolean;
  /** This family documents preserved-thinking prefix checking. */
  readonly thinkingPrefixBinding?: true;
}

const row = (
  thinking: ThinkingMode,
  forcedToolChoice = true,
  thinkingPrefixBinding = false,
): AnthropicModelFacts =>
  Object.freeze({
    thinking,
    forcedToolChoice,
    ...(thinkingPrefixBinding && { thinkingPrefixBinding: true as const }),
  });

/**
 * The facts per Claude model family, keyed by the family id (the model id
 * without a date, version or platform prefix — matching is
 * {@link anthropicModelFamily}'s). The ONE table.
 */
export const ANTHROPIC_MODELS: Readonly<Record<string, AnthropicModelFacts>> = Object.freeze({
  // Adaptive only — `budget_tokens` is a 400 (Claude 4.7 and later). Opus 5.5,
  // Sonnet 5.5, Fable 5.1 and Mythos 5.1 also reject a forced tool choice on
  // every request.
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

// The existing thinking lookup intentionally accepts decorated/dotted aliases.
// Preserve that compatibility, but never use it to assert hard model facts.
const THINKING_SUFFIX = /^(?:$|-0(?![0-9])|-\d{8}(?![0-9])|-latest(?![a-z0-9])|-v\d|[@:[])/;
const API_SUFFIX = /^(?:|-0|-\d{8}|-latest|@\d{8})$/;
const BEDROCK_SUFFIX = /^(?:|-\d{8})(?:-v\d+(?::\d+)?)?$/;
const BEDROCK_ID = /^(?:(?:us|eu|apac|global|jp|au)\.)?anthropic\.(claude-[a-z0-9:-]+)$/;
const FOUNDATION_ARN = /^arn:aws(?:-us-gov|-cn)?:bedrock:[a-z0-9-]+::foundation-model\/([^/]+)$/;
const PROFILE_ARN =
  /^arn:aws(?:-us-gov|-cn)?:bedrock:[a-z0-9-]+:\d{12}:inference-profile\/([^/]+)$/;
const VERTEX_ID =
  /^(?:projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/)?publishers\/anthropic\/models\/(claude-[a-z0-9@-]+)$/;

/** Longest match keeps the one table independent of declaration order. */
function familyMatching(name: string, suffix: RegExp): string | undefined {
  let match: string | undefined;
  for (const family of Object.keys(ANTHROPIC_MODELS)) {
    if (!name.startsWith(family) || !suffix.test(name.slice(family.length))) continue;
    if (match === undefined || family.length > match.length) match = family;
  }
  return match;
}

/**
 * The table family a Claude model id names, or `undefined` when none does.
 *
 * Accepts complete Claude API, Bedrock foundation/system-profile and Vertex
 * model identifiers. Application profiles, deployment names and router aliases
 * are opaque: a Claude-looking substring is not evidence of the served model.
 * This recognizes a family, not its availability in a particular region.
 */
export function anthropicModelFamily(model: string): string | undefined {
  // Besides refusing decorated aliases, this prevents `$` in the anchored
  // matchers from accepting a final newline as part of a valid identifier.
  if (model !== model.trim()) return undefined;
  if (model.startsWith('claude-')) return familyMatching(model, API_SUFFIX);

  const vertex = VERTEX_ID.exec(model);
  if (vertex) return familyMatching(vertex[1], API_SUFFIX);

  const arn = FOUNDATION_ARN.exec(model) ?? PROFILE_ARN.exec(model);
  const bedrock = BEDROCK_ID.exec(arn ? arn[1] : model);
  return bedrock ? familyMatching(bedrock[1], BEDROCK_SUFFIX) : undefined;
}

/** Compatibility only: do not use this permissive lookup for hard refusals. */
function thinkingFamily(model: string): string | undefined {
  const id = model.toLowerCase();
  const start = id.indexOf('claude-');
  if (start < 0) return undefined;
  return familyMatching(id.slice(start).replace(/\./g, '-'), THINKING_SUFFIX);
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
 * Historical dotted and decorated aliases retain their existing thinking
 * lookup. That compatibility behavior is not a hard fact about the model
 * behind an opaque deployment and does not control forced-tool refusals.
 *
 * @example
 *   anthropicThinkingMode('claude-opus-5-5');                            // 'adaptive'
 *   anthropicThinkingMode('us.anthropic.claude-sonnet-4-5-20250929-v1:0'); // 'budget'
 *   anthropicThinkingMode('claude-3-5-haiku@20241022');                   // 'none'
 *   anthropicThinkingMode('claude-opus-6');                               // 'adaptive' — unknown
 */
export function anthropicThinkingMode(model: string): ThinkingMode {
  const family = thinkingFamily(model);
  return family === undefined ? 'adaptive' : ANTHROPIC_MODELS[family].thinking;
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
