import {
  corroboratesNativeCall,
  readCallOccurrences,
  readNativeCallWitness,
} from '../core/agent/recordedCalls.js';
import { readOwnList } from '../lib/boundedJson.js';
import { readCallOccurrenceKey } from '../lib/callOccurrence.js';
import {
  CALL_EXPECTATION,
  type AccountEventEvidence,
  type CallExpectationEvidence,
} from '../recorders/observability/answerAccount/evidence.js';
import { own, rootToolPrefix } from './nativeToolStage.js';

const ITERATION_END = 'agentfootprint.agent.iteration_end';
const CONFIGURED = 'agentfootprint.agent.run_configured';
const MAX_FINDINGS_ROWS = 4_096;

/** Capture only the declared basis, optional rating and recorded call identity. */
export function projectCallExpectation(
  source: object,
): Readonly<Record<string, unknown>> | undefined {
  const basis = own(source, 'basis');
  const rating = Object.getOwnPropertyDescriptor(source, 'expect');
  const expect: unknown = rating?.value;
  const toolCallId = own(source, 'toolCallId');
  const toolName = own(source, 'toolName');
  const iteration = own(source, 'iteration');
  if (
    (basis !== 'direct' && basis !== 'exploratory') ||
    (rating !== undefined && !('value' in rating)) ||
    (expect !== undefined && expect !== 'low' && expect !== 'medium' && expect !== 'high') ||
    typeof toolCallId !== 'string' ||
    toolCallId.length === 0 ||
    typeof toolName !== 'string' ||
    toolName.length === 0 ||
    typeof iteration !== 'number' ||
    !Number.isSafeInteger(iteration) ||
    iteration < 1 ||
    typeof readCallOccurrenceKey(source) !== 'string'
  )
    return undefined;
  return {
    basis,
    ...(expect !== undefined && { expect }),
    toolCallId,
    toolName,
    iteration,
    callOccurrenceKey: own(source, 'callOccurrenceKey'),
  };
}

/** A recorded basis row makes a missing declaration a gap. Ledger content
 * cannot supply the fact or repair its original event pointer. */
function hasUnpairedBasis(snapshot: unknown, occurrence?: string): boolean {
  const ledger = own(own(snapshot, 'sharedState'), 'findingsLedger');
  if (ledger === undefined) return false;
  const rows = readOwnList(ledger, MAX_FINDINGS_ROWS);
  return (
    rows?.unread !== 0 ||
    rows.entries.some(
      (row) =>
        row === undefined ||
        (own(row, 'kind') === 'basis' &&
          (occurrence === undefined ||
            row === null ||
            typeof row !== 'object' ||
            readCallOccurrenceKey(row) !== occurrence)),
    )
  );
}

const unproven = { kind: 'unproven' } as const;

/** Admit one expectation, using the same occurrence reader as the whole account. */
export function proveCallExpectation(
  events: readonly AccountEventEvidence[],
  snapshot: unknown,
): CallExpectationEvidence {
  const declarations = events.filter(({ event }) => event.type === CALL_EXPECTATION);
  const [first] = declarations;
  if (first === undefined) return hasUnpairedBasis(snapshot) ? unproven : { kind: 'none' };

  const key = readCallOccurrenceKey(first.event.payload);
  const configured = events.find(({ event }) => event.type === CONFIGURED);
  const run = configured?.event.meta.runId;
  if (typeof key !== 'string' || typeof run !== 'string' || hasUnpairedBasis(snapshot, key))
    return unproven;
  const scoped = events
    .filter(({ event }) => event.meta.runId === run)
    .map(({ event, index }) => ({ ...event, index }));
  const call = readCallOccurrences(scoped, []).find((row) => row.occurrenceKey === key);
  if (call?.start === undefined || call.end === undefined) return unproven;
  const start = { index: call.start.index, event: call.start };
  const end = { index: call.end.index, event: call.end };
  const stage = call.runtimeStageId;
  if (typeof stage !== 'string' || stage.length === 0 || end.event.meta.runtimeStageId !== stage)
    return unproven;
  const completions = events.filter(
    ({ event }) =>
      event.type === ITERATION_END &&
      event.meta.runId === run &&
      event.meta.runtimeStageId === stage,
  );
  const [completion] = completions;
  if (completions.length !== 1 || completion === undefined || completion.index <= end.index)
    return unproven;
  const witness = readNativeCallWitness(start.event.payload, completion.event.payload.iterIndex);
  if (
    witness === undefined ||
    !corroboratesNativeCall(witness, end.event.payload, 'terminal') ||
    rootToolPrefix(snapshot, start, [start, end, completion, ...declarations]) === undefined
  )
    return unproven;

  if (first.index >= start.index) return unproven;
  if (
    declarations.some(
      ({ event }) =>
        event.meta.runId !== run ||
        event.meta.runtimeStageId !== stage ||
        !corroboratesNativeCall(witness, event.payload, 'declaration') ||
        event.payload.basis !== first.event.payload.basis ||
        event.payload.expect !== first.event.payload.expect,
    )
  )
    return unproven;
  return { kind: 'linked', index: first.index };
}
