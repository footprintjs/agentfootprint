import { type RecordedTurn, recordedTurn } from './source.js';
import type { TurnEvidenceSource } from './types.js';

export const MAX_COMPLETED_TURN_EVENTS = 8_192;

type CompletedTurnAdmission =
  | { readonly status: 'ready'; readonly turn: RecordedTurn }
  | { readonly status: 'turn-unavailable' | 'coverage-work-limit' };

/** Match one already host-selected leg within the input budget, before any event scan. */
export function admitCompletedTurn(
  source: TurnEvidenceSource,
  runId: string,
  resumed?: true,
): CompletedTurnAdmission {
  const { events } = source;
  if (!Array.isArray(events)) return { status: 'turn-unavailable' };
  if (events.length > MAX_COMPLETED_TURN_EVENTS) return { status: 'coverage-work-limit' };
  const turn = recordedTurn({ events, snapshot: source.snapshot }, runId);
  if (turn?.snapshot === undefined) return { status: 'turn-unavailable' };
  return { status: 'ready', turn: resumed ? { ...turn, resumed } : turn };
}
