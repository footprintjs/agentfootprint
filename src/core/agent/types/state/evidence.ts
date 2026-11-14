import type { PendingEvidenceRecovery, UnsupportedValue } from '../../evidence/types.js';

export interface EvidenceState {
  // ── The evidence gate (`.namesAndNumbersFromEvidence()`, 9.35.0) ────────
  /** In-flight hand-off from the Route decider (which finds the values and
   *  picks the branch) to the recheck stage (which writes the correction).
   *  Not a record — the per-check record rides the emit channel as
   *  `agentfootprint.agent.evidence_checked`, because a per-attempt fact
   *  belongs on that channel and not in a CommitBundle. Always freshly
   *  written by the decider immediately before the branch runs, so it is
   *  never read stale. Absent on an agent without the gate. */
  evidenceUnsupported?: {
    readonly values: readonly UnsupportedValue[];
    /** How many distinct values the answer had to ground, flagged included. */
    readonly candidates: number;
    /** How many of them the gate looked up (exempt values excluded) — carried
     *  to the recheck stage's `evidence_checked` row. */
    readonly lookedUp: number;
    /** Under the figures dial: the late line for the revision request
     *  (`evidence/figures.ts` · `figuresConclusionLine`), composed by Route. */
    readonly conclusion?: string;
    /** Under `code: 'match'`: the match's verdict on the draft's fenced
     *  blocks, for the revision-asked event. Never the code. */
    readonly scripts?: import('../../scripts/types.js').ScriptsVerdict;
    /** Under `code: 'match'`: the revision request's script clause
     *  (`scripts/recovery.ts` · `scriptRecoveryClause`), composed by Route. */
    readonly scriptClause?: string;
  };
  /** The one bounded revision has been spent this turn (9.35.0). Written by
   *  the EvidenceRecheck branch; reset at seed. Absent on an agent without
   *  the gate, and on one whose posture is `'assist'` (which never revises). */
  evidenceRevisionSpent?: boolean;
  /** Internal recovery text for one iteration. Never a conversation turn. */
  evidenceRecovery?: PendingEvidenceRecovery;
  /** Set only after the recovery-bearing provider call succeeds. Kept apart
   * from its carrier so the pre-call record reconstructs the exact request. */
  evidenceRecoveryUsed?: boolean;
  /**
   * The evidence gate asked for its revision while an ENFORCING answer
   * validation governs delivery, so the rest of this run calls no tools.
   * Written by the EvidenceRecheck branch, read in three places and no others:
   *
   *   • `callLLM`, at request assembly — every later call is served no tools;
   *   • the Route decider and the inputs layer (`willDispatch`) — a tool call
   *     the model returns anyway is never dispatched;
   *   • `servedView`, which rebuilds the withheld list from this key.
   *
   * Why: the revision turn used to keep every tool on the wire, so a revision
   * could run a tool that writes or sends again (a second refund) before the
   * answer was withheld. The library cannot tell a tool that only reads, so
   * none is offered. Deliberately NOT seeded: written only by an armed agent
   * on the run whose answer was flagged (the `wrapUpAsked` grammar).
   */
  toolsOffAfterRevision?: boolean;
  /**
   * The answer this run hands back states values that appear in no tool
   * result (9.35.0).
   *
   * Written by the Route decider on the one occasion the check ran and the
   * answer still carried unsupported values with no revision left. Absent on
   * every clean answer and on every agent without the gate.
   *
   * Committed rather than returned for the reason `outputContractUnmet` is:
   * `run()` returns a bare string with nowhere to carry the fact, and under
   * `'assist'` / `'guard'` the library does not get to raise on its own. Under
   * `'rails'` it does, and this is what the boundary reads to do it. Read it
   * after the run with `agent.unsupportedValues()`.
   */
  unsupportedValues?: {
    /** The flagged values, normalized and truncated. */
    readonly values: readonly UnsupportedValue[];
    /** How many distinct values the answer had to ground in total. */
    readonly candidates: number;
    /** True when a revision was asked for and the values survived it. */
    readonly revised: boolean;
    /** True when the answer was WITHHELD (`posture: 'rails'`) rather than
     *  returned with a flag. */
    readonly refused: boolean;
    /** The posture in force, so a reader knows why the answer shipped. */
    readonly posture: 'assist' | 'guard' | 'rails';
  };
}
