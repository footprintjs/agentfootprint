import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../types.js';
import type { AgentfootprintEventMap } from '../../../../../../events/registry.js';

/** Explicit callback contract for existing observations operations. */
export interface ToolObservationsOperations {
  readonly emitToolStart: (
    scope: TypedScope<AgentState>,
    payload: AgentfootprintEventMap['agentfootprint.stream.tool_start']['payload'],
  ) => void;
  readonly emitToolEnd: (
    scope: TypedScope<AgentState>,
    toolName: string,
    payload: AgentfootprintEventMap['agentfootprint.stream.tool_end']['payload'],
    ran: boolean,
    declaredStatus?: string | undefined,
    negativeResultId?: string,
    refusalArgs?: Readonly<Record<string, unknown>>,
  ) => void;
}
