/**
 * defineSkill — sugar for LLM-activated Injections that target both
 * system-prompt + tools.
 *
 * A Skill is a bundle of (1) a body of guidance and (2) optionally some
 * tools. The LLM decides when a Skill is needed by calling a designated
 * activation tool — by default `read_skill(<id>)`.
 *
 * Activation is about the BODY. A Skill's tools are registered up front
 * and callable from iteration 1 unless the Skill sets
 * `autoActivate: 'currentSkill'` — see that option.
 *
 * Produces an `Injection` with:
 *   - flavor: `'skill'`
 *   - trigger: `{ kind: 'llm-activated', viaToolName: 'read_skill' }`
 *   - inject: `{ systemPrompt: body, tools }`
 *
 * The Agent integration auto-attaches the `read_skill` tool when one
 * or more Skills are present. When the LLM calls
 * `read_skill('billing')`, the engine adds `'billing'` to
 * `ctx.activatedInjectionIds`; the next iteration's evaluator
 * matches this Skill's `id`, activates it, and the body lands in the
 * slot subflows (plus the tools, for an `autoActivate` Skill — every
 * other Skill's tools were already there).
 *
 * @example
 *   const billingSkill = defineSkill({
 *     id: 'billing',
 *     description: 'Use for refunds, charges, billing questions.',
 *     body: 'When handling billing: confirm identity first, then…',
 *     tools: [refundTool, chargeHistoryTool],
 *   });
 */

import type { Injection } from '../types.js';
import type { Tool } from '../../../core/tools.js';
import { resolveCachePolicy } from '../../../cache/applyCachePolicy.js';
import type { CachePolicy } from '../../../cache/types.js';

/**
 * Where the Skill's body lands when activated.
 *
 * Delivery reads the mode you DECLARED, literally — `buildSystemPromptSlot`
 * decides the system slot, the `read_skill` tool decides its own result:
 *
 * - `'system-prompt'` — body appended to the system slot on the
 *   iteration after activation; the `read_skill` result is a one-line
 *   confirmation. Best on Claude ≥ 3.5 (training-time adherence to
 *   system-prompt instructions is strong).
 * - `'tool-only'` — body SUPPRESSED from the system slot and returned as
 *   the `read_skill` tool result instead. Recency-first by protocol;
 *   doesn't rely on the model's training to honor system-prompt
 *   anchoring. Legal only on a Skill that `read_skill` really activates —
 *   a Skill a skill graph routes to is refused at build time, because the
 *   tool call that would carry the body never happens (`skillBodyDelivery.ts`).
 * - `'both'` — body lands in the system slot AND in the tool result.
 *   Belt-and-suspenders for high-stakes Skills on long-context runs.
 * - `'auto'` (the default) — delivered exactly like `'system-prompt'`:
 *   body in the system slot, tool result is a confirmation. It is NOT
 *   resolved per provider on the delivery path.
 *
 * `resolveSurfaceMode(provider, model)` — Claude ≥ 3.5 → `'both'`, else
 * `'tool-only'` — is the per-provider RECOMMENDATION, and it runs only where
 * something asks for it: `SkillRegistry.resolveForSkill(...)` (the skill →
 * registry → provider cascade) and `resolvedSurfaceModeOf(skill, provider,
 * model)`. Nothing on the delivery path calls it, so feed its answer back in
 * as an explicit `surfaceMode` if you want it honored.
 */
export type SurfaceMode = 'auto' | 'system-prompt' | 'tool-only' | 'both';

/**
 * When (if ever) to re-deliver a Skill's body in long-running runs.
 *
 * Even on providers with strong system-prompt adherence, attention to
 * the system slot decays past long contexts. `refreshPolicy` re-injects
 * the body via tool result past a token threshold so the LLM sees it
 * fresh again.
 *
 * **Status: declared, not yet wired.** `defineSkill` stores what you pass
 * on `skill.metadata.refreshPolicy`, and nothing in the engine reads it —
 * no re-injection happens today, on any version. The field is typed and
 * non-breaking so a Skill can record the intent, but do not count on the
 * behavior until this note says the hook shipped. If you need a body
 * re-surfaced in a long run, deliver it yourself (e.g. `surfaceMode:
 * 'both'`, so every `read_skill` call returns the body afresh).
 */
export interface RefreshPolicy {
  /**
   * Re-inject the Skill body once the run has consumed this many input
   * tokens since the Skill was last surfaced. Recommended: 50_000 for
   * 200k-context models; 20_000 for 32k-context models.
   */
  readonly afterTokens: number;
  /**
   * How to re-inject. `'tool-result'` synthesizes a fresh tool result
   * carrying the body text (recency-first). Other modes reserved.
   */
  readonly via: 'tool-result';
}

export interface DefineSkillOptions {
  readonly id: string;
  /** Visible to the LLM via the activation tool's description. */
  readonly description: string;
  /** Body appended to the system-prompt slot once activated. */
  readonly body: string;
  /** Tools this Skill contributes. **By default they are added to the agent's tool
   *  registry at build time and are visible to the model from the first iteration,
   *  whether or not the Skill is ever activated** — activation adds the Skill's
   *  body, not its tools. To make the tools appear only while the Skill is active,
   *  set `autoActivate: 'currentSkill'`; `skillGraph().tree()` sets it for you on
   *  every leaf. If a tool must never be offered before activation, that is not a
   *  default — say so with `autoActivate`. */
  readonly tools?: readonly Tool[];
  /**
   * Override the activation tool name. Defaults to `'read_skill'`.
   * Multiple Skills sharing one activation tool is the common pattern;
   * the LLM picks WHICH skill via the tool's argument.
   *
   * @deprecated Since 8.7.0 — `'read_skill'` is the only value that has ever worked,
   * and anything else is now REFUSED when the skill is mounted on an agent. No tool is
   * built from this name: the evaluator activates an `llm-activated` skill by matching
   * `ctx.activatedInjectionIds`, which only `read_skill` writes, and it never reads
   * this field. A skill declaring another name activated through `read_skill` exactly
   * like every other skill, so the declaration described a door that does not exist.
   * Drop it — skills already share ONE activation tool and the model picks which skill
   * by id. Removed in 9.0.0.
   */
  readonly viaToolName?: string;
  /**
   * Where the body lands when activated. See `SurfaceMode`. Default
   * `'auto'`, which delivers like `'system-prompt'`; name a mode
   * explicitly to get the other channels.
   */
  readonly surfaceMode?: SurfaceMode;
  /**
   * Intent to re-deliver the body past a token threshold, to defend
   * against long-context attention decay. Default: undefined.
   *
   * Recorded on the Skill's metadata and NOT yet acted on by the engine —
   * see `RefreshPolicy` before you rely on it.
   */
  readonly refreshPolicy?: RefreshPolicy;
  /**
   * Per-skill tool gating — the field that makes this Skill's `tools`
   * appear only while the Skill is active.
   *
   * - `'currentSkill'` — this Skill's `tools` are held out of the agent's
   *   static tool list and offered to the model only on iterations where
   *   the Skill is active. Outside the Agent's own wiring, materialize the
   *   same gate with `skillScopedTools(id, tools)` from
   *   `agentfootprint/tool-providers`.
   * - `undefined` (default) — additive: this Skill's tools go into the
   *   agent's registry at BUILD time and the model can see and call them
   *   from iteration 1, activated or not.
   *
   * Wired at runtime since v2.5: `buildToolRegistry` holds these tools out of the
   * static registry and `buildToolsSlot` readmits them per-iteration from the
   * active injections. Dispatch is unaffected either way — an autoActivate tool
   * stays callable by name once activated. Read `skill.metadata.autoActivate` if
   * you compose your own ToolProvider.
   */
  readonly autoActivate?: AutoActivateMode;
  /**
   * Cache policy for this skill's body. Defaults to `'while-active'` —
   * the body caches while the skill is in `activeInjections[]` (i.e.,
   * while it's the most-recently-activated skill); invalidates the
   * moment it deactivates.
   *
   * For skills with stable, frequently-accessed bodies, consider
   * `'always'` to keep the body cached even when temporarily inactive.
   * For skills with bodies that depend on per-iter state, use
   * `'never'` or `{ until: ... }`.
   *
   * See `CachePolicy` in `agentfootprint/src/cache/types.ts`.
   */
  readonly cache?: CachePolicy;
}

/**
 * Per-skill tool gating mode. See `DefineSkillOptions.autoActivate`.
 *
 * Reserved future values: `'always'` (always show this Skill's tools
 * regardless of activation), `'group'` (gate by a named skill group).
 */
export type AutoActivateMode = 'currentSkill';

/**
 * Resolve `surfaceMode: 'auto'` to a concrete mode based on provider
 * + model. The defaults match the per-provider attention profile
 * documented in the Skills, explained essay:
 *
 *   - Claude >= 3.5  → 'both'      (cheap to cache, high adherence)
 *   - Claude pre-3.5 → 'tool-only' (recency-first more reliable)
 *   - OpenAI / Bedrock / Ollama / Mock / unknown → 'tool-only'
 *
 * Pure function — no side effects. Consumers can call directly to
 * inspect what `'auto'` will resolve to in their stack.
 */
export function resolveSurfaceMode(provider: string, model?: string): SurfaceMode {
  const p = provider.toLowerCase();
  if (p === 'anthropic') {
    // Match both naming styles in current use:
    //   - claude-3-5-sonnet-..., claude-3.5-...
    //   - claude-sonnet-4-..., claude-haiku-4-..., claude-opus-4-..., claude-4-...
    // Anything matching "Claude >= 3.5" gets 'both'; older Claudes get 'tool-only'.
    if (model && /(claude-3-5|claude-3\.5|claude-(?:opus-|sonnet-|haiku-)?[4-9])/i.test(model)) {
      return 'both';
    }
    return 'tool-only';
  }
  return 'tool-only';
}

export function defineSkill(opts: DefineSkillOptions): Injection {
  if (!opts.id || opts.id.trim().length === 0) {
    throw new Error('defineSkill: `id` is required and must be non-empty.');
  }
  if (!opts.description || opts.description.length === 0) {
    throw new Error(
      `defineSkill(${opts.id}): \`description\` is required (LLM uses it to decide when to activate).`,
    );
  }
  if (!opts.body || opts.body.length === 0) {
    throw new Error(`defineSkill(${opts.id}): \`body\` is required.`);
  }
  return Object.freeze({
    id: opts.id,
    description: opts.description,
    flavor: 'skill' as const,
    trigger: {
      kind: 'llm-activated' as const,
      viaToolName: opts.viaToolName ?? 'read_skill',
    },
    inject: {
      systemPrompt: opts.body,
      ...(opts.tools && opts.tools.length > 0 && { tools: opts.tools }),
    },
    // Skill-specific options live in metadata. The engine reads them
    // when present; absent metadata = current behavior. `surfaceMode` and
    // `autoActivate` are read at runtime; `refreshPolicy` is recorded here
    // and not yet acted on by anything (see its docstring — it is stored,
    // not honoured).
    //
    // `cache` also rides this bag when a caller sets it.
    metadata: Object.freeze({
      surfaceMode: opts.surfaceMode ?? 'auto',
      ...(opts.refreshPolicy && { refreshPolicy: opts.refreshPolicy }),
      ...(opts.autoActivate && { autoActivate: opts.autoActivate }),
      cache: resolveCachePolicy('skill', opts.cache),
    }),
  }) as unknown as Injection;
}
