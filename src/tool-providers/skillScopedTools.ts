/**
 * skillScopedTools — ToolProvider that exposes a tool subset only while a
 * specific Skill is the one the model most recently loaded.
 *
 * **You probably don't need this.** If the tools belong to the skill, hand them
 * to the skill: `defineSkill({ tools: [...], autoActivate: 'currentSkill' })`
 * already narrows the LLM's tool list to the active skill, with no provider
 * wiring at all. This provider is for tools that CAN'T ride on the skill —
 * a list assembled elsewhere, discovered at runtime, or owned by another module.
 *
 * Three facts worth knowing before you wire it:
 *
 * 1. **`ctx.activeSkillId` is the last `read_skill` activation, not the graph
 *    cursor.** The runtime fills it from the tail of `scope.activatedInjectionIds`,
 *    which only `read_skill` ever appends to. A skill that activated because an
 *    entry RULE matched, or because a `skillGraph()` edge routed into it, does
 *    NOT set it — `list(ctx)` will return `[]` for that skill. Scope by graph
 *    position with the skill's own `tools:[]` instead.
 * 2. **One ToolProvider per agent.** `AgentBuilder.toolProvider()` throws on the
 *    second call. Compose several scopes into ONE provider (see the example
 *    below) rather than calling it in a loop.
 * 3. It is pure compute — no Agent-runtime dependency — so it is equally usable
 *    from a test or a design-time inspection.
 *
 * @example  One skill's tools, scoped by activation
 *   const billingTools = skillScopedTools('billing', [refundTool, chargeTool]);
 *   billingTools.list({ iteration: 1, activeSkillId: 'billing' });
 *   // → [refundTool, chargeTool]
 *   billingTools.list({ iteration: 1, activeSkillId: 'refund' });
 *   // → [] (a different skill was loaded)
 *   billingTools.list({ iteration: 1 });
 *   // → [] (nothing loaded via read_skill — see fact 1 above)
 *
 * @example  Compose with baseline + multiple skills
 *   const baseline   = staticTools([lookupOrderTool, listSkills, readSkill]);
 *   const billingTbx = skillScopedTools('billing', [refundTool, chargeTool]);
 *   const refundTbx  = skillScopedTools('refund',  [reverseTool]);
 *
 *   // ONE provider for the agent (see fact 2) — concatenate the scopes:
 *   const provider: ToolProvider = {
 *     id: 'composite',
 *     list: (ctx) => [
 *       ...baseline.list(ctx),
 *       ...billingTbx.list(ctx),
 *       ...refundTbx.list(ctx),
 *     ],
 *   };
 *   Agent.create({ provider: llm, model }).toolProvider(provider).build();
 */

import type { Tool } from '../core/tools.js';
import type { ToolProvider, ToolDispatchContext } from './types.js';

// #region skillScopedTools
export function skillScopedTools(skillId: string, tools: readonly Tool[]): ToolProvider {
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
