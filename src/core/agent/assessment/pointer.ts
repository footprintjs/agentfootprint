import type { TurnResult } from './turnResults.js';
import type { AssessmentPointer } from './types.js';

/** A leaf of a committed key, as an RFC 6901 pointer. */
export const statePointer = (
  key: string,
  ...path: readonly (string | number)[]
): AssessmentPointer => ({
  kind: 'state',
  key,
  path: path.map((p) => `/${String(p).replace(/~/g, '~0').replace(/\//g, '~1')}`).join(''),
});

export const historyPointer = (result: TurnResult): AssessmentPointer => ({
  kind: 'history',
  index: result.index,
  path: result.toolCallId !== undefined ? '/toolCallId' : '/role',
  ...(result.toolCallId !== undefined && { toolCallId: result.toolCallId }),
});

/** The first array slot a state witness names, when it has a canonical index. */
export function witnessRowIndex(path: string): number | undefined {
  const first = /^\/(0|[1-9]\d*)(?:\/|$)/.exec(path)?.[1];
  const index = Number(first);
  return Number.isSafeInteger(index) ? index : undefined;
}
