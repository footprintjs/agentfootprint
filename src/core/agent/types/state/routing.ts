import type { CacheMarker } from '../../../../cache/types.js';
import type { InstructionLease } from '../../../../injection-engine/leases.js';

export interface RoutingState {
  // ── Cache layer state (v2.6) ────────────────────────────────
  /** Provider-agnostic cache markers emitted by CacheDecision subflow.
   *  Cleared each iteration by the SkipCaching branch when the
   *  CacheGate decides to skip (kill switch / hit-rate / churn). */
  cacheMarkers: readonly CacheMarker[];
  /** Global cache kill switch from `Agent.create({ caching: 'off' })`. */
  cachingDisabled: boolean;
  /** Running cache hit rate from recent iterations (0..1). Computed
   *  by cacheRecorder (Phase 9); `undefined` until first metrics. */
  recentHitRate: number | undefined;
  /** Rolling window of active-skill IDs across recent iterations.
   *  Maintained by the UpdateSkillHistory function stage; consumed
   *  by CacheGate's skill-churn rule. */
  skillHistory: readonly (string | undefined)[];
  /** The skill-graph CURSOR — which skill node a `skillGraph()` agent is
   *  currently *in*, persisted across ReAct iterations. Advanced each iteration
   *  by the Injection Engine (`currentSkillId = graph.nextSkill(ctx)`) and
   *  carried by the mount mappers; reset to `undefined` per turn at seed (each
   *  turn re-enters via the entry router). `from`-gates the route triggers.
   *  Undefined for agents without a skill graph. */
  currentSkillId?: string;
  /** The `read_skill` pick the skill-graph gate ACCEPTED on this iteration — the
   *  model's own move through the graph. Written by the tool-calls stage EVERY
   *  iteration it runs (cleared when no pick was accepted), so it is one-shot by
   *  construction and can never re-apply a stale pick. Read by the Injection
   *  Engine, where it moves the cursor unless a declared edge fired first.
   *  Undefined for agents without a skill graph (the gate is what validates it). */
  pendingSkillPick?: string;
  /** The ADVANCED skill-graph cursor, inside `sf-llm-call` (the grouped
   *  chart): the Injection Engine's outputMapper writes it here because the
   *  boundary's `currentSkillId` is a readonly input still holding the
   *  previous iteration's value. The tools slot and callLLM's `brainFor`
   *  consult read `nextSkillCursor ?? currentSkillId`. In the flat chart the
   *  engine's outputMapper maps it straight onto `currentSkillId`, so this
   *  key never exists there — the same expression is correct in both shapes. */
  nextSkillCursor?: string;
  /** The relevance ranking of entry candidates from an entry scorer (`.entryBy()` /
   *  `.entryByRelevance()`) — written by the PickEntry stage once per turn (the
   *  "Why this skill?" relevance %). `score` is the raw strategy score; `relevance`
   *  the softmax share. Absent unless the graph used an entry scorer. */
  entryScores?: ReadonlyArray<{
    readonly id: string;
    readonly score: number;
    readonly relevance: number;
  }>;
  /** Name of the entry scorer that produced `entryScores` (`'keyword'` /
   *  `'embedding'` / a custom scorer's name). */
  entryScorer?: string;
  /** The turn-start routing verdict (SG-C) — written once per turn by the
   *  RouteTurn stage on cascade graphs (`classify` / `continuity:
   *  'conversation'`), read by the cursor resolver (iteration 1), the
   *  `read_skill` menu envelope and the `'guard'` gate. Absent on every
   *  other agent — nothing writes it, so nothing changes. */
  turnRoute?: import('../../../../injection-engine/routingPolicy.js').TurnRoute;
  /** WHERE the active skill's declared procedure stands (9.18.0) — strictly
   *  subordinate to the ONE cursor: it lives and dies inside one skill's
   *  tenure, is re-keyed on every cursor move (by the Evaluate stage, the
   *  same stage the cursor truth lives at) and never crosses runs. Advanced
   *  and skip-recorded by the tool-calls stage at the result boundary.
   *
   *  Carried as a 0-or-1-element ARRAY (`StepPointerCarrier`), never a bare
   *  object: footprintjs outputMappers shallow-merge bare objects field by
   *  field (nested arrays APPEND), while a top-level array under
   *  `arrayMerge: Replace` is set wholesale — the same reason
   *  `activeInjections` crosses boundaries as an array. `[]` = steps are
   *  declared somewhere but no procedure is active; ABSENT = no registered
   *  skill declares steps (nothing ever writes it — zero-cost-when-unused).
   *  Read it with `pointerOf()` from `agentfootprint/injection-engine`. */
  stepPointer?: import('../../../../injection-engine/skillSteps.js').StepPointerCarrier;
  /** The one teaching nudge for a premature stop has been spent this turn
   *  (9.18.0). Written by the StepNudge branch; reset at seed. Absent on
   *  agents with no stepped skill. */
  stepNudgeSpent?: boolean;
  /** Gate refusals (`skill.rejected` — reachability, posture or a self-call,
   *  all three arms) this turn
   *  (9.19.0). Counted by the tool-calls stage, reset at seed, present ONLY
   *  when an escalation brain is declared — the refusal budget that trips
   *  the flip. */
  skillRefusalsThisTurn?: number;
  /** The turn crossed its declared refusal threshold and the rest of it
   *  runs on the escalation brain (9.19.0). Written once per turn at the
   *  flip (a recorded fact — `skill.escalated` fires beside it); reset at
   *  seed (de-escalation). Absent without an escalation brain. */
  skillEscalated?: boolean;
  /** The `propose-transition` tool effect the gate ACCEPTED this iteration
   *  (9.19.0) — reachability-validated, first-accepted-wins across the
   *  batch, stamped with the granting iteration (one-shot by data: the
   *  Evaluate stage honors it exactly once, on the following iteration).
   *  Absent unless a tool proposed one on a skill-graph agent. */
  pendingToolTransition?: import('../../../../injection-engine/leases.js').PendingToolTransition;
  /** The granted `require-instruction` leases (9.19.0), in grant order.
   *  Appended by the tool-calls stage (which prunes spent ones as it
   *  writes); validity is computed per Evaluate pass, never mutated.
   *  Absent unless a tool granted one. */
  instructionLeases?: ReadonlyArray<InstructionLease>;

  /**
   * The mount kernel's engagement state (9.58.0) — one record per mounted
   * map: engaged or parked, the evidence strength the standing rests on,
   * and the idle count. Written each pass by the injection engine's
   * Evaluate stage via the `nextMapEngagement` alias round trip; present
   * ONLY on agents built with `.maps()`, so every other agent commits the
   * exact key set it always did. A plain POJO — survives structuredClone,
   * so recordings carry the kernel's standing beside the cursor it never
   * touches.
   */
  /** The `read_skill` picks the gate accepted THIS pass (9.59.0) — cleared at
   *  the top of every dispatching iteration, exactly like `pendingSkillPick`.
   *  The mount kernel's renewal feed reads it; written only on agents built
   *  with `.maps()`. */
  acceptedSkillPicks?: readonly string[];
  mapEngagement?: import('../../../../maps/engagement/types.js').MapEngagement;
}
