/**
 * Skill-tool builders — shared source of truth for `list_skills` and
 * `read_skill` tools used by the Agent's auto-attach path AND by
 * `SkillRegistry.toTools()` (explicit composition path).
 *
 * Both tools work over the SAME catalog (a list of `Injection` skills).
 * Pulling them out of `core/Agent.ts` removes the v2.4 duplication
 * risk: the Agent auto-attaches its own `read_skill`, the registry
 * builds a sibling — they MUST agree on schema + execute semantics.
 *
 * Pattern: pure builder functions over an `Injection[]` catalog.
 *          Tool execute is identity-style (returns confirmation
 *          string); the agent's tool-calls subflow inspects the
 *          tool name + args and updates `scope.activatedInjectionIds`
 *          so the next iteration's InjectionEngine sees the new
 *          activation.
 *
 * Closes Neo gap #3 (of 8) by making the LLM-facing skill discovery
 * surface composable — consumers can plug `listSkills` / `readSkill`
 * into their own ToolProvider chain (e.g., gatedTools → permission
 * filter → static + skill-tools).
 */

import { defineTool } from '../../core/tools.js';
import type { Tool } from '../../core/tools.js';
import type { Injection } from './types.js';

/**
 * Build the `list_skills` tool — a no-arg tool that returns the
 * registered skills as `{ id, description }[]`. Lets the LLM discover
 * skills without paying the prompt-token cost of embedding the
 * catalog into every system prompt.
 *
 * Pairs with `read_skill` (which actually activates a skill by id).
 *
 * Returns `undefined` when there are no skills — callers should
 * guard or filter undefined out of their tool list.
 */
export function buildListSkillsTool(skills: readonly Injection[]): Tool | undefined {
  if (skills.length === 0) return undefined;

  // Capture a stable snapshot — the registry/agent calls this at
  // build time, so the tool reflects the catalog as of registration.
  const catalog = skills.map((s) => ({
    id: s.id,
    description: s.description ?? '(no description)',
  }));

  return defineTool<Record<string, never>, string>({
    name: 'list_skills',
    description:
      'List all available skills with their ids and descriptions. ' +
      'Use this to discover what skills exist before calling read_skill.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: () => {
      // Return as a JSON-serialized string so the LLM can parse easily.
      return JSON.stringify(catalog, null, 2);
    },
  });
}

/**
 * Build the `read_skill` tool — activates a skill for the next
 * iteration. The LLM picks WHICH skill via the `id` argument.
 *
 * Tool execute() returns a confirmation string. The actual bookkeeping
 * (appending the requested skill id to `scope.activatedInjectionIds`)
 * is handled by the Agent's tool-calls subflow, which inspects every
 * `read_skill` tool call by name. The next iteration's InjectionEngine
 * matches Skills with `trigger.kind: 'llm-activated'` by id and
 * includes them in the active set; slot subflows then inject the body
 * + tools.
 *
 * The tool's description lists each Skill's `id` + `description` so
 * the LLM can choose meaningfully without first calling `list_skills`
 * (a perf trade-off — small registries can afford the inline catalog;
 * large ones should use `list_skills` for discovery and rely on the
 * shorter `read_skill` description.) See `surfaceMode` (Block A4) for
 * tunable trade-offs.
 *
 * Returns `undefined` when there are no skills — callers should
 * guard or filter undefined out of their tool list.
 */
export function buildReadSkillTool(skills: readonly Injection[]): Tool | undefined {
  if (skills.length === 0) return undefined;

  const skillIds = skills.map((s) => s.id);
  const skillCatalog = skills
    .map((s) => `  - ${s.id}: ${s.description ?? '(no description)'}`)
    .join('\n');

  return defineTool<{ id: string }, string>({
    name: 'read_skill',
    description:
      `Activate a skill for the next iteration. Available skills:\n${skillCatalog}\n\n` +
      `Pass the skill's id. The skill's body becomes part of the system prompt and any ` +
      `gated tools become available on the next call.`,
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          enum: skillIds,
          description: 'The skill id to activate.',
        },
      },
      required: ['id'],
    },
    execute: ({ id }) => {
      if (!skillIds.includes(id)) {
        return `Unknown skill '${id}'. Available: ${skillIds.join(', ')}`;
      }
      return `Skill '${id}' activated for the next iteration.`;
    },
  });
}

/**
 * The pair returned by `SkillRegistry.toTools()`. Either entry may be
 * undefined when the registry is empty. Consumers typically destructure:
 *
 *   const { listSkills, readSkill } = registry.toTools();
 *   const tools = [listSkills, readSkill, ...other].filter(Boolean) as Tool[];
 */
export interface SkillToolPair {
  /** The `list_skills` tool, or `undefined` if registry is empty. */
  readonly listSkills: Tool | undefined;
  /** The `read_skill` tool, or `undefined` if registry is empty. */
  readonly readSkill: Tool | undefined;
}
