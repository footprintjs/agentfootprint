import type { buildCallStart } from './callStart.js';
import type { buildDispatchContext } from '../batch/dispatchContext.js';
import type { buildToolCatalogOperations } from './catalogOperations.js';
import type { CallArguments, CallExecution, CallResultCell } from '../contracts/callCells.js';
import type { buildToolCredentialsOperations } from './credentialsOperations.js';
import type { CallCredentialInput, CallArtifactInputs } from '../contracts/invocationInputs.js';
import type { buildToolContextOperations } from './contextOperations.js';
import type { buildToolProgressOperations } from '../observation/progressOperations.js';
import type { buildToolResourcesOperations } from './resourcesOperations.js';
import type { buildSearchCoverage } from '../../searchCoverage.js';
import type { buildToolScriptsOperations } from '../evidence/scriptsOperations.js';
import type { buildToolEffectsOperations } from '../routing/effectsOperations.js';
import type { buildToolCoverageOperations } from '../evidence/coverageOperations.js';
import type { buildToolSemanticsOperations } from '../evidence/semanticsOperations.js';
import type { buildToolLimitsOperations } from '../decorators/limitsOperations.js';
import type { buildToolIntegrityOperations } from '../evidence/integrityOperations.js';
import type { buildToolArtifactsOperations } from './artifactsOperations.js';
import type { InputsDispatch } from '../contracts/inputsDispatch.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import { unknownToolResult } from '../helpers/dispatchRefusals.js';
import type { ToolArgs } from '../../../../../tools/runChain.js';
import { type CodeRunSlot, CODE_RUN_SLOT } from '../../../../codeRunnerTool.js';
import { reportingCredentials } from '../decorators/reportingCredentials.js';
import { requestEvidenceFor } from '../../../../../tools/requestEvidence.js';
import { mcpClientUseFor } from '../../../../../tools/mcpClientUse.js';
import {
  startNegativeCall,
  captureNegativeResult,
  keepNegativeResultOut,
  pauseNegativeCall,
} from '../../../negativeClaims/capture.js';
import {
  readToolResultEnvelope,
  explainStatusOnlyNearMiss,
} from '../../../../../semantics/toolEffects.js';
import { isPauseRequest } from '../../../../pause.js';
import { bindOuterCall } from '../../../innerCallOuter.js';
import {
  validateInputDeclaration,
  stampInputRequest,
  repeatOf,
} from '../../../../../tools/inputRequest.js';
import type { DispatchCall } from '../contracts/batchCall.js';

type CallStartFacts = ReturnType<ReturnType<typeof buildCallStart>['beginDispatchCall']>;
type DispatchContext = ReturnType<
  ReturnType<typeof buildDispatchContext>['prepareDispatchContext']
>;

interface InvokeInitialToolFrame {
  readonly tool: CallStartFacts['tool'];
  readonly resolved: CallStartFacts['resolved'];
  readonly tc: DispatchCall;
  readonly dispatchRoster: ReturnType<typeof buildToolCatalogOperations>['dispatchRoster'];
  readonly noteOffWire: ReturnType<typeof buildToolCatalogOperations>['noteOffWire'];
  readonly iteration: number;
  readonly callArguments: CallArguments;
  readonly env: DispatchContext['env'];
  readonly credentialsIn: ReturnType<typeof buildToolCredentialsOperations>['credentialsIn'];
  readonly emitSecurity: CallStartFacts['emitSecurity'];
  readonly hasCredentials: boolean;
  readonly authorization: CallCredentialInput;
  readonly toolArtifacts: ReturnType<typeof buildToolContextOperations>['toolArtifacts'];
  readonly wanted: CallArtifactInputs;
  readonly toolProgress: ReturnType<typeof buildToolProgressOperations>['toolProgress'];
  readonly sessionContext: ReturnType<typeof buildToolResourcesOperations>['sessionContext'];
  readonly toolDispatchCtx: ReturnType<typeof buildToolContextOperations>['toolDispatchCtx'];
  readonly historyForCallbacks: CallStartFacts['historyForCallbacks'];
  readonly searchFunnel: ReturnType<typeof buildSearchCoverage>;
  readonly execution: CallExecution;
  readonly runFactsOf: ReturnType<typeof buildToolResourcesOperations>['runFactsOf'];
  readonly programOfCall: ReturnType<typeof buildToolScriptsOperations>['programOfCall'];
  readonly outcome: CallResultCell;
  readonly takeCodeRun: ReturnType<typeof buildToolScriptsOperations>['takeCodeRun'];
  readonly warnEffect: ReturnType<typeof buildToolEffectsOperations>['warnEffect'];
  readonly declareCoverage: ReturnType<typeof buildToolCoverageOperations>['declareCoverage'];
  readonly declareSemantics: ReturnType<typeof buildToolSemanticsOperations>['declareSemantics'];
  readonly refuseOverCeiling: ReturnType<typeof buildToolLimitsOperations>['refuseOverCeiling'];
  readonly judgeColumns: ReturnType<typeof buildToolIntegrityOperations>['judgeColumns'];
  readonly endCall: ReturnType<typeof buildToolResourcesOperations>['endCall'];
  readonly oneQuestionAsked: boolean;
  readonly assertComponentDeliverable: ReturnType<
    typeof buildToolArtifactsOperations
  >['assertComponentDeliverable'];
  readonly newHistory: DispatchContext['newHistory'];
  readonly startMs: CallStartFacts['startMs'];
  readonly declareRaisedAbsence: ReturnType<
    typeof buildToolCoverageOperations
  >['declareRaisedAbsence'];
  readonly fileScript: ReturnType<typeof buildToolScriptsOperations>['fileScript'];
  readonly proposedProgram: CallStartFacts['proposedProgram'];
  readonly askedLayer: InputsDispatch | undefined;
  readonly resolution: ReturnType<ReturnType<InputsDispatch['resolutionsFor']>['get']>;
}

/** Existing initialInvocation body; original guard and native pause return stay with the handler. */
export async function invokeInitialTool(
  scope: TypedScope<AgentState>,
  deps: Pick<ToolCallsHandlerDeps, 'time' | 'negativeClaimsArmed' | 'answeredAsk'>,
  frame: InvokeInitialToolFrame,
) {
  try {
    // The two refusals share one door: a name nothing holds, and a
    // name whose offered party cannot answer (9.92.0). Both land as
    // an errored tool result the model reads, on the same path.
    if (!frame.tool) {
      throw new Error(
        frame.resolved.refusal ?? unknownToolResult(frame.tc.name, frame.dispatchRoster(scope)),
      );
    }
    frame.noteOffWire(scope, frame.resolved, {
      toolName: frame.tc.name,
      toolCallId: frame.tc.id,
      iteration: frame.iteration,
    });
    // The time layer's dispatch moment — just before the tool runs.
    // A look-back the clock drifted past is redrawn here (§ 7.4) — `callArgs`
    // carries what the tool ran with, so the note and the results layer read it.
    const dispatched =
      deps.time !== undefined
        ? (await import('../../timeLayer.js')).timeAtDispatch(
            scope,
            { toolCallId: frame.tc.id, toolName: frame.tc.name },
            frame.iteration,
            frame.tool,
            frame.callArguments.callArgs,
            deps.time.appZone,
          )
        : undefined;
    const callTime = dispatched?.context;
    if (dispatched !== undefined) frame.callArguments.callArgs = dispatched.args as ToolArgs;
    // Set BEFORE the await: a tool that throws has still run, and a
    // tool that does not exist has not. This flag is the entire
    // precondition of the after-tool moment below.
    // This dispatch's own slot for the runner's facts — see the
    // resume path's twin in `resolveCredentialAndExecute`.
    const codeRunSlot: CodeRunSlot = {};
    // The outer call's hold on the inner calls its tool makes (`innerCallOuter.ts`).
    const binding = bindOuterCall();
    const executionContext = {
      [CODE_RUN_SLOT]: codeRunSlot,
      toolCallId: frame.tc.id,
      iteration: frame.iteration,
      ...(callTime !== undefined && { time: callTime }),
      ...(frame.env.signal && { signal: frame.env.signal }),
      credentials: reportingCredentials(
        frame.credentialsIn(scope, frame.tool.needs?.credential),
        frame.emitSecurity,
        frame.tc.name,
      ),
      hasCredentials: frame.hasCredentials,
      ...(frame.authorization.resolvedCredential && {
        credential: frame.authorization.resolvedCredential,
      }),
      ...frame.toolArtifacts(scope, frame.tc.name, frame.tc.id),
      ...(frame.wanted.wantedMeta !== undefined && { wanted: frame.wanted.wantedMeta }),
      ...frame.toolProgress(scope, {
        toolName: frame.tc.name,
        toolCallId: frame.tc.id,
        iteration: frame.iteration,
      }),
      ...requestEvidenceFor(scope, {
        toolName: frame.tc.name,
        toolCallId: frame.tc.id,
        iteration: frame.iteration,
      }),
      ...mcpClientUseFor(scope, { toolCallId: frame.tc.id }),
      ...frame.sessionContext(scope, frame.tc.name, frame.tc.id),
      ...frame.toolDispatchCtx(
        scope,
        {
          toolName: frame.tc.name,
          toolCallId: frame.tc.id,
          iteration: frame.iteration,
          history: frame.historyForCallbacks,
          binding,
        },
        frame.env.signal,
      ),
    };
    // `Tool.search`: the result identity is reserved and the dispatch
    // instant taken just BEFORE the call runs (the row's address,
    // never the provider's call id; a relative window's clock).
    const searchDispatch = frame.searchFunnel.dispatch(scope, frame.tool, callTime);
    frame.execution.negativeDispatch =
      deps.negativeClaimsArmed === true
        ? startNegativeCall(scope, {
            tool: frame.tool,
            party: frame.resolved.party,
            args: frame.callArguments.callArgs,
            toolCallId: frame.tc.id,
            iteration: frame.iteration,
            runId: frame.runFactsOf(scope)?.runId,
            dispatch: searchDispatch,
            context: executionContext,
          })
        : undefined;
    frame.execution.executed = true;
    frame.execution.submittedProgram = frame.programOfCall(
      frame.tool,
      frame.callArguments.callArgs,
    );
    try {
      frame.outcome.result = await frame.tool.execute(
        frame.callArguments.callArgs,
        executionContext,
      );
    } finally {
      // `ctx.tools` ends with `execute`; an inner call's halt becomes this
      // call's, run by `dispatchCall.ts` once the result has landed.
      binding.end();
      if (binding.halt !== undefined) frame.execution.haltContext ??= { ...binding.halt };
    }
    if (frame.execution.negativeDispatch !== undefined)
      frame.outcome.result = captureNegativeResult(
        scope,
        frame.execution.negativeDispatch,
        frame.outcome.result,
        frame.tool,
      );
    // A code-runner tool leaves the SHAPE of what it just ran, keyed by
    // this call. Taken and deleted here so the map cannot grow across
    // a long run, and emitted from the dispatch loop rather than from
    // the tool because this is the layer that holds `typedEmit`.
    //
    // The code itself is never on this channel — the same rule the
    // session events follow with `keyHash`, never the key. Generated
    // code quotes the data it was handed, so the program is the one
    // part of a code run that must not reach an exporter.
    frame.execution.ranCode = frame.takeCodeRun(scope, frame.tool, codeRunSlot, {
      toolName: frame.tc.name,
      toolCallId: frame.tc.id,
      takeListed: true,
    });
    // The typed effects channel (9.19.0): a recognized envelope is
    // unwrapped HERE, at the one boundary the raw return crosses —
    // everything downstream (governance rules, the cap, history,
    // `tool_end`) sees the CONTENT, exactly what a bare return
    // would have shown. The effects are judged below, after the
    // gates, in call order.
    const envelope = readToolResultEnvelope(frame.outcome.result);
    if (envelope !== undefined) {
      frame.outcome.toolEnvelope = envelope;
      frame.outcome.result = envelope.content;
      frame.outcome.toolStatus = envelope.status;
    } else {
      // A status-only shape missing its `effects: []` marker is
      // DATA (bytes unchanged) — but never silently: name the
      // dropped marker in dev mode.
      const nearMiss = explainStatusOnlyNearMiss(frame.outcome.result);
      if (nearMiss !== undefined) frame.warnEffect(frame.tc.name, nearMiss);
    }
    // Coverage (this release), on the UNWRAPPED content and before
    // the ceiling — the boundary a tool declared is not the channel
    // that can overflow. A tool that spelled its own status keeps
    // it; otherwise an absence names the delivered outcome, so an
    // `onToolStatus` edge can route "we looked and there was
    // nothing" somewhere other than "the call broke".
    // `Tool.search` — the coverage composed from the declaration and
    // the arguments the call ran with, BEFORE everything that reads
    // the value: the composed absence is what the model is served.
    const searched = frame.searchFunnel.compose(
      scope,
      {
        call: { toolName: frame.tc.name, toolCallId: frame.tc.id, iteration: frame.iteration },
        tool: frame.tool,
        ...(frame.resolved.party !== undefined && { party: frame.resolved.party }),
        args:
          frame.execution.negativeDispatch?.args ??
          (frame.callArguments.callArgs as Readonly<Record<string, unknown>>),
        ...(searchDispatch !== undefined && { dispatch: searchDispatch }),
        ...(frame.outcome.toolStatus !== undefined && { status: frame.outcome.toolStatus }),
      },
      frame.outcome.result,
    );
    if (searched !== undefined) frame.outcome.result = searched.value;
    const coverageStatus = frame.declareCoverage(
      scope,
      { toolName: frame.tc.name, toolCallId: frame.tc.id, iteration: frame.iteration },
      frame.outcome.result,
      searched?.reading,
    );
    if (frame.outcome.toolStatus === undefined) frame.outcome.toolStatus = coverageStatus;
    // The semantic envelope (9.53.0), on the unwrapped content and
    // AFTER coverage (whose funnel absorbs the envelope's own
    // `coverage` field), BEFORE the ceiling (which must measure
    // what the model will actually read, and must not silently
    // delete grain/provenance — they are already on the record by
    // the time it fires). Everything downstream — governance, the
    // cap, history, `tool_end` — sees the compact projection; the
    // full envelope rides `tools.semantics_declared`.
    const semanticView = frame.declareSemantics(
      scope,
      { toolName: frame.tc.name, toolCallId: frame.tc.id, iteration: frame.iteration },
      frame.outcome.result,
    );
    if (semanticView !== undefined) frame.outcome.result = semanticView;
    // The tool's own refusing ceiling (9.20.0) — at the execute
    // boundary, BEFORE the gates and the after-tool chain, so
    // governance and the agent-level cap compose over what the
    // model will actually read (the read_skill-gate precedent).
    // A recognized envelope's DECLARED effects (`toolEnvelope`)
    // are still judged below — the effects channel is not the
    // channel that overflowed; the delivered status becomes
    // 'invalid' so `onToolStatus` edges can route the overflow
    // (the declared one rides the `result_refused` event).
    const overflowRefusal = frame.refuseOverCeiling(
      scope,
      { toolName: frame.tc.name, toolCallId: frame.tc.id, iteration: frame.iteration },
      frame.tool,
      frame.outcome.result,
      frame.outcome.toolStatus,
    );
    if (overflowRefusal !== undefined) {
      if (frame.execution.negativeDispatch !== undefined)
        keepNegativeResultOut(scope, frame.execution.negativeDispatch.resultId);
      frame.execution.ceilingRefused = true;
      frame.execution.withheldOverCeiling = true;
      frame.outcome.result = overflowRefusal;
      frame.outcome.toolStatus = 'invalid';
    } else {
      // The column-type contract (9.78.0) — the main batch-loop
      // door, one step after the ceiling. Only when the payload
      // survived it: rows nobody will read have no columns worth
      // arguing about.
      const columnRefusal = frame.judgeColumns(
        scope,
        { toolName: frame.tc.name, toolCallId: frame.tc.id, iteration: frame.iteration },
        frame.outcome.result,
      );
      if (columnRefusal !== undefined) {
        if (frame.execution.negativeDispatch !== undefined)
          keepNegativeResultOut(scope, frame.execution.negativeDispatch.resultId);
        frame.execution.ceilingRefused = true;
        frame.outcome.result = columnRefusal;
        frame.outcome.toolStatus = 'invalid';
      }
    }
    await frame.endCall(scope);
  } catch (err) {
    // Set when a raise declared a miss the door could not file:
    // the call then errors with this text and does not pause.
    let raisedMissError: string | undefined;
    // In a batch whose one human question was the inputs layer's ask
    // (`oneQuestionAsked`), the tool's own pause cannot be given: the
    // call settles as an error below, with the refusal sentence.
    if (isPauseRequest(err) && !frame.oneQuestionAsked) {
      // The typed half of the question (9.24.0): a tool that raised
      // `askHuman({ question, component })` nominated a screen
      // component, and the nomination is judged HERE — the raise
      // site — before the pause is allowed to happen. The tool
      // usually minted `propsRef` via ctx.artifacts moments ago;
      // this validates the ref it chose to carry still resolves in
      // this run's scope, so the throw (which fails the run loudly,
      // naming the fix) lands in the author's lap and never in the
      // answering person's. Pauses without a component skip this
      // entirely — byte-identical.
      if (typeof err.data === 'object' && err.data !== null) {
        const rawComponent = (err.data as { component?: unknown }).component;
        if (rawComponent !== undefined) {
          await frame.assertComponentDeliverable(
            scope,
            frame.tc.name,
            rawComponent,
            `askHuman in tool '${frame.tc.name}'`,
          );
        }
      }
      const declaration =
        typeof err.data === 'object' && err.data !== null
          ? (err.data as { inputRequest?: unknown }).inputRequest
          : undefined;
      // A lookup that pauses still declares what it looked at
      // (9.114.0): the miss it is asking about is filed HERE, the
      // raise site, FIRST — the one moment the declaration's
      // `absence` is read. So a declaration that CARRIES one is
      // judged before anything is written for the pause, and a miss
      // the door cannot file errors the call below, as the same value
      // returned would, with nothing written for a pause. A MALFORMED
      // declaration still leaves the committed record it always left,
      // whether or not it carried `absence`: its error leaves the
      // stage only after the pause writes are made, so a hand-raised
      // request (a `pauseHere`/`askHuman` that never went through
      // `requestInput`) fails with the in-flight batch on the record.
      // `null` is the field omitted (`inputRequest.ts` ·
      // `validateInputDeclaration`).
      //
      // The pause writes: partial state, so resume() can find the
      // history intact.
      const writePause = (): void => {
        if (frame.execution.negativeDispatch !== undefined)
          pauseNegativeCall(scope, frame.execution.negativeDispatch.resultId);
        scope.history = frame.newHistory;
        scope.pausedToolCallId = frame.tc.id;
        scope.pausedToolName = frame.tc.name;
        scope.pausedToolStartMs = frame.startMs;
        // The args the tool WAS RUNNING WITH (post-transform), for
        // the after-tool moment on the far side of the pause
        // (8.13.0) — the same reason the three sibling pauses carry
        // theirs.
        scope.pausedToolArgs = frame.callArguments.callArgs;
      };
      const carriesAbsence =
        typeof declaration === 'object' &&
        declaration !== null &&
        (declaration as { absence?: unknown }).absence != null;
      let declared: ReturnType<typeof validateInputDeclaration> | undefined;
      if (carriesAbsence) {
        try {
          declared = validateInputDeclaration(declaration);
        } catch (invalid) {
          writePause();
          throw invalid;
        }
      }
      raisedMissError =
        declared?.absence === undefined
          ? undefined
          : frame.declareRaisedAbsence(
              scope,
              { toolName: frame.tc.name, toolCallId: frame.tc.id, iteration: frame.iteration },
              frame.callArguments.callArgs,
              declared.absence,
              frame.newHistory,
            );
      if (raisedMissError === undefined) {
        // A pause has NOT settled this call — it is waiting for a
        // person, and the resources it opened are what the resume
        // needs. No `'call'` teardown here, deliberately.
        writePause();
        // The tool asked from INSIDE `execute`: its program is the
        // value read before it ran, never the arguments as it left them.
        const pausedDispatch = frame.fileScript(scope, {
          tool: frame.tool,
          toolName: frame.tc.name,
          toolCallId: frame.tc.id,
          iteration: frame.iteration,
          proposed: frame.proposedProgram,
          submitted: frame.execution.submittedProgram,
          settlement: 'not-entered',
          paused: true,
        });
        // The resume settles this call without running it again, so
        // the values read before it ran ride the checkpoint.
        if (pausedDispatch !== undefined) {
          scope.pausedScriptPrograms = {
            ...(typeof frame.proposedProgram === 'string' && { proposed: frame.proposedProgram }),
            ...(typeof frame.execution.submittedProgram === 'string' && {
              submitted: frame.execution.submittedProgram,
            }),
          };
        }
        const stamped =
          declaration === undefined ? undefined : declared ?? validateInputDeclaration(declaration);
        const awaitingInput =
          stamped === undefined
            ? undefined
            : stampInputRequest(
                stamped,
                `${frame.runFactsOf(scope)?.runId ?? scope.turnStartMs}:${frame.tc.id}`,
                {
                  originalRequest: scope.userMessage,
                  toolCallId: frame.tc.id,
                  ...(scope.currentSkillId !== undefined && {
                    skillId: scope.currentSkillId,
                  }),
                  ...(scope.turnRoute?.offered !== undefined && {
                    offeredSkillIds: [...scope.turnRoute.offered],
                  }),
                },
                // A re-ask of the ask this run's resume answered is
                // never silent: the count, and the previous
                // answer as the record holds it — facts, no reason.
                repeatOf(stamped, deps.answeredAsk?.(), frame.newHistory),
              );
        // Returning a defined value triggers footprintjs pause —
        // the returned object becomes the checkpoint's pauseData.
        return {
          toolCallId: frame.tc.id,
          toolName: frame.tc.name,
          ...(awaitingInput !== undefined
            ? { question: awaitingInput.question, awaitingInput }
            : typeof err.data === 'object' && err.data !== null
            ? (err.data as Record<string, unknown>)
            : { data: err.data }),
        };
      }
    }
    // A tool that threw still RAN, and may have opened the thing it
    // was about to close. A raise whose miss could not be filed is
    // settled here too — the returned path's error, not a pause.
    await frame.endCall(scope);
    frame.outcome.error = true;
    frame.execution.executeThrew = frame.execution.executed;
    frame.outcome.result =
      raisedMissError ??
      (frame.askedLayer !== undefined && isPauseRequest(err)
        ? // Reached only in the batch that asked (a pause anywhere
          // else returned above, or set `raisedMissError`): the
          // answers the call carried are kept for its next proposal.
          frame.askedLayer.secondPauseRefusal(frame.tc.name, 'tool-pause') +
          frame.askedLayer.keptNote(
            scope,
            frame.tc.name,
            frame.resolution,
            frame.tool,
            frame.callArguments.callArgs,
          )
        : err instanceof Error
        ? err.message
        : String(err));
  }
  return undefined;
}
