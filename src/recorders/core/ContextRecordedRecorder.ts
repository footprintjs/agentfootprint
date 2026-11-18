import { EmitBridge, type EmitBridgeOptions } from './EmitBridge.js';

/** The opt-in call frame is captured inline, independently of public queues. */
export function contextRecordedRecorder(
  options: Pick<EmitBridgeOptions, 'dispatcher' | 'getRunContext'>,
): EmitBridge {
  return new EmitBridge({
    ...options,
    id: 'agentfootprint.context-recorded-recorder',
    prefix: 'agentfootprint.context.recorded',
  });
}
