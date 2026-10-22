import type { TypedScope } from 'footprintjs';
import {
  claimChecksOf,
  evidenceCheckOf,
  executeAnswerValidation,
  type AnswerCheck,
  type ResolvedAnswerValidation,
  type AnswerValidationReport,
} from '../../../answer-validation/index.js';
import { ledgerAtCheck } from '../../../answer-validation/toolLedger.js';
import type { ArtifactStore } from '../../../artifacts/types.js';
import type { OutputSchemaParser } from '../../../answer-validation/outputSchema.js';
import type { DeclaredClaim } from '../../../integrity/unsupported-claim/check.js';
import type { AgentState } from '../types.js';
import { answerEvidenceOf } from './answerEvidence.js';
import type { RouteBranch } from './route.js';

/** Wrap only the configured agent's terminal decision, in the outer scope.
 * The final branch can consume the verdict, while snapshots retain its owner.
 * A refusal stops before conversation capture and memory writes — stopped by
 * the final branch's guard (`prepareFinal.ts` · `withheldByValidation`), not
 * by a break here: a decider that breaks ends the chart with the branch name
 * as its result, and a composition mounting the chart took `'final'` for the
 * agent's answer. Routed on, the chart ends with no answer and the verdict in
 * its state (`core/terminalVerdict.ts`).
 *
 * `claims` is the agent's `.claims()` contract, read only when
 * `config.agentChecks` lists `'claims'` (refused here without one, so a listed
 * check can never silently judge nothing). */
export function withAnswerValidation(
  decide: (scope: TypedScope<AgentState>) => RouteBranch | Promise<RouteBranch>,
  config: ResolvedAnswerValidation,
  parser: OutputSchemaParser<unknown> | undefined,
  store: ArtifactStore | undefined,
  hasOutstandingConsent: () => boolean,
  nativeOutput = false,
  claims?: readonly DeclaredClaim[],
): (scope: TypedScope<AgentState>) => Promise<RouteBranch> {
  if (parser === undefined) {
    throw new Error('Agent.answerValidation requires .outputSchema(parser).');
  }
  const declaredClaims = claims ?? [];
  if (config.agentChecks.includes('claims') && declaredClaims.length === 0) {
    throw new Error("Agent.answerValidation({ agentChecks: ['claims'] }) requires .claims().");
  }
  return async (scope) => {
    const branch = await decide(scope);
    if (branch !== 'final') return branch;
    // `strategy: 'native'` only (read only then, so other agents keep their
    // bytes): an answer whose attempt the Route decider failed on a provider
    // stop ('refusal', 'max_tokens') may still parse — it is not schema-accepted.
    const nativeStop = nativeOutput ? scope.outputContractUnmet?.stopReason : undefined;
    const priorRefusal =
      scope.messageDeniedReason !== undefined ||
      scope.unsupportedValues?.refused === true ||
      hasOutstandingConsent() ||
      nativeStop !== undefined;
    if (priorRefusal) {
      const report: AnswerValidationReport = {
        validatorId: config.id,
        validatorVersion: config.version,
        mode: config.mode,
        status: 'unverified',
        checked: 0,
        failed: 0,
        unreachable: 0,
        notApplicable: 0,
        checks: [],
        resolvedRefs: [],
        schemaAccepted: false,
        reason: nativeStop !== undefined ? `provider-stop:${nativeStop}` : 'prior-refusal',
      };
      scope.answerValidation = report;
      // A provider stop is the schema's verdict, not a refusal by a rule: it
      // withholds only in `enforce` — `observe` hands the answer back with
      // the report, as the same agent without validation would.
      if (nativeStop === undefined || config.mode === 'enforce') {
        scope.answerValidationBlocked = true;
      }
      return 'final';
    }
    const identity = scope.runIdentity;
    const result = await executeAnswerValidation(
      scope.llmLatestContent,
      parser,
      config,
      store,
      {
        conversationId: identity.conversationId,
        ...(identity.tenant !== undefined && { tenant: identity.tenant }),
        ...(identity.principal !== undefined && { principal: identity.principal }),
      },
      scope.$getEnv().signal,
      // This run's own ledger, read off its own state at the moment of the
      // check — never another run's, never a cached copy. Incomplete while a
      // call is open or the last reply's calls never went out (this is the
      // terminal branch, so they never will). `executeAnswerValidation`
      // detaches and freezes it before the check runs.
      ledgerAtCheck(scope.toolCallLedger, undispatchedCalls(scope)),
      agentRowsFor(scope, config, declaredClaims),
    );
    scope.answerValidation = result.report;
    if (config.mode === 'enforce' && result.report.status !== 'passed') {
      scope.answerValidationBlocked = true;
    } else {
      scope.llmLatestContent = result.content ?? scope.llmLatestContent;
    }
    return 'final';
  };
}

/**
 * The rows of the agent's own checks this validation lists, every one judged
 * on the candidate it DELIVERS (`answer-validation/agentChecks.ts`) — after
 * every output transform, never the draft the Route decider judged. Reads
 * state only for a listed check: this Route stage's evidence judge, the claim
 * ledger for `'claims'`. `undefined` when nothing is listed.
 */
function agentRowsFor(
  scope: TypedScope<AgentState>,
  config: ResolvedAnswerValidation,
  claims: readonly DeclaredClaim[],
): ((candidate: unknown, canonical: string) => readonly AnswerCheck[]) | undefined {
  if (config.agentChecks.length === 0) return undefined;
  const listsEvidence = config.agentChecks.includes('names-and-numbers');
  const listsClaims = config.agentChecks.includes('claims');
  const judge = listsEvidence ? answerEvidenceOf(scope) : undefined;
  const ledger = listsClaims ? [...(scope.claimFacts ?? [])] : [];
  const epoch = listsClaims ? (scope.iteration as number | undefined) ?? 0 : 0;
  // Fixed order — the Route decider's own: the evidence gate, then the claims.
  return (candidate, canonical) => [
    ...(listsEvidence ? [evidenceCheckOf(judge?.(canonical))] : []),
    ...(listsClaims ? claimChecksOf(claims, ledger, candidate, epoch) : []),
  ];
}

/** Calls the model asked for that the terminal branch will never dispatch:
 *  the last reply's (all but a forced-output strategy's own answer tool), or —
 *  on a wrapped-up turn, whose last reply was asked with the tools withheld —
 *  the cut-off reply's, which the route recorded on `stoppedEarly`. */
function undispatchedCalls(scope: TypedScope<AgentState>): number {
  const calls = scope.llmLatestToolCalls ?? [];
  const forced = scope.forcedOutputToolName;
  let count = 0;
  for (const call of calls) if (call?.name !== forced) count += 1;
  const cutOff = scope.stoppedEarly?.pendingToolCalls;
  return Math.max(count, typeof cutOff === 'number' ? cutOff : 0);
}
