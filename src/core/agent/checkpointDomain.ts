import type { FlowchartCheckpoint } from 'footprintjs';

import { ResumeCheckpointError } from './resumeError.js';

export function plainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

/** Read only an own data field; no accessor or inherited capture is consumed. */
export function ownField(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object')
    throw new ResumeCheckpointError('invalid-domain');
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (field === undefined) return undefined;
  if (!field.enumerable || !('value' in field)) throw new ResumeCheckpointError('invalid-domain');
  return field.value;
}

/**
 * Select the exact CODE-owned tool mount on the documented native pause path.
 * Root state is a separate view. Deeper tool-owned children are never searched.
 * This reads its own fields only; the native resume decoder still owns the protocol.
 * Reflection can execute Proxy traps; no isolation from caller-created Proxies is claimed.
 */
export function toolDomainStateOf(
  checkpoint: FlowchartCheckpoint,
  mountId: string,
): Record<string, unknown> | undefined {
  const path = ownField(checkpoint, 'subflowPath');
  if (path === undefined) return undefined;
  if (!Array.isArray(path) || Object.getPrototypeOf(path) !== Array.prototype) {
    throw new ResumeCheckpointError('invalid-domain');
  }
  const length = Object.getOwnPropertyDescriptor(path, 'length')!.value as number;
  let matches = 0;
  for (let index = 0; index < length; index += 1) {
    const id = ownField(path, String(index));
    if (typeof id !== 'string') throw new ResumeCheckpointError('invalid-domain');
    if (id === mountId) matches += 1;
  }
  if (matches === 0) return undefined;
  if (matches !== 1) throw new ResumeCheckpointError('invalid-domain');
  const states = ownField(checkpoint, 'subflowStates');
  if (!plainRecord(states)) throw new ResumeCheckpointError('invalid-domain');
  const state = ownField(states, mountId);
  if (!plainRecord(state)) throw new ResumeCheckpointError('invalid-domain');
  return state;
}
