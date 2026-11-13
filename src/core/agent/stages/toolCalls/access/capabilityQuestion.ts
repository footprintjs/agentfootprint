import type { CallArguments, CallExecution, CallResultCell } from '../contracts/callCells.js';
import type { buildCallStart } from '../execution/callStart.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import {
  checkerGoverns,
  type PermissionCapability,
  type PermissionChecker,
  type ToolCapability,
} from '../../../../../provider-contract/types.js';
import { checkerContextOf } from './bindings.js';
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
      bindings.emitSecurity('agentfootprint.permission.check', {
        capability,
        actor: 'agent',
        target,
        result: decision.result,
        ...(decision.policyRuleId !== undefined && { policyRuleId: decision.policyRuleId }),
        ...(decision.rationale !== undefined && { rationale: decision.rationale }),
        ...(decision.reason !== undefined && { reason: decision.reason }),
      });
      if (decision.result === 'deny') {
        bindings.execution.denied = true;
        bindings.outcome.result =
          decision.tellLLM ?? `[permission denied: ${decision.rationale ?? 'policy'}]`;
      } else if (decision.result === 'halt') {
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
      bindings.execution.denied = true;
      const msg = permErr instanceof Error ? permErr.message : String(permErr);
      bindings.emitSecurity('agentfootprint.permission.check', {
        capability,
        actor: 'agent',
        target,
        result: 'deny',
        rationale: `permission-checker threw: ${msg}`,
      });
      bindings.outcome.result =
        `[permission denied: Tool '${bindings.tc.name}' could not be authorized. This will not ` +
        `change during this run — do not call it again. Continue without it, or say ` +
        `what you are unable to do.]`;
    }
  };
  return askCapability;
}

/**
 * Ask about every capability the tool DECLARES and the checker GOVERNS, in
 * the tool's order, until one refuses (9.11.0). Beside the `tool_call` gate,
 * at the same layer and before any middleware, so an existing checker still
 * decides first. Either side silent and the loop asks nothing, which is why
 * an agent that has not opted in is byte-identical. One owner for the model
 * call (`execution/dispatchCall.ts`) and an inner call (`innerCallGates.ts`).
 */
export async function askDeclaredCapabilities(
  askCapability: ReturnType<typeof buildCapabilityQuestion>,
  permissionChecker: PermissionChecker,
  capabilities: readonly ToolCapability[],
  toolName: string,
  execution: CallExecution,
): Promise<void> {
  for (const capability of capabilities) {
    if (execution.denied) break;
    if (!checkerGoverns(permissionChecker, capability)) continue;
    await askCapability(
      capability,
      toolName,
      `Tool '${toolName}' is not available in this context.`,
    );
  }
}
