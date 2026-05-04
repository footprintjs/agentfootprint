/**
 * Agent validators — pure helper functions extracted from Agent.ts.
 *
 * These run at Agent construction time (eagerly, so misconfiguration
 * fails fast at `.build()`) and during stage execution (safeStringify
 * for tool-result formatting).
 *
 * Pure functions, no class state — extracted for readability and
 * isolated testability. The Agent class imports + invokes these in
 * its constructor and stage handlers.
 */

import type { MemoryDefinition } from '../../memory/define.types.js';
import type { Injection } from '../../lib/injection-engine/types.js';
import type { Tool, ToolRegistryEntry } from '../tools.js';

/**
 * Validate that every memory definition has a unique id. Each memory
 * writes to its own scope key (`memoryInjection_${id}`); duplicates
 * silently overwrite, leading to data loss that's hard to debug.
 *
 * Throws on collision so `Agent.build()` fails fast at construction.
 */
export function validateMemoryIdUniqueness(memories: readonly MemoryDefinition[]): void {
  const seen = new Set<string>();
  for (const m of memories) {
    if (seen.has(m.id)) {
      throw new Error(
        `Agent: duplicate memory id '${m.id}'. Each memory needs a unique id to keep ` +
          'its scope key (`memoryInjection_${id}`) collision-free.',
      );
    }
    seen.add(m.id);
  }
}

/**
 * Clamp `maxIterations` to a safe range. The lower bound (1) prevents
 * a 0-iteration agent (no LLM calls = no work); the upper bound (50)
 * prevents runaway loops in misconfigured agents.
 */
export function clampIterations(n: number): number {
  if (!Number.isInteger(n) || n < 1) return 1;
  if (n > 50) return 50;
  return n;
}

/**
 * Validate tool-name uniqueness across `.tool()`-registered tools +
 * every Skill's `inject.tools[]`. The LLM dispatches by `tool.schema.name`
 * (the wire format), so any collision silently shadows execution.
 *
 * Called eagerly in the Agent constructor so `Agent.build()` throws
 * immediately, not on first `run()`.
 *
 * `read_skill` is reserved when ≥1 Skill is registered — collisions
 * with consumer tools throw.
 */
export function validateToolNameUniqueness(
  registry: readonly ToolRegistryEntry[],
  injections: readonly Injection[],
): void {
  // Static registry: unique within itself. The Agent.tool() builder
  // method already throws on per-call duplicates; this is the
  // belt-and-suspenders check at build time.
  const staticNames = new Set<string>();
  for (const entry of registry) {
    if (staticNames.has(entry.name)) {
      throw new Error(
        `Agent: duplicate tool name '${entry.name}' in .tool() registry. ` +
          `Tool names must be unique within the static registry.`,
      );
    }
    staticNames.add(entry.name);
  }

  // `read_skill` is reserved when any Skill is registered. Collisions
  // with consumer-supplied tools break the auto-attach path.
  const skills = injections.filter((i) => i.flavor === 'skill');
  if (skills.length > 0 && staticNames.has('read_skill')) {
    throw new Error(
      `Agent: tool name 'read_skill' is reserved when ≥1 Skill is registered. ` +
        `Rename your custom 'read_skill' tool or unregister it.`,
    );
  }

  // Per-skill check: a skill's `inject.tools` array must be internally
  // unique (no duplicate names within the same skill — that's a
  // skill authoring bug). Across skills, sharing a Tool reference is
  // EXPECTED and supported — common tools (e.g., a `flogi_lookup`
  // used by multiple investigation skills) appear in multiple skills'
  // tool arrays. Only one skill is active at a time (or, when several
  // are active, deduped by name + reference at runtime). Sharing the
  // same Tool object across skills is the supported pattern; sharing
  // a Tool NAME with a DIFFERENT execute function is the actual bug —
  // we detect that here too.
  const seenByName = new Map<string, Tool>();
  for (const skill of skills) {
    const intraSkill = new Set<string>();
    for (const tool of skill.inject.tools ?? []) {
      const name = tool.schema.name;
      if (intraSkill.has(name)) {
        throw new Error(
          `Agent: skill '${skill.id}' lists tool '${name}' more than once in its ` +
            `inject.tools array. Each skill's tools must be unique within itself.`,
        );
      }
      intraSkill.add(name);
      // Skill tools collide with the static .tool() registry → ambiguous dispatch
      if (staticNames.has(name)) {
        throw new Error(
          `Agent: skill '${skill.id}' tool '${name}' collides with the static .tool() ` +
            `registry. Either rename the skill's tool or remove the static registration.`,
        );
      }
      // Same name across skills with DIFFERENT Tool objects = ambiguous when
      // both skills active. Same name + SAME Tool reference = supported sharing.
      const prior = seenByName.get(name);
      if (prior && prior !== (tool as unknown as Tool)) {
        throw new Error(
          `Agent: tool name '${name}' is declared by multiple skills with different ` +
            `Tool implementations. Skills MAY share the SAME Tool reference across ` +
            `their inject.tools arrays (deduped at dispatch); they may NOT register ` +
            `different functions under the same name (ambiguous dispatch).`,
        );
      }
      seenByName.set(name, tool as unknown as Tool);
    }
  }
}

/**
 * JSON.stringify with circular-ref protection. Tool results are untrusted —
 * a hostile/buggy tool returning a cyclic object must not crash the run.
 * Falls back to '[unstringifiable: <reason>]' so the LLM still sees that
 * the tool ran and produced something unusable.
 */
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return `[unstringifiable: ${reason}]`;
  }
}
