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
import { evaluateInjections } from './evaluator.js';
import {
  projectActiveInjection,
  type ActiveInjection,
  type Injection,
  type InjectionContext,
} from './types.js';
import { SKILL_GRAPH_METADATA_KEY, type CursorMove, type SkillRouting } from './skillGraph.js';

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
) {
  return (scope: TypedScope<InjectionEngineState>): void => {
    const args = scope.$getArgs<InjectionEngineArgs>();

    const ctx: InjectionContext = {
      iteration: args.iteration ?? 1,
      userMessage: args.userMessage ?? '',
      history: args.history ?? [],
      ...(args.lastToolResult && { lastToolResult: args.lastToolResult }),
      ...(args.toolResults && { toolResults: args.toolResults }),
      activatedInjectionIds: args.activatedInjectionIds ?? [],
      ...(args.currentSkillId !== undefined && { currentSkillId: args.currentSkillId }),
      ...(args.pendingSkillPick !== undefined && { pendingSkillPick: args.pendingSkillPick }),
      ...(args.entryScores !== undefined && { entryScores: args.entryScores }),
      ...(args.entryScorer !== undefined && { entryScorer: args.entryScorer }),
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
    const move = explainNextSkill ? explainNextSkill(ctx) : undefined;
    const routes = explainNextSkill !== undefined || nextSkill !== undefined;
    const cursor = move ? move.to : nextSkill ? nextSkill(ctx) : undefined;
    if (routes) {
      scope.$setValue('nextSkillCursor', cursor);
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

    // activeInjections — the REAL output the slot subflows read. POJO
    // projections (no trigger functions, no Tool execute functions) so they
    // survive footprintjs's transactional scope buffer (which clones on
    // write). Tool schemas are preserved + tagged by injectionId so the
    // Agent's closure-held registry can look up the executable.
    const activePOJOs = evaluation.active.map(projectActiveInjection);
    scope.$setValue('activeInjections', activePOJOs);

    const routing = routingEntriesOf(evaluation.active);
    // Structural copy (the events layer stays decoupled from `CursorMove`), and a
    // POJO so it survives the emit channel's clone.
    const cursorMove = move
      ? {
          ...(move.from !== undefined && { from: move.from }),
          ...(move.to !== undefined && { to: move.to }),
          by: move.by,
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
