/**
 * A call-bound facade over typedEmit. Permission and credential producers
 * supply their own facts; this owner stamps the invocation those facts
 * belong to. No policy, buffering, joins or scope reads.
 */
import type { AgentfootprintEventMap } from '../../events/registry.js';
import type { ToolCallEventIdentity } from '../../events/types.js';
import { typedEmit, type EmitableScope } from '../../recorders/core/typedEmit.js';

type ToolSecurityEvent =
  | 'agentfootprint.permission.check'
  | 'agentfootprint.permission.halt'
  | 'agentfootprint.credential.requested'
  | 'agentfootprint.credential.acquired'
  | 'agentfootprint.credential.authorization_required'
  | 'agentfootprint.credential.failed';

/** Internal emitter: callers cannot supply or forget the captured identity. */
export type ToolSecurityEmitter = <K extends ToolSecurityEvent>(
  type: K,
  payload: Omit<AgentfootprintEventMap[K]['payload'], keyof ToolCallEventIdentity>,
) => void;

/**
 * Bind at dispatch, including resumed and nested dispatch. Copy the two
 * primitives now: a provider may finish later, after another call started.
 * Never read "current call" from mutable state at delivery time.
 */
export function bindToolSecurityEvents(
  scope: EmitableScope,
  call: ToolCallEventIdentity,
): ToolSecurityEmitter {
  const { toolCallId, iteration } = call;
  return (type, payload): void => {
    // The mapped payload omits exactly the two keys restored here. TS cannot
    // prove that generic Omit + reconstruction equals the indexed payload.
    typedEmit(scope, type, {
      ...payload,
      toolCallId,
      iteration,
    } as AgentfootprintEventMap[typeof type]['payload']);
  };
}
