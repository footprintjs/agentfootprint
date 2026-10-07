/**
 * A run's TERMINAL VERDICT: the way an agent's run ended that its caller must
 * receive as a typed error, held as a plain value a chart's state can carry.
 *
 * An agent ends some runs on a record in its state instead of a throw — a
 * reliability fail-fast, a policy halt, a denied message, a refused answer —
 * and only its run boundary (`Agent · finalizeResult`) turns that record into
 * the error. A composition mounts the agent's CHART, so that boundary never
 * runs: the composition asks the agent what the mount handed back
 * (`outcomeOf`, duck-typed — `core-flow/` imports no runner): its answer, or
 * the verdict read off the state its chart ended with. It carries the verdict
 * and raises the SAME error (`terminalErrorOf`). One translation, used by the
 * agent's own boundary and by every composition.
 *
 * Leaf module: the error classes only, no runner.
 */
import { AnswerValidationError, type AnswerValidationReport } from '../answer-validation/types.js';
import { failFastErrorOf, type ReliabilityFailRecord } from '../reliability/failFastRecord.js';
import { PolicyHaltError, type PolicyHaltContext } from '../security/PolicyHaltError.js';
import { UnsupportedValuesError, type UnsupportedValuesContext } from './agent/evidence/errors.js';
import { MessageDeniedError, type MessageDeniedContext } from './agent/middleware/errors.js';

/** Each verdict keeps exactly what its error is built from. */
export type TerminalVerdict =
  | { readonly kind: 'reliability-fail-fast'; readonly record: ReliabilityFailRecord }
  | { readonly kind: 'policy-halt'; readonly halt: PolicyHaltContext }
  | { readonly kind: 'message-denied'; readonly denial: MessageDeniedContext }
  | { readonly kind: 'unsupported-values'; readonly refusal: UnsupportedValuesContext }
  | { readonly kind: 'answer-validation'; readonly report: AnswerValidationReport };

/** The typed error a verdict is raised as — the same one the agent's own run raises. */
export function terminalErrorOf(verdict: TerminalVerdict, snapshot?: unknown): Error {
  switch (verdict.kind) {
    case 'reliability-fail-fast':
      return failFastErrorOf(verdict.record, snapshot);
    case 'policy-halt':
      return new PolicyHaltError(verdict.halt);
    case 'message-denied':
      return new MessageDeniedError(verdict.denial);
    case 'unsupported-values':
      return new UnsupportedValuesError(verdict.refusal);
    case 'answer-validation':
      return new AnswerValidationError(verdict.report);
  }
}

/**
 * What a mount of a runner's chart handed back: the runner's ANSWER, or the
 * terminal verdict its chart ended on. A verdict is read ONLY from the chart's
 * state — handed over when the chart returned no result — never from a result.
 */
export type ChildOutcome = { readonly answer: unknown } | { readonly verdict: TerminalVerdict };

/** A runner that reads its own chart's outcome off a mount (an `Agent` does). */
export interface ReadsItsOwnOutcome {
  outcomeOf(sfOutput: unknown): ChildOutcome;
}

/** Whether a runner reads its own chart's outcome. */
export function readsItsOwnOutcome(runner: unknown): runner is ReadsItsOwnOutcome {
  return (
    typeof runner === 'object' &&
    runner !== null &&
    typeof (runner as Partial<ReadsItsOwnOutcome>).outcomeOf === 'function'
  );
}
