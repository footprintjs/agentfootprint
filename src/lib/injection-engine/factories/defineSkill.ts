/**
 * defineSkill — sugar for LLM-activated Injections that target both
 * system-prompt + tools.
 *
 * A Skill is a bundle of (1) a body of guidance and (2) optionally
 * unlocked tools. The LLM decides when a Skill is needed by calling
 * a designated activation tool — by default `read_skill(<id>)`.
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
 * matches this Skill's `id`, activates it, and the body + tools land
 * in the slot subflows.
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
 * - `'system-prompt'` — body appended to the system slot on the
 *   iteration after activation. Best on Claude ≥ 3.5 (training-time
 *   adherence to system-prompt instructions is strong).
 * - `'tool-only'` — body delivered ONLY via the `read_skill` tool's
 *   result. Recency-first by protocol; doesn't rely on the model's
 *   training to honor system-prompt anchoring. Default for every
 *   non-Claude provider.
 * - `'both'` — body lands in both the system slot AND the tool result.
 *   Belt-and-suspenders for high-stakes Skills on long-context runs.
 * - `'auto'` — the library picks per provider via `resolveSurfaceMode`.
 *   `'both'` on Claude ≥ 3.5; `'tool-only'` everywhere else.
 *
 * **v2.5 runtime dispatch (Block C):** modes now route differently:
 *   - `'system-prompt'` → body in system slot, tool result is confirmation
 *   - `'tool-only'`     → body SUPPRESSED from system slot, tool result IS the body
 *   - `'both'`          → body in system slot AND in tool result
 *   - `'auto'`          → keeps v2.4 behavior (body in system slot, tool result is confirmation)
 *     The Block A4 cascade resolves `'auto'` against provider/model context
 *     at a future runtime layer (Claude ≥ 3.5 → `'both'`; else `'tool-only'`).
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
 * **v2.4 status:** the field is reserved + typed; the runtime hook
 * lands in v2.5 as part of the long-context attention work. Specifying
 * `refreshPolicy` today is non-breaking — the engine ignores it until
 * the hook is implemented.
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
  /** Optional unlocked tools, added to the tools slot once activated. */
  readonly tools?: readonly Tool[];
  /**
   * Override the activation tool name. Defaults to `'read_skill'`.
   * Multiple Skills sharing one activation tool is the common pattern;
   * the LLM picks WHICH skill via the tool's argument.
   */
  readonly viaToolName?: string;
  /**
   * Where the body lands when activated. See `SurfaceMode`. Default
   * `'auto'` — the library resolves per provider via `resolveSurfaceMode`.
   */
  readonly surfaceMode?: SurfaceMode;
  /**
   * Re-deliver the body past a token threshold to defend against
   * long-context attention decay. Default: undefined (no refresh).
   */
  readonly refreshPolicy?: RefreshPolicy;
  /**
   * Per-skill tool gating intent. Block A5 / v2.5.
   *
   * - `'currentSkill'` — when this Skill is the only active one, the
   *   agent's tool list should narrow to this Skill's `tools` (plus
   *   the consumer-composed baseline). Used with
   *   `skillScopedTools(id, tools)` from `agentfootprint/tool-providers`
   *   to materialize the gate. Block C wires this into the runtime
   *   automatically.
   * - `undefined` (default) — current additive behavior: this Skill's
   *   tools are added to the agent's registry on activation, alongside
   *   every other tool already registered.
   *
   * The field is a forward-compat marker today: the metadata stores
   * it; consumers can read `skill.metadata.autoActivate` to drive
   * their own ToolProvider composition. v2.5 runtime wiring builds
   * on this contract without API change.
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
    // when present; absent metadata = current behavior. Forward-compat:
    // when v2.5 implements per-mode routing diversity, this field is
    // already where the runtime looks.
    //
    // `cache` joins the metadata bag in v2.6 — CacheDecision subflow
    // reads `metadata.cache` to know how to treat this skill's body.
    metadata: Object.freeze({
      surfaceMode: opts.surfaceMode ?? 'auto',
      ...(opts.refreshPolicy && { refreshPolicy: opts.refreshPolicy }),
      ...(opts.autoActivate && { autoActivate: opts.autoActivate }),
      cache: resolveCachePolicy('skill', opts.cache),
    }),
  }) as unknown as Injection;
}
