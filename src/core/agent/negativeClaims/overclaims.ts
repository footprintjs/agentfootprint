import { refusalIssues } from '../../../semantics/overclaim.js';
import {
  readCallOccurrenceKey,
  storedCallOccurrenceField,
  type CallOccurrenceKey,
} from '../../../lib/callOccurrence.js';
import type { NegativeRuntimeCall } from './capture.js';

/** Occurrence evidence kept with the application's validation report. */
export interface NegativeDeclarationOccurrence {
  readonly toolCallId: string;
  readonly iteration: number;
  readonly callOccurrenceKey?: CallOccurrenceKey;
}

export interface NegativeOverclaim extends Partial<NegativeDeclarationOccurrence> {
  readonly tool: string;
  readonly code: 'refusal-asserts-absence';
  readonly turn: number;
}

export function hasOverclaim(
  rows: readonly NegativeOverclaim[],
  tool: string,
  turn: number,
  occurrence?: NegativeDeclarationOccurrence,
): boolean {
  const key = occurrence === undefined ? undefined : readCallOccurrenceKey(occurrence);
  return rows.some((row) => {
    if (row.turn !== turn || row.tool !== tool) return false;
    if (occurrence === undefined) return true;
    const rowKey = readCallOccurrenceKey(row);
    if (key !== undefined || rowKey !== undefined) return typeof key === 'string' && rowKey === key;
    return row.toolCallId === occurrence.toolCallId && row.iteration === occurrence.iteration;
  });
}

/** Use only the call whose native return supplied the declaration. */
export function returnedDeclarationOf(
  calls: readonly NegativeRuntimeCall[],
  resultId: string | undefined,
  tool: string,
  turn: number,
): NegativeDeclarationOccurrence | undefined {
  if (resultId === undefined) return undefined;
  const call = calls.find((candidate) => candidate.resultId === resultId);
  if (
    call?.dispatched !== true ||
    call.keptOut === true ||
    call.toolName !== tool ||
    call.turn !== turn ||
    typeof call.toolCallId !== 'string' ||
    call.toolCallId === ''
  )
    return undefined;
  return {
    toolCallId: call.toolCallId,
    iteration: call.batch,
    ...storedCallOccurrenceField(call),
  };
}

export function refusalOverclaims(
  value: unknown,
  args?: Readonly<Record<string, unknown>>,
): boolean {
  const direct = refusalIssues(value, 'result');
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const contextual = Object.entries(args ?? {}).some(
    ([argument, sent]) =>
      refusalIssues({ text, argument, ...(typeof sent === 'string' && { value: sent }) }, 'result')
        .length > 0,
  );
  return direct.length > 0 || contextual;
}

export const DECLARATION_CHECK_PREFIX = 'agent:negative-claims:declaration:';

export function overclaimCheckOf(tool: string, index: number) {
  return {
    id: `${DECLARATION_CHECK_PREFIX}${index}`,
    path: '/',
    index,
    kind: 'unknown' as const,
    code: 'declaration-overclaimed',
    disposition: 'not-applicable' as const,
    tools: [tool],
    results: [],
  };
}
