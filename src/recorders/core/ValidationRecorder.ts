/**
 * ValidationRecorder — forwards `agentfootprint.validation.*` emits to the
 * dispatcher.
 *
 * Pattern: Factory over EmitBridge.
 * Role:    Bridges tool-args validation events (#9) emitted by the
 *          toolCalls stage when LLM-produced args fail the tool's declared
 *          `inputSchema` — so consumers observe rejected/warned calls via
 *          `agent.on('agentfootprint.validation.args_invalid', ...)`.
 * Emits:   agentfootprint.validation.args_invalid
 */

import { EmitBridge, type EmitBridgeOptions } from './EmitBridge.js';

export type ValidationRecorderOptions = Omit<EmitBridgeOptions, 'id' | 'prefix'> & {
  readonly id?: string;
};

export function validationRecorder(options: ValidationRecorderOptions): EmitBridge {
  return new EmitBridge({
    id: options.id ?? 'agentfootprint.validation-recorder',
    prefix: 'agentfootprint.validation.',
    dispatcher: options.dispatcher,
    getRunContext: options.getRunContext,
  });
}
