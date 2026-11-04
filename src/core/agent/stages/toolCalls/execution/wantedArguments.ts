import type { buildCallStart } from './callStart.js';
import type { buildToolArtifactsOperations } from './artifactsOperations.js';
import type { CallArguments, CallResultCell } from '../contracts/callCells.js';
import type { CallArtifactInputs } from '../contracts/invocationInputs.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { DispatchCall } from '../contracts/batchCall.js';

type CallStartFacts = ReturnType<ReturnType<typeof buildCallStart>['beginDispatchCall']>;

interface AdmitWantedArgumentsFrame {
  readonly resolveWantsAtDispatch: ReturnType<
    typeof buildToolArtifactsOperations
  >['resolveWantsAtDispatch'];
  readonly tc: DispatchCall;
  readonly tool: NonNullable<CallStartFacts['tool']>;
  readonly callArguments: CallArguments;
  readonly wanted: CallArtifactInputs;
  readonly outcome: CallResultCell;
}

/** Existing wantedArguments body; original guard and native pause return stay with the handler. */
export async function admitWantedArguments(
  scope: TypedScope<AgentState>,
  frame: AdmitWantedArgumentsFrame,
) {
  const resolution = await frame.resolveWantsAtDispatch(
    scope,
    frame.tc.name,
    frame.tool.wants!,
    frame.callArguments.callArgs,
    frame.tool.schema.inputSchema,
  );
  if (resolution.ok) {
    frame.callArguments.callArgs = resolution.args;
    frame.wanted.wantedMeta = resolution.wanted;
  } else {
    frame.wanted.wantsBlocked = true;
    frame.outcome.error = true;
    frame.outcome.result = resolution.refusal;
  }
}
