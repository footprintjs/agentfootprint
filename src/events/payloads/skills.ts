import type { SkillGuardValueRecord } from './context.js';

// skill.* (9)
/**
 * The turn-start routing verdict (SG-C) — one per turn on skill-graph agents
 * whose graph ran the cascade (`classify` configured, or
 * `continuity: 'conversation'` with something to decide). Fired by the
 * RouteTurn stage DURING traversal (collect-during-traversal; never rebuilt),
 * BEFORE iteration 1, so it precedes every `context.evaluated` of its turn.
 *
 * The LOSERS are on the record: `scores` ranks every candidate the tier-2
 * scorer judged (role-hidden skills are excluded before scoring — a hidden
 * capability is never named, not even to observers of this run); `offered`
 * names the menu the model was handed; `policy` stamps the exact thresholds
 * that judged the hop, so no observer has to guess which numbers decided.
 */
export interface SkillTurnRoutedPayload {
  /** The tier that decided the turn's start:
   *  `'entry'` — a tier-1 rule (the recorded vocabulary for rule-won starts);
   *  `'intent'` — the tier-2 scorer was decisive;
   *  `'continuity'` — the inherited cursor held (incumbent won / near-tie /
   *  sticky default / the decider picked STAY — `decider` says which);
   *  `'menu'` — a menu was put in-band (near-tie or unmatched);
   *  `'decider'` — the configured tier-3 decider resolved the menu
   *  out-of-band (9.19.0; `decider` carries the pick);
   *  `'none'` — the cascade decided nothing the loop may act on (a rails
   *  menu — the offer is still recorded here — or a dropped resume). */
  readonly by: 'entry' | 'intent' | 'continuity' | 'menu' | 'decider' | 'none';
  /** The inherited cursor (continuity), when one existed. */
  readonly from?: string;
  /** Where the turn starts. Absent = menu pending / none. */
  readonly to?: string;
  /** `IntentScorer.name` / entry-scorer name, when tier 2 ran. */
  readonly scorer?: string;
  /** EVERY candidate, ranked best-first — the losers, with the numbers that
   *  lost. `score` is raw (strategy-specific); `relevance` is the
   *  full-softmax share. */
  readonly scores?: ReadonlyArray<{
    readonly id: string;
    readonly score: number;
    readonly relevance: number;
  }>;
  /** The top-vs-2nd PAIRWISE gap actually judged (count-independent — see
   *  routingPolicy.ts; NOT the difference of two `relevance` shares). */
  readonly runnerUp?: { readonly id: string; readonly gap: number };
  /** Whether tier 2 cleared the margin + floor. */
  readonly decisive?: boolean;
  /** WHAT the message said that won tier 1 (9.28.0) — present only on a
   *  `by: 'entry'` verdict a DATA matcher (`match:` — RegExp / `{ keywords }` /
   *  `{ all }`) decided. `text` is the matched substring of the USER message
   *  (never tool or system text), whitespace-collapsed and bounded to 80
   *  characters, ellipsis included; `keyword` names WHICH declared keyword hit
   *  (keywords arm only). Absent for `when` predicates — opaque code the
   *  library cannot quote — and for intent/scorer verdicts, whose evidence is
   *  the `scores` above. */
  readonly witness?: { readonly text: string; readonly keyword?: string };
  /** The tier-3 menu (near-tie cluster, or every entry when unmatched). */
  readonly offered?: readonly string[];
  /** STAY was a first-class option in that menu (mid-conversation). */
  readonly stayOffered?: boolean;
  /** The thresholds that judged this turn, verbatim. `floor` is the EFFECTIVE
   *  floor (`policy.floor ?? scorer.floor`); absent = no floor, so
   *  `unmatched` was unreachable and near-tie governed. */
  readonly policy: {
    readonly nearTieMargin: number;
    readonly menuSize: number;
    readonly floor?: number;
  };
  /** Prior conversational turns the scorer saw (its declared window). */
  readonly window?: number;
  /** A continuity cursor that could not be honored — the stored id is not a
   *  node of the currently mounted graph (a deploy changed it). The turn
   *  started cold instead, and says so. */
  readonly droppedResume?: { readonly id: string; readonly reason: 'unknown-skill' };
  /**
   * The tier-3 DECIDER's involvement (9.19.0) — present whenever one was
   * configured AND a menu verdict reached it. `picked` is the constrained
   * pick that resolved the menu (an offered id, or `'stay'`); ABSENT when
   * the decider declined (`'none'` / parse failure / a throw) and the
   * in-band envelope stood. Recorded on every outcome so the record always
   * says the decider was consulted — a resolver that ran and said nothing
   * is still a fact.
   */
  readonly decider?: {
    readonly provider: string;
    readonly model?: string;
    readonly picked?: string;
  };
}

export interface SkillActivatedPayload {
  readonly skillId: string;
  readonly reason: 'autoActivate' | 'read_skill_result' | 'manual';
  readonly injectedTools?: readonly string[];
  readonly injectedSystemPromptChars?: number;
}

export interface SkillDeactivatedPayload {
  readonly skillId: string;
  readonly reason: string;
}

/**
 * Fired by the skill-graph read_skill GATE when the model tries to `read_skill`
 * a skill that is NOT reachable from the current cursor. The jump is rejected
 * (cursor/activations unchanged); the model gets a synthetic re-prompt naming
 * `allowed`. Powers the lens / Why-panel "it tried to leave the graph here".
 */
/**
 * Fired when a `read_skill` pick the gate ACCEPTED did not end up active — the
 * model was told "Skill 'X' activated for the next iteration" and something else
 * won. There is exactly one way to get here: a declared route edge fired on the
 * same turn (the model emitted a domain tool AND `read_skill` in one message, and
 * the tool's result matched the edge). The author's declared edge wins by design
 * (`D1 > D2`), so the pick is superseded — and reported here rather than silently
 * dropped. The next iteration shows the model where it actually is.
 */
export interface SkillRerouteSupersededPayload {
  /** The skill the model picked with `read_skill` (accepted, then superseded). */
  readonly volunteeredId: string;
  /** The skill the declared edge routed to instead (the cursor that won). */
  readonly wonId?: string;
  /** The cursor the hop started from. */
  readonly fromSkillId?: string;
  /** The ReAct iteration whose evaluation dropped the pick. */
  readonly iteration: number;
  /**
   * WHO volunteered the superseded move (9.19.0). Absent = the model's
   * `read_skill` pick, exactly as this event has always meant;
   * `'tool-proposal'` = an accepted `propose-transition` effect that a
   * same-batch declared edge outran (D1 wins over the proposal exactly as
   * it wins over a pick — the author's determinism is never overridden).
   */
  readonly source?: 'tool-proposal';
}

/**
 * The DECLARED skill map, as the author drew it (9.50.0) — fired ONCE per run,
 * right after `agent.run_configured`, for every agent whose `.skillGraph()`
 * mount could state its map. Nodes and edges come from the BUILT graph
 * (`graph.nodes` / `graph.edges`), never inferred from runtime hops — so a
 * recording carries the complete authored topology, not the lower bound that
 * per-hop `routing[]` provenance names (an edge appears there only once it
 * FIRES). A consumer drawing the graph from a recording no longer has to say
 * "partial" or ask the caller to pass the built graph in.
 *
 * ABSENT (no event) when no graph is mounted, or when a structurally-typed
 * graph carries no `nodes` — the map is then honestly not on the record,
 * never guessed.
 */
export interface SkillGraphDeclaredPayload {
  /** The drawn nodes: `kind: 'skill'` boxes, plus `'predicate'` diamonds for a
   *  decision `tree()`. `description` is the skill's catalog description,
   *  verbatim (the text the model reads) — absent when the skill declares
   *  none. `label` is the drawn caption (predicate nodes). */
  readonly nodes: ReadonlyArray<{
    readonly id: string;
    /** `'skill' | 'predicate'` (reported verbatim from the graph). */
    readonly kind: string;
    readonly description?: string;
    readonly label?: string;
    /** The skill's declared plain name for a person (`defineSkill({ title })`)
     *  — "array estate report" for `array-inventory`. Absent when the skill
     *  declares none (the label a graph draws for a skill node is its id, so
     *  a reader wanting a plain name reads this, never `label`). The model
     *  never reads it. */
    readonly title?: string;
  }>;
  /** The author's edges, verbatim. `from: null` is the synthetic START (an
   *  entry edge — the lens's declared-edge consumers filter on
   *  `from !== null`). `kind` is the declared `SkillEdgeKind`
   *  (`'entry' | 'predicate' | 'on-tool-return' | 'on-tool-status' | 'guard'
   *  | 'model'`). `guard` (9.51.0) is the edge's declared DATA guard,
   *  verbatim — conditions in declaration order, all ANDed, the operator
   *  vocabulary mirroring footprintjs's `WhereFilter` — so a recording's
   *  SkillMap shows its guard conditions without anyone re-reading source. */
  readonly edges: ReadonlyArray<{
    readonly from: string | null;
    readonly to: string;
    readonly kind: string;
    readonly label?: string;
    readonly guard?: {
      readonly conditions: ReadonlyArray<{
        readonly key: string;
        readonly op: string;
        readonly value: SkillGuardValueRecord;
      }>;
    };
  }>;
}

export interface SkillRejectedPayload {
  /** The skill id the model requested via `read_skill`. */
  readonly requestedId: string;
  /** The cursor it was at (undefined = cold start, before any entry resolved). */
  readonly currentSkillId?: string;
  /**
   * What the model was TOLD it could reach — role-filtered (9.86.0).
   *
   * No longer the set the call was bounded to: admission still reads the
   * graph's raw set, and this is the SPEAKING set, so a skill the caller's
   * `PermissionChecker` hides never appears here. Empty is therefore two
   * different facts — nothing was reachable, or nothing reachable may be named
   * — and a reader that needs them apart wants the run's graph, not this row.
   */
  readonly allowed: readonly string[];
  /** The ReAct iteration the rejection fired on. */
  readonly iteration: number;
  /** Present when a POSTURE, not reachability, refused (SG-C `strictness`):
   *  `'guard'` — the pick was reachable but off the outstanding menu (or no
   *  menu was outstanding); `'rails'` — routing picks are refused outright
   *  (rules/scorer route turn starts; declared routes handle transitions).
   *  Absent = today's reachability refusal, unchanged. */
  readonly posture?: 'guard' | 'rails';
  /** WHICH ARM of the gate answered (9.84.0) — optional, so every consumer
   *  written against the older shape keeps working unchanged:
   *
   *   • `'self-call'` — `requestedId === currentSkillId`. The model asked for
   *     the skill it is already in; the cursor did not move because there was
   *     nowhere to move it, and the tool result is an acknowledgement naming
   *     the tools it can call, not a decline. Consumers that count refusals as
   *     routing failures should read this one as a NAMING failure instead.
   *   • `'unreachable'` — a genuine hop the cursor cannot make.
   *   • `'posture'` — a reachable hop a declared `strictness` declined; pairs
   *     with {@link SkillRejectedPayload.posture}, which names which one.
   *
   *  Before this, telling a self-call from an unreachable hop meant comparing
   *  `requestedId` against `currentSkillId` and knowing why that mattered. */
  readonly reason?: 'self-call' | 'unreachable' | 'posture';
}

/**
 * Fired when two or more tool results of ONE parallel batch matched skill-graph
 * edges to DIFFERENT targets (9.16.0). The first match in call order wins the
 * cursor move; every later result matching another target is suppressed — and
 * reported here so the record explains the hop the run did not take. Before
 * 9.16.0 there was no conflict to report because there was no batch: only the
 * LAST call of a batch was consulted, and the earlier calls' routing
 * implications were silently dropped.
 *
 * Not fired for same-target matches (they all asked for the move that
 * happened), nor for batches where only one result matched. Distinct from
 * `skill.reroute_superseded`, which reports a declared edge outranking a
 * `read_skill` pick — this one is edge-vs-edge, inside one batch.
 */
export interface SkillRouteConflictPayload {
  /** The ReAct iteration whose evaluation resolved the batch. */
  readonly iteration: number;
  /** The cursor the winning hop started from. */
  readonly fromSkillId?: string;
  /** The call-order-first match — the one that moved the cursor. */
  readonly winner: {
    /** The provider's tool_use id for the winning call, when known. */
    readonly toolCallId?: string;
    readonly toolName: string;
    /** The skill the cursor moved to. */
    readonly target: string;
  };
  /** Later matches to other targets, in call order — the suppressed hops. */
  readonly losers: ReadonlyArray<{
    readonly toolCallId?: string;
    readonly toolName: string;
    /** The skill this result would have routed to. */
    readonly target: string;
  }>;
  /**
   * WHAT conflicted (9.19.0). Absent = declared route edges, exactly as
   * this event has always meant; `'tool-proposal'` = two or more accepted
   * `propose-transition` effects of one batch named different targets —
   * first accepted in call order wins, the rest are suppressed and
   * reported here under the same law.
   */
  readonly source?: 'tool-proposal';
}

/**
 * A declared step completed: its tool returned (non-error) while it was
 * current (9.18.0). Fired at the tool-return boundary, in batch call order —
 * two adjacent steps naming the same tool advance twice in one batch, each
 * on the record. A skip is NOT a completion: a `skip_step` that moved the
 * pointer fires `step_skipped { policy: 'advance' }` alone.
 */
export interface SkillStepAdvancedPayload {
  readonly skillId: string;
  /** The step that just completed (or was skipped past). */
  readonly step: {
    readonly index: number;
    readonly total: number;
    readonly tool: string;
    readonly note: string;
  };
  readonly iteration: number;
  /** The provider's tool_use id for the completing call, when known. */
  readonly toolCallId?: string;
  /** Present on the LAST step: the procedure finished. */
  readonly completed?: true;
}

/**
 * The model declined a step, with its reason — the integrity condition, not
 * polish (9.18.0). The framework moved on or held per the skill's declared
 * `onSkip`; both facts are here. An empty reason never gets this far: the
 * tool-calls stage answers it with a teaching result and no event.
 */
export interface SkillStepSkippedPayload {
  readonly skillId: string;
  readonly step: SkillStepAdvancedPayload['step'];
  /** The model's own words. */
  readonly reason: string;
  readonly policy: 'advance' | 'hold';
  readonly iteration: number;
  readonly toolCallId?: string;
}

/**
 * The turn is ending with steps unrun (9.18.0). `'nudged'` = the one
 * teaching re-ask went back (at most once per turn); `'accepted'` = the
 * model stopped again and the framework honored it — never a forced
 * continue; `'cut-short'` = a limit (max-iterations / cost-budget) ended
 * the turn, and a nudge would have spent an iteration the limit refused.
 */
export interface SkillStepsUnfinishedPayload {
  readonly skillId: string;
  readonly remaining: ReadonlyArray<{
    readonly index: number;
    readonly tool: string;
    readonly note: string;
  }>;
  readonly total: number;
  readonly action: 'nudged' | 'accepted' | 'cut-short';
  readonly iteration: number;
}

/**
 * The turn's refusal loop crossed the declared threshold and the rest of the
 * turn runs on the escalation brain (9.19.0). Fired ONCE per turn, at the
 * flip, from the gate that counted the refusals — escalation is always on
 * recorded evidence (`skill.rejected` — reachability, posture or a self-call,
 * all three refusal arms), never on
 * vibes. De-escalation is the next turn's seed; no event marks it.
 */
export interface SkillEscalatedPayload {
  /** The ReAct iteration whose refusal tripped the threshold. */
  readonly iteration: number;
  /** The declared threshold (`escalation.afterRefusals`). */
  readonly afterRefusals: number;
  /** The observed refusal count that tripped it (== afterRefusals at the
   *  flip; the counter keeps counting but the event fires once). */
  readonly refusals: number;
  /** The brain that WAS serving — resolved by the same precedence chain
   *  callLLM applies (skill brain > configured > default). */
  readonly from: { readonly provider: string; readonly model: string };
  /** The declared escalation brain. `model` absent = it inherits down the
   *  chain (same-provider escalations only; enforced at build). */
  readonly to: { readonly provider: string; readonly model?: string };
}
