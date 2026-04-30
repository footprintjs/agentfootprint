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
import { buildListSkillsTool, buildReadSkillTool, type SkillToolPair } from './skillTools.js';
import { resolveSurfaceMode, type SurfaceMode } from './factories/defineSkill.js';

/**
 * Options for `new SkillRegistry({...})`. All fields are optional;
 * the empty-object form (`new SkillRegistry()`) is the v2.4 surface.
 *
 * @see SkillRegistry.resolveForSkill — applies the cascade
 */
export interface SkillRegistryOptions {
  /**
   * Registry-level default `surfaceMode`. Applies to skills whose own
   * `surfaceMode` is `'auto'` (the `defineSkill` default). Per-skill
   * `surfaceMode` always wins; this is the fallback BEFORE the global
   * `resolveSurfaceMode(provider, model)` rule.
   *
   * Use case: a registry shared across agents pointed at the same
   * provider can lock surfaceMode here once instead of repeating it
   * on every `defineSkill`.
   */
  readonly surfaceMode?: SurfaceMode;

  /**
   * Provider name used as a hint when resolving `surfaceMode: 'auto'`
   * inside this registry. Most consumers don't set this — runtime code
   * passes the provider name into `resolveForSkill(skill, provider, model)`
   * directly. This field is for cases where the registry is composed
   * far from the agent (test fixtures, design-time inspectors).
   *
   * Match the provider's `name` field — `'anthropic'`, `'openai'`,
   * `'mock'`, etc.
   */
  readonly providerHint?: string;
}

export class SkillRegistry {
  private readonly skills = new Map<string, Injection>();
  private readonly opts: SkillRegistryOptions;

  /**
   * Construct an empty registry. Optional `{ surfaceMode, providerHint }`
   * fields set registry-level defaults; absent both, the registry is a
   * pure container (the v2.4 surface).
   */
  constructor(opts: SkillRegistryOptions = {}) {
    this.opts = Object.freeze({ ...opts });
  }

  /** Registry-level default `surfaceMode`, or `undefined` if unset. */
  get surfaceMode(): SurfaceMode | undefined {
    return this.opts.surfaceMode;
  }

  /** Registry-level provider hint, or `undefined` if unset. */
  get providerHint(): string | undefined {
    return this.opts.providerHint;
  }

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

  /**
   * Resolve the effective `surfaceMode` for a skill, applying the
   * cascade:
   *
   *   1. If the skill's own `metadata.surfaceMode` is concrete
   *      (`'system-prompt'` / `'tool-only'` / `'both'`), return it.
   *      Per-skill explicit choice always wins.
   *   2. Else if the registry was constructed with a concrete
   *      `surfaceMode`, return that.
   *   3. Else delegate to `resolveSurfaceMode(provider, model)` using
   *      the explicit `provider` arg (or `this.providerHint` if
   *      omitted). Falls back to `'tool-only'` when no provider is
   *      known.
   *
   * Forward-compat for Block C / v2.5 per-mode runtime routing: the
   * runtime calls this with the agent's provider + model to decide
   * how to materialize the skill's body into slots.
   *
   * Throws if the skill is not registered (catches typos at the
   * caller site rather than silently resolving against a stranger).
   *
   * @param skillOrId  A registered Skill `Injection` OR its `id`.
   * @param provider   Provider name override (wins over `providerHint`).
   * @param model      Model name for the per-provider attention rule.
   */
  resolveForSkill(
    skillOrId: Injection | string,
    provider?: string,
    model?: string,
  ): Exclude<SurfaceMode, 'auto'> {
    const skill = typeof skillOrId === 'string' ? this.get(skillOrId) : skillOrId;
    if (!skill) {
      const id = typeof skillOrId === 'string' ? skillOrId : skillOrId.id;
      throw new Error(`SkillRegistry.resolveForSkill: no skill registered at id '${id}'.`);
    }
    if (skill.flavor !== 'skill') {
      throw new Error(
        `SkillRegistry.resolveForSkill: '${skill.id}' has flavor '${skill.flavor}', expected 'skill'.`,
      );
    }

    const meta = skill.metadata as { surfaceMode?: SurfaceMode } | undefined;
    const skillMode = meta?.surfaceMode;
    if (skillMode && skillMode !== 'auto') return skillMode;

    if (this.opts.surfaceMode && this.opts.surfaceMode !== 'auto') {
      return this.opts.surfaceMode;
    }

    const effectiveProvider = provider ?? this.opts.providerHint ?? 'unknown';
    return resolveSurfaceMode(effectiveProvider, model) as Exclude<SurfaceMode, 'auto'>;
  }
}
