/**
 * Skill-tool ADAPTERS — the one place the graph's tool DESCRIPTIONS become
 * agentfootprint `Tool`s.
 *
 * `list_skills`, `read_skill` and `skip_step` are described — name, schema,
 * every sentence the model reads — by the pure skill-graph core
 * (`skillToolDescriptors.ts`, `skillSteps.ts`). This module does the last
 * step: hands each descriptor to `defineTool`. That split (9.34.0) is what
 * keeps `read_skill`'s grammar, which is genuinely the graph's — the enum is
 * the catalog, the description is the reachability offer, the result is what
 * the model learns about the skill it activated — out of a module that has to
 * import the framework's tool factory, and therefore out of everything that
 * factory pulls in (artifacts, credentials, check-in, tool sessions).
 *
 * Both tool pairs work over the SAME catalog (a list of `Injection` skills),
 * used by the Agent's auto-attach path AND by `SkillRegistry.toTools()`
 * (explicit composition path). Pulling them out of `core/Agent.ts` removed
 * the v2.4 duplication risk: the Agent auto-attaches its own `read_skill`,
 * the registry builds a sibling — they MUST agree on schema + execute
 * semantics, and now they cannot disagree because neither writes the words.
 *
 * Tool execute is identity-style (returns a confirmation string); the agent's
 * tool-calls subflow inspects the tool name + args and updates
 * `scope.activatedInjectionIds` so the next iteration's InjectionEngine sees
 * the new activation.
 *
 * Zone: HOST. Importing `core/tools.js` here is the point of the file.
 */

import { defineTool } from '../../core/tools.js';
import type { Tool } from '../../core/tools.js';
import { skipStepDescriptor } from './skillSteps.js';
import {
  listSkillsDescriptor,
  readSkillDescriptor,
  type ReadSkillOffer,
} from './skillToolDescriptors.js';
import type { Injection } from './types.js';

// The offer shape is the graph's (it describes reachability), but it was
// declared here through 9.33.x — keep the name importable from both.
export type { ReadSkillOffer } from './skillToolDescriptors.js';

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
  const d = listSkillsDescriptor(skills);
  if (!d) return undefined;
  return defineTool<Record<string, never>, string>({
    name: d.name,
    description: d.description,
    inputSchema: d.inputSchema,
    execute: (args) => d.execute(args),
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
 *
 * Pass `offer` to scope the DESCRIPTION to what the graph's gate will actually
 * grant from the current cursor (8.5.0); the enum stays the full catalog either
 * way. Omit it and the tool is byte-identical to what it has always been.
 */
export function buildReadSkillTool(
  skills: readonly Injection[],
  offer?: ReadSkillOffer,
): Tool | undefined {
  const d = readSkillDescriptor(skills, offer);
  if (!d) return undefined;
  return defineTool<{ id: string }, string>({
    name: d.name,
    description: d.description,
    inputSchema: d.inputSchema,
    execute: (args) => d.execute(args),
  });
}

/**
 * Build the `skip_step` tool. Auto-attached to the dispatch registry when
 * ≥1 registered skill declares steps (the `read_skill` auto-attach seam) —
 * always dispatchable, but OFFERED (schema in the request) only while a
 * stepped tenure is active and unfinished. Its execute returns a
 * placeholder; the tool-calls stage overwrites the model-visible result
 * with the authoritative sentence, exactly as the skill-graph gate
 * overwrites `read_skill` refusals — bookkeeping lives where the batch
 * order lives.
 *
 * Lived in `skillSteps.ts` through 9.33.x; moved here in 9.34.0 so that
 * module — the procedure GRAMMAR — stops importing the tool factory. The
 * sentences it speaks are still `skillSteps.ts`'s
 * ({@link skipStepDescriptor}); only the wrapping moved.
 */
export function buildSkipStepTool(): Tool {
  const d = skipStepDescriptor();
  return defineTool<{ reason: string }, string>({
    name: d.name,
    description: d.description,
    inputSchema: d.inputSchema,
    execute: (args) => d.execute(args),
  }) as unknown as Tool;
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
