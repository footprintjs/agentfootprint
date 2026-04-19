/**
 * Skill types — a `Skill` is a typed, versioned bundle of prompt +
 * tools + tool-result rules + metadata, composed over the existing
 * `AgentInstruction` primitive.
 *
 * Skills are the pattern Anthropic popularized in the Claude Agent SDK:
 * a registry of named procedures, each with a short description; the
 * model picks one by description match, calls a `read_skill(id)` tool
 * to surface the skill body into its recency window, and follows the
 * procedure within the skill's declared tool allowlist.
 *
 * Per-panel review decisions that landed here:
 *   - Skill extends AgentInstruction (not parallel) so type additions
 *     to AgentInstruction flow through automatically. (#7)
 *   - `description` is REQUIRED — it's load-bearing for classification. (#7)
 *   - `body` lazy loader supported from day one so future disk/blob-
 *     backed skills don't break the interface. (#5)
 *   - `read_skill` (not `load_skill`) to match Claude Agent SDK naming. (#1)
 */
import type { AgentInstruction } from '../instructions';
import type { ToolDefinition } from '../../types/tools';

/**
 * A named, versioned procedure the agent can activate on demand.
 *
 * Every field from `AgentInstruction<TDecision>` is inherited:
 * `activeWhen`, `prompt`, `tools`, `onToolResult`, `priority`, `safety`.
 * Skills ADD:
 *   - `version` — semver string for evolution / eval pinning
 *   - `title` — short human label
 *   - `description` — classifier input (≤200 chars recommended)
 *   - `scope?` — freeform tags for `list_skills({ scope })` filtering
 *   - `steps?` — ordered procedure text rendered into the skill body
 *   - `body?` — full body override / lazy loader
 *
 * Note: `id` is inherited from `AgentInstruction` and is the primary key.
 */
export interface Skill<TDecision = unknown> extends AgentInstruction<TDecision> {
  /** Required override — Skills ALWAYS have a description; it drives classification. */
  readonly description: string;

  /** Semver version string. Used in recorder events + eval pinning. */
  readonly version: string;

  /** Short, human-readable title. Shown in `list_skills` results and skill body header. */
  readonly title: string;

  /**
   * Freeform tags for filtering. `list_skills({ scope: 'auth' })` returns
   * only skills whose scope array includes `'auth'`. Empty array = match all.
   */
  readonly scope?: readonly string[];

  /**
   * Ordered steps of the procedure, rendered into the skill body as a
   * numbered list. Prefer steps over free-form text: a numbered list
   * survives model attention drift better than a paragraph.
   */
  readonly steps?: readonly string[];

  /**
   * Override the rendered body for the `read_skill` tool result.
   *
   * - `undefined` (default): the library renders `title + description +
   *   steps + prompt` via `renderSkillBody()`.
   * - `string`: returned verbatim (panel #5: supports hot-loaded
   *   disk/blob content even in Phase 1).
   * - `() => Promise<string> | string`: lazy loader — called at
   *   `read_skill` time. Errors propagate as tool-result errors.
   */
  readonly body?: string | (() => Promise<string> | string);
}

/**
 * Controls HOW skill descriptions reach the model.
 *
 * This is the crux of the cross-provider correctness argument from
 * the proposal: system-prompt adherence is a trained behavior; tool-
 * result position is a protocol-level guarantee. Pick `'tool-only'`
 * when portability matters; pick `'both'` on Claude-class providers
 * for belt-and-braces. `'auto'` lets the library choose per provider.
 */
export type SurfaceMode = 'tool-only' | 'system-prompt' | 'both' | 'auto';

/**
 * Minimal provider-identification hint used by `'auto'` surface-mode
 * resolution. Matches the shape of `ModelConfig` from the `anthropic()`
 * / `openai()` factories so callers can forward their provider config
 * directly. Unknown providers resolve to `'tool-only'` (safe default).
 */
export interface ProviderHint {
  readonly provider: string;
  readonly modelId?: string;
}

export interface SkillRegistryOptions {
  /**
   * How descriptions are delivered to the model. Default `'tool-only'`
   * — the portable path that works on every provider (including `mock`
   * for evals).
   */
  readonly surfaceMode?: SurfaceMode;

  /**
   * Provider hint used when `surfaceMode === 'auto'`. Accepts a
   * `ModelConfig` from `anthropic('...')` / `openai('...')`, a plain
   * `{provider, modelId}` object, or omit for the safe default.
   */
  readonly providerHint?: ProviderHint;

  /**
   * Base prompt header inserted before skill descriptions when
   * `surfaceMode` is `'system-prompt'` or `'both'`. Default:
   * `"Available skills — call `read_skill({ id })` to activate one:"`.
   */
  readonly promptHeader?: string;

  /**
   * When configured, the auto-generated `read_skill(id)` tool:
   *   1. returns the skill body as usual (tool-result recency delivery),
   *   2. AND writes the loaded skill's id into agent decision scope at
   *      `decision[stateField]`.
   *
   * Enables **skill-gated tool visibility**: downstream
   * `AgentInstruction.activeWhen: (d) => d[stateField] === 'my-skill'`
   * predicates fire naturally, so each skill's `tools: [...]` only reach
   * the LLM when that skill is active. Without this option, consumers
   * must hand-wire a ~30-LOC bridge (an onToolResult instruction +
   * manual decision mutation); with it, skill-gating is one line.
   *
   * When a skill doesn't declare its own `activeWhen`, the registry
   * auto-fills `activeWhen: (d) => d[stateField] === skill.id` — so
   * consumers only need to set `autoActivate` once and every skill
   * gates its own tools by id automatically.
   */
  readonly autoActivate?: AutoActivateOptions;
}

/** Configuration for `SkillRegistryOptions.autoActivate`. */
export interface AutoActivateOptions {
  /**
   * Key on the agent's decision scope that receives the active skill's
   * id when `read_skill(id)` runs. Must be a string-keyed field the
   * consumer has shaped into their `TDecision` type — e.g.
   * `stateField: 'currentSkill'` with `TDecision = { currentSkill?: string }`.
   */
  readonly stateField: string;

  /**
   * What to do when `read_skill(unknownId)` is called.
   *   - `'leave'` (default): prior `decision[stateField]` is unchanged.
   *   - `'clear'`: `decision[stateField]` is set to `undefined`, so any
   *     previously-active skill's tools disappear.
   */
  readonly onUnknownSkill?: 'leave' | 'clear';
}

/**
 * Output of `list_skills` tool. Model uses `{id, title, description}` to
 * pick a skill; `version` is included for audit / eval recording only
 * (we don't ask the model to reason about versions).
 */
export interface SkillListEntry {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly version: string;
  readonly scope?: readonly string[];
}

/**
 * Auto-generated tools surfaced by the registry. Exported so consumers
 * who want to merge skills tools into a custom tool set can reach them
 * directly instead of going through `AgentBuilder.skills()`.
 */
export interface GeneratedSkillTools {
  readonly listSkills: ToolDefinition;
  readonly readSkill: ToolDefinition;
}
