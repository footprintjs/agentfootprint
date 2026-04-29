/**
 * Injection Engine — evaluator.
 *
 * Pattern: Pure function. Stateless.
 * Role:    Internal helper. Called once per iteration by the
 *          InjectionEngine subflow's compose stage. Slot subflows
 *          read the `active` array and filter by their slot target.
 * Emits:   N/A. Caller (the subflow) emits
 *          `agentfootprint.context.evaluated`.
 *
 * Behavior per trigger kind:
 *   • `always`             → always active.
 *   • `rule`               → predicate runs against `ctx`. Errors are
 *                            caught + reported in `skipped`; never
 *                            propagate. Run never crashes.
 *   • `on-tool-return`     → active when `ctx.lastToolResult.toolName`
 *                            matches `trigger.toolName` (string equal
 *                            or regex test).
 *   • `llm-activated`      → active when the Injection's `id` is in
 *                            `ctx.activatedInjectionIds` (the LLM
 *                            previously called `viaToolName(<id>)`).
 */

import type { Injection, InjectionContext, InjectionEvaluation } from './types.js';

export function evaluateInjections(
  injections: readonly Injection[],
  ctx: InjectionContext,
): InjectionEvaluation {
  const active: Injection[] = [];
  const skipped: Array<{
    id: string;
    reason: 'predicate-threw' | 'unknown-trigger-kind';
    error?: string;
  }> = [];

  for (const inj of injections) {
    const t = inj.trigger;
    switch (t.kind) {
      case 'always': {
        active.push(inj);
        break;
      }
      case 'rule': {
        try {
          if (t.activeWhen(ctx)) active.push(inj);
        } catch (err) {
          skipped.push({
            id: inj.id,
            reason: 'predicate-threw',
            error: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }
      case 'on-tool-return': {
        const toolName = ctx.lastToolResult?.toolName;
        if (!toolName) break;
        const matches =
          typeof t.toolName === 'string' ? t.toolName === toolName : t.toolName.test(toolName);
        if (matches) active.push(inj);
        break;
      }
      case 'llm-activated': {
        if (ctx.activatedInjectionIds.includes(inj.id)) active.push(inj);
        break;
      }
      default: {
        // Defensive: unknown trigger kind (custom user code that
        // didn't typecheck). Skipped for observability; never crashes.
        const _exhaustive: never = t;
        skipped.push({
          id: inj.id,
          reason: 'unknown-trigger-kind',
          error: `Unhandled trigger: ${JSON.stringify(_exhaustive)}`,
        });
      }
    }
  }

  return { active, skipped };
}
