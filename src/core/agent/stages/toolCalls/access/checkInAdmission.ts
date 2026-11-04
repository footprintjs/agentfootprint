import type { buildCallStart } from '../execution/callStart.js';
import type { buildDispatchContext } from '../batch/dispatchContext.js';
import type { buildToolSettlementOperations } from '../batch/settlementOperations.js';
import type { CallArguments, CallConsentGate, CallResultCell } from '../contracts/callCells.js';
import type { InputsDispatch } from '../contracts/inputsDispatch.js';
import type { buildToolArtifactsOperations } from '../execution/artifactsOperations.js';
import type { buildToolScriptsOperations } from '../evidence/scriptsOperations.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import { shouldCheckIn, type CheckInRequest } from '../../../../checkin.js';
import {
  mintConsentRequest,
  type GatedCall,
  type DecisionLedger,
} from '../../../../consentRequest.js';
import { unboundCallRefusal } from './bindings.js';
import { warnFrozenWrite } from '../../../../../lib/frozenCopy.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import type { DispatchCall } from '../contracts/batchCall.js';
import { shownArgsOf } from '../../../../toolShownArgs.js';
import {
  markPrivateCheckIn,
  requirePrivateQuestionSupport,
} from '../../../arguments/privateAnswers.js';

type CallStartFacts = ReturnType<ReturnType<typeof buildCallStart>['beginDispatchCall']>;
type DispatchContext = ReturnType<
  ReturnType<typeof buildDispatchContext>['prepareDispatchContext']
>;

interface AdmitCheckInCallFrame {
  readonly historyForCheckIn: ReturnType<typeof buildToolSettlementOperations>['historyForCheckIn'];
  readonly historyForCallbacks: CallStartFacts['historyForCallbacks'];
  readonly tool: NonNullable<CallStartFacts['tool']>;
  readonly viewOf: CallStartFacts['viewOf'];
  readonly callArguments: CallArguments;
  readonly iteration: number;
  readonly tc: DispatchCall;
  readonly askedLayer: InputsDispatch | undefined;
  readonly resolved: CallStartFacts['resolved'];
  readonly decisionLedger: DecisionLedger;
  readonly consentGate: CallConsentGate;
  readonly outcome: CallResultCell;
  readonly resolution: ReturnType<ReturnType<InputsDispatch['resolutionsFor']>['get']>;
  readonly assertComponentDeliverable: ReturnType<
    typeof buildToolArtifactsOperations
  >['assertComponentDeliverable'];
  readonly env: DispatchContext['env'];
  readonly newHistory: DispatchContext['newHistory'];
  readonly startMs: CallStartFacts['startMs'];
  readonly fileScript: ReturnType<typeof buildToolScriptsOperations>['fileScript'];
  readonly proposedProgram: CallStartFacts['proposedProgram'];
  readonly programOfCall: ReturnType<typeof buildToolScriptsOperations>['programOfCall'];
}

/** Existing checkInAdmission body; the owning handler retains its admission guard and native pause return. */
export async function admitCheckInCall(
  scope: TypedScope<AgentState>,
  deps: Pick<ToolCallsHandlerDeps, 'checkIn'>,
  frame: AdmitCheckInCallFrame,
) {
  // Computed ONLY for a checkIn-declaring tool → zero cost otherwise.
  // Shape shared with the ask-resume gate; see `historyForCheckIn`.
  const historyForEvidence = frame.historyForCheckIn(scope, frame.historyForCallbacks());
  const trips = shouldCheckIn(
    frame.tool.checkIn!,
    frame.viewOf(frame.callArguments.callArgs) ?? frame.callArguments.callArgs,
    {
      iteration: frame.iteration,
      toolCallId: frame.tc.id,
      history: historyForEvidence,
    },
  );
  if (trips && frame.askedLayer === undefined) requirePrivateQuestionSupport(scope, [frame.tool]);
  // The request the person would be asked (`core/consentRequest.ts`):
  // an id their decision must quote, bound to a detached copy of this
  // exact call — minted only for a call that is about to pause.
  const bound =
    trips && frame.askedLayer === undefined
      ? mintConsentRequest(
          {
            gate: 'checkIn',
            tool: frame.tc.name,
            toolCallId: frame.tc.id,
            party: frame.resolved.party,
            args: frame.callArguments.callArgs,
          } satisfies GatedCall,
          frame.decisionLedger,
        )
      : undefined;
  // What the person is shown — and the evidence assembler and every
  // `checkin.request` listener handed: the call's shared frozen copy
  // (equal to `bound.args`, which was copied from the same arguments).
  // The paused state keeps `bound.args`, the copy the request is bound
  // to, so nothing that sees the question can change the call the
  // answer runs.
  const shown = bound === undefined ? undefined : frame.viewOf(shownArgsOf(frame.tool, bound.args));
  if (!trips) {
    // Predicate said no — fall through to the normal credential+execute
    // path below (this `if` block is the ONLY thing the gate adds).
  } else if (frame.askedLayer !== undefined) {
    // One human question per resume (honesty layer 2, step 4): this
    // batch already paused to ask the person for argument values, and
    // the re-run that carries the answer has no second pause to give.
    // The gate's question is not asked and the tool does not run.
    frame.consentGate.checkInRefused = true;
    frame.outcome.error = true;
    // The person's answers the call carried are kept for its next
    // proposal, where the check-in pauses as it always does.
    frame.outcome.result =
      frame.askedLayer.secondPauseRefusal(frame.tc.name, 'check-in') +
      frame.askedLayer.keptNote(
        scope,
        frame.tc.name,
        frame.resolution,
        frame.tool,
        frame.callArguments.callArgs,
      );
  } else if (bound === undefined || shown === undefined) {
    // A call no approval could be bound to is refused, never asked.
    frame.consentGate.checkInRefused = true;
    frame.outcome.error = true;
    frame.outcome.result = unboundCallRefusal(frame.tc.name, 'checkIn');
  } else {
    markPrivateCheckIn(scope, frame.tool, bound.args);
    // The tool's declared decision component (9.24.0), judged BEFORE
    // the evidence pack is assembled — a gate that cannot be honored
    // as declared refuses before any work, and a dangling propsRef is
    // refused at this source rather than discovered by the screen.
    const gateComponent =
      frame.tool.checkInComponent !== undefined
        ? await frame.assertComponentDeliverable(
            scope,
            frame.tc.name,
            frame.tool.checkInComponent,
            `tool '${frame.tc.name}' checkInComponent`,
          )
        : undefined;
    const intent = scope.llmLatestContent ? String(scope.llmLatestContent) : undefined;
    let evidence: CheckInRequest['evidence'];
    try {
      evidence = await deps.checkIn!.assembler({
        tool: { name: frame.tc.name, description: frame.tool.schema.description },
        args: shown,
        ...(intent !== undefined && { intent }),
        iteration: frame.iteration,
        history: historyForEvidence,
        scorer: deps.checkIn!.scorer,
        ...(frame.env.signal && { signal: frame.env.signal }),
      });
    } catch (err) {
      // An assembler that wrote into its frozen arguments fails the
      // check-in as any throw does — said once, in dev mode.
      warnFrozenWrite('check-in evidence assembler', err, 'the check-in failed');
      throw err;
    }
    const request: CheckInRequest = {
      id: bound.request.id,
      tool: frame.tc.name,
      args: shown,
      ...(intent !== undefined && { intent }),
      evidence,
      ...(gateComponent !== undefined && { component: gateComponent }),
    };
    typedEmit(scope, 'agentfootprint.checkin.request', {
      toolName: frame.tc.name,
      toolCallId: frame.tc.id,
      iteration: frame.iteration,
      request: request as unknown as Readonly<Record<string, unknown>>,
    });
    // Commit partial state so resume() finds history intact (mirror the
    // pauseHere path). The bound copy of the args rides the checkpoint,
    // so an APPROVED tool executes exactly what was asked.
    scope.history = frame.newHistory;
    scope.pausedToolCallId = frame.tc.id;
    scope.pausedToolName = frame.tc.name;
    scope.pausedToolStartMs = frame.startMs;
    scope.pausedCheckIn = true;
    scope.pausedCheckInArgs = bound.args;
    scope.pausedRequest = bound.request;
    // Same carrier as the middleware-ask pause (9.92.0).
    if (frame.resolved.party !== undefined) scope.pausedToolParty = frame.resolved.party;
    // Which surface will collect the decision — read back on resume
    // so `checkin.decision` says which component ANSWERED. Written
    // only when one exists (byte-identical otherwise).
    if (gateComponent !== undefined) scope.pausedComponentId = gateComponent.componentId;
    // Open until a person decides: `submitted`, without the text.
    frame.fileScript(scope, {
      tool: frame.tool,
      toolName: frame.tc.name,
      toolCallId: frame.tc.id,
      iteration: frame.iteration,
      proposed: frame.proposedProgram,
      submitted: frame.programOfCall(frame.tool, bound.args),
      settlement: 'not-entered',
      paused: true,
    });
    // Returning a defined value triggers the footprintjs pause; the
    // returned object becomes the checkpoint's pauseData. detectPause
    // surfaces `pauseData.checkIn` as `outcome.checkIn`.
    return { toolCallId: frame.tc.id, toolName: frame.tc.name, checkIn: request };
  }
  return undefined;
}
