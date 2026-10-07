/**
 * The fail-fast RECORD and the one error it becomes.
 *
 * The reliability loop (`core/agent/stages/reliabilityExecution.ts · failFast`)
 * ends a run by writing this record and breaking. Whoever owns the run's
 * outcome turns it into `ReliabilityFailFastError`: the agent's own run
 * boundary (`Agent · finalizeResult`), or a composition the agent runs inside
 * (`core-flow/childFailFast.ts`). Every chart boundary between the two carries
 * the record across — a record left behind a boundary is a run that ends
 * "successfully" with no answer.
 */
import type { AgentState } from '../core/agent/types.js';
import { ReliabilityFailFastError } from './types.js';

/** The keys of the record, listed once and checked against `AgentState`. */
export const RELIABILITY_FAIL_KEYS = [
  'reliabilityFailKind',
  'reliabilityFailPayload',
  'reliabilityFailReason',
  'reliabilityFailCauseMessage',
  'reliabilityFailCauseName',
] as const satisfies readonly (keyof AgentState)[];

/** The fail-fast record as a state holds it. */
export type ReliabilityFailRecord = Pick<AgentState, (typeof RELIABILITY_FAIL_KEYS)[number]>;

/**
 * The fail-fast record a state holds: its present keys, or nothing when no
 * fail-fast fired — so a boundary that spreads it crosses no new key otherwise.
 */
export function failFastRecordOf(
  state: Readonly<Record<string, unknown>>,
): ReliabilityFailRecord | undefined {
  if (state.reliabilityFailKind === undefined) return undefined;
  const record: Record<string, unknown> = {};
  for (const key of RELIABILITY_FAIL_KEYS) {
    if (state[key] !== undefined) record[key] = state[key];
  }
  return record as ReliabilityFailRecord;
}

/**
 * The error a fail-fast record becomes. The cause is rebuilt from the message
 * and name the record keeps — an `Error` does not survive the state's
 * `structuredClone`, so the record never held the original.
 */
export function failFastErrorOf(
  record: ReliabilityFailRecord,
  snapshot?: unknown,
): ReliabilityFailFastError {
  const kind = record.reliabilityFailKind ?? 'unknown';
  let cause: Error | undefined;
  if (record.reliabilityFailCauseMessage !== undefined) {
    cause = new Error(record.reliabilityFailCauseMessage);
    if (record.reliabilityFailCauseName !== undefined) cause.name = record.reliabilityFailCauseName;
  }
  return new ReliabilityFailFastError({
    kind,
    reason: record.reliabilityFailReason ?? kind,
    ...(cause !== undefined && { cause }),
    ...(record.reliabilityFailPayload !== undefined && { payload: record.reliabilityFailPayload }),
    ...(snapshot !== undefined && { snapshot }),
  });
}
