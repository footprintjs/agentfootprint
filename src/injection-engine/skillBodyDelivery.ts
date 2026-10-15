/**
 * Where a skill's BODY actually lands — and the one combination where the honest
 * answer is "nowhere" (8.5.0).
 *
 * `surfaceMode` names a delivery CHANNEL, and `'tool-only'` names the channel that
 * only exists when the model calls `read_skill`: the body is returned as that tool's
 * result, and the system slot suppresses it by design (`buildSystemPromptSlot`,
 * mirrored in `routeActiveInjections`). That is exactly right for a skill `read_skill`
 * activates, which is what the mode was designed against and what every shipped
 * Block-C test covers.
 *
 * It is a hole for a skill the GRAPH activates. A route target, a flat entry and a
 * decision-tree leaf all activate off the cursor, without any `read_skill` call — so
 * the tool result never happens, the system slot suppresses the body anyway, and the
 * body reaches the model through no channel at all. The skill's TOOLS still arrive,
 * which makes it worse than the skill not loading: the model is handed the tools of a
 * procedure it was never told.
 *
 * The rule that closes it is the one 8.4.0 already uses for the `read_skill` gate:
 * `trigger.kind === 'llm-activated'` is precisely "read_skill can really activate
 * this". A skill may claim the read_skill delivery channel exactly when read_skill is
 * what activates it.
 *
 * Refusal rather than a quiet fall back to the system slot, because the author wrote
 * `'tool-only'` to keep the body OUT of the system prompt (token cost, attention
 * placement). Silently putting it back would honour the activation and break the
 * declaration — a different lie, not a fix. `'both'` already means "deliver it either
 * way", so the refusal has a real, one-word answer to name.
 */

import type { Injection } from './types.js';
import { resolveSurfaceMode, type SurfaceMode } from './factories/defineSkill.js';

/** A skill's declared surface mode, before any provider resolution. */
function declaredSurfaceModeOf(skill: Injection): SurfaceMode {
  const meta = skill.metadata as { surfaceMode?: SurfaceMode } | undefined;
  return meta?.surfaceMode ?? 'auto';
}

/**
 * The surface mode a skill will be TREATED as at runtime.
 *
 * Today the runtime compares the literal string, so `'auto'` is its own mode and
 * lands in the system slot — pass no provider and that is what you get back, which
 * is the truth about the current engine.
 *
 * Pass a provider (and model) to ask the OTHER question: what would `'auto'` become
 * if the `resolveSurfaceMode` cascade were wired into the runtime? It resolves to
 * `'tool-only'` for every non-Claude provider, so wiring it in without this guard
 * would silently open the delivered-nowhere hole for every OpenAI / Bedrock / Ollama
 * user at once. Routing both questions through ONE function is what keeps that from
 * being a future accident: the refusal below is written against this, so the day the
 * cascade is wired in, the guard already covers it.
 */
export function resolvedSurfaceModeOf(
  skill: Injection,
  provider?: string,
  model?: string,
): SurfaceMode {
  const declared = declaredSurfaceModeOf(skill);
  if (declared !== 'auto' || provider === undefined) return declared;
  return resolveSurfaceMode(provider, model);
}

/**
 * Can this skill's body be delivered through the `read_skill` tool result?
 *
 * Only if `read_skill` is what activates it. `'llm-activated'` is the one trigger
 * kind that reads `activatedInjectionIds`, which is the only thing a `read_skill`
 * call writes — the same clause the gate's open-skill rule turns on (8.4.0).
 */
export function activatesByRead(skill: Injection): boolean {
  return skill.trigger.kind === 'llm-activated';
}

/** How a refused skill is identified back to its author, so a directory-sized
 *  refusal reads as a list of names and reasons rather than one mystery. */
function describeRouting(skill: Injection): string {
  const routing = (skill.metadata as { skillGraph?: { via?: string; from?: string } } | undefined)
    ?.skillGraph;
  if (routing?.via === 'route') {
    return routing.from
      ? `a route target (the graph routes "${routing.from}" → "${skill.id}")`
      : 'a route target';
  }
  if (routing?.via === 'entry') return 'a graph entry';
  if (routing?.via === 'tree') return 'a decision-tree leaf';
  return `activated by rule (trigger '${skill.trigger.kind}')`;
}

/**
 * Refuse every skill that claims the `read_skill` delivery channel without being
 * activated by `read_skill`. Returns the message, or `undefined` when all is well.
 *
 * Runs over the FINAL injection list — the agent is the only place that sees every
 * skill's compiled trigger, whichever call registered it — and names every offender,
 * because `skillsFromDir({ surfaceMode: 'tool-only' })` under a graph refuses a whole
 * directory at once and a list is debuggable where one sample is not.
 */
export function toolOnlyDeliveryRefusal(injections: readonly Injection[]): string | undefined {
  const offenders = injections.filter(
    (i) =>
      i.flavor === 'skill' &&
      resolvedSurfaceModeOf(i) === 'tool-only' &&
      !activatesByRead(i) &&
      (i.inject.systemPrompt ?? '').length > 0,
  );
  if (offenders.length === 0) return undefined;

  const list = offenders.map((s) => `  • "${s.id}" — ${describeRouting(s)}`).join('\n');
  const subject = offenders.length === 1 ? 'This skill sets' : 'These skills set';
  const its = offenders.length === 1 ? 'its' : 'their';
  return (
    `Agent: ${subject} surfaceMode: 'tool-only', which delivers the body as the ` +
    `read_skill tool result — but nothing here activates by read_skill, so ${its} ` +
    `body would reach the model NOWHERE: the system slot suppresses a tool-only body ` +
    `by design, and no read_skill call happens to carry it.\n${list}\n` +
    `Use 'both' (system prompt AND tool result) or 'system-prompt'. Only a skill ` +
    `read_skill actually activates — trigger 'llm-activated', which is every skill a ` +
    `graph does not route — can be 'tool-only'.`
  );
}
