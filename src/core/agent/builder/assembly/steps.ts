import { isDevMode } from 'footprintjs';
import type { Injection, InjectionContext } from '../../../../injection-engine/types.js';
import {
  defineStepsHint,
  STEPS_HINT_METADATA_KEY,
} from '../../../../injection-engine/factories/defineStepsHint.js';
import { foldStepPlans } from '../../../../injection-engine/skillSteps.js';
import type { AgentOptions } from '../../types.js';
export interface StepsPort {
  readonly opts: AgentOptions;
  skillGraphIsTree: boolean;
  skillGraphEdgeTargets?: readonly string[];
  skillGraphNextSkill?: (ctx: InjectionContext) => string | undefined;
}

export function checkSteps(
  self: StepsPort,
  injections: Injection[],
  opts: AgentOptions,
): Injection[] {
  // ── Steps-as-data check-up + advisory (9.18.0) ─────────────────────
  // Judged on the FINAL injection list (the delivery-refusal reasoning:
  // skills arrive through `.skill()`, `.skillGraph()`, `.skills()` and
  // `.selfExplain()`, and only this line sees all of them). Nothing here
  // runs for an agent without a stepped skill.
  const stepPlans = foldStepPlans(injections);
  if (stepPlans.size > 0) {
    // Classic caches the tools slot after turn 1, so the per-step
    // narrowing and the banner would FREEZE at whatever step was current —
    // sequence enforcement that stops tracking the sequence. Refused, the
    // classic+graph sentence pattern (9.16.0).
    if (self.opts.reactMode === 'classic') {
      const ids = [...stepPlans.keys()].join("', '");
      throw new Error(
        `Agent.build(): reactMode 'classic' cannot honor \`steps\` (declared by '${ids}'). ` +
          `Classic composes the tools slot once on turn 1, so the per-step narrowing and ` +
          `the step banner would freeze at the first step while the procedure moved on — ` +
          `the offer would enforce a sequence it stopped tracking. Use the default ` +
          `'dynamic' mode (or 'dynamic-grouped'), which recomposes the slots every ` +
          `iteration, or drop \`steps\`.`,
      );
    }
    // A decision .tree() never writes a cursor (per-iteration predicate
    // routing — skillGraph's resolver stays the no-op there), and a step
    // procedure's tenure begins only under the cursor. A stepped tree
    // LEAF would slip past the wiring check below — its compiled trigger
    // is 'rule' and it has a predicate edge, so the open-skill clause
    // never fires — and then activate with its FULL toolset: no pointer,
    // no narrowing, no banner, no skip_step, no step event, nothing
    // saying why (accepted-and-silently-wrong, the cardinal sin). Same
    // fate for a stepped skill registered BESIDE the tree: no cursor
    // exists anywhere on a tree agent. Refused for all of them, the
    // continuity×tree sentence pattern (9.17.0).
    if (self.skillGraphIsTree) {
      const ids = [...stepPlans.keys()].join("', '");
      throw new Error(
        `Agent.build(): a decision .tree() cannot honor \`steps\` (declared by '${ids}'). ` +
          `A tree routes by predicate on every iteration and never writes a cursor, and ` +
          `a step procedure's tenure begins only under the cursor — the steps would ` +
          `never engage: no pointer, no narrowing, no banner, no step event. Use the ` +
          `flat entry/route form, register the skill on an agent without a graph, or ` +
          `drop \`steps\`.`,
      );
    }
    const edgeTargets = new Set(self.skillGraphEdgeTargets ?? []);
    for (const [skillId] of stepPlans) {
      const skill = injections.find((i) => i.id === skillId);
      if (!skill) continue;
      if (self.skillGraphNextSkill !== undefined) {
        // A graph is mounted: the tenant is the CURSOR, and the cursor
        // never lands on an OPEN skill (llm-activated + no incoming edge —
        // `Agent.openSkillIds`'s two clauses). Steps on one would activate
        // a body whose procedure never engages: no pointer, no narrowing,
        // no banner, no event, nothing saying why. Refused instead
        // (accepted-and-silently-wrong is the cardinal sin).
        const isOpen = skill.trigger.kind === 'llm-activated' && !edgeTargets.has(skillId);
        if (isOpen) {
          throw new Error(
            `Agent.build(): skill '${skillId}' declares \`steps\`, but the mounted skill ` +
              `graph does not wire it (no entry, no route edge) — it is an OPEN skill, ` +
              `activated by read_skill without ever receiving the cursor, and a step ` +
              `procedure's tenure begins only under the cursor. Its steps would never ` +
              `engage. Wire it into the graph (an entry or a route), register it on an ` +
              `agent without a graph, or drop \`steps\`.`,
          );
        }
      } else if (skill.trigger.kind !== 'llm-activated') {
        // No graph: the tenant is the most recent read_skill activation
        // (the tail of activatedInjectionIds), and ONLY read_skill writes
        // that array — a rule/always-triggered skill would never tenure.
        throw new Error(
          `Agent.build(): skill '${skillId}' declares \`steps\`, but its trigger is ` +
            `'${skill.trigger.kind}' and this agent mounts no skill graph — without a ` +
            `cursor, a procedure's tenure begins at a read_skill activation, which only ` +
            `an 'llm-activated' skill ever gets. Use defineSkill (its trigger is ` +
            `llm-activated), mount a graph that routes to it, or drop \`steps\`.`,
        );
      }
    }
    // Warn about an iteration budget too small for the declared procedure.
    if (isDevMode()) {
      const effectiveMax = opts.maxIterations ?? 10;
      for (const plan of stepPlans.values()) {
        // Warn, not refuse: adjacent same-tool steps can advance twice in
        // one batch, so a tight budget CAN still complete a procedure.
        if (plan.steps.length + 1 > effectiveMax) {
          // eslint-disable-next-line no-console
          console.warn(
            `agentfootprint Agent: skill '${plan.skillId}' declares ${plan.steps.length} ` +
              `steps but maxIterations is ${effectiveMax} — the procedure cannot complete ` +
              `in one turn unless steps share a batch. Raise maxIterations, or expect ` +
              `steps_unfinished { action: 'cut-short' } on the record.`,
          );
        }
      }
    }
    // The steps advisory (the menu-hint pattern, one block up): a narrowed
    // offer with no explanation would be sequence enforcement the model was
    // never told about. Marker-detected, so a consumer's own hint (any id)
    // stands the default down.
    if (
      !injections.some(
        (i) => (i.metadata as Record<string, unknown> | undefined)?.[STEPS_HINT_METADATA_KEY],
      )
    ) {
      injections = [...injections, defineStepsHint()];
    }
  }
  return injections;
}
