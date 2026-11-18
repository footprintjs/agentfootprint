import { isDevMode } from 'footprintjs';
import { skillScopedToolsTarget } from '../../../../tools/skillScopedTools.js';
import type { ToolProvider } from '../../../../tools/toolProvider.js';
import type { Injection } from '../../../../injection-engine/types.js';

/**
 * Dev-warn a `skillScopedTools(id, …)` pointed at a skill that already scopes its own
 * tools (8.7.0).
 *
 * `defineSkill({ tools, autoActivate: 'currentSkill' })` already narrows the LLM's
 * tool list to the active skill, with no provider at all — that is what
 * `skillScopedTools`' own header means by "you probably don't need this". Wiring both
 * gives one skill two tool sources keyed on two DIFFERENT signals (the graph's active
 * set vs. the last `read_skill` call), which is how a tool ends up visible on
 * iterations nobody expected — and it is the exact pairing that put a shadowed tool
 * name into a field agent.
 */
function warnRedundantSkillScopedTools(
  provider: ToolProvider | undefined,
  injections: readonly Injection[],
): void {
  if (!isDevMode()) return;
  const target = skillScopedToolsTarget(provider?.id);
  if (target === undefined) return;
  const skill = injections.find((i) => i.id === target);
  if (!skill) return;
  const meta = skill.metadata as { autoActivate?: string } | undefined;
  if (meta?.autoActivate !== 'currentSkill') return;
  if ((skill.inject?.tools ?? []).length === 0) return;
  // eslint-disable-next-line no-console
  console.warn(
    `agentfootprint Agent: skillScopedTools('${target}') is wired, but skill '${target}' already ` +
      `carries autoActivate: 'currentSkill' with its own tools:[] — which narrows the tool list ` +
      `to that skill on its own. The two gates key on DIFFERENT signals (the provider on the ` +
      `last read_skill call, the skill on the graph's active set), so a tool can appear on ` +
      `iterations you did not expect, and a name declared on both sides shadows (the model ` +
      `reads the provider's description and the skill's implementation runs). Keep one: the ` +
      `skill's tools:[] if the tools belong to the skill, the provider if they are assembled ` +
      `elsewhere.`,
  );
}

export { warnRedundantSkillScopedTools };
