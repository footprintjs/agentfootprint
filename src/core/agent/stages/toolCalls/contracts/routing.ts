import type { StepPlanFor } from '../../../../../injection-engine/skillSteps.js';

/** The routing dependencies of the existing tool-call stage. */
export interface ToolRoutingPort {
  /**
   * Skill-graph read_skill GATE (`graph.reachableSkills`). When present, a
   * `read_skill('id')` whose `id` is not reachable from the current cursor is
   * REJECTED — the model gets a synthetic re-prompt naming the allowed ids and
   * the cursor/activations stay unchanged, so it can't leave the graph mid-run.
   * Undefined → no gate (plain read_skill agents append as before).
   */
  readonly allowedSkillIds?: (currentSkillId?: string) => readonly string[];
  /**
   * The OPEN skills — registered skills the graph never wires, admitted by the gate
   * from ANY cursor (8.4.0; see `Agent.openSkillIds`). They ACTIVATE and never move
   * the cursor: a skill the graph does not route is not a node, so it cannot be a
   * hop. Only meaningful alongside `allowedSkillIds`.
   */
  readonly openSkillIds?: readonly string[];
  /**
   * The mount kernel's plan (9.59.0) — present only on agents built with
   * `.maps()`. Read for exactly one thing: to tell a cursor move from a
   * RE-ENGAGEMENT at the gate below. Everything else about engagement stays
   * the kernel's business.
   */
  readonly engagementPlan?: import('../../../../../maps/engagement/types.js').EngagementPlan;
  /**
   * Is the mounted graph a decision `tree()`? Changes only the REFUSAL TEXT (8.5.0).
   *
   * A tree routes by predicate every iteration and has no cursor, so
   * `reachableSkills()` is empty and every leaf pick is refused. Told with the
   * generic message that reads "No skills are reachable from here", which is true
   * but teaches nothing — the model would keep trying. The tree-shaped message says
   * why the graph cannot be jumped at all, so the model stops asking and answers.
   */
  readonly skillGraphIsTree?: boolean;
  /**
   * The frozen step plans, keyed by skill id (9.18.0) — set only when ≥1
   * registered skill declares `steps`. This stage owns the pointer's two
   * RESULT-BOUNDARY moves, applied at EVERY site a result becomes final and
   * is pushed (the batch loop AND all the pausable resume paths — a step
   * whose tool paused, an `askHuman` step first among them, must advance on
   * the resumed call exactly as it would have inline):
   *
   *   • ADVANCE — the finalized call is the current step's tool, ran, and
   *     was not an error/denial/refusal → pointer + 1, `step_advanced`, and
   *     the model-visible result gains the "now on step k+1" suffix
   *     (composed BEFORE the history push — one past, no splicing).
   *   • SKIP — a `skip_step` call: reason validated (empty → teaching
   *     result, no event), `step_skipped` emitted, pointer moved or held
   *     per the skill's declared `onSkip`, and the model-visible result is
   *     OVERWRITTEN with the authoritative sentence (the read_skill-refusal
   *     precedent — bookkeeping lives where the batch order lives).
   *
   * Postures never gate `skip_step`: skipping is judgment INSIDE a step,
   * not routing. Undefined → no stepped skill anywhere; not one new line
   * runs (zero-cost-when-unused).
   */
  readonly stepPlanFor?: StepPlanFor;
  /**
   * The mount's routing POSTURE beyond reachability (SG-C `strictness`).
   * Undefined = `'assist'` = today's gate, byte-for-byte — not one new line
   * runs. Judged AFTER reachability (an unreachable pick keeps its original
   * teaching refusal), and only on HOPS — an OPEN skill (`.selfExplain()`,
   * a `.skill()` beside the graph) is admitted from anywhere under every
   * posture, so debugging never breaks:
   *   • `'guard'` — a routing pick is admitted only while the turn's MENU is
   *     outstanding AND names an offered id (the framework declared the
   *     ambiguity; the model resolves exactly that). Off-menu / no-menu picks
   *     get a teaching refusal + `skill.rejected { posture: 'guard' }`.
   *   • `'rails'` — routing picks are refused outright: rules/scorer resolve
   *     turn starts, declared routes handle transitions.
   * Same graph, same trace: postures change refusal behavior only.
   *
   * Read only by the `read_skill` gate below, and that is the whole scope:
   * `applyToolEffects` never consults it, because a `propose-transition`
   * comes from a tool — the author's own code — and is admitted under every
   * posture against reachability alone. See `SkillGraphOptions.strictness`
   * (builder/graph/options.ts), which states the exemption for authors.
   */
  readonly skillStrictness?: 'guard' | 'rails';
  /**
   * Escalate-on-evidence (9.19.0). When declared, the two `skill.rejected`
   * emit sites below increment a per-turn counter; at `afterRefusals` the
   * rest of the turn flips onto the escalation brain (`scope.skillEscalated`
   * — a committed fact callLLM's `brainFor` reads) and `skill.escalated`
   * goes on the record ONCE. Undefined — the default — and not one new key
   * is read or written (zero-cost-when-unused).
   */
  readonly escalation?: {
    readonly afterRefusals: number;
    /** The declared escalation brain, for the event's `to`. */
    readonly to: { readonly provider: string; readonly model?: string };
    /** Resolve the brain that WAS serving (the event's honest `from`) — the
     *  same precedence chain callLLM applies, evaluated at the flip. */
    readonly describeFrom: (
      cursor: string | undefined,
      resolvedModel: string | undefined,
    ) => { readonly provider: string; readonly model: string };
  };
  /**
   * The registered injection ids a `require-instruction` tool effect may
   * push, with the one fact its check-up needs (9.19.0): a skill whose
   * declared body channel is `'tool-only'` cannot be pushed through the
   * system slot — the slot suppresses it — so granting the lease would be
   * accepted-and-silently-undelivered. Undefined → the agent registered no
   * injections; every require-instruction is a teaching refusal.
   */
  readonly leaseTargets?: ReadonlyMap<string, { readonly surfaceMode?: string }>;
}
