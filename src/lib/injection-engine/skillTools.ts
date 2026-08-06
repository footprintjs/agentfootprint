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
 * What the gate will ACTUALLY grant right now — the ids `read_skill` should be
 * offering, as opposed to the ids it can dispatch (8.5.0).
 *
 * Without this the tool enumerated every registered skill while the skill-graph gate
 * admitted only `reachableSkills(cursor) ∪ open`, so a route target the cursor cannot
 * reach was advertised on every iteration and refused on every call. The model was
 * being asked to choose from a menu the library knew it would reject.
 */
export interface ReadSkillOffer {
  /** Ids the gate will grant from the current cursor. */
  readonly grantable: readonly string[];
  /** Say the rest are refusable rather than hiding them. Hiding a skill it can see
   *  in `list_skills` (and in the enum) would just move the confusion; naming the
   *  boundary lets the model route around it in one step instead of guessing. */
  readonly showRefusable?: boolean;
}

/** Compose the tool description: one catalog, or the offer split in two. */
function describeOffer(
  skills: readonly Injection[],
  line: (s: Injection) => string,
  fullCatalog: string,
  offer?: ReadSkillOffer,
): string {
  const tail =
    `Pass the skill's id. The skill's body becomes part of the system prompt and any ` +
    `gated tools become available on the next call.`;
  if (!offer) {
    return `Activate a skill for the next iteration. Available skills:\n${fullCatalog}\n\n${tail}`;
  }
  const grantable = new Set(offer.grantable);
  const open = skills.filter((s) => grantable.has(s.id));
  const shut = skills.filter((s) => !grantable.has(s.id));
  const parts = [
    open.length > 0
      ? `Reachable from here:\n${open.map(line).join('\n')}`
      : 'Nothing is reachable from here — answer with the skill you are in, or finish.',
  ];
  if (offer.showRefusable !== false && shut.length > 0) {
    parts.push(
      `Not reachable from here (read_skill for these will be refused):\n${shut
        .map(line)
        .join('\n')}`,
    );
  }
  return `Activate a skill for the next iteration.\n\n${parts.join('\n\n')}\n\n${tail}`;
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
  if (skills.length === 0) return undefined;

  const skillIds = skills.map((s) => s.id);
  const line = (s: Injection): string => `  - ${s.id}: ${s.description ?? '(no description)'}`;
  const skillCatalog = skills.map(line).join('\n');

  // Index per-skill body + surfaceMode (Block C — runtime per-mode dispatch).
  // For 'tool-only' / 'both' surface modes, the read_skill tool result
  // CONTAINS the skill body (recency-first delivery). For 'system-prompt'
  // and 'auto', the result is a confirmation string only — the body
  // lands via system slot on the next iteration.
  type SkillEntry = { body: string; surfaceMode: string };
  const byId = new Map<string, SkillEntry>();
  for (const s of skills) {
    const meta = s.metadata as { surfaceMode?: string } | undefined;
    byId.set(s.id, {
      body: s.inject.systemPrompt ?? '',
      surfaceMode: meta?.surfaceMode ?? 'auto',
    });
  }

  return defineTool<{ id: string }, string>({
    name: 'read_skill',
    description: describeOffer(skills, line, skillCatalog, offer),
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          // The FULL catalog, always — deliberately NOT narrowed to the reachable
          // set (8.5.0). `toolArgValidation` defaults to `'enforce'` and runs BEFORE
          // the skill-graph gate, rejecting an off-enum id with a generic schema
          // error and `error = true`, which the gate then skips. Narrowing this
          // would silently retire the gate's teaching refusal, the
          // `agentfootprint.skill.rejected` event, `routeRecorder`'s rejection hops
          // and the rejected-cap governor's only input — four honesty mechanisms
          // traded for one. The OFFER is narrowed in the description instead, which
          // is what the model actually reads to choose.
          enum: skillIds,
          description: 'The skill id to activate.',
        },
      },
      required: ['id'],
    },
    execute: ({ id }) => {
      const entry = byId.get(id);
      if (!entry) {
        return `Unknown skill '${id}'. Available: ${skillIds.join(', ')}`;
      }
      // Block C — per-mode tool-result dispatch:
      //   - 'tool-only' / 'both' → return body verbatim (recency-first
      //     delivery; LLM sees it as the most recent tool result).
      //   - 'system-prompt' / 'auto' / unspecified → return confirmation
      //     only; body lands via system slot on the next iteration.
      if ((entry.surfaceMode === 'tool-only' || entry.surfaceMode === 'both') && entry.body) {
        return entry.body;
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
