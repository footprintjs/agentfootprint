import type { buildCallStart } from '../execution/callStart.js';
import type { CallExecution, CallArguments } from '../contracts/callCells.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import { extractSequence } from '../../../../../security/extractSequence.js';
import type { DispatchCall } from '../contracts/batchCall.js';

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
export function haltLandedCall(scope: TypedScope<AgentState>, frame: PolicyHaltFrame): void {
  const { haltContext, emitSecurity, tc, newHistory, iteration, callArguments } = frame;
  emitSecurity('agentfootprint.permission.halt', {
    target: tc.name,
    reason: haltContext.reason,
    tellLLM: haltContext.tellLLM,
    sequenceLength: extractSequence(newHistory, iteration).length,
    ...(haltContext.checkerId !== undefined && { checkerId: haltContext.checkerId }),
  });
  scope.history = newHistory;
  scope.policyHaltReason = haltContext.reason;
  scope.policyHaltTellLLM = haltContext.tellLLM;
  scope.policyHaltTarget = tc.name;
  // The carrier law every pause carrier follows (`pausedToolArgs`,
  // `pausedCheckInArgs`, `pausedCredentialArgs`): what the call would
  // have RUN with — `callArgs`, peeled under `.findings()` — never the
  // emission. `PolicyHaltError.proposed.args` hands this to the app as
  // the arguments the policy refused; the model's declaration is on
  // the ledger and in history, not in that hand-off.
  scope.policyHaltArgs = callArguments.callArgs;
  scope.policyHaltIteration = iteration;
  if (haltContext.checkerId !== undefined) {
    scope.policyHaltCheckerId = haltContext.checkerId;
  }
  scope.$break(`policy-halt: ${haltContext.reason}`);
}
