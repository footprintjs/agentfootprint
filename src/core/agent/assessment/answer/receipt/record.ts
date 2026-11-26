import { readOwnList } from '../../../../../lib/boundedJson.js';
import { readCallOccurrenceKey } from '../../../../../lib/callOccurrence.js';
import { fire, type Gathered } from '../../gathered.js';
import { statePointer } from '../../pointer.js';
import type { RetainedReasonState } from '../../reasonDetails.js';
import type { AssessmentPointer } from '../../types.js';
import { MAX_EXECUTION_CLAIM_FINDINGS } from './check/bounds.js';

const key = 'answerExecutionClaims';

export function isExecutionClaimWitness(pointer: AssessmentPointer): boolean {
  return (
    pointer.kind === 'state' &&
    pointer.key === key &&
    /^\/findings\/(0|[1-9]\d*)\/outcome$/u.test(pointer.path)
  );
}

function dataAt(value: unknown, property: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, property);
  return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

/** The same retained verdict supplies live warnings, events and saved reasons. */
export function readExecutionClaimRows(
  state: Readonly<Record<string, unknown>>,
  gathered: Gathered,
  retain: RetainedReasonState,
): void {
  let findings;
  try {
    // An absent or masked optional report cannot reset standing from other checks.
    const recorded = dataAt(state, key);
    if (recorded === undefined) return;
    const report = retain(key, recorded);
    if (dataAt(report, 'complete') !== true) return;
    const list = readOwnList(dataAt(report, 'findings'), MAX_EXECUTION_CLAIM_FINDINGS);
    if (list === undefined || list.unread !== 0) return;
    findings = list.entries.flatMap((row, index) => {
      if (row === null || typeof row !== 'object') return [];
      const claim = dataAt(row, 'claim');
      const target = dataAt(row, 'target');
      const outcome = dataAt(row, 'outcome');
      if (
        (claim !== 'ran-code' && claim !== 'no-code') ||
        (outcome !== 'contradicted' && outcome !== 'unverified') ||
        (target !== 'current' &&
          target !== 'previous' &&
          !(target === 'unresolved' && outcome === 'unverified'))
      )
        return [];
      if (
        outcome === 'contradicted' &&
        claim === 'no-code' &&
        (dataAt(row, 'callOccurrenceKey') === undefined ||
          typeof readCallOccurrenceKey(row) !== 'string')
      )
        return [];
      return [{ index, outcome }];
    });
  } catch {
    // A malformed record cannot supply a public verdict.
    return;
  }
  for (const { index, outcome } of findings) {
    const witness = statePointer(key, 'findings', index, 'outcome');
    fire(gathered, outcome === 'contradicted' ? 'unsupported-claim' : 'check-unreachable', witness);
  }
}
