import { callOccurrenceField } from '../../../../../lib/callOccurrence.js';
import { batchAddress } from '../../../arguments/batchAddress.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import { markWantedResultsRead } from '../../../honesty/libraryResultLimits.js';
import { recordToolEntry } from '../../../honesty/enteredToolCalls.js';
import type { PausedGatePolicy } from '../../../types/state/pause.js';
import type { Resolution, ResumedCallFacts } from '../contracts/callFacts.js';
import { isPauseRequest } from '../../../../pause.js';
import {
  type ToolResultStatus,
  explainStatusOnlyNearMiss,
  unknownStatusOf,
  unknownStatusWarning,
} from '../../../../../semantics/toolEffects.js';
import { bindToolSecurityEvents } from '../../../toolSecurityEvents.js';
import { unknownToolResult } from '../helpers/dispatchRefusals.js';
import type { ArtifactMeta } from '../../../../../artifacts/types.js';
import { reportingCredentials } from '../decorators/reportingCredentials.js';
import {
  type NegativeDispatch,
  startNegativeCall,
  captureNegativeResult,
  keepNegativeResultOut,
} from '../../../negativeClaims/capture.js';
import { type CodeRunSlot, CODE_RUN_SLOT } from '../../../../codeRunnerTool.js';
import { requestEvidenceFor } from '../../../../../tools/requestEvidence.js';
import { mcpClientUseFor } from '../../../../../tools/mcpClientUse.js';
import { runEndedBy, runsAsAsked, gatedCallOf } from '../../../../consentRequest.js';
import { rewrittenAfterApproval } from '../access/bindings.js';
import { recheckResumedCall, recordResumedRefusal } from '../access/resumedAdmission.js';
import { resumedCredential } from './resumedCredential.js';
import { resumedPauseRefusal } from './resumedPauseRefusal.js';
import { classifyToolFailure } from './outcomeField.js';
import { awaitUnder } from '../../../../../lib/abort.js';
import type { InputsDispatch } from '../contracts/inputsDispatch.js';
import type {
  ResumedCallResult,
  ResumedInvocation,
  ResumedInvocationLinks,
} from '../contracts/operations/resumedInvocation.js';
import { nativeResultFinalizer } from '../../../resultRowsets/finalization.js';
import { bindOuterCall, type OuterCallBinding } from '../../../innerCallOuter.js';
import { readExecutedResult } from './readExecutedResult.js';

/** Compose the existing resumed invocation without changing its catch/cleanup boundary. */
export function buildResumedInvocation(
  deps: Pick<
    ToolCallsHandlerDeps,
    | 'inputsLayer'
    | 'permissionChecker'
    | 'toolMiddleware'
    | 'clearConsentOutstanding'
    | 'reportConsentOutstanding'
    | 'time'
    | 'negativeClaimsArmed'
    | 'sourceEvidenceConfig'
    | 'citationOptions'
    | 'columnCheckMode'
    | 'resultRowsetsFor'
    | 'integrityLedger'
    | 'answerLayer'
    | 'currentRun'
    | 'isRunRetired'
  >,
  links: ResumedInvocationLinks,
): ResumedInvocation {
  // Resolve a tool's declared credential (declare-and-push) and execute it,
  // emitting the same credential.* events as the main loop. Used by the
  // check-in RESUME path when a human APPROVES — the tool never ran at pause
  // time (that's the whole point: consent BEFORE credentials + execute), so it
  // runs now. Fail-closed: a blocked/failed credential surfaces to the model
  // and the tool does NOT run. A tool that pauses again during an approved
  // resume can't re-pause (resume returns void), so that is surfaced as an error.
  //
  // `heldTo` names the consent gate a person approved this call through (a
  // check-in, an ask, or credential consent). Its arguments are then held to the request once more
  // at the last moment before `execute` — defence in depth behind the frozen
  // copies every app callback is handed (`lib/frozenCopy.ts`). Entry requires
  // the original bound call to re-derive the request's id (`runsAsAsked`).
  const executeResumed = async (
    binding: OuterCallBinding,
    scope: TypedScope<AgentState>,
    resolved: Resolution,
    toolName: string,
    approved: Readonly<Record<string, unknown>>,
    toolCallId: string,
    iteration: number,
    env: ReturnType<TypedScope<AgentState>['$getEnv']>,
    heldTo: PausedGatePolicy['gate'],
    seen?: ResumedCallFacts,
  ): Promise<ResumedCallResult> => {
    const tool = resolved.tool;
    const occurrence = callOccurrenceField(seen?.callOccurrenceKey);
    if (seen !== undefined)
      seen.resultFinalizer = nativeResultFinalizer(
        scope,
        tool,
        { toolName, toolCallId, iteration, ...occurrence },
        deps,
        links.runFactsOf(scope)?.runId,
        resolved.party,
      );
    /** What the approval covers — the arguments as handed in, before any
     *  `wants` resolution or clock redraw derives the ones `execute` gets. */
    let prepared = approved;
    const emitSecurity = bindToolSecurityEvents(scope, { toolCallId, iteration, ...occurrence });
    // The two refusals share one door here too (9.92.0): a name nothing holds,
    // and a name whose offered party cannot answer on this resume.
    if (!tool) {
      return {
        result: resolved.refusal ?? unknownToolResult(toolName, links.dispatchRoster(scope)),
        error: true,
      };
    }
    env.signal?.throwIfAborted();
    if (
      heldTo === 'credential' &&
      (tool.needs === undefined || tool.needs.credential !== scope.pausedCredentialService)
    ) {
      return { result: `Tool '${toolName}' could not be authorized after the wait.`, error: true };
    }
    const inputs: InputsDispatch | undefined =
      deps.inputsLayer === true ? await import('../../../arguments/dispatch.js') : undefined;
    const unmounted = links.unmountedRules(tool, toolName);
    const rulesRefusal =
      inputs
        ?.resolutionsFor(scope, iteration)
        .get(batchAddress(toolCallId, seen?.callOccurrenceKey))?.refused ??
      (unmounted === undefined ? undefined : await unmounted);
    if (rulesRefusal !== undefined) return { result: rulesRefusal, error: true };
    const invalidArgs = links.argumentRefusal(scope, tool, approved, {
      toolName,
      toolCallId,
      iteration,
    });
    if (invalidArgs !== undefined) return { result: invalidArgs, error: true };
    links.noteOffWire(scope, resolved, { toolName, toolCallId, iteration, ...occurrence });
    // Declared artifact arguments (9.22.0) — the same resolution the batch
    // loop applies, at this door: a resumed call's refs are judged exactly
    // as an inline call's, BEFORE credentials, and a refusal means the tool
    // does not run.
    let wantedMeta: Readonly<Record<string, ArtifactMeta>> | undefined;
    if (tool.wants !== undefined) {
      const resolution = await links.resolveWantsAtDispatch(
        scope,
        toolName,
        tool.wants,
        approved,
        tool.schema.inputSchema,
      );
      if (!resolution.ok) return { result: resolution.refusal, error: true };
      prepared = resolution.args;
      wantedMeta = resolution.wanted;
    }
    let executed = false;
    let toolInvoked = false;
    let negativeDispatch: NegativeDispatch | undefined;
    /** What the run ended with, when it ended before the call could run. */
    let ended: Error | undefined;
    try {
      // The time layer's dispatch moment — a resumed call is dispatched NOW,
      // so its `dispatchedAt` is the resume's, not the pause's.
      const dispatched =
        deps.time !== undefined
          ? (await import('../../timeLayer.js')).timeAtDispatch(
              scope,
              { toolCallId, toolName, ...occurrence },
              iteration,
              tool,
              prepared,
              deps.time.appZone,
            )
          : undefined;
      const callTime = dispatched?.context;
      const access = await recheckResumedCall(scope, deps, {
        ...occurrence,
        gate: heldTo,
        tool,
        toolName,
        toolCallId,
        iteration,
        args: dispatched?.args ?? prepared,
        env,
        parkedNow: links.parkedNow,
        historyForCheckIn: links.historyForCheckIn,
      });
      if (!access.allowed) return access.refusal;
      const { args } = access;
      const credentials = await awaitUnder(env.signal, () =>
        resumedCredential(
          scope,
          deps,
          links.credentialsIn,
          tool,
          toolName,
          iteration,
          emitSecurity,
        ),
      );
      if (!credentials.ok) return { result: credentials.result, error: true };
      const resolvedCredential = credentials.credential;
      // Keep runner facts on this dispatch even when another call reuses its provider ID.
      const codeRunSlot: CodeRunSlot = {};
      const executionContext = {
        [CODE_RUN_SLOT]: codeRunSlot,
        toolCallId,
        iteration,
        ...(callTime !== undefined && { time: callTime }),
        ...(env.signal && { signal: env.signal }),
        credentials: reportingCredentials(
          links.credentialsIn(scope, tool.needs?.credential),
          emitSecurity,
          toolName,
        ),
        hasCredentials: links.hasCredentials,
        ...(resolvedCredential && { credential: resolvedCredential }),
        ...links.toolArtifacts(
          scope,
          toolName,
          toolCallId,
          seen?.resultFinalizer?.needsPublications,
          seen?.callOccurrenceKey,
          binding,
          seen,
        ),
        ...(wantedMeta !== undefined && { wanted: wantedMeta }),
        ...links.toolProgress(scope, { toolName, toolCallId, iteration, ...occurrence }),
        ...requestEvidenceFor(scope, { toolName, toolCallId, iteration, ...occurrence }),
        ...mcpClientUseFor(scope, { toolCallId }),
        ...links.sessionContext(scope, toolName, toolCallId),
        // The resume doors hand their gates the committed history; so does an inner call.
        ...links.toolDispatchCtx(
          scope,
          {
            toolName,
            toolCallId,
            iteration,
            history: () => [...(scope.history ?? [])],
            binding,
          },
          env.signal,
        ),
      };
      // The last moment before the call runs, after every await that prepared
      // it — its artifacts (`wants`), its credential (`needs`), its clock, and
      // on an ask the rest of the chain. The engine stops waiting on an
      // aborted run's stage (a hang-up, a deadline), but the stage goes on:
      // a call never runs for a caller already told the run ended. Thrown past
      // the catch below — the run ended, the tool did not fail.
      ended = runEndedBy(env.signal);
      if (ended !== undefined) throw ended;
      // An approved call runs with the arguments its request binds, or not
      // at all — asked here, after every callback that saw them has returned.
      const read = (key: string): unknown => scope.$getValue(key);
      const approvalChanged =
        heldTo !== 'credential' &&
        !runsAsAsked(read('pausedRequest'), gatedCallOf(read, heldTo), approved);
      if (approvalChanged || !access.matchesPrepared(args)) {
        // Nothing ran. Release the sessions as for a run that ended here.
        await links.endCall(scope).catch(() => undefined);
        recordResumedRefusal(
          scope,
          { toolName, toolCallId, iteration, ...occurrence },
          'call-changed',
        );
        return {
          result: rewrittenAfterApproval(
            toolName,
            'those arguments changed before the call could run',
          ),
          error: true,
        };
      }
      // `Tool.search`: reserved, with the dispatch instant, just before the
      // call runs — as in the batch loop.
      const searchDispatch = links.searchFunnel.dispatch(scope, tool, callTime);
      negativeDispatch =
        deps.negativeClaimsArmed === true
          ? startNegativeCall(scope, {
              tool,
              party: resolved.party,
              args,
              toolCallId,
              ...occurrence,
              iteration,
              runId: links.runFactsOf(scope)?.runId,
              dispatch: searchDispatch,
              context: executionContext,
            })
          : undefined;
      seen?.resultFinalizer?.entered(
        executionContext,
        args,
        negativeDispatch?.resultId ?? searchDispatch?.resultId,
      );
      executed = true;
      if (seen !== undefined) {
        // Read now, before any tool code runs: what the call proposed and
        // what `execute` is handed — values, never the arguments object.
        seen.entered = true;
        seen.proposed = links.programOfCall(
          tool,
          links.proposedArgsOf(scope, toolCallId, seen.callOccurrenceKey) ?? args,
        );
        seen.submitted = links.programOfCall(tool, args);
      }
      let result: unknown;
      let returned = false;
      try {
        markWantedResultsRead(scope, wantedMeta);
        recordToolEntry(scope, seen?.callOccurrenceKey);
        toolInvoked = true;
        result = await tool.execute(args, executionContext);
        returned = true;
        seen?.resultFinalizer?.captureReturned?.(result);
      } finally {
        await binding.close(env.signal);
        if (seen !== undefined) seen.toolResultExecution = returned ? 'returned' : 'threw';
      }
      ended = runEndedBy(env.signal);
      if (ended !== undefined) throw ended;
      seen?.resultFinalizer?.returned();
      // The runner's facts, at this execute boundary as at the batch loop's.
      const codeRun = links.takeCodeRun(scope, tool, codeRunSlot, {
        toolName,
        toolCallId,
        takeListed: false,
      });
      if (seen !== undefined && codeRun !== undefined) seen.codeRun = codeRun;
      if (negativeDispatch !== undefined)
        result = captureNegativeResult(scope, negativeDispatch, result, tool);
      await links.endCall(scope);
      const searchBoundary = (status: ToolResultStatus | undefined) => ({
        call: { toolName, toolCallId, iteration, ...occurrence },
        tool,
        ...(resolved.party !== undefined && { party: resolved.party }),
        args: negativeDispatch?.args ?? args,
        ...(searchDispatch !== undefined && { dispatch: searchDispatch }),
        ...(status !== undefined && { status }),
      });
      // The typed effects channel (9.19.0) — same unwrap as the batch loop,
      // at this path's own execute boundary, so a resumed call's envelope is
      // judged exactly as an inline one's.
      const envelope = readExecutedResult(tool, result, codeRunSlot);
      if (envelope !== undefined) {
        // Coverage (this release) before the ceiling, for the same reason the
        // effects are judged even when the payload is refused: the boundary a
        // tool declared is not the channel that can overflow, and a limit
        // that died with an oversized result would be the silence this
        // primitive exists to break. An absence's status is the tool's own
        // and wins over the envelope's only when the envelope declared none.
        const searched = links.searchFunnel.compose(
          scope,
          searchBoundary(envelope.status),
          envelope.content,
        );
        const declaredContent = searched !== undefined ? searched.value : envelope.content;
        const coverageStatus = links.declareCoverage(
          scope,
          { toolName, toolCallId, iteration, ...occurrence },
          declaredContent,
          searched?.reading,
        );
        const declaredStatus = envelope.status ?? coverageStatus;
        // The semantic envelope (9.53.0), on the unwrapped content — the
        // effects+semantics composition point: full envelope to the record,
        // projection to the model. BEFORE the ceiling, which must measure
        // what the model will actually read.
        const semanticView = links.declareSemantics(
          scope,
          { toolName, toolCallId, iteration, ...occurrence },
          declaredContent,
        );
        const content = semanticView ?? declaredContent;
        // The tool's own ceiling (9.20.0) measures the CONTENT — the channel
        // that can overflow a context window. The DECLARED effects are small
        // validated data and are still judged by the caller: a tool that
        // proposed a transition and overflowed its payload does not lose the
        // transition. The delivered status becomes 'invalid' (the declared
        // status described a result the model never received — the
        // `result_refused` event keeps what was declared).
        const refusal = links.refuseOverCeiling(
          scope,
          { toolName, toolCallId, iteration, ...occurrence },
          tool,
          content,
          declaredStatus,
        );
        if (refusal !== undefined) {
          if (negativeDispatch !== undefined)
            keepNegativeResultOut(scope, negativeDispatch.resultId);
          if (seen !== undefined) seen.overCeiling = true;
          return {
            result: refusal,
            executed: true,
            negativeResultId: negativeDispatch?.resultId,
            ceilingRefused: true,
            envelope: { ...envelope, content: refusal, status: 'invalid' },
          };
        }
        // The column-type contract (9.78.0), at the same door and one step
        // after the ceiling. `'warn'` files and returns undefined — this
        // path keeps every byte it had.
        const columnRefusal = links.judgeColumns(
          scope,
          { toolName, toolCallId, iteration, ...occurrence },
          content,
        );
        if (columnRefusal !== undefined) {
          if (negativeDispatch !== undefined)
            keepNegativeResultOut(scope, negativeDispatch.resultId);
          return {
            result: columnRefusal,
            executed: true,
            negativeResultId: negativeDispatch?.resultId,
            // The ceiling's flag, reused for the ceiling's reason: a refused
            // payload must not advance the step pointer on any path, and
            // there is exactly one fact here — the model did not get the
            // result — not two spellings of it.
            ceilingRefused: true,
            envelope: { ...envelope, content: columnRefusal, status: 'invalid' },
          };
        }
        return {
          result: content,
          executed: true,
          negativeResultId: negativeDispatch?.resultId,
          envelope:
            declaredStatus === envelope.status && content === envelope.content
              ? envelope
              : {
                  ...envelope,
                  content,
                  ...(declaredStatus !== undefined && { status: declaredStatus }),
                },
        };
      }
      // An envelope in every way but an unknown status word is data — read
      // the word off the value the tool returned, before anything rewrites it.
      const unknownStatus = unknownStatusOf(result);
      if (unknownStatus !== undefined)
        links.warnEffect(toolName, unknownStatusWarning(unknownStatus));
      const searched = links.searchFunnel.compose(scope, searchBoundary(undefined), result);
      if (searched !== undefined) result = searched.value;
      const coverageStatus = links.declareCoverage(
        scope,
        { toolName, toolCallId, iteration, ...occurrence },
        result,
        searched?.reading,
      );
      // The semantic envelope (9.53.0) on this path's own execute boundary —
      // a resumed call's envelope is judged exactly as an inline one's.
      const semanticView = links.declareSemantics(
        scope,
        { toolName, toolCallId, iteration, ...occurrence },
        result,
      );
      if (semanticView !== undefined) result = semanticView;
      const refusal = links.refuseOverCeiling(
        scope,
        { toolName, toolCallId, iteration, ...occurrence },
        tool,
        result,
        coverageStatus,
      );
      if (refusal !== undefined) {
        if (negativeDispatch !== undefined) keepNegativeResultOut(scope, negativeDispatch.resultId);
        if (seen !== undefined) seen.overCeiling = true;
        // Synthesized empty-effects envelope: the resume paths read the
        // routing status off `envelope.status`, and this is how a refused
        // NON-envelope result carries `'invalid'` there without every path
        // learning about ceilings. Empty effects/malformed judge to nothing.
        return {
          result: refusal,
          executed: true,
          negativeResultId: negativeDispatch?.resultId,
          ceilingRefused: true,
          envelope: { content: refusal, effects: [], status: 'invalid', malformed: [] },
        };
      }
      // The column-type contract on this path's own execute boundary — a
      // resumed call's rows are judged exactly as an inline one's.
      const columnRefusal = links.judgeColumns(
        scope,
        { toolName, toolCallId, iteration, ...occurrence },
        result,
      );
      if (columnRefusal !== undefined) {
        if (negativeDispatch !== undefined) keepNegativeResultOut(scope, negativeDispatch.resultId);
        return {
          result: columnRefusal,
          executed: true,
          negativeResultId: negativeDispatch?.resultId,
          ceilingRefused: true,
          envelope: { content: columnRefusal, effects: [], status: 'invalid', malformed: [] },
        };
      }
      // A status-only shape missing its `effects: []` marker is DATA (bytes
      // unchanged) — but never silently: name the dropped marker in dev mode.
      const nearMiss = explainStatusOnlyNearMiss(result);
      if (nearMiss !== undefined) links.warnEffect(toolName, nearMiss);
      if (coverageStatus !== undefined) {
        // The ceiling path's synthesized envelope, for the same reason: the
        // resume paths read the routing status off `envelope.status`, and an
        // absence that lost its status here would route down whichever edge a
        // statusless result routes down — the confusion the word exists to
        // end. Empty effects/malformed judge to nothing, so the only thing
        // this carries is the status.
        return {
          result,
          executed: true,
          negativeResultId: negativeDispatch?.resultId,
          envelope: { content: result, effects: [], status: coverageStatus, malformed: [] },
        };
      }
      return {
        result,
        executed: true,
        negativeResultId: negativeDispatch?.resultId,
        ...(unknownStatus !== undefined && { unknownStatus }),
      };
    } catch (err) {
      seen?.resultFinalizer?.withheld();
      ended ??= runEndedBy(env.signal);
      if (ended !== undefined) {
        // Release the call's sessions and report the run's cancellation as
        // the stage outcome, even when the tool had already entered.
        await links.endCall(scope).catch(() => undefined);
        throw ended;
      }
      // Settled by throwing is still settled — a tool that opened a session and
      // then failed must not keep it.
      await links.endCall(scope);
      if (seen !== undefined && executed) seen.threw = true;
      if (isPauseRequest(err)) {
        return {
          result: binding.halt?.tellLLM ?? resumedPauseRefusal(toolName, heldTo),
          error: true,
          // It ran — a tool that asked to pause had already started work.
          executed,
          negativeResultId: negativeDispatch?.resultId,
        };
      }
      if (toolInvoked && seen?.toolResultExecution === 'threw' && binding.halt === undefined) {
        const category = classifyToolFailure(err, deps.answerLayer);
        if (category !== undefined) seen.toolFailureCategory = category;
      }
      // A tool that threw still RAN, and may have done half its work; the
      // after-tool moment exists precisely for the rules that care about that.
      return {
        result: err instanceof Error ? err.message : String(err),
        error: true,
        executed,
        negativeResultId: negativeDispatch?.resultId,
      };
    }
  };
  /** Carry the inner halt to the resume door once the result has landed. */
  const resolveCredentialAndExecute: ResumedInvocation['resolveCredentialAndExecute'] = async (
    ...call
  ) => {
    const binding = bindOuterCall();
    try {
      const answer = await executeResumed(binding, ...call);
      return binding.halt === undefined ? answer : { ...answer, halt: binding.halt };
    } finally {
      await binding.close();
    }
  };
  return { resolveCredentialAndExecute };
}
