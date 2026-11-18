import type { buildCallStart } from '../execution/callStart.js';
import type { buildToolScriptsOperations } from '../evidence/scriptsOperations.js';
import type { CallExecution, CallArguments, CallResultCell } from '../contracts/callCells.js';
import type { buildToolObservationsOperations } from './observationsOperations.js';
import type { buildToolLimitsOperations } from '../decorators/limitsOperations.js';
import type { changedArgKeys } from '../../../../toolShownArgs.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { DispatchCall } from '../contracts/batchCall.js';

type CallStartFacts = ReturnType<ReturnType<typeof buildCallStart>['beginDispatchCall']>;

interface RecordCallSettlementFrame {
  readonly fileScript: ReturnType<typeof buildToolScriptsOperations>['fileScript'];
  readonly tool: CallStartFacts['tool'];
  readonly tc: DispatchCall;
  readonly iteration: number;
  readonly proposedProgram: CallStartFacts['proposedProgram'];
  readonly execution: CallExecution;
  readonly programOfCall: ReturnType<typeof buildToolScriptsOperations>['programOfCall'];
  readonly callArguments: CallArguments;
  readonly emitToolEnd: ReturnType<typeof buildToolObservationsOperations>['emitToolEnd'];
  readonly capped: ReturnType<ReturnType<typeof buildToolLimitsOperations>['capResults']>;
  readonly durationMs: number;
  readonly outcome: CallResultCell;
  readonly modelResult: unknown;
  readonly changedKeys: ReturnType<typeof changedArgKeys>;
}

/** The existing synchronous callSettlement phase; no new await or checkpoint carrier. */
export function recordCallSettlement(
  scope: TypedScope<AgentState>,
  frame: RecordCallSettlementFrame,
): void {
  // The call has settled: its script row, read from the runner's facts
  // first, then from how the call settled — never from the delivery
  // (`ceilingRefused` rides the row as `resultWithheld`).
  frame.fileScript(scope, {
    tool: frame.tool,
    toolName: frame.tc.name,
    toolCallId: frame.tc.id,
    iteration: frame.iteration,
    proposed: frame.proposedProgram,
    submitted: frame.execution.executed
      ? frame.execution.submittedProgram
      : frame.programOfCall(frame.tool, frame.callArguments.callArgs),
    settlement: !frame.execution.executed
      ? 'not-entered'
      : frame.execution.executeThrew
      ? 'threw'
      : 'returned',
    ...(frame.execution.ranCode !== undefined && { facts: frame.execution.ranCode }),
    withheld: frame.execution.withheldOverCeiling,
  });
  frame.emitToolEnd(
    scope,
    frame.tc.name,
    {
      toolCallId: frame.tc.id,
      result: frame.capped.result,
      durationMs: frame.durationMs,
      ...(frame.outcome.error === true && { error: true }),
      // The tool's own declared outcome (9.19.0) — additive, envelope
      // tools only.
      ...(frame.outcome.toolStatus !== undefined && { status: frame.outcome.toolStatus }),
      // Each only when a CONFIGURED RULE acted — an `onToolResult` link or
      // the cap (`modelResult`), an `onToolCall` link or the tool's own
      // redaction (`changedArgKeys`), a permission policy or a link that
      // refused (`notExecuted`). Whether the tool was entered is not stamped
      // here: `emitToolEnd` writes `entered` from the `executed` flag passed
      // below, for this path and every resume alike, so a call that failed
      // to run on its own (an unknown name, an args rejection, a credential
      // block) reads `error: true, entered: false`, and a success keeps its
      // bytes.
      ...(frame.modelResult !== frame.capped.result && { modelResult: frame.modelResult }),
      ...(frame.execution.executed &&
        frame.changedKeys.length > 0 && { changedArgKeys: frame.changedKeys }),
      ...(frame.execution.denied && { notExecuted: true as const }),
    },
    frame.execution.executed,
    frame.outcome.toolEnvelope?.status,
    frame.execution.negativeDispatch?.resultId,
    frame.callArguments.callArgs,
  );
}
