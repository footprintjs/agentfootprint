import type { AttemptCategory } from 'footprintjs';
import { TOOL_BATCH_FRAME_PREFIX } from '../../../lib/saidByPerson.js';
import { isRecord } from './record.js';
import { toolRanOf } from '../../../semantics/toolRan.js';
import { recordedCallOutcome } from '../../../semantics/toolOutcome.js';

export type RecordedToolExecution =
  | 'not-entered'
  | 'threw'
  | 'returned'
  | 'returned-unserved'
  | 'entered-unknown-result'
  | 'unknown';

/** The history result's execution fact, independent of the completion outcome. */
export function recordedToolExecution(
  result: Readonly<Record<string, unknown>>,
): RecordedToolExecution {
  if (toolRanOf(result) === 'not-run' || result.toolResultOrigin === 'not-entered')
    return 'not-entered';
  const execution = result.toolResultExecution;
  if (
    execution === 'not-entered' ||
    execution === 'threw' ||
    execution === 'returned' ||
    execution === 'returned-unserved'
  )
    return execution;
  if (
    execution !== undefined ||
    result.toolResultOrigin !== undefined ||
    result.notDispatched !== undefined
  )
    return 'unknown';
  // Legacy messages predate the execution stamp. A producer status proves a
  // return only when the old writer kept that status from the entered tool.
  if (
    result.reportedStatus === 'denied' ||
    result.reportedStatus === 'partial' ||
    result.reportedStatus === 'pending'
  )
    return 'returned';
  const outcome = recordedCallOutcome(result);
  if (outcome === 'refused') return 'unknown';
  // The legacy failed outcome proves entry but cannot distinguish an
  // exception from a return replaced by a framework refusal.
  if (outcome === 'failed') return 'entered-unknown-result';
  return result.outcome === undefined && typeof result.content === 'string'
    ? 'returned'
    : 'unknown';
}

export function callEntered(execution: RecordedToolExecution | undefined): boolean {
  return (
    execution === 'threw' ||
    execution === 'returned' ||
    execution === 'returned-unserved' ||
    execution === 'entered-unknown-result'
  );
}

/** The recorded settlement, with the entry fact for older refusal writers. */
export function assessmentCallOutcome(message: Readonly<Record<string, unknown>>) {
  return (
    recordedCallOutcome(message) ??
    (message.notDispatched === undefined && recordedToolExecution(message) === 'not-entered'
      ? 'refused'
      : undefined)
  );
}

const failureCategories = {
  timeout: true,
  'rate-limited': true,
  server: true,
  network: true,
  auth: true,
  permanent: true,
  unknown: true,
} satisfies Record<AttemptCategory, true>;

/** Read only the engine's closed category vocabulary from a retained record. */
export function readToolFailureCategory(value: unknown): AttemptCategory | undefined {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(failureCategories, value)
    ? (value as AttemptCategory)
    : undefined;
}

/** A category belongs only to a failed tool throw whose delivery was retained. */
export function recordedToolFailureCategory(message: object): AttemptCategory | undefined {
  const category = readToolFailureCategory(
    Object.getOwnPropertyDescriptor(message, 'toolFailureCategory')?.value,
  );
  if (category === undefined) return undefined;
  const disposition = Object.getOwnPropertyDescriptor(message, 'toolResultDisposition');
  return Object.getOwnPropertyDescriptor(message, 'toolResultExecution')?.value === 'threw' &&
    Object.getOwnPropertyDescriptor(message, 'outcome')?.value === 'failed' &&
    (disposition === undefined || ('value' in disposition && disposition.value === undefined))
    ? category
    : undefined;
}

/** A protocol refusal has no valid tool-result correlation. Its frame is the witness. */
export function isRecordedBatchRefusal(message: unknown): boolean {
  return (
    isRecord(message) &&
    message.role === 'user' &&
    message.toolResultExecution === 'not-entered' &&
    typeof message.content === 'string' &&
    message.content.startsWith(TOOL_BATCH_FRAME_PREFIX)
  );
}
