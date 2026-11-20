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
