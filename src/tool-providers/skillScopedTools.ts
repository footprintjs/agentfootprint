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

import { isDevMode } from 'footprintjs';

import type { Tool } from '../core/tools.js';
import type { ToolProvider, ToolDispatchContext } from './types.js';

/** The `ToolProvider.id` prefix every `skillScopedTools(...)` carries. */
export const SKILL_SCOPED_TOOLS_ID_PREFIX = 'skill-scoped:';

/** Recover the skill id from a `skillScopedTools` provider id, or `undefined`. */
export function skillScopedToolsTarget(providerId: string | undefined): string | undefined {
  if (!providerId?.startsWith(SKILL_SCOPED_TOOLS_ID_PREFIX)) return undefined;
  const id = providerId.slice(SKILL_SCOPED_TOOLS_ID_PREFIX.length);
  return id.length > 0 ? id : undefined;
}

// #region skillScopedTools
export function skillScopedTools(skillId: string, tools: readonly Tool[]): ToolProvider {
  if (!skillId || skillId.trim().length === 0) {
    throw new Error('skillScopedTools: `skillId` is required and must be non-empty.');
  }
  // Capture the tool list once. `list()` returns a fresh array each
  // call (matches the staticTools / gatedTools convention so the
  // agent's reference-equality check always sees an update).
  const captured = [...tools];
  // Dev-mode latch: fact 1 above is a one-time lesson, not a per-iteration one.
  let warnedNotByReadSkill = false;
  return {
    id: `${SKILL_SCOPED_TOOLS_ID_PREFIX}${skillId}`,
    list(ctx: ToolDispatchContext): readonly Tool[] {
      // Empty list when the skill is not active.
      if (ctx.activeSkillId !== skillId) {
        // The silent-empty this provider is most often wired into (8.7.0): the skill
        // IS loaded this iteration — an entry rule matched, or a skillGraph() edge
        // routed into it — but it did not arrive by `read_skill`, and `activeSkillId`
        // only ever reports a `read_skill` activation. Fact 1 in the header says so;
        // nothing said it at the moment it happened, so the tools simply never
        // appeared and the run looked fine. `activeSkillIds` (8.7.0) is the real
        // active set, which is what makes this detectable from inside the provider —
        // composed into a bigger provider or not.
        if (isDevMode() && !warnedNotByReadSkill && ctx.activeSkillIds?.includes(skillId)) {
          warnedNotByReadSkill = true;
          // eslint-disable-next-line no-console
          console.warn(
            `agentfootprint skillScopedTools('${skillId}'): skill '${skillId}' IS active on ` +
              `iteration ${ctx.iteration}, but it was not activated by read_skill — so ` +
              `ctx.activeSkillId does not name it and this provider returned NO tools. That is ` +
              `what happens to a skill an entry rule or a skillGraph() edge activates. Put the ` +
              `tools on the skill itself (defineSkill({ tools, autoActivate: 'currentSkill' })), ` +
              `or scope on ctx.activeSkillIds, which follows the graph's position.`,
          );
        }
        return [];
      }
      return [...captured];
    },
  };
}
// #endregion skillScopedTools
