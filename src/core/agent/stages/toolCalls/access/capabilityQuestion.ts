import type { CallArguments, CallExecution, CallResultCell } from '../contracts/callCells.js';
import type { buildCallStart } from '../execution/callStart.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { PermissionCapability } from '../../../../../provider-contract/types.js';
import { checkerContextOf } from './bindings.js';
import { readPermissionDecision } from '../../../../../provider-contract/permissionDecision.js';
import { warnFrozenWrite } from '../../../../../lib/frozenCopy.js';
import type { DispatchCall } from '../contracts/batchCall.js';

type CallStartFacts = ReturnType<ReturnType<typeof buildCallStart>['beginDispatchCall']>;

interface CapabilityQuestionBindings {
  readonly permissionChecker: ToolCallsHandlerDeps['permissionChecker'];
  readonly viewOf: CallStartFacts['viewOf'];
  readonly historyForCallbacks: CallStartFacts['historyForCallbacks'];
  readonly iteration: number;
  readonly runIdentity: { tenant?: string; principal?: string; conversationId: string } | undefined;
  readonly env: ReturnType<TypedScope<AgentState>['$getEnv']>;
  readonly emitSecurity: CallStartFacts['emitSecurity'];
  readonly tc: DispatchCall;
  readonly callArguments: CallArguments;
  readonly execution: CallExecution;
  readonly outcome: CallResultCell;
}

/** Bind the existing per-call capability question to its original live cells. */
export function buildCapabilityQuestion(bindings: CapabilityQuestionBindings) {
  /**
   * Ask the checker about ONE capability beyond `'tool_call'`, and apply
   * the verdict exactly as the gate above applies its own (9.11.0).
   *
   * Called only when BOTH sides declared the capability, so a checker
   * that never opted in is never asked and never has to answer a
   * question it was not written for. `sequence` is deliberately absent —
   * the port says it is empty for non-`tool_call` capabilities, and the
   * in-flight tool sequence is not evidence about a capability.
   */
  const askCapability = async (
    capability: PermissionCapability,
    target: string,
    genericHaltText: string,
  ): Promise<void> => {
    if (!bindings.permissionChecker) return;
    // The ONE fail-closed refusal, shared by a checker that threw and one
    // whose answer is not recognised — the tool_call gate's rule, applied
    // to this capability. Only `rationale` differs.
    const refuseUnanswered = (rationale: string): void => {
      bindings.execution.denied = true;
      bindings.emitSecurity('agentfootprint.permission.check', {
        capability,
        actor: 'agent',
        target,
        result: 'deny',
        rationale,
      });
      bindings.outcome.result =
        `[permission denied: Tool '${bindings.tc.name}' could not be authorized. This will not ` +
        `change during this run — do not call it again. Continue without it, or say ` +
        `what you are unable to do.]`;
    };
    try {
      const decision = await bindings.permissionChecker.check({
        capability,
        actor: 'agent',
        target,
        context: checkerContextOf(bindings.viewOf(bindings.callArguments.callArgs)),
        history: bindings.historyForCallbacks(),
        iteration: bindings.iteration,
        ...(bindings.runIdentity && { identity: bindings.runIdentity }),
        ...(bindings.env.signal && { signal: bindings.env.signal }),
      });
      // Read ONCE, by the one reader (`readPermissionDecision`): only
      // 'allow' / 'gate_open' allow; an answer it does not recognise is a
      // refusal, never a pass.
      const reading = readPermissionDecision(decision);
      if (reading.kind === 'unrecognised') {
        refuseUnanswered(reading.rationale);
        return;
      }
      bindings.emitSecurity('agentfootprint.permission.check', {
        capability,
        actor: 'agent',
        target,
        result: reading.kind === 'allow' ? reading.result : reading.kind,
        ...(decision.policyRuleId !== undefined && { policyRuleId: decision.policyRuleId }),
        ...(decision.rationale !== undefined && { rationale: decision.rationale }),
        ...(decision.reason !== undefined && { reason: decision.reason }),
      });
      if (reading.kind === 'deny') {
        bindings.execution.denied = true;
        bindings.outcome.result =
          decision.tellLLM ?? `[permission denied: ${decision.rationale ?? 'policy'}]`;
      } else if (reading.kind === 'halt') {
        bindings.execution.denied = true;
        // Same reasoning as the tool_call halt: `reason` is a telemetry
        // tag and teaching the model the rule space is not a service.
        const tellLLM = decision.tellLLM ?? genericHaltText;
        bindings.outcome.result = tellLLM;
        bindings.execution.haltContext = {
          reason: decision.reason ?? decision.rationale ?? 'policy-halt',
          tellLLM,
          ...(bindings.permissionChecker.name && { checkerId: bindings.permissionChecker.name }),
        };
      }
    } catch (permErr) {
      warnFrozenWrite('permission checker', permErr, 'the call was denied');
      // Fail closed, and say so terminally — the 9.4.0 lesson applies
      // whole: an operator's outage text reads as weather to a model.
      const msg = permErr instanceof Error ? permErr.message : String(permErr);
      refuseUnanswered(`permission-checker threw: ${msg}`);
    }
  };
  return askCapability;
}
