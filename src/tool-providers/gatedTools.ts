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

import type { Tool } from '../tools/tools.js';
import {
  listWithSelectionDecisions,
  registerLedgerListing,
  type ObserveSelection,
} from '../tools/selectionListing.js';
import type {
  ToolProvider,
  ToolDispatchContext,
  ToolGatePredicate,
} from '../tools/toolProvider.js';

// LENS · tool-list · request-ephemeral
// reads: nothing of its own — a caller-supplied predicate over the inner provider, recomputed per iteration
// Only a framework ledger gate can contribute an attention decision. Arbitrary predicates may implement
// authority policy and must conceal exclusions, including decisions made inside their provider.
// The local allowlist and remote policy distinction is described in src/security/index.ts.
// law: may omit, never deny; every clause anchored to the call it was composed on.
// #region gatedTools
export function gatedTools(inner: ToolProvider, predicate: ToolGatePredicate): ToolProvider {
  function evaluate(ctx: ToolDispatchContext, observe?: ObserveSelection) {
    // Pull from the inner provider first; each recomputation sees
    // the freshest state from any nested gates. Inner may be sync
    // or async — we mirror what we get back so a sync chain stays
    // sync (zero microtask overhead) and an async chain stays
    // async (no premature `Promise.resolve` wrapping).
    const innerResult = observe ? listWithSelectionDecisions(inner, ctx, observe) : inner.list(ctx);
    const filter = (innerTools: readonly Tool[]): readonly Tool[] =>
      // Filter by predicate — tool name from `tool.schema.name`.
      // Predicates throwing escape: a buggy predicate should crash
      // loudly, not silently allow tools through. Per the
      // permission-as-defense-in-depth principle.
      innerTools.filter((tool) => {
        const name = tool.schema.name;
        const include = predicate(name, ctx);
        if (!include && observe) observe({ kind: 'ledger', name, tool });
        return include;
      });
    return innerResult instanceof Promise ? innerResult.then(filter) : filter(innerResult);
  }
  const provider: ToolProvider = { id: 'gated', list: (ctx) => evaluate(ctx) };
  registerLedgerListing(provider, predicate, evaluate);
  return provider;
}
// #endregion gatedTools
