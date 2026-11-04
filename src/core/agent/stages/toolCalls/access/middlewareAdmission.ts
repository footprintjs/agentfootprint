import type { buildCallStart } from '../execution/callStart.js';
import type { buildDispatchContext } from '../batch/dispatchContext.js';
import type { CallArguments, CallExecution, CallOutcome } from '../contracts/callCells.js';
import type { InputsDispatch } from '../contracts/inputsDispatch.js';
import type { buildToolArtifactsOperations } from '../execution/artifactsOperations.js';
import type { buildToolScriptsOperations } from '../evidence/scriptsOperations.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import { runToolChain } from '../../../../../tools/runChain.js';
import {
  mintConsentRequest,
  type GatedCall,
  type DecisionLedger,
} from '../../../../consentRequest.js';
import { unboundAskRows, unboundCallRefusal } from './bindings.js';
import { recordDecisions } from '../../../middleware/ledger.js';
import type { DispatchCall } from '../contracts/batchCall.js';

type CallStartFacts = ReturnType<ReturnType<typeof buildCallStart>['beginDispatchCall']>;
type DispatchContext = ReturnType<
  ReturnType<typeof buildDispatchContext>['prepareDispatchContext']
>;

interface AdmitMiddlewareCallFrame {
  readonly tc: DispatchCall;
  readonly tool: CallStartFacts['tool'];
  readonly iteration: number;
  readonly callArguments: CallArguments;
  readonly historyForCallbacks: CallStartFacts['historyForCallbacks'];
  readonly runIdentity: DispatchContext['runIdentity'];
  readonly env: DispatchContext['env'];
  readonly oneQuestionAsked: boolean;
  readonly resolved: CallStartFacts['resolved'];
  readonly decisionLedger: DecisionLedger;
  readonly inputs: InputsDispatch | undefined;
  readonly invalidateViews: CallStartFacts['invalidateViews'];
  readonly execution: CallExecution;
  readonly outcome: CallOutcome;
  readonly askedLayer: InputsDispatch | undefined;
  readonly resolution: ReturnType<ReturnType<InputsDispatch['resolutionsFor']>['get']>;
  readonly assertComponentDeliverable: ReturnType<
    typeof buildToolArtifactsOperations
  >['assertComponentDeliverable'];
  readonly newHistory: DispatchContext['newHistory'];
  readonly startMs: CallStartFacts['startMs'];
  readonly fileScript: ReturnType<typeof buildToolScriptsOperations>['fileScript'];
  readonly proposedProgram: CallStartFacts['proposedProgram'];
  readonly programOfCall: ReturnType<typeof buildToolScriptsOperations>['programOfCall'];
}

/** Existing middlewareAdmission body; the owning handler retains its admission guard and native pause return. */
export async function admitMiddlewareCall(
  scope: TypedScope<AgentState>,
  deps: Pick<ToolCallsHandlerDeps, 'toolMiddleware'>,
  frame: AdmitMiddlewareCallFrame,
) {
  const chain = await runToolChain(deps.toolMiddleware!, {
    toolName: frame.tc.name,
    // Provenance from the tool that is about to run, so a policy can
    // scope to the server that served it. Absent for our own tools.
    ...(frame.tool?.source !== undefined && { toolSource: frame.tool.source }),
    toolCallId: frame.tc.id,
    iteration: frame.iteration,
    args: frame.callArguments.callArgs,
    history: frame.historyForCallbacks(),
    ...(frame.runIdentity && { identity: frame.runIdentity }),
    ...(frame.env.signal && { signal: frame.env.signal }),
    // One human question per resume: this batch already asked the
    // person for argument values, so a link that also wants a person
    // gets the chain's named refusal and the tool does not run.
    ...(frame.oneQuestionAsked && { askPolicy: 'refuse' as const }),
  });
  // The rules the asked call still has to pass once the person
  // answers: the asking link and every link after it, by name.
  const askChain =
    chain.kind === 'ask'
      ? deps.toolMiddleware!.slice(chain.index).map((link) => link.name)
      : undefined;
  // The request the person would be asked (`core/consentRequest.ts`):
  // an id their decision must quote, bound to a detached copy of this
  // exact call — the args AS TRANSFORMED SO FAR, where the chain
  // resumes and the rules from there on. Minted only for a call that
  // is about to pause.
  const bound =
    chain.kind === 'ask'
      ? mintConsentRequest(
          {
            gate: 'ask',
            tool: frame.tc.name,
            toolCallId: frame.tc.id,
            party: frame.resolved.party,
            args: chain.args,
            middleware: chain.middleware,
            askIndex: chain.index,
            chain: askChain,
          } satisfies GatedCall,
          frame.decisionLedger,
        )
      : undefined;
  // An ask no approval could be bound to asked nobody, and its row
  // says so (`unboundAskRows`).
  const chainRows =
    chain.kind === 'ask' && bound === undefined
      ? unboundAskRows(chain.decisions, chain.middleware, chain.payload.question)
      : chain.decisions;
  // Under the inputs layer, a rewrite of a RULED tool's arguments is
  // filed with the NAMES of the keys it changed (honesty layer 2) —
  // the answer's standing reads a rewritten ruled argument with no
  // declared origin as assumed. Every other row: as it always was.
  recordDecisions(
    scope,
    frame.inputs !== undefined ? frame.inputs.decisionsToRecord(frame.tool, chainRows) : chainRows,
  );
  frame.callArguments.callArgs = chain.args;
  frame.callArguments.chainedArgs = chain.args;
  // The links were handed the live arguments (a link rewrites by what
  // it hands back, and may have edited them in place): the shared
  // frozen copy is made again from what the chain handed back.
  frame.invalidateViews();
  if (chain.kind === 'deny') {
    frame.execution.denied = true;
    // A link that ASKED, refused by the one-question law: the person's
    // answers this call carried are kept for its next proposal.
    frame.outcome.result =
      chain.refusedAsk === true && frame.askedLayer !== undefined
        ? chain.reason + frame.askedLayer.keptNote(scope, frame.tc.name, frame.resolution)
        : chain.reason;
  } else if (chain.kind === 'ask' && bound === undefined) {
    // A call no approval could be bound to is refused, never asked.
    frame.execution.denied = true;
    frame.outcome.error = true;
    frame.outcome.result = unboundCallRefusal(frame.tc.name, 'ask');
  } else if (chain.kind === 'ask' && bound !== undefined) {
    // The typed half of the question (9.24.0), judged BEFORE anything
    // is committed: a component the screen could not render must
    // refuse here, at the source, not pause and be discovered. The
    // `ask()` constructor already checked the shape; a hand-built
    // outcome literal bypasses it, so the shape is re-asserted at
    // this boundary (cheap, idempotent) along with the propsRef
    // resolution only a raise site can judge. Asks without a
    // component skip all of it.
    const askComponent =
      chain.payload.component !== undefined
        ? await frame.assertComponentDeliverable(
            scope,
            frame.tc.name,
            chain.payload.component,
            `ask middleware '${chain.middleware}'`,
          )
        : undefined;
    // Commit partial state so resume() finds history intact (the
    // pauseHere / check-in path does the same). The TRANSFORMED args
    // ride the checkpoint — the bound copy: a person approves what the
    // chain produced, not what the model originally proposed.
    scope.history = frame.newHistory;
    scope.pausedToolCallId = frame.tc.id;
    scope.pausedToolName = frame.tc.name;
    scope.pausedToolStartMs = frame.startMs;
    scope.pausedAsk = true;
    scope.pausedAskArgs = bound.args;
    scope.pausedAskIndex = chain.index;
    scope.pausedAskMiddleware = chain.middleware;
    scope.pausedAskChain = askChain;
    scope.pausedRequest = bound.request;
    // The party this call was resolved against (9.92.0) — so a resume
    // in a FRESH instance dispatches to the same party, never to the
    // build-time map's first holder. Pause-path-only.
    if (frame.resolved.party !== undefined) scope.pausedToolParty = frame.resolved.party;
    // Which surface will collect the decision — carried so the
    // resume-side ledger rows can say which component ANSWERED.
    // Written only when one exists: a component-less ask's
    // checkpoint stays byte-identical.
    if (askComponent !== undefined) scope.pausedComponentId = askComponent.componentId;
    // The call is open, waiting on a person: its script row says
    // `submitted`, without the text — the settled row carries it.
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
    // A defined return value triggers the footprintjs pause; this
    // object becomes the checkpoint's pauseData, and detectPause
    // surfaces `pauseData.ask` as `outcome.ask`.
    return {
      toolCallId: frame.tc.id,
      toolName: frame.tc.name,
      ask: { ...chain.payload, middleware: chain.middleware, id: bound.request.id },
    };
  }
  return undefined;
}
