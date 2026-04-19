/**
 * agentfootprint/skills — typed, versioned agent skills.
 *
 * A `Skill` is a named procedure the agent can discover via `list_skills`
 * and activate via `read_skill(id)`. Each Skill is a typed bundle of
 * prompt + tools + tool-result rules + metadata, composed over the
 * existing `AgentInstruction` primitive.
 *
 * The pattern Anthropic popularized in the Claude Agent SDK, packaged
 * at `agentfootprint`'s framework layer with two agentfootprint-native
 * advantages over the Agent SDK: cross-provider correctness (recency-
 * first delivery by default) and typed / composable authoring.
 *
 * @example
 * ```ts
 * import { Agent, anthropic } from 'agentfootprint';
 * import { defineSkill, SkillRegistry } from 'agentfootprint/skills';
 *
 * const portTriage = defineSkill<TriageDecision>({
 *   id: 'port-error-triage',
 *   version: '1.0.0',
 *   title: 'Port error triage',
 *   description: 'Investigate interfaces reporting CRC or input errors.',
 *   steps: [
 *     'Fetch interface metrics',
 *     'Pull last 5m of logs',
 *     'Report findings to operator',
 *   ],
 *   tools: [getMetrics, getLogs],
 *   activeWhen: (d) => d.currentSkill === 'port-error-triage',
 * });
 *
 * const registry = new SkillRegistry<TriageDecision>({ surfaceMode: 'auto' });
 * registry.register(portTriage);
 *
 * const agent = Agent.create({ provider: anthropic('claude-sonnet-4-5') })
 *   .skills(registry)
 *   .build();
 * ```
 */

export { defineSkill, SkillRegistry, renderSkillBody } from './lib/skills';
export type {
  Skill,
  SurfaceMode,
  ProviderHint,
  SkillRegistryOptions,
  SkillListEntry,
  GeneratedSkillTools,
} from './lib/skills';
