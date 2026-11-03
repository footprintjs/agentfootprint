import type {
  ContextLifetime,
  ContextRecency,
  ContextRole,
  ContextSlot,
  ContextSource,
} from './dependencyTypes.js';

// context.* (5) — THE CORE DOMAIN
export interface ContextInjectedPayload {
  readonly contentSummary: string;
  readonly contentHash: string;
  readonly rawContent?: string;
  readonly slot: ContextSlot;
  readonly asRole?: ContextRole;
  readonly asRecency?: ContextRecency;
  readonly position?: number;
  readonly sectionTag?: string;
  readonly source: ContextSource;
  readonly sourceId?: string;
  readonly upstreamRef?: string;
  readonly reason: string;
  readonly retrievalScore?: number;
  readonly rankPosition?: number;
  readonly threshold?: number;
  readonly budgetSpent?: { readonly tokens: number; readonly fractionOfCap: number };
  readonly expiresAfter?: ContextLifetime;
}

export interface ContextEvictedPayload {
  readonly slot: ContextSlot;
  readonly contentHash: string;
  readonly reason: 'budget' | 'stale' | 'low_score' | 'policy' | 'user_revoked';
  readonly survivalMs: number;
}

export interface ContextSlotComposedPayload {
  readonly slot: ContextSlot;
  readonly iteration: number;
  readonly budget: {
    readonly cap: number;
    readonly used: number;
    readonly headroomChars: number;
  };
  readonly sourceBreakdown: Readonly<
    Partial<Record<ContextSource, { readonly chars: number; readonly count: number }>>
  >;
  readonly orderingStrategy?: string;
  readonly droppedCount: number;
  readonly droppedSummaries: readonly string[];
}

/**
 * Fired when a budget is exceeded — by a context SLOT composing over its
 * `budgetCap`, or by a window STRATEGY measuring the window over its
 * `thresholdTokens`.
 *
 * ## Read `unit` before you read a number (8.14.0)
 *
 * Two emitters share this event name and the `slot: 'messages'` value, and
 * **they do not count in the same unit**:
 *
 * | emitter | what it measures | `unit` |
 * |---|---|---|
 * | the three context slots (`contextBudget`) | `String.length` of what it composed | `'chars'` |
 * | a window strategy (`.window()` / `.compaction()`) | the provider's reported input tokens | `'tokens'` |
 *
 * Since `contextBudget` is on by default, one subscriber routinely receives
 * both — and before 8.14.0 nothing in the payload told them apart, so
 * "cap 200, projected 258" could be 258 characters or 258 tokens. `unit` is
 * the answer; `cap` and `projected` are the same two numbers under names that
 * do not assert an untrue one.
 *
 * `planAction: 'none'` means no mitigation was performed — nothing was
 * evicted or truncated and the full content still went to the LLM. That
 * is what the built-in slots report: they never truncate, so the event is
 * the signal that the budget is not being respected.
 */
export interface ContextBudgetPressurePayload {
  readonly slot: ContextSlot;
  /** How far over the cap, in {@link unit}. Never carried a unit in its name. */
  readonly overflowBy: number;
  readonly planAction: 'evict' | 'summarize' | 'abort' | 'none';
  /**
   * What {@link cap}, {@link projected} and {@link overflowBy} are counted in
   * (8.14.0). `'chars'` from a context slot, `'tokens'` from a window
   * strategy. Branch on this before comparing any of the three numbers to
   * anything.
   */
  readonly unit: 'chars' | 'tokens';
  /**
   * The budget that was exceeded, in {@link unit}.
   *
   * Called `capTokens` until 9.0.0 — a name that asserted tokens on a channel
   * that is CHARS half the time, since `contextBudget` is on by default and a
   * slot counts `String.length`. Both spellings shipped through 8.x with the
   * identical value; 9.0.0 keeps only this one.
   */
  readonly cap: number;
  /** What was measured, in {@link unit}. Called `projectedTokens` until 9.0.0
   *  — see {@link cap}. */
  readonly projected: number;
}

/**
 * Fired once per iteration by the Injection Engine after it evaluates every
 * Injection's trigger — BEFORE the Context fork routes the survivors into the
 * three slots. This is the "what was considered, what won, what was skipped
 * and why" signal; `context.slot_composed` is its downstream counterpart
 * ("what actually landed in each slot"). Pure observability — no flow stage
 * reads it.
 */
/** A guard threshold value as the record carries it — plain data only. */
export type SkillGuardValueRecord =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<string | number | boolean | null>;

/**
 * One route-edge guard evaluation, as `cursorMove.guard` / `guardsClosed`
 * carry it (9.51.0): the guarded edge, the tool result it judged, the
 * verdict, and per-condition evidence — each declared condition
 * (`key`/`op`/`value`), the summarized value it was judged against (bounded
 * to 80 chars — evidence, not a transcript), and whether it passed. The
 * operator vocabulary deliberately mirrors footprintjs's `WhereFilter`
 * (`eq/ne/gt/gte/lt/lte/in/notIn`).
 */
export interface SkillGuardEvaluationRecord {
  readonly from: string;
  readonly to: string;
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly verdict: boolean;
  readonly conditions: ReadonlyArray<{
    readonly key: string;
    readonly op: string;
    readonly value: SkillGuardValueRecord;
    readonly actualSummary: string;
    readonly passed: boolean;
  }>;
}

export interface ContextEvaluatedPayload {
  readonly iteration: number;
  /** Number of injections active this iteration. */
  readonly activeCount: number;
  /** Number skipped (predicate false counts as neither — only errors/unknown land here). */
  readonly skippedCount: number;
  /** Total injections evaluated (the full declared list). */
  readonly evaluatedTotal: number;
  /** Ids of the active injections, in evaluation order. */
  readonly activeIds: readonly string[];
  /** Why each skipped injection was skipped (errors / unknown trigger kinds). */
  readonly skippedDetails: readonly {
    readonly id: string;
    /** `'unknown-fact'` (9.57.0): a templated instruction named a run-time
     *  fact this evaluation could not supply, so it was skipped whole.
     *  `'parked'` (9.58.0): a member of a map the mount kernel parked —
     *  served without corroboration for the grace window; the map's own
     *  cursor is untouched and evidence re-engages it.
     *  `'hidden'`: a skill the caller's role may not see (`skill_read`),
     *  refused whatever tried to activate it. */
    readonly reason:
      | 'predicate-threw'
      | 'unknown-trigger-kind'
      | 'unknown-fact'
      | 'parked'
      | 'hidden';
    readonly error?: string;
  }[];
  /** Count of active injections by trigger kind (always / rule / on-tool-return / llm-activated). */
  readonly triggerKindCounts: Readonly<Record<string, number>>;
  /**
   * The Skill CATALOG the LLM was offered this turn — every registered Skill's
   * `id` + `description` (the same text that lands in the `read_skill` tool
   * description). Lets observers pair "what was offered" against "what the LLM
   * chose" (`read_skill` → `activatedInjectionIds`) when debugging a missed or
   * wrong activation. Empty when no Skills are registered. Static across turns.
   */
  readonly skillCatalog: readonly { readonly id: string; readonly description: string }[];
  /**
   * Routing PROVENANCE for the active injections that came from a `skillGraph()`
   * — *why* each was reached. One entry per active skill-graph injection (a
   * decision-tree leaf, a flat entry, or a route edge); absent when no active
   * injection carries skill-graph metadata. The structured counterpart to the
   * `context.routed` commentary line — lets the lens show the decision path, the
   * matched predicate, and the tools a route unlocked. Structural shape (mirrors
   * `SkillRouting` from the injection engine; events stay decoupled from it).
   */
  readonly routing?: readonly {
    readonly injectionId: string;
    readonly flavor: string;
    /** `'tree' | 'entry' | 'route' | 'model'`. */
    readonly via: string;
    /** Decision path (tree only): predicates root→leaf + branch taken. */
    readonly path?: readonly { readonly label: string; readonly branch: string }[];
    /** Entry/route edge caption. */
    readonly label?: string;
    /** Source skill id (route only). */
    readonly from?: string;
    /** Compiled trigger kind for a route. */
    readonly triggerKind?: string;
    /** Tool names this injection unlocked. */
    readonly tools?: readonly string[];
  }[];
  /**
   * How the skill-graph CURSOR moved on THIS iteration — the winning clause of the
   * graph's one cursor resolver, reported by it (8.5.0). Present only for an agent
   * built with `.skillGraph()` (and a graph new enough to explain itself).
   *
   * Distinct from `routing[]` above, and the distinction is the point: `routing[]`
   * is per-SKILL build-time provenance ("how is this skill reachable"), while this
   * is per-HOP runtime truth ("what moved us, this turn"). `by: 'model-pick'` is the
   * case the two disagree on — a `read_skill` pick the gate accepted, into a skill
   * that also has a declared edge whose predicate never fired.
   */
  readonly cursorMove?: {
    readonly from?: string;
    readonly to?: string;
    /** `'entry' | 'route' | 'model-pick' | 'intent' | 'continuity' | 'stay' | 'none'`. */
    readonly by: string;
    /** The turn-start MENU this model pick resolved (SG-C) — present only on
     *  the iteration an accepted pick closed an outstanding menu. */
    readonly offered?: readonly string[];
    /** The accepted pick was reachable but NOT on the offered menu — the
     *  model's divergence, on the record (data under `'assist'`, a refusal
     *  under `'guard'`/`'rails'`, which never reach here). */
    readonly declinedOffer?: boolean;
    /** WHAT the message said that routed this hop (9.28.0) — present only for a
     *  `by: 'entry'` move a DATA matcher (`match:` — RegExp / `{ keywords }` /
     *  `{ all }`) decided. `text` is the matched substring of the USER message,
     *  whitespace-collapsed and bounded to 80 characters (ellipsis included);
     *  `keyword` names WHICH declared keyword hit, for the keywords arm.
     *  Absent for `when` predicates (opaque code), unconditional entries, and
     *  every scorer verdict (whose evidence is its scores). */
    readonly witness?: { readonly text: string; readonly keyword?: string };
    /**
     * The EVIDENCE the winning data GUARD routed on (9.51.0) — present only
     * for a `by: 'route'` move whose firing edge declared a `guard:`. The
     * full per-condition evaluation (verdict `true`): which edge, which tool
     * result it judged, and every declared condition with the summarized
     * value it saw. Structural shape (mirrors the graph's `GuardEvaluation`;
     * events stay decoupled from it).
     */
    readonly guard?: SkillGuardEvaluationRecord;
    /**
     * The data guards that REFUSED this iteration (9.51.0) — guarded edges
     * out of the cursor whose other declared conditions a tool result met
     * and whose guard said no (verdict `false`; at most one record per
     * edge). Rides whatever move resulted — including a `'stay'`, where it
     * answers "why didn't my guarded edge fire?" with the conditions and
     * values that closed it. Absent when no guard decided anything.
     */
    readonly guardsClosed?: readonly SkillGuardEvaluationRecord[];
    /**
     * The REACHABLE set from the cursor this move landed on (9.50.0) — the
     * skill ids the `read_skill` gate will admit on THIS iteration: declared
     * hops out of the landed cursor plus the open skills (`llm-activated`
     * skills the graph wires no edge to). It is the same set, from the same
     * two resolvers, that builds the `read_skill` offer prose and any
     * `skill.rejected.allowed` list this iteration — as DATA, so no consumer
     * has to parse the menu sentence back into ids. `[]` is a fact (a dead
     * end: no hop and no open skill is admissible); ABSENT means the graph
     * predates `reachableSkills` and the set was not on the record.
     */
    readonly reachable?: readonly string[];
  };
  /**
   * Skill-graph entries whose own `when` matched this iteration and which the cursor
   * law kept OFF the wire (8.15.0). A conditional entry is active exactly while the
   * cursor is on it — `when` says where a turn STARTS, not what stays loaded — so an
   * entry whose rule still matches while the graph is elsewhere is suppressed.
   *
   * Read it beside `cursorMove`, which names where the graph went instead: together
   * they answer "why isn't my entry loading?" without re-running a predicate to
   * guess. Absent when nothing was suppressed, and for every non-skill-graph run.
   *
   * Distinct from `agentfootprint.skill.reroute_superseded`, which reports a DISCRETE
   * broken promise (a `read_skill` pick the gate accepted and a declared edge
   * outranked). This is a CONTINUOUS condition — an entry whose rule stays true while
   * the cursor is parked elsewhere is suppressed on every iteration — so it rides the
   * per-iteration event.
   */
  readonly supersededIds?: readonly string[];
}
