import { buildArgumentRefusal } from '../access/argumentValidation.js';
import { buildSearchCoverage } from '../../searchCoverage.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { Resolution, ResumedCallFacts } from '../contracts/callFacts.js';
import { type ConsentGateKind, isPauseRequest } from '../../../../pause.js';
import {
  type ReadToolResultEnvelope,
  type ToolResultStatus,
  readToolResultEnvelope,
  explainStatusOnlyNearMiss,
} from '../../../../../semantics/toolEffects.js';
import { bindToolSecurityEvents } from '../../../toolSecurityEvents.js';
import { unknownToolResult } from '../helpers/dispatchRefusals.js';
import type { ArtifactMeta } from '../../../../../artifacts/types.js';
import type { Credential } from '../../../../../identity/types.js';
import { modelRefusal } from '../../../../../identity/consent.js';
import { errorClassOf, reportingCredentials } from '../decorators/reportingCredentials.js';
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
import type { ToolCatalogOperations } from '../contracts/operations/catalog.js';
import type { ToolArtifactsOperations } from '../contracts/operations/artifacts.js';
import type { ToolCredentialsOperations } from '../contracts/operations/credentials.js';
import type { ToolContextOperations } from '../contracts/operations/context.js';
import type { ToolProgressOperations } from '../contracts/operations/progress.js';
import type { ToolResourcesOperations } from '../contracts/operations/resources.js';
import type { ToolScriptsOperations } from '../contracts/operations/scripts.js';
import type { ToolCoverageOperations } from '../contracts/operations/coverage.js';
import type { ToolSemanticsOperations } from '../contracts/operations/semantics.js';
import type { ToolLimitsOperations } from '../contracts/operations/limits.js';
import type { ToolIntegrityOperations } from '../contracts/operations/integrity.js';
import type { ToolEffectsOperations } from '../contracts/operations/effects.js';
import type { ResumedInvocation } from '../contracts/operations/resumedInvocation.js';

interface ResumedInvocationLinks {
  readonly dispatchRoster: ToolCatalogOperations['dispatchRoster'];
  readonly argumentRefusal: ReturnType<typeof buildArgumentRefusal>;
  readonly noteOffWire: ToolCatalogOperations['noteOffWire'];
  readonly resolveWantsAtDispatch: ToolArtifactsOperations['resolveWantsAtDispatch'];
  readonly credentialsIn: ToolCredentialsOperations['credentialsIn'];
  readonly hasCredentials: boolean;
  readonly toolArtifacts: ToolContextOperations['toolArtifacts'];
  readonly toolProgress: ToolProgressOperations['toolProgress'];
  readonly sessionContext: ToolResourcesOperations['sessionContext'];
  readonly toolDispatchCtx: ToolContextOperations['toolDispatchCtx'];
  readonly endCall: ToolResourcesOperations['endCall'];
  readonly searchFunnel: ReturnType<typeof buildSearchCoverage>;
  readonly runFactsOf: ToolResourcesOperations['runFactsOf'];
  readonly programOfCall: ToolScriptsOperations['programOfCall'];
  readonly proposedArgsOf: ToolScriptsOperations['proposedArgsOf'];
  readonly takeCodeRun: ToolScriptsOperations['takeCodeRun'];
  readonly declareCoverage: ToolCoverageOperations['declareCoverage'];
  readonly declareSemantics: ToolSemanticsOperations['declareSemantics'];
  readonly refuseOverCeiling: ToolLimitsOperations['refuseOverCeiling'];
  readonly judgeColumns: ToolIntegrityOperations['judgeColumns'];
  readonly warnEffect: ToolEffectsOperations['warnEffect'];
}

/** Compose the existing resumed invocation without changing its catch/cleanup boundary. */
export function buildResumedInvocation(
  deps: Pick<
    ToolCallsHandlerDeps,
    'clearConsentOutstanding' | 'reportConsentOutstanding' | 'time' | 'negativeClaimsArmed'
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
  // check-in, an ask). Its arguments are then held to the request once more
  // at the last moment before `execute` — defence in depth behind the frozen
  // copies every app callback is handed (`lib/frozenCopy.ts`): arguments that
  // no longer re-derive the request's id (`runsAsAsked`, the one rule that
  // binds a decision to its call) do not run (`callChanged`).
  const resolveCredentialAndExecute = async (
    scope: TypedScope<AgentState>,
    resolved: Resolution,
    toolName: string,
    args: Readonly<Record<string, unknown>>,
    toolCallId: string,
    iteration: number,
    env: { readonly signal?: AbortSignal },
    heldTo?: ConsentGateKind,
    /** Filled for the call's script row (`deps.scriptRecord`): what `execute`
     *  was handed, the runner's facts, a ceiling refusal, a throw. */
    seen?: ResumedCallFacts,
  ): Promise<{
    result: unknown;
    error?: boolean;
    executed?: boolean;
    negativeResultId?: string;
    /** The recognized effects envelope, when the tool returned one (9.19.0)
     *  — `result` above is already its unwrapped `content`. When the ceiling
     *  fired this carries the refusal as `content` and status `'invalid'`
     *  (synthesized empty-effects for a non-envelope result), so every resume
     *  path routes the status without knowing about ceilings. */
    envelope?: ReadToolResultEnvelope;
    /** The tool's own `resultCeiling` refused the result (9.20.0): `result`
     *  is the teaching refusal, the true size is on the record. The call ran
     *  — but it must not complete a procedure step (the model was told to
     *  call again). */
    ceilingRefused?: true;
    /** An approved call's arguments no longer matched its request at the
     *  last moment before `execute` (`heldTo`): the call did not run. */
    callChanged?: true;
  }> => {
    const tool = resolved.tool;
    /** What the approval covers — the arguments as handed in, before any
     *  `wants` resolution or clock redraw derives the ones `execute` gets. */
    const approved = args;
    const emitSecurity = bindToolSecurityEvents(scope, { toolCallId, iteration });
    // The two refusals share one door here too (9.92.0): a name nothing holds,
    // and a name whose offered party cannot answer on this resume.
    if (!tool) {
      return {
        result: resolved.refusal ?? unknownToolResult(toolName, links.dispatchRoster(scope)),
        error: true,
      };
    }
    const invalidArgs = links.argumentRefusal(scope, tool, args, {
      toolName,
      toolCallId,
      iteration,
    });
    if (invalidArgs !== undefined) return { result: invalidArgs, error: true };
    links.noteOffWire(scope, resolved, { toolName, toolCallId, iteration });
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
        args,
        tool.schema.inputSchema,
      );
      if (!resolution.ok) return { result: resolution.refusal, error: true };
      args = resolution.args;
      wantedMeta = resolution.wanted;
    }
    const runIdentity = scope.runIdentity as
      | { tenant?: string; principal?: string; conversationId: string }
      | undefined;
    let resolvedCredential: Credential | undefined;
    const need = tool.needs;
    if (need) {
      emitSecurity('agentfootprint.credential.requested', {
        service: need.credential,
        ...(need.mode && { mode: need.mode }),
      });
      try {
        const cred = await links.credentialsIn(scope, need.credential).getCredential({
          service: need.credential,
          ...(need.scopes && { scopes: need.scopes }),
          ...(need.mode && { mode: need.mode }),
          ...(runIdentity && {
            identity: {
              ...(runIdentity.principal && { principal: runIdentity.principal }),
              ...(runIdentity.tenant && { tenant: runIdentity.tenant }),
            },
          }),
        });
        if (cred.status === 'issued') {
          resolvedCredential = cred.credential;
          emitSecurity('agentfootprint.credential.acquired', {
            service: need.credential,
            kind: cred.credential.kind,
            ...(cred.expiresAt !== undefined && { expiresAt: cred.expiresAt }),
          });
          // The consent that was outstanding for this service has been given.
          deps.clearConsentOutstanding?.(need.credential);
        } else {
          emitSecurity('agentfootprint.credential.authorization_required', {
            service: need.credential,
            sessionId: cred.sessionId,
          });
          // Still not authorized on the far side of a resume. A resume cannot
          // pause again (`ResumeFn` returns void), so the honest move is the
          // URL-free refusal plus `error: true`: the model reads it, the loop
          // continues, and if it calls the tool again `execute` CAN pause — a
          // fresh consent round with a fresh URL on `PendingAsk`. The
          // consent record still goes out on the side channel so the turn
          // cannot end quietly.
          deps.reportConsentOutstanding?.({
            service: need.credential,
            authorizationUrl: cred.authorizationUrl,
            sessionId: cred.sessionId,
            tool: toolName,
            iteration,
          });
          return { result: modelRefusal(need.credential), error: true };
        }
      } catch (credErr) {
        const reason = credErr instanceof Error ? credErr.message : String(credErr);
        emitSecurity('agentfootprint.credential.failed', {
          service: need.credential,
          reason,
          tool: toolName,
          ...(errorClassOf(credErr) !== undefined && { errorClass: errorClassOf(credErr) }),
        });
        return { result: `credential error for '${need.credential}': ${reason}`, error: true };
      }
    }
    let executed = false;
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
              { toolCallId, toolName },
              iteration,
              tool,
              args,
              deps.time.appZone,
            )
          : undefined;
      const callTime = dispatched?.context;
      if (dispatched !== undefined) args = dispatched.args;
      // `let`, not `const`: the semantic projection below replaces the value
      // on the non-envelope path exactly as the batch loop does.
      // This dispatch's own slot for the runner's facts (`CODE_RUN_SLOT`):
      // facts reach the exact dispatch that ran, never another run's call
      // that happens to reuse the provider's id.
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
        ...links.toolArtifacts(scope, toolName, toolCallId),
        ...(wantedMeta !== undefined && { wanted: wantedMeta }),
        ...links.toolProgress(scope, { toolName, toolCallId, iteration }),
        ...requestEvidenceFor(scope, { toolName, toolCallId, iteration }),
        ...mcpClientUseFor(scope, { toolCallId }),
        ...links.sessionContext(scope, toolName, toolCallId),
        // The resume doors hand their gates the committed history; so does an inner call.
        ...links.toolDispatchCtx(
          scope,
          { toolName, toolCallId, iteration, history: () => [...(scope.history ?? [])] },
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
      if (heldTo !== undefined) {
        const read = (key: string): unknown => scope.$getValue(key);
        if (!runsAsAsked(read('pausedRequest'), gatedCallOf(read, heldTo), approved)) {
          // Nothing ran; the call's sessions are still released, as for a
          // run that ended here.
          await links.endCall(scope).catch(() => undefined);
          return {
            result: rewrittenAfterApproval(
              toolName,
              'those arguments changed before the call could run',
            ),
            error: true,
            callChanged: true,
          };
        }
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
              iteration,
              runId: links.runFactsOf(scope)?.runId,
              dispatch: searchDispatch,
              context: executionContext,
            })
          : undefined;
      executed = true;
      if (seen !== undefined) {
        // Read now, before any tool code runs: what the call proposed and
        // what `execute` is handed — values, never the arguments object.
        seen.entered = true;
        seen.proposed = links.programOfCall(tool, links.proposedArgsOf(scope, toolCallId) ?? args);
        seen.submitted = links.programOfCall(tool, args);
      }
      let result = await tool.execute(args, executionContext);
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
        call: { toolName, toolCallId, iteration },
        tool,
        ...(resolved.party !== undefined && { party: resolved.party }),
        args: negativeDispatch?.args ?? args,
        ...(searchDispatch !== undefined && { dispatch: searchDispatch }),
        ...(status !== undefined && { status }),
      });
      // The typed effects channel (9.19.0) — same unwrap as the batch loop,
      // at this path's own execute boundary, so a resumed call's envelope is
      // judged exactly as an inline one's.
      const envelope = readToolResultEnvelope(result);
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
          { toolName, toolCallId, iteration },
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
          { toolName, toolCallId, iteration },
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
          { toolName, toolCallId, iteration },
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
          { toolName, toolCallId, iteration },
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
      const searched = links.searchFunnel.compose(scope, searchBoundary(undefined), result);
      if (searched !== undefined) result = searched.value;
      const coverageStatus = links.declareCoverage(
        scope,
        { toolName, toolCallId, iteration },
        result,
        searched?.reading,
      );
      // The semantic envelope (9.53.0) on this path's own execute boundary —
      // a resumed call's envelope is judged exactly as an inline one's.
      const semanticView = links.declareSemantics(
        scope,
        { toolName, toolCallId, iteration },
        result,
      );
      if (semanticView !== undefined) result = semanticView;
      const refusal = links.refuseOverCeiling(
        scope,
        { toolName, toolCallId, iteration },
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
      const columnRefusal = links.judgeColumns(scope, { toolName, toolCallId, iteration }, result);
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
      return { result, executed: true, negativeResultId: negativeDispatch?.resultId };
    } catch (err) {
      if (ended !== undefined && err === ended) {
        // Nothing ran; the call's sessions are still released, and the run's
        // end — not a tool failure — is what the stage ends with.
        await links.endCall(scope).catch(() => undefined);
        throw err;
      }
      // Settled by throwing is still settled — a tool that opened a session and
      // then failed must not keep it.
      await links.endCall(scope);
      if (seen !== undefined && executed) seen.threw = true;
      if (isPauseRequest(err)) {
        return {
          result: `tool '${toolName}' requested a pause while resuming an approved check-in, which is not supported`,
          error: true,
          // It ran — a tool that asked to pause had already started work.
          executed,
          negativeResultId: negativeDispatch?.resultId,
        };
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
  return { resolveCredentialAndExecute };
}
