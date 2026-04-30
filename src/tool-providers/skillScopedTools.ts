/**
 * skillScopedTools — ToolProvider that exposes a tool subset only when
 * a specific Skill is active in the current iteration's context.
 *
 * The Block A5 piece. Pairs with `defineSkill({ autoActivate: 'currentSkill' })`
 * to give the LLM a sharper choice space: when `billing` activates, the
 * tool list flips from "all 25 agent tools" to "the 7 billing tools" +
 * any baseline (always-on) tools the consumer composes alongside.
 *
 * Pattern: gated ToolProvider keyed by `ctx.activeSkillId`. Pure compute;
 *          no Agent-runtime dependency. Composes freely with `staticTools`
 *          for the always-on baseline.
 *
 * @example  One skill's tools, scoped by activation
 *   const billingTools = skillScopedTools('billing', [refundTool, chargeTool]);
 *   billingTools.list({ iteration: 1, activeSkillId: 'billing', identity: ... });
 *   // → [refundTool, chargeTool]
 *   billingTools.list({ iteration: 1, activeSkillId: 'refund', identity: ... });
 *   // → [] (different skill active)
 *   billingTools.list({ iteration: 1, identity: ... });
 *   // → [] (no skill active)
 *
 * @example  Compose with baseline + multiple skills
 *   const baseline   = staticTools([lookupOrderTool, listSkills, readSkill]);
 *   const billingTbx = skillScopedTools('billing', [refundTool, chargeTool]);
 *   const refundTbx  = skillScopedTools('refund',  [reverseTool]);
 *
 *   // Wrap each scope-provider in a gatedTools for downstream composition,
 *   // OR build a small wrapper that concatenates list(ctx) outputs:
 *   const provider: ToolProvider = {
 *     id: 'composite',
 *     list: (ctx) => [
 *       ...baseline.list(ctx),
 *       ...billingTbx.list(ctx),
 *       ...refundTbx.list(ctx),
 *     ],
 *   };
 *
 * Note: the runtime that POPULATES `ctx.activeSkillId` from
 * `scope.activatedInjectionIds` lands in Block C / v2.5+. Today,
 * consumers can drive it manually for tests + design-time inspection.
 */

import type { Tool } from '../core/tools.js';
import type { ToolProvider, ToolDispatchContext } from './types.js';

// #region skillScopedTools
export function skillScopedTools(
  skillId: string,
  tools: readonly Tool[],
): ToolProvider {
  if (!skillId || skillId.trim().length === 0) {
    throw new Error('skillScopedTools: `skillId` is required and must be non-empty.');
  }
  // Capture the tool list once. `list()` returns a fresh array each
  // call (matches the staticTools / gatedTools convention so the
  // agent's reference-equality check always sees an update).
  const captured = [...tools];
  return {
    id: `skill-scoped:${skillId}`,
    list(ctx: ToolDispatchContext): readonly Tool[] {
      // Empty list when the skill is not active.
      if (ctx.activeSkillId !== skillId) return [];
      return [...captured];
    },
  };
}
// #endregion skillScopedTools
