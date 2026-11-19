import { refusalIssues } from '../../../semantics/overclaim.js';
import type { TurnCall } from '../../../integrity/negative-claim/types.js';

/** Occurrence evidence kept with the application's validation report. */
export interface NegativeDeclarationOccurrence {
  readonly toolCallId: string;
  readonly iteration: number;
}

export interface NegativeOverclaim {
  readonly tool: string;
  readonly code: 'refusal-asserts-absence';
  readonly turn: number;
  readonly toolCallId?: string;
  readonly iteration?: number;
}

export function hasOverclaim(
  rows: readonly NegativeOverclaim[],
  tool: string,
  turn: number,
  occurrence?: NegativeDeclarationOccurrence,
): boolean {
  return rows.some(
    (row) =>
      row.turn === turn &&
      row.tool === tool &&
      (occurrence === undefined ||
        (row.toolCallId === occurrence.toolCallId && row.iteration === occurrence.iteration)),
  );
}

/** Use only the call whose native return supplied the declaration. */
export function returnedDeclarationOf(
  calls: readonly TurnCall[],
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
  return { toolCallId: call.toolCallId, iteration: call.batch };
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
