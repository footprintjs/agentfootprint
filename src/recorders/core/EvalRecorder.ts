/**
 * EvalRecorder — forwards `agentfootprint.eval.*` emits to the v2 dispatcher.
 *
 * Pattern: Factory over EmitBridge.
 * Role:    Bridges consumer-emitted `eval.score` + `eval.threshold_crossed`
 *          events to typed listeners. Evaluation is a consumer concern
 *          (LLM-based grading, heuristic checks, reference-output diffs),
 *          so the library only provides transport — not any built-in
 *          evaluators.
 * Emits:   agentfootprint.eval.score / eval.threshold_crossed
 */

import { EmitBridge, type EmitBridgeOptions } from './EmitBridge.js';

export type EvalRecorderOptions = Omit<EmitBridgeOptions, 'id' | 'prefix'> & {
  readonly id?: string;
};

export function evalRecorder(options: EvalRecorderOptions): EmitBridge {
  return new EmitBridge({
    id: options.id ?? 'agentfootprint.eval-recorder',
    prefix: 'agentfootprint.eval.',
    dispatcher: options.dispatcher,
    getRunContext: options.getRunContext,
  });
}
