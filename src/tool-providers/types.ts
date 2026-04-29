/**
 * ToolProvider — abstraction over tool dispatch.
 *
 * v2.4 shipped tools as a flat array on the agent (registered via
 * `agent.tool(t)` / `agent.tools(arr)`). That model breaks down once
 * production agents need:
 *   1. Permission gating per-tool, per-caller (read-only roles, etc.)
 *   2. Per-skill tool gating (only show the active skill's tools to
 *      the LLM each turn)
 *   3. Composable filters (a `withReadonly` decorator over a `withSkill`
 *      decorator over the base tool list)
 *
 * `ToolProvider` is the answer: a chainable abstraction over "what
 * tools does the LLM see right now?". The agent asks the provider
 * each iteration; the provider returns the visible tool set computed
 * from whatever predicates / role gates / skill filters the consumer
 * composed.
 *
 * Pattern: Strategy (GoF) — each ToolProvider is a strategy for
 *          "compute the visible tool list given current context".
 *          Decorator (GoF) — `gatedTools(inner, predicate)` wraps any
 *          provider with an additional filter, mirroring how `withRetry`
 *          / `withFallback` decorate `LLMProvider`.
 * Role:    Layer-3 tool-dispatch primitive. Agent calls `provider.list(ctx)`
 *          each iteration to compute the visible tool set.
 * Emits:   N/A (pure compute; permission denials emit elsewhere via the
 *          permission subsystem).
 *
 * @example  Static tool list (90% case — what `.tools(arr)` does today)
 *   const provider = staticTools([weather, lookupOrder]);
 *
 * @example  Read-only enforcement (role-based gate)
 *   const readOnlyProvider = gatedTools(
 *     staticTools([weather, lookupOrder, processRefund]),
 *     (toolName) => policy.isAllowed(toolName),
 *   );
 *
 * @example  Skill-gated dispatch (only active skill's tools visible)
 *   const skillGated = gatedTools(
 *     staticTools(allTools),
 *     (toolName, ctx) => ctx.activeSkillId
 *       ? skillsToolMap[ctx.activeSkillId].includes(toolName)
 *       : alwaysVisible.includes(toolName),
 *   );
 *
 * @example  Stack: read-only over skill-gated
 *   const provider = gatedTools(
 *     gatedTools(staticTools(allTools), readOnlyPredicate),
 *     skillGatePredicate,
 *   );
 */

import type { Tool } from '../core/tools.js';

/**
 * Read-only context the provider receives each iteration. Pure data
 * — providers MUST NOT mutate. Used by gating predicates to inspect
 * the current activation state.
 */
export interface ToolDispatchContext {
  /** Current ReAct iteration (1-based). */
  readonly iteration: number;
  /**
   * The id of the currently-activated Skill, if any.
   * Set by `read_skill(id)` activation; cleared between turns.
   * Used by `autoActivate`-driven per-skill tool gating.
   */
  readonly activeSkillId?: string;
  /**
   * Caller identity tuple — passed through from `agent.run({ identity })`.
   * Permission predicates can role-check based on `identity.principal`
   * or `identity.tenant`.
   */
  readonly identity?: {
    readonly tenant?: string;
    readonly principal?: string;
    readonly conversationId: string;
  };
}

/**
 * The provider interface. A `ToolProvider` answers ONE question per
 * iteration: "what tools should the LLM see right now?"
 *
 * Implementations are PURE — given the same context, return the same
 * tool list. No async (the answer is needed synchronously each
 * iteration; if you need async filtering, precompute upstream).
 */
export interface ToolProvider {
  /**
   * Return the tool list visible to the LLM for the current iteration.
   * The returned array MUST be a NEW reference each call (the agent
   * compares for change detection). Order is preserved — the LLM may
   * use position as a hint when tool descriptions are ambiguous.
   */
  list(ctx: ToolDispatchContext): readonly Tool[];

  /**
   * Optional: stable id for observability / debugging. Defaults to
   * `'static'` for `staticTools`, `'gated'` for `gatedTools`. Custom
   * implementations should set their own id.
   */
  readonly id?: string;
}

/** Predicate for `gatedTools` — runs per tool, per iteration. */
export type ToolGatePredicate = (
  toolName: string,
  ctx: ToolDispatchContext,
) => boolean;
