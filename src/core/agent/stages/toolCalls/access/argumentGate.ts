import type { buildCallStart } from '../execution/callStart.js';
import type {
  CallExecution,
  CallResultCell,
  CallArgumentGate,
  CallConsentGate,
} from '../contracts/callCells.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import {
  streamedToolArgIssues,
  formatToolArgIssues,
} from '../../../../../tools/toolArgsValidation.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import type { DispatchCall } from '../contracts/batchCall.js';
import type { ToolCatalogOperations } from '../contracts/operations/catalog.js';

type CallStartFacts = ReturnType<ReturnType<typeof buildCallStart>['beginDispatchCall']>;

interface ArgumentGateFrame {
  readonly tc: DispatchCall;
  readonly tool: CallStartFacts['tool'];
  readonly iteration: number;
  readonly execution: CallExecution;
  readonly outcome: CallResultCell;
}

/** The original streamed-argument refusal and ruled-tool admission probes. */
export function prepareArgumentGate(
  scope: TypedScope<AgentState>,
  frame: ArgumentGateFrame,
  ports: Pick<ToolCatalogOperations, 'unmountedRules' | 'warnUnmountedToolPeriod'>,
) {
  const { tc, tool, iteration, execution, outcome } = frame;
  const { unmountedRules, warnUnmountedToolPeriod } = ports;
  const argumentGate: CallArgumentGate = {
    // Tool-args validation (#9) and the inputs layer's refusals share one
    // flag: the call is refused for its ARGUMENTS and lands in one shape.
    argsRejected: tc.argumentsFailure !== undefined,
  };
  if (!execution.denied && tc.argumentsFailure !== undefined) {
    const issues = streamedToolArgIssues(tc.argumentsFailure);
    typedEmit(scope, 'agentfootprint.validation.args_invalid', {
      toolName: tc.name,
      toolCallId: tc.id,
      iteration,
      issues,
      enforced: true,
    });
    outcome.error = true;
    outcome.result = formatToolArgIssues(tc.name, issues);
  }
  const consentGate: CallConsentGate = {
    // A check-in that tripped in a batch whose one human question was the
    // inputs layer's ask (`oneQuestionAsked`) — refused, never asked.
    checkInRefused: false,
  };
  // ── THE INPUTS LAYER'S REFUSALS (honesty layer 2) — the argument-
  // refusal shape the validation refusal below uses, decided HERE:
  // after permission (policy sees every attempted call) and BEFORE the
  // middleware chain, so no middleware can `ask` a person about a call
  // the library has already decided must not run — an approved ask
  // resumes through its own door, which re-applies both refusals
  // (`resume`, the middleware-ask path). Refused: a call whose tool's
  // rules could not be read at dispatch (the layer's entry), and — with
  // the layer NOT mounted — any call whose tool declares rules (fail
  // closed). Neither applies to a tool that declares nothing — and
  // neither awaits for one (`unmountedRules` answers it synchronously).
  const unmounted =
    execution.denied || argumentGate.argsRejected ? undefined : unmountedRules(tool, tc.name);
  warnUnmountedToolPeriod(tool, tc.name);
  return { argumentGate, consentGate, unmounted };
}
