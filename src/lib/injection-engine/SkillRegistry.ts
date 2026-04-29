/**
 * SkillRegistry — centralized governance for Skills across one or
 * more Agents.
 *
 * Most apps register Skills directly on the Agent via `.skill(s)`.
 * Once you have multiple Agents that share a common skill catalog
 * (a customer-support pool, a research team, a multi-step workflow
 * where each step uses different overlapping skills), hand-syncing
 * `.skill()` calls per Agent gets fragile.
 *
 * `SkillRegistry` is the answer: register once, attach to many
 * Agents via `.skills(registry)`. Add a Skill to the registry and
 * every consumer Agent picks it up at next build.
 *
 * @example
 *   const registry = new SkillRegistry();
 *   registry.register(billingSkill);
 *   registry.register(refundSkill);
 *
 *   const supportAgent = Agent.create({ provider }).skills(registry).build();
 *   const escalationAgent = Agent.create({ provider }).skills(registry).build();
 *
 *   // Add a new skill — both agents pick it up at next build.
 *   registry.register(complianceSkill);
 */

import type { Injection } from './types.js';
import {
  buildListSkillsTool,
  buildReadSkillTool,
  type SkillToolPair,
} from './skillTools.js';

export class SkillRegistry {
  private readonly skills = new Map<string, Injection>();

  /**
   * Register a skill. Throws if `skill.flavor !== 'skill'` or if a
   * skill with the same id is already registered (use `.replace(...)`
   * to overwrite intentionally).
   */
  register(skill: Injection): this {
    if (skill.flavor !== 'skill') {
      throw new Error(
        `SkillRegistry.register: expected a Skill (flavor: 'skill'), got flavor: '${skill.flavor}' (id: '${skill.id}'). Use defineSkill(...) to construct.`,
      );
    }
    if (this.skills.has(skill.id)) {
      throw new Error(
        `SkillRegistry.register: skill '${skill.id}' is already registered. Use .replace('${skill.id}', skill) to overwrite.`,
      );
    }
    this.skills.set(skill.id, skill);
    return this;
  }

  /** Replace an existing skill by id. Throws if id is not registered. */
  replace(id: string, skill: Injection): this {
    if (!this.skills.has(id)) {
      throw new Error(
        `SkillRegistry.replace: no skill registered at '${id}'. Use .register(...) for new skills.`,
      );
    }
    if (skill.flavor !== 'skill') {
      throw new Error(
        `SkillRegistry.replace: expected a Skill (flavor: 'skill'), got '${skill.flavor}'.`,
      );
    }
    if (skill.id !== id) {
      throw new Error(
        `SkillRegistry.replace: skill.id ('${skill.id}') does not match the slot id ('${id}'). Either use .register(...) for the new id or pass a skill with the matching id.`,
      );
    }
    this.skills.set(id, skill);
    return this;
  }

  /** Remove a skill by id. No-op if not registered. */
  unregister(id: string): this {
    this.skills.delete(id);
    return this;
  }

  /** Look up by id. Returns undefined if not registered. */
  get(id: string): Injection | undefined {
    return this.skills.get(id);
  }

  /** True iff a skill with the given id is registered. */
  has(id: string): boolean {
    return this.skills.has(id);
  }

  /** All registered skills. Order matches registration order. */
  list(): readonly Injection[] {
    return [...this.skills.values()];
  }

  /** Number of registered skills. */
  get size(): number {
    return this.skills.size;
  }

  /** Drop all registrations. */
  clear(): void {
    this.skills.clear();
  }

  /**
   * Materialize the LLM-facing skill discovery tools from the current
   * registry contents. Returns `{ listSkills, readSkill }`:
   *
   *   - `list_skills` — no-arg tool the LLM calls to enumerate
   *     `{ id, description }` for every registered skill. Lets the
   *     LLM discover skills without paying the prompt-token cost of
   *     a static catalog in the system prompt.
   *
   *   - `read_skill({ id })` — activates the named skill for the
   *     NEXT iteration. The Agent's tool-calls subflow inspects this
   *     tool call by name and updates `scope.activatedInjectionIds`
   *     so the InjectionEngine on iter N+1 includes the skill in the
   *     active set (body lands in the system slot; gated tools land
   *     in the tools slot).
   *
   * Both entries are `undefined` when the registry is empty — filter
   * before adding to a tool list:
   *
   *   const { listSkills, readSkill } = registry.toTools();
   *   const tools = [listSkills, readSkill, ...other].filter(Boolean) as Tool[];
   *
   * Composes with `gatedTools` from `agentfootprint/tool-providers`
   * so PermissionPolicy can scope which roles see the skill discovery
   * surface.
   *
   * @returns A `SkillToolPair` (`{ listSkills, readSkill }`).
   */
  toTools(): SkillToolPair {
    const skills = this.list();
    return {
      listSkills: buildListSkillsTool(skills),
      readSkill: buildReadSkillTool(skills),
    };
  }
}
