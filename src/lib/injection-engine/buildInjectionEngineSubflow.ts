/**
 * Injection Engine — subflow builder.
 *
 * Pattern: Subflow Builder (returns a FlowChart mountable via
 *          `addSubFlowChartNext`). Each subflow stands alone.
 * Role:    Layer-3 context-engineering primitive. Sits BEFORE the
 *          three slot subflows in any primitive (Agent, LLMCall) that
 *          uses Injections. Evaluates every Injection's trigger once
 *          per iteration.
 *
 * Four small, readable stages (was one monolithic `evaluate`):
 *   1. Gather   — snapshot the turn's inputs (iteration, history size,
 *                 last tool, LLM-activated count). Observability only.
 *   2. Evaluate — run every trigger → `activeInjections` (the REAL output
 *                 the slot subflows read). Logic is UNCHANGED from the old
 *                 single stage: `activeInjections` is byte-identical, so the
 *                 slots are 100% unaffected. (Safety invariant.)
 *   3. Route    — partition `activeInjections` into per-slot buckets
 *                 (`activeByslot`), mirroring how the slots filter. Pure
 *                 annotation — the slots still do their own filtering.
 *   4. Delta    — diff this turn's buckets vs last turn's (`slotDelta`):
 *                 per slot, what activated / deactivated / stayed. The
 *                 explainability win ("tools +skill X, system-prompt
 *                 unchanged"). Reads last turn via `priorActiveByslot`
 *                 carried by the mount's input/output mappers.
 *
 * Nothing here SKIPS a slot — Route/Delta only annotate. See
 * docs (injection-algorithm blog) + memory agentfootprint_slot_plan_review
 * for why per-turn skip was deferred.
 *
 * Emits:   `agentfootprint.context.evaluated` at the Evaluate stage, with
 *          aggregate metadata. The per-slot route/delta ride visible stage
 *          STATE (`activeByslot` / `slotDelta`) so the lens reads them from
 *          the commit log without a new event-type contract.
 *
 * Mount with:
 *   builder.addSubFlowChartNext(
 *     SUBFLOW_IDS.INJECTION_ENGINE,
 *     buildInjectionEngineSubflow({ injections }),
 *     'Injection Engine',
 *     {
 *       inputMapper: (parent) => ({
 *         iteration: parent.iteration,
 *         userMessage: parent.userMessage,
 *         history: parent.history,
 *         lastToolResult: parent.lastToolResult,
 *         toolResults: parent.toolResults, // the whole batch, in call order
 *         activatedInjectionIds: parent.activatedInjectionIds ?? [],
 *         priorActiveByslot: parent.activeByslot ?? EMPTY_ACTIVE_BY_SLOT,
 *       }),
 *       outputMapper: (sf) => ({
 *         activeInjections: sf.activeInjections,
 *         activeByslot: sf.activeByslot, // carried so next turn's Delta can diff
 *       }),
 *     },
 *   )
 */

import { flowChart } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import { typedEmit } from '../../recorders/core/typedEmit.js';
import { iterationsRemainingOf } from '../iterationBudget.js';
import { evaluateInjections } from './evaluator.js';
import {
  projectActiveInjection,
  toolResultsOf,
  type ActiveInjection,
  type Injection,
  type InjectionContext,
} from './types.js';
import {
  SKILL_GRAPH_METADATA_KEY,
  type CursorMove,
  type GuardEvaluation,
  type SkillRouting,
} from './skillGraph.js';
import { menuOutstanding, type TurnRoute } from './routingPolicy.js';
import {
  pointerOf,
  rekeyStepPointer,
  type StepPlanFor,
  type StepPointerCarrier,
} from './skillSteps.js';
import {
  activeLeaseIds,
  pruneLeases,
  tenantOf,
  type InstructionLease,
  type PendingToolTransition,
} from '../../core/agent/toolEffects.js';
import { advanceEngagement } from '../../maps/engagement/lease.js';
import type { EngagementPlan, MapEngagement } from '../../maps/engagement/types.js';

export interface InjectionEngineConfig {
  /**
   * The Injection list. Frozen at build time. To change at runtime,
   * rebuild the agent / chart — the primitive is intentionally
   * declarative.
   */
  readonly injections: readonly Injection[];
  /**
   * The skill-graph CURSOR resolver (`graph.nextSkill`), present only when the
   * agent was built with `.skillGraph()`. The Evaluate stage advances the cursor
   * with the SAME `ctx` the triggers gate on, so trigger ↔ cursor never diverge
   * (the keystone). Absent → `currentSkillId` is never written (no graph routing).
   */
  readonly nextSkill?: (ctx: InjectionContext) => string | undefined;
  /**
   * The same resolver, reporting the clause that WON (`graph.explainNextSkill`,
   * 8.5.0). Preferred over `nextSkill` when present — the stage takes the cursor
   * from `.to`, so the graph is still consulted exactly once per iteration, and
   * stamps the cause on `context.evaluated` as `cursorMove`.
   *
   * Optional for forward-compat with graphs built before it existed; without it
   * the stage falls back to `nextSkill` and emits no `cursorMove` (an observer
   * then sees exactly what it saw in 8.4.0).
   */
  readonly explainNextSkill?: (ctx: InjectionContext) => CursorMove;
  /**
   * The graph's suppression reporter (`graph.supersededEntries`, 8.15.0) — the
   * conditional entries whose own `when` matched this iteration while the cursor was
   * elsewhere, so the cursor law kept them off the wire. Stamped on
   * `context.evaluated` as `supersededIds`.
   *
   * Optional for forward-compat with graphs built before it existed; absent → the
   * field is omitted and an observer sees exactly what it saw in 8.14.0.
   */
  readonly supersededEntries?: (ctx: InjectionContext) => readonly string[];
  /**
   * The gate's admissible set, for the record (9.50.0) — given the cursor a
   * move landed on, the skill ids the `read_skill` gate will admit this
   * iteration (declared hops out of that cursor plus the open skills). The
   * Agent composes it from the SAME two resolvers the `read_skill` offer and
   * the refusal messages use, so the recorded set can never drift from the
   * verdicts. Stamped on `context.evaluated.cursorMove` as `reachable`.
   *
   * Optional for forward-compat with graphs built before `reachableSkills`
   * existed; absent → the field is omitted and an observer sees exactly what
   * it saw in 9.49.0.
   */
  readonly reachableSkills?: (currentSkillId?: string) => readonly string[];
  /**
   * The frozen step plans, keyed by skill id (9.18.0) — present only when
   * ≥1 registered skill declares `steps`. The Evaluate stage owns the
   * pointer's TENURE RE-KEY with it, at the same stage the cursor truth
   * lives: tenant changed → fresh pointer (or cleared, when the new tenant
   * has no steps); unchanged → pass-through. Absent → no pointer key is
   * ever written (zero-cost-when-unused).
   */
  readonly stepPlanFor?: StepPlanFor;
  /**
   * The mount kernel's plan (9.58.0) — present only when the agent was built
   * with `.maps()`. The Evaluate stage advances every mounted map's
   * engagement with the SAME ctx the triggers gate on, and hands the parked
   * maps' member ids to the evaluator as the one framework-tier suppression
   * (`ctx.parkedIds`, the `leaseActiveIds` admission's mirror). Absent →
   * nothing here runs and the evaluation is byte-identical.
   */
  readonly engagement?: EngagementPlan;
}

// ── Route / Delta shapes (visible stage state; no new event contract) ────

/** One routed entry per (active injection × slot it contributes to). */
export interface RoutedInjection {
  readonly id: string;
  readonly source: ActiveInjection['flavor'];
  readonly reason: string;
}

/** Active injections partitioned by the slot they contribute to. */
export interface ActiveBySlot {
  readonly systemPrompt: readonly RoutedInjection[];
  readonly messages: readonly RoutedInjection[];
  readonly tools: readonly RoutedInjection[];
}

/** Per-slot change since last turn. */
export interface SlotDeltaEntry {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly kept: readonly string[];
}

/** Per-slot delta across the whole context. */
export interface SlotDelta {
  readonly systemPrompt: SlotDeltaEntry;
  readonly messages: SlotDeltaEntry;
  readonly tools: SlotDeltaEntry;
}

/** Empty buckets — turn-1 prior, and the safe default for the mappers. */
export const EMPTY_ACTIVE_BY_SLOT: ActiveBySlot = {
  systemPrompt: [],
  messages: [],
  tools: [],
};

interface InjectionEngineState {
  [k: string]: unknown;
}

/** Subflow input (boundary inputMapper) shape, shared by all four stages. */
interface InjectionEngineArgs {
  iteration?: number;
  /** The turn's action budget (9.57.0), threaded by the mount exactly as the
   *  cache mount threads it. Absent = the engine was driven without one, and
   *  then neither budget fact reaches the ctx. */
  maxIterations?: number;
  userMessage?: string;
  history?: InjectionContext['history'];
  lastToolResult?: InjectionContext['lastToolResult'];
  /** The previous iteration's WHOLE tool batch, in call order (9.16.0) —
   *  `lastToolResult` is its last entry. Carried by the mount mappers so
   *  `on-tool-return` triggers and route edges see every call, not only the
   *  last one of a parallel batch. */
  toolResults?: InjectionContext['toolResults'];
  activatedInjectionIds?: readonly string[];
  /** Last turn's per-slot active set, carried by the mount mappers. */
  priorActiveByslot?: ActiveBySlot;
  /** The skill-graph cursor as of the previous iteration (the `from`-gate the
   *  route triggers compare against). Carried by the mount mappers; undefined
   *  on cold start and for non-skillGraph agents. */
  currentSkillId?: string;
  /** The `read_skill` pick the gate accepted last iteration (one-shot). Moves the
   *  cursor unless a declared edge fired first. Carried by the mount mappers. */
  pendingSkillPick?: string;
  /** The relevance entry ranking (from an entry scorer) — read by defineRelevanceHint. */
  entryScores?: InjectionContext['entryScores'];
  /** Name of the entry scorer that produced `entryScores`. */
  entryScorer?: InjectionContext['entryScorer'];
  /** The turn-start routing verdict (SG-C) — written once per turn by the
   *  RouteTurn stage, carried by the mount mappers. The resolver consumes
   *  `to` on iteration 1; the menu hint reads `offered`. Absent on graphs
   *  without the cascade. */
  turnRoute?: TurnRoute;
  /** The step pointer as of the PREVIOUS iteration (9.18.0) — a readonly
   *  input here (the currentSkillId/nextSkillCursor alias discipline: an
   *  inputMapper key cannot be written inside the subflow). Evaluate
   *  re-keys it against this iteration's tenant and writes the fresh value
   *  under `nextStepPointer`; the mount mappers carry the alias back onto
   *  the parent's `stepPointer`. Carried only for agents with stepped
   *  skills. */
  stepPointer?: StepPointerCarrier;
  /** The `propose-transition` tool effect the gate accepted (9.19.0) —
   *  written by the tool-calls stage, stamped with the granting iteration.
   *  Honored by Evaluate exactly once, on the FOLLOWING iteration (one-shot
   *  by data — nothing ever clears it). Present only when a tool proposed
   *  one; the mappers thread it value-conditionally. */
  pendingToolTransition?: PendingToolTransition;
  /** The granted `require-instruction` leases (9.19.0) — written by the
   *  tool-calls stage; validity is computed per pass (`activeLeaseIds`).
   *  A readonly INPUT here, so Evaluate's tenure sweep (which makes lease
   *  death permanent — no resurrection on cyclic re-entry) writes the
   *  survivors under the DISTINCT key `nextInstructionLeases`, and the
   *  mount mappers carry them back onto the parent (the
   *  currentSkillId/nextSkillCursor alias discipline). Present only after
   *  a tool granted one. */
  instructionLeases?: readonly InstructionLease[];
  /** The kernel's engagement state as of the PREVIOUS iteration (9.58.0) — a
   *  readonly boundary INPUT (the currentSkillId/nextSkillCursor alias
   *  discipline). Evaluate advances it and writes the fresh value under
   *  `nextMapEngagement`; the mount mappers carry the alias back onto the
   *  parent's `mapEngagement`. Present only on agents built with `.maps()`. */
  mapEngagement?: MapEngagement;
}

/**
 * Build the Injection Engine subflow — Gather → Evaluate → Route → Delta.
 */
export function buildInjectionEngineSubflow(config: InjectionEngineConfig): FlowChart {
  const injections = config.injections;

  return flowChart<InjectionEngineState>('Gather', gatherStage, 'gather', {
    description:
      "Snapshot this turn's injection inputs (iteration, history, last tool, LLM-activated)",
  })
    .addFunction(
      'Evaluate',
      makeEvaluateStage(
        injections,
        config.nextSkill,
        config.explainNextSkill,
        config.supersededEntries,
        config.stepPlanFor,
        config.reachableSkills,
        config.engagement,
      ),
      'evaluate',
      'Evaluate every Injection trigger; produce activeInjections + metadata',
    )
    .addFunction(
      'Route',
      routeStage,
      'route',
      'Partition active injections into per-slot buckets (system-prompt / messages / tools)',
    )
    .addFunction(
      'Delta',
      deltaStage,
      'delta',
      'Per-slot delta vs last turn: what activated / deactivated / stayed',
    )
    .build();
}

// ── Stage 1: Gather ──────────────────────────────────────────────────────

/** Observability-only: record what this turn is being evaluated against. */
function gatherStage(scope: TypedScope<InjectionEngineState>): void {
  const args = scope.$getArgs<InjectionEngineArgs>();
  scope.$setValue('injectionContextSummary', {
    iteration: args.iteration ?? 1,
    historyLength: args.history?.length ?? 0,
    lastToolName: args.lastToolResult?.toolName,
    activatedInjectionCount: args.activatedInjectionIds?.length ?? 0,
  });
}

// ── Stage 2: Evaluate (logic identical to the old single stage) ──────────

function makeEvaluateStage(
  injections: readonly Injection[],
  nextSkill?: (ctx: InjectionContext) => string | undefined,
  explainNextSkill?: (ctx: InjectionContext) => CursorMove,
  supersededEntries?: (ctx: InjectionContext) => readonly string[],
  stepPlanFor?: StepPlanFor,
  reachableSkills?: (currentSkillId?: string) => readonly string[],
  engagementPlan?: EngagementPlan,
) {
  return (scope: TypedScope<InjectionEngineState>): void => {
    const args = scope.$getArgs<InjectionEngineArgs>();

    // The accepted transition proposal (9.19.0), VALID only on the iteration
    // after its grant — one-shot by data, the same one-shot-ness the pick
    // gets from being rewritten, with zero clearing writes (an agent whose
    // tools never propose keeps its exact committed keys).
    const iteration = args.iteration ?? 1;
    const proposal =
      args.pendingToolTransition !== undefined &&
      args.pendingToolTransition.iteration + 1 === iteration
        ? args.pendingToolTransition
        : undefined;

    const baseCtx: InjectionContext = {
      iteration,
      // The action budget, as ONE fact with two spellings (9.57.0). Written
      // together so the pairing invariant — both or neither — is a property
      // of this object literal rather than a rule somebody has to remember.
      ...(args.maxIterations !== undefined && {
        maxIterations: args.maxIterations,
        iterationsRemaining: iterationsRemainingOf(args.maxIterations, iteration),
      }),
      userMessage: args.userMessage ?? '',
      history: args.history ?? [],
      ...(args.lastToolResult && { lastToolResult: args.lastToolResult }),
      ...(args.toolResults && { toolResults: args.toolResults }),
      activatedInjectionIds: args.activatedInjectionIds ?? [],
      ...(args.currentSkillId !== undefined && { currentSkillId: args.currentSkillId }),
      ...(args.pendingSkillPick !== undefined && { pendingSkillPick: args.pendingSkillPick }),
      ...(proposal !== undefined && {
        pendingToolTransition: { targetSkillId: proposal.targetSkillId },
      }),
      ...(args.entryScores !== undefined && { entryScores: args.entryScores }),
      ...(args.entryScorer !== undefined && { entryScorer: args.entryScorer }),
      ...(args.turnRoute !== undefined && { turnRoute: args.turnRoute }),
    };

    // KEYSTONE cursor advance — derive the next cursor from the SAME ctx the
    // route triggers gate on (`nextSkill(ctx) === id`), so the active set and the
    // stored cursor can never disagree. Written to a DISTINCT output key
    // (`nextSkillCursor`) because `currentSkillId` arrives as a readonly INPUT
    // here; the mount's outputMapper maps it onto the parent's mutable
    // `currentSkillId` for the next iteration. Skill-graph agents only.
    // ONE consultation of the graph per iteration: when the graph can explain
    // itself (8.5.0) the cursor comes out of `.to`, so asking for the cause costs
    // nothing extra and cannot answer a different destination than the routing did.
    const move = explainNextSkill ? explainNextSkill(baseCtx) : undefined;
    const routes = explainNextSkill !== undefined || nextSkill !== undefined;
    const cursor = move ? move.to : nextSkill ? nextSkill(baseCtx) : undefined;
    if (routes) {
      scope.$setValue('nextSkillCursor', cursor);
    }

    // ── The step pointer's TENURE RE-KEY (9.18.0) ─────────────────────
    // Same discipline as the cursor, one line down from it: `stepPointer`
    // arrives as a readonly INPUT, so the fresh value goes out under a
    // DISTINCT key (`nextStepPointer` — the currentSkillId/nextSkillCursor
    // alias, NOT the turn-constant turnRoute pattern) and the mount mappers
    // carry it back onto the parent. The tenant is the ADVANCED cursor on
    // graph agents, else the tail of `activatedInjectionIds` (the shipped
    // `activeSkillId` notion). Written on EVERY iteration the feature is on
    // (the `if (routes)` precedent) so a downstream reader never sees a
    // stale pointer; gated on `stepPlanFor` so agents without steps commit
    // exactly the keys they always did.
    //
    // Computed BEFORE `evaluateInjections`, and the FRESH pointer goes into
    // the ctx the triggers read — else `defineStepsHint`'s trigger would
    // judge the stale pointer and the hint would miss the tenure's first
    // iteration while the banner (tools slot, fresh value) was present.
    let ctx = baseCtx;
    if (stepPlanFor) {
      const activated = args.activatedInjectionIds ?? [];
      const tenant = routes ? cursor : activated[activated.length - 1];
      const fresh = rekeyStepPointer({ prior: args.stepPointer, tenant, stepPlanFor });
      scope.$setValue('nextStepPointer', fresh);
      const freshPointer = pointerOf(fresh);
      ctx = { ...baseCtx, ...(freshPointer !== undefined && { stepPointer: freshPointer }) };
    }

    // ── Instruction leases (9.19.0) — the `require-instruction` push ───
    // Validity is COMPUTED per pass against the ADVANCED tenure (a lease
    // dies the same pass its tenure ends): `'next-call'` serves exactly the
    // pass after its grant; `'until-skill-exit'` serves while the granting
    // tenant still holds. The served ids ride the ctx the evaluator reads,
    // which admits them into the active set beside their own triggers.
    // Zero-cost gate: no granted lease anywhere → not one line here runs.
    if (args.instructionLeases !== undefined) {
      const leaseTenant = tenantOf(routes ? cursor : undefined, args.activatedInjectionIds);
      if (args.instructionLeases.length > 0) {
        const leaseIds = activeLeaseIds(args.instructionLeases, ctx.iteration, leaseTenant);
        if (leaseIds.length > 0) {
          ctx = { ...ctx, leaseActiveIds: leaseIds };
        }
      }
      // The TENURE SWEEP — what makes lease death PERMANENT. `skillId ===
      // tenant` alone cannot tell "held the tenure all along" from
      // "re-entered the granting skill later" (a cyclic graph makes both
      // real), so the pass that sees a tenure end removes its dead leases
      // from the record — computed AFTER `activeLeaseIds` (this pass's
      // serving is untouched; the swept array feeds only future passes).
      // Same alias round trip as the cursor: `instructionLeases` is a
      // readonly boundary INPUT here, so the survivors go out under
      // `nextInstructionLeases` and the mount mappers carry them back onto
      // the parent key. Written on EVERY pass the key exists — even as [] —
      // so no boundary ever re-delivers a stale, pre-sweep array.
      scope.$setValue(
        'nextInstructionLeases',
        pruneLeases(args.instructionLeases, ctx.iteration, leaseTenant),
      );
    }

    // A parallel batch whose results matched edges to DIFFERENT targets
    // (9.16.0). The resolver already decided the hop — first match in call
    // order won — and reported the suppression on the move; here it goes on
    // the record as its own typed event, stamped the iteration it happened.
    // Silent-drop was the pre-9.16.0 behavior this replaces: earlier calls of
    // a batch simply never routed. POJO copies, because event payloads must
    // be detached plain data.
    if (move?.conflict) {
      typedEmit(scope, 'agentfootprint.skill.route_conflict', {
        iteration: ctx.iteration,
        ...(ctx.currentSkillId !== undefined && { fromSkillId: ctx.currentSkillId }),
        winner: { ...move.conflict.winner },
        losers: move.conflict.losers.map((l) => ({ ...l })),
      });
    }

    // ── Map engagement (9.58.0) — the mount kernel's one pass ──────────
    // Advanced with the SAME facts the triggers gate on, BEFORE the
    // evaluator runs, so a re-engagement earned this pass serves this pass
    // and a park suppresses this pass — the record and the wire can never
    // disagree. The state rides the boundary as a readonly INPUT
    // (`mapEngagement`) and leaves under the DISTINCT key
    // `nextMapEngagement` (the cursor/lease alias discipline). The cursor
    // itself is untouched by every branch of this block: engagement is the
    // kernel's axis, position is the map's.
    if (engagementPlan !== undefined) {
      const advance = advanceEngagement(engagementPlan, args.mapEngagement, {
        iteration: ctx.iteration,
        ...(cursor !== undefined && { currentNode: cursor }),
        ...(move?.by !== undefined && { moveBy: move.by }),
        ...(move?.witness?.text !== undefined && { witness: move.witness.text }),
        toolResults: toolResultsOf(ctx),
        ...(ctx.pendingSkillPick !== undefined && { pendingSkillPick: ctx.pendingSkillPick }),
        activatedInjectionIds: ctx.activatedInjectionIds,
      });
      // Written on EVERY pass the feature is on (the `if (routes)` precedent)
      // so a boundary never re-delivers stale engagement state.
      scope.$setValue('nextMapEngagement', advance.next);
      for (const change of advance.changes) {
        if (change.kind === 'engaged') {
          typedEmit(scope, 'agentfootprint.map.engaged', {
            mapId: change.mapId,
            iteration: change.iteration,
            by: change.by,
            ...(change.witness !== undefined && { witness: change.witness }),
            ...(change.reengaged === true && { reengaged: true as const }),
          });
        } else {
          typedEmit(scope, 'agentfootprint.map.parked', {
            mapId: change.mapId,
            iteration: change.iteration,
            by: change.by,
            idleCalls: change.idleCalls,
            ...(change.witness !== undefined && { witness: change.witness }),
          });
        }
      }
      if (advance.parkedInjectionIds.length > 0) {
        ctx = { ...ctx, parkedIds: advance.parkedInjectionIds };
      }
    }

    const evaluation = evaluateInjections(injections, ctx);

    // The suppression the cursor law performs (8.15.0). Asked ONCE, on the same ctx
    // the triggers gated on, so the reported suppression and the active set are two
    // views of one evaluation and cannot disagree.
    const supersededIds = supersededEntries ? [...supersededEntries(ctx)] : [];

    // The told-the-truth check. `read_skill` answered "Skill 'X' activated for the
    // next iteration" and the gate accepted the pick — so X must be in THIS pass's
    // active set. It normally is (the pick moved the cursor). The one case where it
    // isn't: a declared edge fired the same turn and won the cursor (`D1 > D2` —
    // the model emitted a domain tool AND read_skill in one message, and the domain
    // tool's result matched a route). Rather than let a promise quietly go unmet,
    // say so on the record. Checked against the REAL active set, not against which
    // clause won — the question is "did the promised skill load?", and only the
    // active set answers it.
    //
    // 8.15.0 widened WHEN that answer is "no", without changing the question. A
    // superseded pick onto a rules-form entry used to slip through: the pick lost the
    // cursor, but the entry's own rule kept it active anyway, so the promise looked
    // kept by accident. Conditional entries are cursor-gated now, so the same hop
    // reports itself. `supersededIds` below is a DIFFERENT fact — a continuous
    // suppression, nobody's broken promise — and deliberately does not come out here.
    const pick = ctx.pendingSkillPick;
    if (pick !== undefined && !evaluation.active.some((inj) => inj.id === pick)) {
      typedEmit(scope, 'agentfootprint.skill.reroute_superseded', {
        volunteeredId: pick,
        ...(cursor !== undefined && { wonId: cursor }),
        ...(ctx.currentSkillId !== undefined && { fromSkillId: ctx.currentSkillId }),
        iteration: ctx.iteration,
      });
    }

    // The same told-the-truth check for an ACCEPTED transition proposal
    // (9.19.0): the effect was accepted (`tools.effect { outcome:
    // 'accepted' }` is on the record) but a declared edge fired on the same
    // batch and won the cursor (D1 outranks the proposal exactly as it
    // outranks a pick). Said out loud rather than left as a promise that
    // quietly went unmet.
    if (proposal !== undefined && cursor !== proposal.targetSkillId) {
      typedEmit(scope, 'agentfootprint.skill.reroute_superseded', {
        volunteeredId: proposal.targetSkillId,
        ...(cursor !== undefined && { wonId: cursor }),
        ...(ctx.currentSkillId !== undefined && { fromSkillId: ctx.currentSkillId }),
        iteration: ctx.iteration,
        source: 'tool-proposal',
      });
    }

    // activeInjections — the REAL output the slot subflows read. POJO
    // projections (no trigger functions, no Tool execute functions) so they
    // survive footprintjs's transactional scope buffer (which clones on
    // write). Tool schemas are preserved + tagged by injectionId so the
    // Agent's closure-held registry can look up the executable.
    // The ctx goes in (9.57.0): this is the one moment the context and the
    // content are both in scope, so a templated instruction is rendered here
    // and every reader downstream sees the same plain text it always saw.
    const activePOJOs = evaluation.active.map((inj) => projectActiveInjection(inj, ctx));
    scope.$setValue('activeInjections', activePOJOs);

    const routing = routingEntriesOf(evaluation.active);
    // Structural copy (the events layer stays decoupled from `CursorMove`), and a
    // POJO so it survives the emit channel's clone.
    //
    // SG-C decoration: on the iteration a MODEL PICK resolves an outstanding
    // turn-start menu, the move carries the menu it resolved (`offered`) — and
    // `declinedOffer: true` when the accepted pick was reachable but NOT on it.
    // Under 'assist' the model's divergence from the menu is DATA, not a
    // refusal; without this stamp the record could not tell an on-menu pick
    // from an off-menu one. `menuOutstanding` is the same one implementation
    // the envelope and the 'guard' gate use, judged on the PRE-advance cursor
    // (this very move is what closes the menu).
    const resolvedMenu =
      move?.by === 'model-pick' &&
      move.to !== undefined &&
      menuOutstanding(ctx.turnRoute, ctx.currentSkillId)
        ? {
            offered: [...ctx.turnRoute!.offered!],
            ...(ctx.turnRoute!.offered!.includes(move.to) ? {} : { declinedOffer: true as const }),
          }
        : undefined;
    // The gate's admissible set from the LANDED cursor (9.50.0) — asked once,
    // beside the one resolver consultation, so the recorded set and this
    // iteration's read_skill offer/refusals come from the same answer. A POJO
    // copy (event payloads are detached plain data); `[]` is a fact (a dead
    // end), absence means the graph could not say.
    const reachable =
      move !== undefined && reachableSkills ? [...reachableSkills(cursor)] : undefined;
    const cursorMove = move
      ? {
          ...(move.from !== undefined && { from: move.from }),
          ...(move.to !== undefined && { to: move.to }),
          by: move.by,
          ...(reachable !== undefined && { reachable }),
          // Tier-1 DATA-matcher evidence (9.28.0) — what the message said that
          // routed this hop. Copied field-by-field: the event payload is a
          // structural shape, never the engine's own object.
          ...(move.witness !== undefined && {
            witness: {
              text: move.witness.text,
              ...(move.witness.keyword !== undefined && { keyword: move.witness.keyword }),
            },
          }),
          // Data-guard evidence (9.51.0) — the taken hop's evaluation and the
          // refusals, copied field-by-field like the witness: the event
          // payload is a structural shape, never the engine's own object.
          ...(move.guard !== undefined && { guard: copyGuardEvaluation(move.guard) }),
          ...(move.guardsClosed !== undefined &&
            move.guardsClosed.length > 0 && {
              guardsClosed: move.guardsClosed.map(copyGuardEvaluation),
            }),
          ...resolvedMenu,
        }
      : undefined;

    // Aggregate evaluation metadata is pure OBSERVABILITY — no flow stage
    // reads it — so it goes out the EMIT channel where a recorder/Lens can
    // observe "what was considered, what won, what was skipped and why".
    typedEmit(scope, 'agentfootprint.context.evaluated', {
      iteration: ctx.iteration,
      activeCount: evaluation.active.length,
      skippedCount: evaluation.skipped.length,
      evaluatedTotal: injections.length,
      activeIds: evaluation.active.map((i) => i.id),
      skippedDetails: evaluation.skipped,
      triggerKindCounts: countTriggerKinds(evaluation.active),
      // The Skill menu the LLM was offered (same text as the read_skill tool
      // description) — pair "offered" with "chosen" (activatedInjectionIds) to
      // debug a missed/wrong read_skill call.
      skillCatalog: skillCatalogOf(injections),
      // Routing PROVENANCE for active skill-graph injections — the decision path
      // / edge that reached each. Undefined when none came from a skillGraph().
      //
      // NOTE the difference from `cursorMove` below, which is the whole reason the
      // latter exists: `routing[]` is BUILD-TIME provenance ("how is this skill
      // reachable at all"), stamped once by the compiler. It answers per SKILL, not
      // per HOP. Reading it as the cause of this turn's move is what made a model
      // pick get recorded under a declared edge's label.
      ...(routing && { routing }),
      // How the CURSOR actually moved this iteration, straight from the clause that
      // won inside the resolver (8.5.0). Skill-graph agents only; absent for a graph
      // built before `explainNextSkill` existed.
      ...(cursorMove && { cursorMove }),
      // Entries whose own `when` matched and which the cursor law kept OFF the wire
      // (8.15.0). A conditional entry is active exactly while the cursor is on it,
      // and a suppression the run cannot name is a silent drop. Omitted when nothing
      // was suppressed, so the common iteration is byte-identical to 8.14.0.
      ...(supersededIds.length > 0 && { supersededIds }),
    });
  };
}

/** One guard evaluation as a DETACHED POJO for the emit channel (9.51.0) —
 *  field-by-field, conditions included: event payloads must be plain data,
 *  and value arrays are re-sliced so no live reference rides the record. */
function copyGuardEvaluation(g: GuardEvaluation) {
  return {
    from: g.from,
    to: g.to,
    toolName: g.toolName,
    ...(g.toolCallId !== undefined && { toolCallId: g.toolCallId }),
    verdict: g.verdict,
    conditions: g.conditions.map((c) => ({
      key: c.key,
      op: c.op,
      value: Array.isArray(c.value) ? [...c.value] : c.value,
      actualSummary: c.actualSummary,
      passed: c.passed,
    })),
  };
}

/** Per active skill-graph injection: its routing provenance + unlocked tools.
 *  Returns undefined when no active injection carries skill-graph metadata, so
 *  the emit payload omits `routing` entirely for non-skill-graph runs. */
function routingEntriesOf(active: readonly Injection[]) {
  const entries = active.flatMap((inj) => {
    const routing = (inj.metadata as { [SKILL_GRAPH_METADATA_KEY]?: SkillRouting } | undefined)?.[
      SKILL_GRAPH_METADATA_KEY
    ];
    if (!routing) return [];
    return [
      {
        injectionId: inj.id,
        flavor: inj.flavor,
        via: routing.via,
        ...(routing.path && {
          path: routing.path.map((s) => ({ label: s.label, branch: s.branch })),
        }),
        ...(routing.label && { label: routing.label }),
        ...(routing.from && { from: routing.from }),
        ...(routing.triggerKind && { triggerKind: routing.triggerKind }),
        tools: (inj.inject.tools ?? []).map((t) => t.schema.name),
      },
    ];
  });
  return entries.length > 0 ? entries : undefined;
}

// ── Stage 3: Route ───────────────────────────────────────────────────────

/** Partition active injections by the slot(s) each contributes to. Mirrors
 *  the slot subflows' own filters so this view matches what they compose.
 *  Pure — exported for unit tests + reuse (e.g. the lens). */
export function routeActiveInjections(active: readonly ActiveInjection[]): ActiveBySlot {
  const systemPrompt: RoutedInjection[] = [];
  const messages: RoutedInjection[] = [];
  const tools: RoutedInjection[] = [];

  for (const inj of active) {
    const entry: RoutedInjection = {
      id: inj.id,
      source: inj.flavor,
      reason: inj.description ?? `${inj.flavor} '${inj.id}' active`,
    };
    // system-prompt: has prompt content AND not a tool-only Skill
    // (mirrors buildSystemPromptSlot's Block C suppression).
    if (
      inj.inject.systemPrompt &&
      inj.inject.systemPrompt.length > 0 &&
      !(inj.flavor === 'skill' && inj.surfaceMode === 'tool-only')
    ) {
      systemPrompt.push(entry);
    }
    if (inj.inject.messages && inj.inject.messages.length > 0) messages.push(entry);
    if (inj.inject.tools && inj.inject.tools.length > 0) tools.push(entry);
  }

  return { systemPrompt, messages, tools };
}

function routeStage(scope: TypedScope<InjectionEngineState>): void {
  const active =
    (scope.$getValue('activeInjections') as readonly ActiveInjection[] | undefined) ?? [];
  scope.$setValue('activeByslot', routeActiveInjections(active));
}

// ── Stage 4: Delta ───────────────────────────────────────────────────────

/** Diff this turn's per-slot buckets against last turn's (carried via the
 *  mount mappers as `priorActiveByslot`). Turn 1 / unwired → all "added". */
function deltaStage(scope: TypedScope<InjectionEngineState>): void {
  const current =
    (scope.$getValue('activeByslot') as ActiveBySlot | undefined) ?? EMPTY_ACTIVE_BY_SLOT;
  const prior = scope.$getArgs<InjectionEngineArgs>().priorActiveByslot ?? EMPTY_ACTIVE_BY_SLOT;
  scope.$setValue('slotDelta', diffActiveBySlot(prior, current));
}

/** Diff two per-slot snapshots into a per-slot delta. Pure — exported for
 *  unit tests + reuse. */
export function diffActiveBySlot(prior: ActiveBySlot, current: ActiveBySlot): SlotDelta {
  return {
    systemPrompt: diffSlot(prior.systemPrompt, current.systemPrompt),
    messages: diffSlot(prior.messages, current.messages),
    tools: diffSlot(prior.tools, current.tools),
  };
}

/** added = now-not-before, removed = before-not-now, kept = both. */
function diffSlot(
  prior: readonly RoutedInjection[],
  current: readonly RoutedInjection[],
): SlotDeltaEntry {
  const priorIds = new Set(prior.map((e) => e.id));
  const currentIds = new Set(current.map((e) => e.id));
  return {
    added: [...currentIds].filter((id) => !priorIds.has(id)),
    removed: [...priorIds].filter((id) => !currentIds.has(id)),
    kept: [...currentIds].filter((id) => priorIds.has(id)),
  };
}

/** The Skill catalog the LLM was offered — id + description for every Skill
 *  injection, mirroring buildReadSkillTool's `(no description)` fallback. */
function skillCatalogOf(
  injections: readonly Injection[],
): readonly { id: string; description: string }[] {
  return injections
    .filter((i) => i.flavor === 'skill')
    .map((i) => ({ id: i.id, description: i.description ?? '(no description)' }));
}

/** Count active injections by trigger kind (observability metric). */
function countTriggerKinds(active: readonly Injection[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const inj of active) {
    counts[inj.trigger.kind] = (counts[inj.trigger.kind] ?? 0) + 1;
  }
  return counts;
}
