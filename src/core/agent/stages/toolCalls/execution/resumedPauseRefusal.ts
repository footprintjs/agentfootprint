import type { PausedGatePolicy } from '../../../types/state/pause.js';

/** Name the gate the call actually resumed through. */
export function resumedPauseRefusal(toolName: string, gate: PausedGatePolicy['gate']): string {
  const door =
    gate === 'checkIn'
      ? 'an approved check-in'
      : gate === 'ask'
      ? 'an approved ask'
      : 'granted credential consent';
  return `tool '${toolName}' requested a pause while resuming ${door}, which is not supported`;
}
