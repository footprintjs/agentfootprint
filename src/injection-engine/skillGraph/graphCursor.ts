import type { GuardConditionEvidence } from '../skillGuard.js';
import type { RouteWitness } from '../skillMatch.js';

/**
 * WHY the cursor landed where it did on one iteration — the winning clause of the
 * one cursor resolver, reported rather than guessed (8.5.0).
 *
 *   • `'entry'`      — cold start: the first entry whose `when` passed (or, on a
 *                      cascade graph, a tier-1 start rule won the turn);
 *   • `'route'`      — a declared, `from`-gated edge fired (D1);
 *   • `'model-pick'` — no declared edge fired, so the model's gate-accepted
 *                      `read_skill` pick moved the cursor (D2), at cold start or mid-run;
 *   • `'tool-proposal'` — no declared edge fired and an ACCEPTED
 *                      `propose-transition` tool effect moved the cursor
 *                      (9.19.0) — deterministic tool evidence, ranked between
 *                      the author's edges (D1 still wins) and the model's
 *                      pick (a tool outranks a guess);
 *   • `'intent'`     — the turn-start cascade's tier-2 scorer decisively routed
 *                      the turn (SG-C; `turn_routed` carries the numbers);
 *   • `'continuity'` — the inherited conversation cursor held the turn's start
 *                      (SG-C, `continuity: 'conversation'`);
 *   • `'decider'`    — the configured tier-3 decider resolved an outstanding
 *                      menu out-of-band and the turn starts on its pick
 *                      (9.19.0);
 *   • `'stay'`       — nothing fired; the cursor is sticky and stayed put;
 *   • `'none'`       — no cursor at all (cold start with nothing to enter, or a
 *                      decision `tree()`, which routes by predicate and has no cursor).
 *
 * This exists because the DRAWN provenance on a skill (`metadata.skillGraph`) answers
 * "how is this skill reachable" — a build-time fact — and was being read as "how did
 * we get here this turn". A model pick into a skill that also has a declared edge was
 * therefore attributed to that edge, label and all, in the recorded route.
 */
export type CursorMoveCause =
  | 'entry'
  | 'route'
  | 'model-pick'
  | 'tool-proposal'
  | 'intent'
  | 'continuity'
  | 'decider'
  | 'stay'
  | 'none';

/**
 * One tool result's routing implication inside a parallel batch (9.16.0) —
 * which call it was, and the edge target it matched. Named by
 * `skill.route_conflict` as the winner or a suppressed loser.
 */
export interface RouteBatchOutcome {
  /** The provider's tool_use id for the call. Absent only for a context that
   *  supplied the singular `lastToolResult` (which can never conflict). */
  readonly toolCallId?: string;
  /** The tool whose result matched an edge. */
  readonly toolName: string;
  /** The edge target that result routed to. */
  readonly target: string;
}

/**
 * Two or more results of ONE parallel batch matched edges to DIFFERENT
 * targets (9.16.0). The first in call order wins the cursor; the rest are
 * suppressed — and reported here rather than silently dropped, so the record
 * explains the hop the run did NOT take. Same-target matches are not a
 * conflict (they all asked for the move that happened).
 */
export interface RouteBatchConflict {
  /** The call-order-first match — the one that moved the cursor. */
  readonly winner: RouteBatchOutcome;
  /** Later matches to other targets, in call order, that did not move it. */
  readonly losers: readonly RouteBatchOutcome[];
}

/**
 * One guard's evaluation against one tool result (9.51.0) — the evidence a
 * data guard leaves whenever it DECIDES a hop: which edge, which result it
 * judged, and every condition with the value it saw. Two homes on the move:
 * `CursorMove.guard` (the taken hop's evaluation, verdict `true`) and
 * `CursorMove.guardsClosed` (the refusals, verdict `false`) — both ride
 * `context.evaluated.cursorMove` onto the record.
 */
export interface GuardEvaluation {
  /** The guarded edge. */
  readonly from: string;
  readonly to: string;
  /** The tool result this evaluation judged. */
  readonly toolName: string;
  /** The provider's tool_use id for that call, when the batch carried one. */
  readonly toolCallId?: string;
  /** `true` — the guard passed and the edge fired; `false` — the guard
   *  refused a hop whose other declared conditions were already met. */
  readonly verdict: boolean;
  /** Per-condition evidence, in declaration order — every condition, the
   *  summarized value it was judged against, and whether it passed. */
  readonly conditions: readonly GuardConditionEvidence[];
}

/** The cursor resolver's full answer: where, and by which clause. */
export interface CursorMove {
  /** The cursor after this iteration (what `nextSkill` returns). */
  readonly to?: string;
  /** The cursor before it. */
  readonly from?: string;
  /** The winning clause. */
  readonly by: CursorMoveCause;
  /** Present only when `by: 'route'` resolved a parallel batch whose results
   *  matched edges to different targets — the suppression, on the record.
   *  The Evaluate stage emits it as `agentfootprint.skill.route_conflict`. */
  readonly conflict?: RouteBatchConflict;
  /**
   * The EVIDENCE a tier-1 DATA matcher routed on (9.28.0) — the text out of the
   * user message that made the entry's rule true, bounded (see
   * {@link RouteWitness}). Present only for `by: 'entry'` moves decided by a
   * `match:` (RegExp / `{ keywords }` / `{ all }`) rule; a `when` predicate is
   * opaque code, an unconditional entry matched nothing, and a scorer's
   * evidence is its scores — all three record no witness.
   */
  readonly witness?: RouteWitness;
  /**
   * The EVIDENCE the winning guard routed on (9.51.0) — present only for a
   * `by: 'route'` move whose firing edge declared a `guard:`. The full
   * per-condition evaluation (verdict `true`), decided at the same return as
   * the destination, so the record can never quote a different judgment than
   * the one that routed.
   */
  readonly guard?: GuardEvaluation;
  /**
   * The guards that REFUSED this iteration (9.51.0) — every guarded edge out
   * of the cursor whose OTHER declared conditions a result met and whose
   * guard said no (verdict `false`; at most one record per edge, the first
   * refusal in call order). Present on whatever move resulted — including a
   * `'stay'`, where it answers "why didn't my guarded edge fire?" with the
   * conditions and the values that closed it, the same honesty
   * `supersededEntries` gives suppressed entries. An edge whose
   * `onToolReturn`/`onToolStatus` preconditions never matched is NOT here:
   * its guard never decided anything.
   */
  readonly guardsClosed?: readonly GuardEvaluation[];
}
