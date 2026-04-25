/**
 * CompositionRecorder — forwards `agentfootprint.composition.*` emits to v2 dispatcher.
 *
 * Pattern: Factory (GoF) returning an EmitBridge instance.
 * Role:    Convenience constructor for the composition-domain bridge recorder.
 *          Compositions (Sequence, Parallel, Conditional, Loop) typedEmit
 *          composition.enter/exit/fork_start/branch_complete/merge_end/
 *          route_decided/iteration_start/iteration_exit from their internal
 *          stages; this recorder observes via footprintjs's EmitRecorder
 *          channel and re-dispatches through v2 with typed payloads + meta.
 * Emits:   agentfootprint.composition.*
 */

import { EmitBridge, type EmitBridgeOptions } from './EmitBridge.js';

export type CompositionRecorderOptions = Omit<EmitBridgeOptions, 'id' | 'prefix'> & {
  readonly id?: string;
};

export function compositionRecorder(
  options: CompositionRecorderOptions,
): EmitBridge {
  return new EmitBridge({
    id: options.id ?? 'agentfootprint.composition-recorder',
    prefix: 'agentfootprint.composition.',
    dispatcher: options.dispatcher,
    getRunContext: options.getRunContext,
  });
}
