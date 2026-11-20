import type { PeriodRow } from './period.js';

/** Every verdict a period row may carry, in the order the fold reports them. */
export const PERIOD_ROW_VERDICTS: readonly PeriodRow['verdict'][] = Object.freeze([
  'covered',
  'partly-held',
  'not-held',
  'unknown',
  'undeclared',
]);
