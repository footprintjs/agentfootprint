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
 *   • `on-tool-return`     → active when ANY tool result of the previous
 *                            iteration's batch (`toolResultsOf(ctx)` —
 *                            `ctx.toolResults`, falling back to the
 *                            singular `ctx.lastToolResult`) has a
 *                            `toolName` matching `trigger.toolName`
 *                            (string equal or regex test). Before 9.16.0
 *                            only the LAST call of a parallel batch was
 *                            consulted — earlier calls were dropped.
 *   • `llm-activated`      → active when the Injection's `id` is in
 *                            `ctx.activatedInjectionIds` (the LLM
 *                            previously called `viaToolName(<id>)`).
 *
 * Beside the trigger kinds, ONE framework-tier admission (9.19.0): an
 * injection named by `ctx.leaseActiveIds` — a `require-instruction` tool
 * effect's granted lease — is active for this pass even when its own
 * trigger said nothing. Declaration order is preserved (the lease admits;
 * it never reorders), and an injection both triggered AND leased is active
 * once. Absent `leaseActiveIds` = the loop below is byte-identical.
 */

import { toolResultsOf } from './types.js';
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
    // The lease admission (9.19.0) — a granted `require-instruction` push.
    // Checked FIRST so a leased injection is active exactly once whatever
    // its own trigger would have said; the switch below never runs for it,
    // which also means a leased rule's throwing predicate cannot mark a
    // framework-granted delivery as skipped.
    if (ctx.leaseActiveIds !== undefined && ctx.leaseActiveIds.includes(inj.id)) {
      active.push(inj);
      continue;
    }
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
        // The WHOLE batch, in call order (9.16.0) — a trigger fires when any
        // call of the previous iteration returned from the named tool, not
        // only when that tool happened to be last in a parallel batch.
        const matches = toolResultsOf(ctx).some((r) =>
          typeof t.toolName === 'string' ? t.toolName === r.toolName : t.toolName.test(r.toolName),
        );
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
