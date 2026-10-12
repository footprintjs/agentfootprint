/**
 * Shared exclusion comparison with Agent's existing recording keys.
 * This wrapper reports conflicts; callers retain their own findings and policy.
 */
import { conflictsOf as compareAssertions, type Assertion, type Conflict } from 'contextfootprint';
import { assertionKey } from './types.js';

export type { Conflict } from 'contextfootprint';

/** Find conflicting current readings, retaining original witnesses and order. */
export function conflictsOf(
  assertions: readonly Assertion[],
  multiValued: ReadonlySet<string> = new Set(),
): readonly Conflict[] {
  return compareAssertions(assertions, multiValued, assertionKey);
}
