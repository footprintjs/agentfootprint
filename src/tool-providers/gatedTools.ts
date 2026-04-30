/**
 * gatedTools — wrap any ToolProvider with a per-tool gating predicate.
 *
 * The DECORATOR for tool providers. Filters the inner provider's
 * output by running the predicate against each tool name. Composes
 * freely:
 *
 *   gatedTools(
 *     gatedTools(staticTools(allTools), readOnlyPredicate),
 *     skillGatePredicate,
 *   )
 *
 * Reads as: "static list of all tools, filtered by readonly policy,
 * then further filtered by the active skill's tool set." Each gate
 * is one concern; composition handles the rest.
 *
 * Pattern: Decorator (GoF) — wraps any ToolProvider with an additional
 *          filter. Mirrors `withRetry` / `withFallback` over LLMProvider.
 *
 * @example  Read-only enforcement
 *   const readOnly = gatedTools(
 *     staticTools([read, write]),
 *     (toolName) => toolName.startsWith('read_'),
 *   );
 *   readOnly.list(ctx); // → [read]
 *
 * @example  Skill-gated dispatch (autoActivate use case)
 *   const skillGated = gatedTools(
 *     staticTools(allTools),
 *     (toolName, ctx) => ctx.activeSkillId
 *       ? skillToolMap[ctx.activeSkillId].includes(toolName)
 *       : alwaysVisible.includes(toolName),
 *   );
 */

import type { ToolProvider, ToolDispatchContext, ToolGatePredicate } from './types.js';

// #region gatedTools
export function gatedTools(inner: ToolProvider, predicate: ToolGatePredicate): ToolProvider {
  return {
    id: 'gated',
    list(ctx: ToolDispatchContext) {
      // Pull from the inner provider first; each recomputation sees
      // the freshest state from any nested gates.
      const innerTools = inner.list(ctx);
      // Filter by predicate — tool name from `tool.schema.name`.
      // Predicates throwing escape: a buggy predicate should crash
      // loudly, not silently allow tools through. Per the
      // permission-as-defense-in-depth principle.
      return innerTools.filter((t) => predicate(t.schema.name, ctx));
    },
  };
}
// #endregion gatedTools
