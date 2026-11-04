import type { ToolCallsHandlerDeps } from './contracts/handlerDeps.js';
import { processDecisionLedger } from '../../../consentRequest.js';
import { buildHeldAnswer } from './access/heldAnswer.js';
import { buildArgumentRefusal } from './access/argumentValidation.js';
import type { AuthorizationRequiredMode } from '../../../../identity/consent.js';
import { unconfiguredCredentialProvider } from '../../../../identity/types.js';
import { buildToolCredentialsOperations } from './execution/credentialsOperations.js';
import { repeatedCallLedgers } from '../../repeatedCall.js';
import { buildToolLimitsOperations } from './decorators/limitsOperations.js';
import { buildToolIntegrityOperations } from './evidence/integrityOperations.js';
import { buildToolCoverageOperations } from './evidence/coverageOperations.js';
import { buildToolSemanticsOperations } from './evidence/semanticsOperations.js';
import { buildToolStepsOperations } from './routing/stepsOperations.js';
import { buildToolEffectsOperations } from './routing/effectsOperations.js';
import type { TeardownScope } from '../../../../tools/toolSessions.js';
import { buildSearchCoverage } from '../searchCoverage.js';
import { buildToolResourcesOperations } from './execution/resourcesOperations.js';
import { buildToolObservationsOperations } from './observation/observationsOperations.js';
import { buildToolScriptsOperations } from './evidence/scriptsOperations.js';
import { buildToolProgressOperations } from './observation/progressOperations.js';
import { buildToolContextOperations } from './execution/contextOperations.js';
import { buildToolArtifactsOperations } from './execution/artifactsOperations.js';
import { buildToolSettlementOperations } from './batch/settlementOperations.js';
import { buildToolResolver } from '../toolResolver.js';
import { notServedResult } from './helpers/dispatchRefusals.js';
import { buildToolCatalogOperations } from './execution/catalogOperations.js';
import { SKIP_STEP_TOOL_NAME } from '../../../../injection-engine/skillSteps.js';
import { buildToolMiddlewareOperations } from './decorators/middlewareOperations.js';
import { buildResumedInvocation } from './execution/resumedInvocation.js';
import { buildResumeAsk } from './resume/ask.js';
import { buildResumeCheckIn } from './resume/checkIn.js';
import { buildResumeCredential } from './resume/credential.js';
import { buildResumePlain } from './resume/plain.js';
import { buildFindingsAdmission } from './batch/findingsAdmission.js';
import { buildDispatchContext } from './batch/dispatchContext.js';
import { buildCallStart } from './execution/callStart.js';

/** Compose the existing callback families once per handler, preserving their construction order. */
export function composeToolCallOperations(deps: ToolCallsHandlerDeps) {
  const {
    registryByName,
    externalToolProvider,
    providerToolCache,
    servedTools,
    toolClaimants,
    permissionChecker,
  } = deps;
  const toolArgValidation = deps.toolArgValidation ?? 'enforce';
  /** Where answered consent requests are spent — the agent's, else this process's. */
  const decisionLedger = deps.decisionLedger ?? processDecisionLedger();
  const heldAnswer = buildHeldAnswer(() => deps.toolMiddleware, decisionLedger);
  const argumentRefusal = buildArgumentRefusal(toolArgValidation);
  // 8.6.0 — default `'pause'`. Consent is work waiting on a person, and every
  // other place this library needs a person stops the run and asks the caller.
  const onAuthorizationRequired: AuthorizationRequiredMode =
    deps.onAuthorizationRequired ?? 'pause';
  // Fail-closed: when no provider is attached, `ctx.credentials` is a provider
  // that THROWS on use (never undefined) — so a tool can't silently no-op.
  const baseCredentials = deps.credentialProvider ?? unconfiguredCredentialProvider();
  const hasCredentials = deps.credentialProvider !== undefined;
  const { credentialsIn } = buildToolCredentialsOperations(deps, { baseCredentials });
  // The repeated-call counters (9.26.0), run-keyed and OFF tracked scope — an
  // empty Map here, and not one byte written anywhere a reader can see until a
  // tool actually lands. See `../repeatedCall.ts` for why they are not state.
  const repeatLedgers = repeatedCallLedgers();
  const { capResults, refuseOverCeiling } = buildToolLimitsOperations(deps);
  const { judgeColumns, noticeEmptyLookup } = buildToolIntegrityOperations(deps);
  const { declareCoverage, declareRaisedAbsence } = buildToolCoverageOperations(deps, {
    noticeEmptyLookup,
  });
  const { declareSemantics } = buildToolSemanticsOperations(deps);
  const { applySkipStep, applyStepReturn, readSkillStepIntroFor, noteSkillRefusal } =
    buildToolStepsOperations(deps);
  const { warnEffect, applyToolEffects, emitTransitionConflict } = buildToolEffectsOperations(deps);

  /**
   * Every teardown scope an Agent run can honour (9.7.0).
   *
   * All four are real here and each has a firing site: `'call'` in this loop,
   * `'run'` at `Agent.run`'s non-pause terminals, `'session'` at
   * `agent.closeToolSessions(...)`, `'shutdown'` at `agent.shutdown()`. A door
   * that cannot honour one declares a shorter list rather than accepting the
   * registration and never firing it.
   */
  const AGENT_TEARDOWN_SCOPES: readonly TeardownScope[] = ['call', 'run', 'session', 'shutdown'];

  /**
   * The identity + teardown half of a `ToolExecutionContext`.
   *
   * Built per call, from the run accessor rather than from a captured value.
   * Every field is ABSENT when the fact is absent: a tool branching on
   * `ctx.sessionId` must be able to tell "not session-bound" from "bound to
   * something I made up".
   *
   * `redact` is read off the stage's own scope — the run that is actually
   * executing this call (`src/redaction/runRedaction.ts` · `policyInForce`),
   * which is a composition's run when this agent is mounted in one — never
   * off the agent's last standalone run.
   */
  /**
   * The run facts this dispatch serves. A composition MEMBER's come from the
   * run it is mounted in (`scope.memberRun`, `core/memberRun.ts`): the
   * instance's own (`deps.currentRun`) describe some other run — its last
   * standalone caller, or none — and must never reach this run's tools.
   */
  /**
   * `Tool.search` — the call's result identity reserved before dispatch, its
   * coverage composed after (`./searchCoverage.ts`). Inert for every tool
   * that declares no search.
   */
  const searchFunnel = buildSearchCoverage((scope) => runFactsOf(scope)?.runId);
  const { runFactsOf, resourceFactsOf, sessionContext, endCall } = buildToolResourcesOperations(
    deps,
    {
      AGENT_TEARDOWN_SCOPES,
    },
  );
  const { emitToolStart, emitToolEnd } = buildToolObservationsOperations(deps);
  const { fileScript, programOfCall, proposedArgsOf, fileResumedScript, takeCodeRun } =
    buildToolScriptsOperations(deps, {
      get peelCall() {
        return peelCall;
      },
      get resolveTool() {
        return resolveTool;
      },
    });

  /**
   * `ctx.progress` for one dispatch (9.52.0) — the tool's mid-call report.
   *
   * The whole feature is this closure. A tool call is atomic on the record
   * (`tool_start`, then silence for as long as the handler runs, then
   * `tool_end`), and a twelve-hop walk spends forty seconds there with nothing
   * to show. `progress` breaks the silence over the channel already built for
   * it: `typedEmit` mid-stage, so each report carries the real
   * `runtimeStageId`, rides the `agentfootprint.stream.` prefix the EmitBridge
   * already forwards, and lands in recordings with the rest of the run.
   *
   * The three identity facts are stamped HERE, from the dispatch this closure
   * was built for — the tool sends only its own payload. A report that could
   * name its own `toolCallId` could name somebody else's, and a correlation id
   * a consumer cannot trust is worse than none.
   *
   * NEVER fatal: an emit that throws (a recorder that dies at the wrong moment,
   * a scope past its stage) must not fail a tool call that is otherwise
   * succeeding — telemetry is not the work. Named in dev mode rather than
   * swallowed, and once per tool: a twelve-hop walk whose channel is broken
   * would otherwise print twelve identical warnings per call.
   */
  const progressWarned = new Set<string>();
  const { toolProgress } = buildToolProgressOperations({ progressWarned });
  const { toolArtifacts, toolDispatchCtx, runScopeOf } = buildToolContextOperations(deps, {
    runFactsOf,
    registryByName,
    credentialsIn,
    hasCredentials,
    toolProgress,
  });
  const { resolveWantsAtDispatch, assertComponentDeliverable, applyPresent, placeResults } =
    buildToolArtifactsOperations(deps, {
      runScopeOf,
      toolArtifacts,
      get lookupTool() {
        return lookupTool;
      },
    });
  const { historyForCheckIn, settleBatch, bracketSettled } = buildToolSettlementOperations(deps, {
    fileScript,
    get resolveTool() {
      return resolveTool;
    },
    programOfCall,
    get peelCall() {
      return peelCall;
    },
    emitToolStart,
    emitToolEnd,
  });
  const resolveTool = buildToolResolver({
    registryByName,
    ...(externalToolProvider !== undefined && { externalToolProvider }),
    ...(providerToolCache !== undefined && { providerToolCache }),
    ...(servedTools !== undefined && { servedTools }),
    ...(toolClaimants !== undefined && { toolClaimants }),
    notServed: notServedResult,
  });
  const {
    lookupTool,
    unmountedRules,
    warnUnmountedToolPeriod,
    turnStampOf,
    peelsReserved,
    peelCall,
    noteOptionsFor,
    noteOffWire,
    frameworkSkipStepAnswered,
    parkedNow,
    dispatchRoster,
  } = buildToolCatalogOperations(deps, {
    resolveTool,
    get peelArms() {
      return peelArms;
    },
    get frameworkSkipStep() {
      return frameworkSkipStep;
    },
    registryByName,
    externalToolProvider,
    providerToolCache,
  });
  const peelArms = deps.argumentSources === true ? { argumentSources: true } : undefined;
  // The framework's own `skip_step` — `buildToolRegistry` installs it in the
  // dispatch map whenever a skill declares steps. The step bookkeeping below
  // keys on THIS instance having answered, not on the name: since 9.92.0 a
  // provider's `skip_step` on the wire is the provider's to answer, and a
  // procedure must not advance on a call whose contract the model read from
  // somebody else (recorded-not-built, entry 3).
  const frameworkSkipStep = deps.stepPlanFor ? registryByName.get(SKIP_STEP_TOOL_NAME) : undefined;
  const { afterMoment } = buildToolMiddlewareOperations(deps);
  const { resolveCredentialAndExecute } = buildResumedInvocation(deps, {
    dispatchRoster,
    argumentRefusal,
    noteOffWire,
    resolveWantsAtDispatch,
    credentialsIn,
    hasCredentials,
    toolArtifacts,
    toolProgress,
    sessionContext,
    toolDispatchCtx,
    endCall,
    searchFunnel,
    runFactsOf,
    programOfCall,
    proposedArgsOf,
    takeCodeRun,
    declareCoverage,
    declareSemantics,
    refuseOverCeiling,
    judgeColumns,
    warnEffect,
  });

  const { resumeAsk } = buildResumeAsk(deps, {
    decisionLedger,
    resolveTool,
    unmountedRules,
    historyForCheckIn,
    resolveCredentialAndExecute,
    frameworkSkipStepAnswered,
    applySkipStep,
    applyPresent,
    afterMoment,
    placeResults,
    capResults,
    applyStepReturn,
    applyToolEffects,
    emitTransitionConflict,
    settleBatch,
    turnStampOf,
    fileResumedScript,
    emitToolEnd,
    bracketSettled,
    endCall,
  });
  const { resumeCheckIn } = buildResumeCheckIn(deps, {
    decisionLedger,
    resolveTool,
    resolveCredentialAndExecute,
    afterMoment,
    placeResults,
    capResults,
    applyStepReturn,
    applyToolEffects,
    emitTransitionConflict,
    settleBatch,
    turnStampOf,
    fileResumedScript,
    emitToolEnd,
    bracketSettled,
    endCall,
  });
  const { resumeCredential } = buildResumeCredential(deps, {
    resolveTool,
    resolveCredentialAndExecute,
    afterMoment,
    placeResults,
    capResults,
    applyStepReturn,
    applyToolEffects,
    emitTransitionConflict,
    settleBatch,
    turnStampOf,
    fileResumedScript,
    emitToolEnd,
    bracketSettled,
    endCall,
  });
  const { resumePlain } = buildResumePlain(deps, {
    lookupTool,
    peelsReserved,
    afterMoment,
    placeResults,
    capResults,
    applyStepReturn,
    settleBatch,
    turnStampOf,
    fileResumedScript,
    emitToolEnd,
    bracketSettled,
    endCall,
  });

  const { admitFindingsBatch } = buildFindingsAdmission(deps, { peelCall, turnStampOf });

  const { prepareDispatchContext } = buildDispatchContext(deps);

  const { beginDispatchCall } = buildCallStart(deps, {
    resolveTool,
    peelCall,
    programOfCall,
    turnStampOf,
    emitToolStart,
  });
  return {
    resourceFactsOf,
    admitFindingsBatch,
    resolveTool,
    runFactsOf,
    prepareDispatchContext,
    beginDispatchCall,
    permissionChecker,
    unmountedRules,
    warnUnmountedToolPeriod,
    decisionLedger,
    assertComponentDeliverable,
    fileScript,
    programOfCall,
    argumentRefusal,
    parkedNow,
    historyForCheckIn,
    resolveWantsAtDispatch,
    credentialsIn,
    onAuthorizationRequired,
    dispatchRoster,
    noteOffWire,
    hasCredentials,
    toolArtifacts,
    toolProgress,
    sessionContext,
    toolDispatchCtx,
    searchFunnel,
    takeCodeRun,
    warnEffect,
    declareCoverage,
    declareSemantics,
    refuseOverCeiling,
    judgeColumns,
    endCall,
    declareRaisedAbsence,
    noteSkillRefusal,
    frameworkSkipStepAnswered,
    applySkipStep,
    applyPresent,
    afterMoment,
    placeResults,
    noticeEmptyLookup,
    capResults,
    emitToolEnd,
    readSkillStepIntroFor,
    applyStepReturn,
    applyToolEffects,
    repeatLedgers,
    noteOptionsFor,
    turnStampOf,
    emitTransitionConflict,
    heldAnswer,
    peelCall,
    resumeAsk,
    resumeCheckIn,
    resumeCredential,
    resumePlain,
  };
}

/** Internal immutable callback and build-configuration port; no run state or dispatcher. */
export type ToolCallOperations = Readonly<ReturnType<typeof composeToolCallOperations>>;
