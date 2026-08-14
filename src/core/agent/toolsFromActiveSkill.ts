/**
 * toolsFromActiveSkill — the AGENT-level tool posture (9.36.0).
 *
 * Pattern: pure fold over the final injection list, run once at `Agent.build()`.
 * Role:    core/ layer. One declaration replaces a per-skill discipline.
 * Emits:   nothing. It changes what the OFFER contains, and the tools slot
 *          already records every offered tool and the skill that unlocked it.
 *
 * ── The defect this exists for ───────────────────────────────────────────
 * `buildToolRegistry` pre-loads a skill's `inject.tools` into the STATIC
 * registry unless that skill declared `autoActivate: 'currentSkill'`. Static
 * means on the wire from iteration 1, whatever the cursor says. So "only the
 * active skill's tools are offered" was a promise you had to keep on EVERY
 * skill, one field at a time, and the first skill you forgot leaked its tools
 * for the life of the agent — silently, because a tool that is offered too
 * early looks exactly like a tool that is offered.
 *
 * A skill graph can already say it once for the skills it WIRES
 * (`skillGraph({ scopeTools: true })`, which stamps the same field at graph
 * compile). Three kinds of skill fall outside that: a skill the graph lists
 * but never routes to, a skill registered beside the graph, and every skill on
 * an agent with no graph at all — including a whole directory loaded through
 * `skillsFromDir`. This is the same decision made where every skill is in
 * hand: at the agent.
 *
 * ── Why it stamps the shipped field instead of adding a second gate ──────
 * The alternative was a flag threaded into `buildToolRegistry`. That would
 * have created TWO ways for a tool to be held out, and only one of them
 * visible to everyone else who asks the question: `ActiveInjection.autoActivate`
 * (which the boundary projects), a consumer's own `ToolProvider`, a lens
 * drawing the graph, `warnRedundantSkillScopedTools`. Stamping the declared
 * field keeps ONE mechanism and one answer.
 *
 * ── Which wins: the per-skill flag or the agent posture ──────────────────
 * Neither overrides the other, because they cannot disagree. `autoActivate`
 * has exactly one legal value (`'currentSkill'`), so a skill can ask to be
 * scoped and cannot ask to be exempt. The stamp is `existing ?? 'currentSkill'`
 * — a DEFAULT, never an override — the same sentence `skillGraph`'s
 * `scopeTools` already lives by. The result is monotone: turning the posture
 * on can only ever REMOVE tools from the static registry, never add one.
 */

import type { Injection } from '../../lib/injection-engine/types.js';

/** The one legal `autoActivate` mode — see `AutoActivateMode` in defineSkill. */
const CURRENT_SKILL = 'currentSkill';

/**
 * Stamp `autoActivate: 'currentSkill'` on every skill that carries tools and
 * has not already declared the field.
 *
 * Only skills WITH tools are touched: `autoActivate` says where a skill's
 * tools appear, and a skill with none has nothing to say — stamping it would
 * put a field on the record that decides nothing, which is exactly the kind of
 * metadata a reader later has to disprove.
 *
 * Called only from `Agent.build()` and only under the opt-in, so an agent that
 * never asks for it never runs this code.
 */
export function scopeToolsToActiveSkill(injections: readonly Injection[]): Injection[] {
  return injections.map((injection) => {
    if (injection.flavor !== 'skill') return injection;
    const tools = injection.inject.tools;
    if (!tools || tools.length === 0) return injection;
    const declared = (injection.metadata as { autoActivate?: string } | undefined)?.autoActivate;
    if (declared !== undefined) return injection; // a default, never an override
    // Frozen like `defineSkill`'s own output: the injection list handed to the
    // Agent is read by the engine, the slots and every recorder, and a copy
    // that is mutable where the original was not is a copy that drifts.
    return Object.freeze({
      ...injection,
      metadata: Object.freeze({ ...injection.metadata, autoActivate: CURRENT_SKILL }),
    }) as Injection;
  });
}
