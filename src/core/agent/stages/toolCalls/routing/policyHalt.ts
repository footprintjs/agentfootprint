import type { buildCallStart } from '../execution/callStart.js';
import type { CallExecution, CallArguments } from '../contracts/callCells.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import { extractSequence } from '../../../../../security/extractSequence.js';
import type { DispatchCall } from '../contracts/batchCall.js';
import type { ToolArgs } from '../../../../../tools/runChain.js';
import type { InnerCallHalt } from '../../../innerCallOuter.js';
import { bindToolSecurityEvents } from '../../../toolSecurityEvents.js';

type CallStartFacts = ReturnType<ReturnType<typeof buildCallStart>['beginDispatchCall']>;

interface PolicyHaltFrame {
  readonly haltContext: NonNullable<CallExecution['haltContext']>;
  readonly emitSecurity: CallStartFacts['emitSecurity'];
  readonly tc: DispatchCall;
  readonly newHistory: LLMMessage[];
  readonly iteration: number;
  readonly callArguments: CallArguments;
}

// v2.12 — strict halt ordering (continued).
//
// The synthetic tool_result for the halt-triggering call has
// ALREADY been pushed to newHistory above. Now: emit the halt
// event, commit history to scope, set the scope flags Agent.run
// reads at the API boundary, and break the loop. This SKIPS any
// remaining parallel-call siblings (intentional — once a halt
// fires, no further tool dispatches should occur this turn).
//
// An INNER call's halt (`haltContext.call`, `innerCallOuter.ts`) takes the
// same path once its outer call has landed: the outer call's real result is
// what was pushed, and the event and the flags name the inner call — its id,
// its tool, the arguments the checker refused.
export function haltLandedCall(scope: TypedScope<AgentState>, frame: PolicyHaltFrame): void {
  const { haltContext, emitSecurity, tc, newHistory, iteration, callArguments } = frame;
  const inner = haltContext.call;
  endRunOnHalt(scope, {
    haltContext,
    emitSecurity:
      inner === undefined
        ? emitSecurity
        : bindToolSecurityEvents(scope, { toolCallId: inner.toolCallId, iteration }),
    target: inner?.toolName ?? tc.name,
    // The carrier law every pause carrier follows (`pausedToolArgs`,
    // `pausedCheckInArgs`, `pausedCredentialArgs`): what the call would
    // have RUN with — `callArgs`, peeled under `.findings()` — never the
    // emission. `PolicyHaltError.proposed.args` hands this to the app as
    // the arguments the policy refused; the model's declaration is on
    // the ledger and in history, not in that hand-off.
    args: inner?.args ?? callArguments.callArgs,
    history: newHistory,
    iteration,
  });
}

/**
 * End the run on an inner call's halt at a RESUME door: the door has already
 * landed the outer call's result in `scope.history`, so this is the halt half
 * alone — the same event, flags and break as `haltLandedCall`.
 */
export function haltResumedCall(
  scope: TypedScope<AgentState>,
  halt: InnerCallHalt,
  iteration: number,
): void {
  endRunOnHalt(scope, {
    haltContext: halt,
    emitSecurity: bindToolSecurityEvents(scope, { toolCallId: halt.call.toolCallId, iteration }),
    target: halt.call.toolName,
    args: halt.call.args,
    history: [...((scope.history as readonly LLMMessage[] | undefined) ?? [])],
    iteration,
  });
}

/** The one halt path: the event, the history, the flags `Agent.run` reads, the break. */
function endRunOnHalt(
  scope: TypedScope<AgentState>,
  halt: {
    readonly haltContext: Omit<NonNullable<CallExecution['haltContext']>, 'call'>;
    readonly emitSecurity: CallStartFacts['emitSecurity'];
    readonly target: string;
    readonly args: ToolArgs;
    readonly history: LLMMessage[];
    readonly iteration: number;
  },
): void {
  const { haltContext, emitSecurity, target, args, history, iteration } = halt;
  emitSecurity('agentfootprint.permission.halt', {
    target,
    reason: haltContext.reason,
    tellLLM: haltContext.tellLLM,
    sequenceLength: extractSequence(history, iteration).length,
    ...(haltContext.checkerId !== undefined && { checkerId: haltContext.checkerId }),
  });
  scope.history = history;
  scope.policyHaltReason = haltContext.reason;
  scope.policyHaltTellLLM = haltContext.tellLLM;
  scope.policyHaltTarget = target;
  scope.policyHaltArgs = args;
  scope.policyHaltIteration = iteration;
  if (haltContext.checkerId !== undefined) {
    scope.policyHaltCheckerId = haltContext.checkerId;
  }
  scope.$break(`policy-halt: ${haltContext.reason}`);
}
