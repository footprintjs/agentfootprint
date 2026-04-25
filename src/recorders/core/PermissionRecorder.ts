/**
 * PermissionRecorder — forwards `agentfootprint.permission.*` emits
 * to the v2 dispatcher.
 *
 * Pattern: Factory over EmitBridge.
 * Role:    Bridges permission.check, permission.gate_opened, and
 *          permission.gate_closed emits into the typed dispatcher so
 *          consumer `.on('agentfootprint.permission.check', ...)`
 *          listeners fire.
 * Emits:   agentfootprint.permission.check / gate_opened / gate_closed
 */

import { EmitBridge, type EmitBridgeOptions } from './EmitBridge.js';

export type PermissionRecorderOptions = Omit<EmitBridgeOptions, 'id' | 'prefix'> & {
  readonly id?: string;
};

export function permissionRecorder(options: PermissionRecorderOptions): EmitBridge {
  return new EmitBridge({
    id: options.id ?? 'agentfootprint.permission-recorder',
    prefix: 'agentfootprint.permission.',
    dispatcher: options.dispatcher,
    getRunContext: options.getRunContext,
  });
}
