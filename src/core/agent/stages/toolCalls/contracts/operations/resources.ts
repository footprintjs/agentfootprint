import type { ResourceFacts } from '../../../../componentResources.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../types.js';
import type { ToolCallsHandlerDeps } from '../handlerDeps.js';
import type { ToolExecutionContext } from '../../../../../../tools/tools.js';

/** Explicit callback contract for existing resources operations. */
export interface ToolResourcesOperations {
  readonly runFactsOf: (
    scope: TypedScope<AgentState>,
  ) => ReturnType<NonNullable<ToolCallsHandlerDeps['currentRun']>> | undefined;
  readonly resourceFactsOf: (scope: TypedScope<AgentState>) => ResourceFacts;
  readonly sessionContext: (
    scope: TypedScope<AgentState>,
    toolName: string,
    toolCallId: string,
  ) => Pick<
    ToolExecutionContext,
    | 'runId'
    | 'sessionId'
    | 'identity'
    | 'redact'
    | 'onTeardown'
    | 'teardownScopes'
    | 'resourceOwner'
  >;
  readonly endCall: (scope: TypedScope<AgentState>) => Promise<void>;
}
