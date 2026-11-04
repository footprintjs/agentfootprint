import type { FlowchartCheckpoint } from 'footprintjs';
export { toolDomainStateOf } from './checkpointDomain.js';

/**
 * Domain readers precede native resume. Admit only their plain state carrier
 * here; footprintjs remains the sole decoder of the native checkpoint protocol.
 */
export function resumeStateOf(checkpoint: FlowchartCheckpoint): Record<string, unknown> {
  const state = checkpoint?.sharedState;
  if (
    state === null ||
    typeof state !== 'object' ||
    Array.isArray(state) ||
    (Object.getPrototypeOf(state) !== Object.prototype && Object.getPrototypeOf(state) !== null)
  ) {
    throw new Error('Invalid checkpoint: sharedState must be a plain object.');
  }
  return state;
}

/**
 * The transport is a separate fact from the memory namespace. Clean14 writes
 * a string or explicit null on every entry; absent data cannot mean anonymous.
 */
export function resumeSessionOf(checkpoint: FlowchartCheckpoint): string | undefined {
  const state = resumeStateOf(checkpoint);
  const session = state.runSessionId;
  if (
    !Object.prototype.hasOwnProperty.call(state, 'runSessionId') ||
    (session !== null && (typeof session !== 'string' || session.length === 0))
  ) {
    throw new Error(
      'Invalid checkpoint: runSessionId must be a non-empty string or explicit null.',
    );
  }
  if (state.runIdentitySource === 'session') {
    const identity = state.runIdentity as { conversationId?: unknown } | undefined;
    if (typeof session !== 'string' || identity?.conversationId !== session)
      throw new Error('Invalid checkpoint: runSessionId disagrees with its session identity.');
  }
  return session === null ? undefined : (session as string);
}
