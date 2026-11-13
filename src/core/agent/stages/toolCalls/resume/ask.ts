import type { ToolResourcesOperations } from '../contracts/operations/resources.js';
import {
  type DecisionLedger,
  spendDecision,
  runsAsAsked,
  gatedCallOf,
} from '../../../../consentRequest.js';
import { buildToolResolver } from '../../toolResolver.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import { boundArgsOf, changedAfterApproval, rewrittenAfterApproval } from '../access/bindings.js';
import { type CheckInDecision, declinedResult, shouldCheckIn } from '../../../../checkin.js';
import type { ReadToolResultEnvelope } from '../../../../../semantics/toolEffects.js';
import type { ResumedCallFacts, TransitionBatchState } from '../contracts/callFacts.js';
import { recordDecisions } from '../../../middleware/ledger.js';
import type { ToolParty } from '../../../../slots/buildToolsSlot.js';
import { runToolChain } from '../../../../../tools/runChain.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import { PRESENT_TOOL_NAME } from '../../../../../artifacts/present.js';
import { safeStringify } from '../../../validators.js';
import { serveNegativeHandle } from '../../../negativeClaims/capture.js';
import { appendBatchResult } from '../batch/settle.js';
import { judgeLanded } from '../evidence/judgeLanded.js';
import { type DispatchSettlement, outcomeField } from '../execution/callOutcome.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import type { ResumeConsentFrame } from '../contracts/resumeFrames.js';
import type { ToolCatalogOperations } from '../contracts/operations/catalog.js';
import type { ToolSettlementOperations } from '../contracts/operations/settlement.js';
import type { ResumedInvocation } from '../contracts/operations/resumedInvocation.js';
import type { ToolStepsOperations } from '../contracts/operations/steps.js';
import type { ToolArtifactsOperations } from '../contracts/operations/artifacts.js';
import type { ToolMiddlewareOperations } from '../contracts/operations/middleware.js';
import type { ToolLimitsOperations } from '../contracts/operations/limits.js';
import type { ToolEffectsOperations } from '../contracts/operations/effects.js';
import type { ToolScriptsOperations } from '../contracts/operations/scripts.js';
import type { ToolObservationsOperations } from '../contracts/operations/observations.js';
import type { InputsDispatch } from '../contracts/inputsDispatch.js';

interface ResumeAskLinks {
  readonly endCall: ToolResourcesOperations['endCall'];
  readonly decisionLedger: DecisionLedger;
  readonly resolveTool: ReturnType<typeof buildToolResolver>;
  readonly unmountedRules: ToolCatalogOperations['unmountedRules'];
  readonly historyForCheckIn: ToolSettlementOperations['historyForCheckIn'];
  readonly resolveCredentialAndExecute: ResumedInvocation['resolveCredentialAndExecute'];
  readonly frameworkSkipStepAnswered: ToolCatalogOperations['frameworkSkipStepAnswered'];
  readonly applySkipStep: ToolStepsOperations['applySkipStep'];
  readonly applyPresent: ToolArtifactsOperations['applyPresent'];
  readonly afterMoment: ToolMiddlewareOperations['afterMoment'];
  readonly placeResults: ToolArtifactsOperations['placeResults'];
  readonly capResults: ToolLimitsOperations['capResults'];
  readonly applyStepReturn: ToolStepsOperations['applyStepReturn'];
  readonly applyToolEffects: ToolEffectsOperations['applyToolEffects'];
  readonly emitTransitionConflict: ToolEffectsOperations['emitTransitionConflict'];
  readonly settleBatch: ToolSettlementOperations['settleBatch'];
  readonly turnStampOf: ToolCatalogOperations['turnStampOf'];
  readonly fileResumedScript: ToolScriptsOperations['fileResumedScript'];
  readonly emitToolEnd: ToolObservationsOperations['emitToolEnd'];
  readonly bracketSettled: ToolSettlementOperations['bracketSettled'];
}

/** Compose only the existing ask resume door and its original landing order. */
export function buildResumeAsk(
  deps: Pick<
    ToolCallsHandlerDeps,
    | 'resources'
    | 'inputsLayer'
    | 'toolMiddleware'
    | 'artifactStore'
    | 'negativeClaimsArmed'
    | 'stepPlanFor'
    | 'findings'
    | 'findingsJudge'
  >,
  links: ResumeAskLinks,
) {
  const resumeAsk = async (
    scope: TypedScope<AgentState>,
    frame: ResumeConsentFrame,
  ): Promise<void> => {
    const { consentDecision, runSignal, toolName, toolCallId, startMs } = frame;

    const iteration = scope.iteration as number;
    // What the rest of the chain is handed: a detached copy of the
    // approved arguments (`boundArgsOf`). The arguments that come back are
    // held to the REQUEST, never to this copy — a link that edits it in
    // place edits the copy — and the tool runs on another fresh copy.
    const args = boundArgsOf(scope, 'pausedAskArgs');
    const askIndex = (scope.pausedAskIndex ?? 0) as number;
    const askedBy = (scope.pausedAskMiddleware ?? 'middleware') as string;
    // The registered component that COLLECTED this decision (9.24.0),
    // written at pause time only when the ask carried one — the ledger
    // rows below then say which surface the person answered through.
    const answeredVia = scope.pausedComponentId as string | undefined;
    const decision: CheckInDecision = consentDecision;
    // Used from here — so spent here, before any row or the tool: a second
    // resume presenting it is refused ('already-answered').
    await spendDecision(links.decisionLedger, decision, 'ask', runSignal, deps.resources?.answer);

    let result: unknown;
    /** What the model reads. Differs from `result` only when a rule at the
     *  after-tool moment transformed or withheld it. */
    let modelResult: unknown;
    let error: boolean | undefined;
    /** The call REALLY ran, clean — the step-advance eligibility this
     *  path knows about itself (a decline or a chain-deny never ran). */
    let stepToolRan = false;
    /** The effects envelope the resumed call returned (9.19.0). */
    let resumeEnvelope: ReadToolResultEnvelope | undefined;
    /** The unknown status word of a result that is an envelope but for it. */
    let resumeUnknownStatus: string | undefined;
    /** The tool ran (any outcome) — the judge's gate (9.104.0). */
    let toolRan = false;
    let negativeResultId: string | undefined;
    /** What the approved call's `execute` saw — its script row reads it. */
    const scriptSeen: ResumedCallFacts = {};
    if (!decision.approved) {
      result = declinedResult(decision.note);
      recordDecisions(scope, [
        {
          middleware: askedBy,
          moment: 'before-tool',
          at: 'tool',
          toolName,
          toolCallId,
          iteration,
          outcome: 'deny',
          changed: false,
          why: `declined by ${decision.by}${decision.note ? `: ${decision.note}` : ''}`,
          ...(answeredVia !== undefined && { componentId: answeredVia }),
        },
      ]);
    } else {
      recordDecisions(scope, [
        {
          middleware: askedBy,
          moment: 'before-tool',
          at: 'tool',
          toolName,
          toolCallId,
          iteration,
          outcome: 'allow',
          changed: false,
          why: `approved by ${decision.by}${decision.note ? `: ${decision.note}` : ''}`,
          ...(answeredVia !== undefined && { componentId: answeredVia }),
        },
      ]);
      // Continue the chain from the link AFTER the one that asked. Its
      // decision is already on the checkpoint; re-running it would ask the
      // same question twice and file a duplicate row.
      //
      // `askPolicy: 'refuse'` because footprintjs's `PausableHandler.resume`
      // returns void — a resumed dispatch has no second checkpoint to give.
      // A link further down the chain that also wants a person gets a named,
      // model-visible refusal and the tool does NOT run. That is the same
      // rule already applied to a tool that tries to pause during an
      // approved check-in resume: at most one human question per resume.
      // Resolved BEFORE the chain runs, not after, because the links that
      // continue here must see the same `toolSource` the links before the
      // ask saw. A chain that changed its mind about where a tool came from
      // halfway through one dispatch would be worse than not knowing.
      //
      // Resolved against the party the CHECKPOINT carries (9.92.0): a
      // fresh instance has an empty served record and Compose has not
      // re-run, so without it the build-time map's first holder answered.
      const resolved = links.resolveTool(toolName, scope.pausedToolParty as ToolParty | undefined);
      const tool = resolved.tool;
      // ── THE INPUTS LAYER'S REFUSALS, re-applied at this door (honesty
      // layer 2). The batch loop decides them BEFORE the chain, so a call
      // it refuses never reaches an ask. This door still asks both
      // questions itself: a checkpoint written before they moved ahead of
      // the chain, or resumed on an agent built without the layer, must
      // not run a ruled tool unruled because a person approved the ask.
      // Refused here, the rest of the chain is not walked and the tool
      // does not run — the argument-refusal shape the loop lands.
      const inputs: InputsDispatch | undefined =
        deps.inputsLayer === true ? await import('../../../arguments/dispatch.js') : undefined;
      const unmounted = links.unmountedRules(tool, toolName);
      const rulesRefusal =
        inputs?.resolutionsFor(scope, iteration).get(toolCallId)?.refused ??
        (unmounted === undefined ? undefined : await unmounted);
      if (rulesRefusal !== undefined) {
        error = true;
        result = rulesRefusal;
      } else {
        const rest = await runToolChain(deps.toolMiddleware ?? [], {
          toolName,
          ...(tool?.source !== undefined && { toolSource: tool.source }),
          toolCallId,
          iteration,
          args,
          history: [...(scope.history as readonly LLMMessage[])],
          startIndex: askIndex + 1,
          askPolicy: 'refuse',
        });
        recordDecisions(scope, rest.decisions);
        // The approval covers the arguments the person was shown. The ones
        // the rest of the chain hands back must re-derive the paused
        // request's id (`runsAsAsked`) — held to the request itself, never
        // to the copy the links were handed. Any other arguments are not
        // approved: the call does not run, and the record and the model
        // are told why ('call-changed').
        const read = (key: string): unknown => scope.$getValue(key);
        const rewrittenBy =
          rest.kind === 'deny' ||
          runsAsAsked(read('pausedRequest'), gatedCallOf(read, 'ask'), rest.args)
            ? undefined
            : changedAfterApproval(rest.decisions);
        // The arguments the call runs with: a fresh copy of the approved
        // ones (equal, by the check above, to what the chain handed back),
        // so nothing a link still holds can reach the tool.
        const runArgs = boundArgsOf(scope, 'pausedAskArgs');
        // Would this tool's OWN consent gate have fired for this call? Asked by
        // EVALUATING the demand, not by noticing that one was declared (8.13.0).
        // Before that, any tool carrying a `checkIn` field was refused here even
        // when its predicate said no — a selective gate (`amount > 1000`) blocked
        // the £5 refunds it was written to let through, and the refusal claimed a
        // consent gate would have run when it provably would not have.
        //
        // Judged on `runArgs` (what the tool would actually run with) and on
        // the same history shape the loop's gate uses, so the answer cannot
        // depend on which door the call arrived through. The predicate is
        // handed its own frozen copy of them (`shouldCheckIn`), never
        // `runArgs` itself: a predicate that wrote into its argument used
        // to change the call the person had approved.
        const demandTrips =
          rest.kind !== 'deny' &&
          rewrittenBy === undefined &&
          tool?.checkIn !== undefined &&
          shouldCheckIn(tool.checkIn, runArgs, {
            iteration,
            toolCallId,
            history: links.historyForCheckIn(scope, scope.history as readonly LLMMessage[]),
          });
        if (rest.kind === 'deny') {
          result = rest.reason;
        } else if (rewrittenBy !== undefined) {
          error = true;
          result = rewrittenAfterApproval(toolName, rewrittenBy);
          recordDecisions(scope, [
            {
              middleware: askedBy,
              moment: 'before-tool',
              at: 'tool',
              toolName,
              toolCallId,
              iteration,
              outcome: 'deny',
              changed: false,
              why:
                `the approval covers the arguments the person was shown; ${rewrittenBy}, ` +
                `so the call was not run (call-changed)`,
            },
          ]);
        } else if (demandTrips) {
          // The one-question rule, from the other direction: this tool's own
          // consent gate really does demand a person for THESE arguments, and
          // there is no checkpoint left to ask with.
          //
          // The two gates ask DIFFERENT questions, which is why an approval of
          // one is not an answer to the other. A middleware `ask` carries the
          // rule's own free-text question; a check-in carries the TOOL's demand
          // with the evidence pack attached — `willDo`, what the run read, what
          // drove the choice, the trail — none of which the person who approved
          // the ask ever saw. Letting the approval satisfy both would file a
          // `checkin.decision` for a question nobody was asked. Governance never
          // silently invents a decision, for the same reason it never silently
          // drops one.
          error = true;
          // A past fact about the resumed call, not a forecast about the
          // turn (9.86.1): "cannot be retried this turn … Answer without it,
          // or finish" was a prediction plus a standing order on a result
          // that is re-read on every later call.
          result =
            `tool '${toolName}' was not executed on that call, and the resumed dispatch had ` +
            `no second checkpoint to retry it on: it declares its own checkIn consent gate, ` +
            `and that gate tripped for those arguments. (To ` +
            `the agent's author: the middleware '${askedBy}' and the tool's checkIn ask ` +
            `different questions — one is the rule's, one is the tool's with the evidence ` +
            `pack attached — so approving one is not answering the other. Keep one gate for ` +
            `this tool: drop the tool's \`checkIn\`, or let \`onToolCall\` return allow() for ` +
            `tools that declare their own.)`;
        } else {
          const env = scope.$getEnv();
          const dispatched = await links.resolveCredentialAndExecute(
            scope,
            resolved,
            toolName,
            runArgs,
            toolCallId,
            iteration,
            env,
            'ask',
            scriptSeen,
          );
          negativeResultId = dispatched.negativeResultId;
          result = dispatched.result;
          error = dispatched.error;
          toolRan = dispatched.executed === true;
          // Held to the request at the last moment and found changed: the
          // record says so, as for a rewrite the chain handed back.
          if (dispatched.callChanged === true) {
            recordDecisions(scope, [
              {
                middleware: askedBy,
                moment: 'before-tool',
                at: 'tool',
                toolName,
                toolCallId,
                iteration,
                outcome: 'deny',
                changed: false,
                why:
                  'the approval covers the arguments the person was shown; they changed ' +
                  'before the call could run, so the call was not run (call-changed)',
              },
            ]);
          }
          // A ceiling-refused call RAN but must not advance a step (9.20.0);
          // its envelope — status 'invalid' plus any surviving declared
          // effects — is still picked up and judged below.
          stepToolRan =
            dispatched.executed === true && error !== true && dispatched.ceilingRefused !== true;
          if (dispatched.executed === true && error !== true) {
            resumeEnvelope = dispatched.envelope;
            resumeUnknownStatus = dispatched.unknownStatus;
          }
          // skip_step behind a middleware ask, approved (9.18.0): the
          // placeholder just landed — replace it with the authoritative
          // sentence BEFORE the chain's last word, the execute loop's
          // composition kept.
          if (links.frameworkSkipStepAnswered(toolName, tool) && stepToolRan) {
            result = links.applySkipStep(scope, { args: runArgs, toolCallId, iteration });
          }
          // present behind a middleware ask, approved (9.22.0): same
          // overwrite the batch loop applies — the snapshot (or refusal)
          // replaces the placeholder before the chain's last word. A miss
          // is an errored call here too.
          if (deps.artifactStore && toolName === PRESENT_TOOL_NAME && stepToolRan) {
            const presented = await links.applyPresent(scope, {
              args: runArgs,
              toolCallId,
              iteration,
            });
            result = presented.text;
            if (!presented.ok) {
              error = true;
              stepToolRan = false;
            }
          }
          // The tool ran on this side of the pause, so the chain gets its
          // last word here too — a rule about results cannot be skipped by
          // routing a call through a human.
          if (dispatched.executed === true) {
            modelResult = await links.afterMoment(scope, {
              ...(tool && { tool }),
              toolName,
              toolCallId,
              iteration,
              args: runArgs,
              result,
              negativeResultId,
              ...(error === true && { error: true }),
              history: [...(scope.history as readonly LLMMessage[])],
              ...(scope.runIdentity && { identity: scope.runIdentity }),
              ...(env.signal && { signal: env.signal }),
            });
          }
        }
      }
    }

    // `modelResult` is only set where the after-tool moment ran; everywhere
    // else the two are the same value.
    if (modelResult === undefined) modelResult = result;
    // Placement then the truncation net — the batch loop's precedence,
    // kept on this door (a resumed result is as placeable as an inline
    // one; `stepToolRan` is exactly "ran clean").
    const askPlaced = await links.placeResults(
      scope,
      { toolName, toolCallId, iteration },
      { result, modelResult },
      stepToolRan,
    );
    const askCapped = links.capResults(toolName, askPlaced);
    modelResult = askCapped.modelResult;
    let askResultStr = typeof modelResult === 'string' ? modelResult : safeStringify(modelResult);
    const askToolChars = askResultStr.length;
    if (deps.negativeClaimsArmed === true)
      askResultStr = serveNegativeHandle(scope, negativeResultId, askResultStr);
    // How the call settled — read by the step and by the message's `outcome`.
    const askSettled: DispatchSettlement = {
      ran: toolRan,
      clean: stepToolRan,
      ...(resumeEnvelope?.status !== undefined && { status: resumeEnvelope.status }),
      ...(resumeUnknownStatus !== undefined && { unknownStatus: resumeUnknownStatus }),
    };
    // Step boundary (9.18.0) — a result finalized HERE is as final as one
    // from the batch loop: the answered call advances or holds the step
    // before the push by the same rule (`stepOutcomeOf`), exactly as it
    // would have inline; a declined ask ran nothing and holds silently.
    if (deps.stepPlanFor) {
      askResultStr += links.applyStepReturn(scope, {
        toolName,
        toolCallId,
        iteration,
        settled: askSettled,
      });
    }
    // Typed tool effects (9.19.0) — a resumed call's envelope is judged
    // exactly as an inline one's (fresh single-call batch state).
    if (resumeEnvelope !== undefined) {
      const askTransition: TransitionBatchState = { losers: [] };
      askResultStr += links.applyToolEffects(
        scope,
        { toolName, toolCallId, iteration },
        resumeEnvelope,
        askTransition,
      );
      links.emitTransitionConflict(scope, iteration, askTransition);
    }
    // The batch settlement (9.113.0): the answered call's result, then the
    // siblings the pause left un-dispatched, each settled — never run.
    const askSettlement = links.settleBatch(
      [
        ...(scope.history as readonly LLMMessage[]),
        {
          role: 'tool',
          content: askResultStr,
          ...(deps.negativeClaimsArmed === true && { toolChars: askToolChars }),
          toolCallId,
          toolName,
          ...(deps.findings === true && !toolRan && { toolResultOrigin: 'not-entered' as const }),
          // A declined ask ran nothing → 'refused'; read by the check-in trail.
          ...outcomeField(askSettled),
        },
      ],
      { toolName, toolCallId },
    );
    const askHistory = askSettlement.history;
    scope.history = askHistory;
    scope.lastToolResult = {
      toolName,
      result: askResultStr,
      ...(resumeEnvelope?.status !== undefined && { status: resumeEnvelope.status }),
    };
    appendBatchResult(scope, {
      toolName,
      result: askResultStr,
      toolCallId,
      ...(resumeEnvelope?.status !== undefined && { status: resumeEnvelope.status }),
    });
    await judgeLanded(
      scope,
      deps.findingsJudge,
      toolRan,
      { toolName, result: askResultStr, toolCallId },
      iteration,
      links.turnStampOf(scope),
    );
    links.fileResumedScript(scope, {
      toolName,
      toolCallId,
      iteration,
      carried: args,
      entered: toolRan,
      seen: scriptSeen,
    });
    links.emitToolEnd(
      scope,
      toolName,
      {
        toolCallId,
        result: askCapped.result,
        durationMs: Date.now() - startMs,
        ...(error === true && { error: true }),
        ...(resumeEnvelope?.status !== undefined && { status: resumeEnvelope.status }),
        ...(askCapped.modelResult !== askCapped.result && {
          modelResult: askCapped.modelResult,
        }),
      },
      toolRan,
      undefined,
      negativeResultId,
      args,
    );
    links.bracketSettled(scope, askSettlement);
    typedEmit(scope, 'agentfootprint.agent.iteration_end', {
      turnIndex: 0,
      iterIndex: iteration,
      // The brackets THIS leg closed: the answered call's, plus one per
      // settled sibling. The calls before the paused one closed theirs on
      // the leg that paused, which ended in a checkpoint, not here.
      toolCallCount: 1 + askSettlement.settled.length,
      history: askHistory,
    });
    if (deps.inputsLayer === true) scope.argumentAsk = undefined;
    scope.iteration = iteration + 1;
    await links.endCall(scope);
    scope.pausedToolCallId = '';
    scope.pausedToolName = '';
    scope.pausedToolStartMs = 0;
    scope.pausedAsk = false;
    scope.pausedAskArgs = undefined;
    scope.pausedAskIndex = undefined;
    scope.pausedAskMiddleware = undefined;
    scope.pausedAskChain = undefined;
    // The request was answered — and spent — by this resume.
    scope.pausedRequest = undefined;
    // Cleared ONLY when it was set: a later component-less pause in this
    // run must not inherit this ask's surface, and a run that never
    // carried one must not gain the key (byte-identical).
    if (answeredVia !== undefined) scope.pausedComponentId = undefined;
    // The served party the checkpoint carried is consumed with it (9.92.0);
    // written back only when it was there, so an older checkpoint's resume
    // commits exactly what it always did.
    if (scope.pausedToolParty !== undefined) scope.pausedToolParty = undefined;
    return;
  };
  return { resumeAsk };
}
