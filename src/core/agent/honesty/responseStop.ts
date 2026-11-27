import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';

/** Keep native enforcement's complete stop, and keep only cutoffs on the prose path. */
export function recordResponseStop(
  scope: TypedScope<AgentState>,
  providerStop: string | undefined,
  nativeOutput: boolean,
  nativeCandidate: boolean,
): void {
  const stop = nativeOutput || providerStop === 'max_tokens' ? providerStop : undefined;
  if (stop !== undefined || nativeCandidate || 'llmLatestStopReason' in scope) {
    scope.llmLatestStopReason = stop;
  }
  if (nativeCandidate) scope.llmLatestNativeOutput = nativeOutput;
}

/** Only map owned fields. An explicit undefined clears a former stop in the outer scope. */
export function responseStopFields(state: Readonly<Record<string, unknown>>) {
  return {
    ...(Object.hasOwn(state, 'llmLatestStopReason') && {
      llmLatestStopReason: state.llmLatestStopReason,
    }),
    ...(Object.hasOwn(state, 'llmLatestNativeOutput') && {
      llmLatestNativeOutput: state.llmLatestNativeOutput,
    }),
  };
}
