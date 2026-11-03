import type { AssessmentCheck, AssessmentReason, HonestyLayer } from './dependencyTypes.js';

// ─── answer (the answer layer — honesty layer 4) ────────────────────────

/**
 * The answer's standing as data — the SAME projection on
 * `agentfootprint.answer.assessed` and on `turn_end.answerAssessment`, built
 * by one function (`assessment/compose.ts` · `assessmentDataOf`) from the one
 * fold (`assessAnswer`) the answer layer runs at the head of the final
 * branch. Names, enums and counts only: the value, its rendering, the reason
 * KINDS and the checks that ran — never a value from the answer, a quote, a
 * witness pointer or the support's digest (those stay on the committed rows
 * `agent.assessment()` folds, with their pointers).
 */
export interface AnswerAssessmentPayload {
  /** The value: `known | unrefuted | unknown | not-applicable`. */
  readonly assessment: 'known' | 'unrefuted' | 'unknown' | 'not-applicable';
  /** The owner's words for it: known · consistent · not sure · ask · not assessed. */
  readonly standing: 'known' | 'consistent' | 'not-sure' | 'ask' | 'not-assessed';
  /** Every reason that fired, by kind, in the fold's order (the ask first, then by layer). */
  readonly reasons: readonly AssessmentReason[];
  /** What actually ran this turn, printed as it is — never a fixed list. */
  readonly checked: readonly {
    readonly layer: HonestyLayer;
    readonly check: AssessmentCheck;
    readonly ran: number;
    readonly of: number;
  }[];
}

/**
 * The answer layer assessed the turn's answer (honesty layer 4,
 * `.answerLayer()`): ONE event per answer, fired at the head of the final
 * branch — after the Route decider's checks filed their verdicts and before
 * the turn's payload is captured. It carries the standing as data
 * ({@link AnswerAssessmentPayload}) with the conversation turn and the
 * answer's iteration. The fold it reports reads committed rows only, so the
 * same recording read afterwards with `assessAnswer` folds the same value
 * (without app declarations — `assessAnswer(record, declarations)` with
 * `rowsAt` can say more than the run did).
 *
 * Where it reaches, and what it is about:
 * - the agent's own listeners only — a composition that mounts the agent
 *   bridges the agent domain, not `answer.*`, so read
 *   `turn_end.answerAssessment` there;
 * - the answer the run COMPOSED: under the evidence gate's `rails` posture a
 *   refused answer is assessed too, and then the run throws (no answer is
 *   delivered, and `agent.assessment()` returns `undefined`).
 */
export interface AnswerAssessedPayload extends AnswerAssessmentPayload {
  /** `AgentState.turnNumber` — the conversation turn. */
  readonly turn: number;
  /** The iteration whose answer was assessed. */
  readonly iteration: number;
}

/** One library-written negative statement, shared by delivery and its event. */
export interface DeliveredNegative {
  readonly kind: 'none' | 'not-found' | 'complete' | 'unknown';
  /** The single public population value derived from admitted searches, never model wording.
   * Omitted for multiple or unknown subjects; their individual scopes remain in the statement. */
  readonly about?: string | number;
  readonly restsOn: readonly string[];
  readonly statement: string;
  readonly delivery: 'record-composed';
  readonly version: string;
}

/** Served negative statements. Codes and identities are diagnostics; the statement is library-written. */
export interface AnswerNegativesPayload {
  readonly field: string;
  readonly version: string;
  readonly delivery: 'as-checked' | 'recorded' | 'fallback';
  readonly claims: readonly DeliveredNegative[];
  readonly checks: readonly {
    readonly id: string;
    readonly path: string;
    readonly index: number;
    readonly kind: 'none' | 'not-found' | 'complete' | 'unknown';
    /** Audit-only: none/not-found was normalized over an explicitly declared absence. */
    readonly notes?: readonly 'absence-kind-normalized'[];
    readonly code: string;
    readonly disposition: 'checked-fail' | 'not-applicable' | 'unreachable';
    readonly tools: readonly string[];
    readonly results: readonly string[];
    /** On a `'stale-turn'` check: the turn the cited result was read on, and when
     *  the read ran (the library's own clock), when it was recorded. */
    readonly staleSince?: { readonly turn: number; readonly readAt?: string };
  }[];
  readonly coverage: readonly { readonly tool: string; readonly checked: number }[];
  readonly actions: readonly {
    readonly tool: string;
    readonly outcome: 'ok' | 'error' | 'not-run';
  }[];
}
