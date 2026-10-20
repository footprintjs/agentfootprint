/** Final-reference refusal uses only an already mounted schema retry, otherwise output denial. */
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';
import type { RouteBranch } from '../stages/route.js';
import type { ResolvedOutputEnforcement } from '../outputEnforcement.js';
import { findingsReferenceRefusal } from './admission.js';

export class FindingsAnswerRefusal extends Error {
  constructor(readonly teaching: string) {
    super('Findings reference admission refused the answer.');
  }
}

/** Throws only after the caller has preserved the attempted standings. */
export function assertAnswerReferences(
  scope: TypedScope<AgentState>,
  declaration: Parameters<typeof findingsReferenceRefusal>[0],
  malformed = 0,
): void {
  const refusal = findingsReferenceRefusal(
    declaration,
    scope.findingsRequest?.[0],
    scope.iteration,
    malformed,
  );
  if (refusal !== undefined) throw new FindingsAnswerRefusal(refusal);
}

export function withFindingsAdmission(
  decider: (scope: TypedScope<AgentState>) => RouteBranch | Promise<RouteBranch>,
  enforcement: ResolvedOutputEnforcement | undefined,
  recordStandings: (scope: TypedScope<AgentState>) => Promise<unknown>,
  announce: (scope: TypedScope<AgentState>, branch: RouteBranch, rationale: string) => void,
  willJudgeAnswer: (scope: TypedScope<AgentState>) => boolean,
): (scope: TypedScope<AgentState>) => Promise<RouteBranch> {
  return async (scope) => {
    const emission = scope.llmLatestContent;
    try {
      // Do not give an output callback an invalid raw proposal. A callback's
      // own rewrite is checked again by the shared peel before any judge.
      if (willJudgeAnswer(scope)) {
        const { peelAnswerFindings } = await import('./peel.js');
        const peeled = peelAnswerFindings(emission);
        if (
          findingsReferenceRefusal(
            peeled.findings,
            scope.findingsRequest?.[0],
            scope.iteration,
            peeled.malformed,
          ) !== undefined
        )
          await recordStandings(scope); // records, then throws the same refusal
      }
      return await decider(scope);
    } catch (error) {
      if (!(error instanceof FindingsAnswerRefusal)) throw error;
      // A host output denial is terminal. The peel already preserved the
      // invalid attempted findings; neither a retry nor a replacement denial
      // may work around the owner's decision to withhold this answer.
      if (scope.messageDeniedPhase === 'output' && scope.messageDeniedReason !== undefined) {
        announce(
          scope,
          'final',
          'host output denial remains terminal; findings retained as diagnostics',
        );
        return 'final';
      }
      const attempt = (scope.outputAttempts?.length ?? 0) + 1;
      if (
        enforcement !== undefined &&
        attempt <= enforcement.retries &&
        scope.iteration < scope.maxIterations &&
        scope.wrapUpAsked !== true &&
        !(scope.costBudgetHit && scope.costBudgetOnExceed === 'halt')
      ) {
        scope.outputSchemaFailure = { attempt, stage: 'schema-validate', error: error.teaching };
        scope.llmLatestContent = emission;
        announce(
          scope,
          'output-retry',
          'findings reference refused; spending a configured output retry',
        );
        return 'output-retry';
      }
      // This is a terminal verdict, not a replacement successful answer.
      // Already streamed drafts remain drafts; Phase A does not buffer them.
      scope.messageDeniedReason = error.teaching;
      scope.messageDeniedPhase = 'output';
      scope.messageDeniedBy = 'findings-reference-admission';
      scope.llmLatestContent = error.teaching;
      announce(
        scope,
        'final',
        'findings reference refused; no configured correction allowance remains',
      );
      return 'final';
    }
  };
}
