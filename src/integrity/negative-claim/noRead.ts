/** A no-read warning needs a negative clause, not an incidental status label.
 * These exact token forms preserve the observer's existing exclusions without
 * changing the frozen grammar or borrowing model text as an evidence anchor. */
import type { DetectedClaim } from './detect.js';

const INCIDENTAL = [['none'], ['no', 'action', 'is', 'needed'], ['tests', '0', 'failed']] as const;

/** Whether a detected clause may note that no native read is recorded.
 * Compare the detector's normalized tokens; extra words and other clauses
 * remain eligible. This never declares a claim grounded or an entity resolved. */
export function eligibleNoReadClaim(claim: DetectedClaim): boolean {
  return !INCIDENTAL.some(
    (words) =>
      words.length === claim.tokens.length &&
      words.every((word, index) => claim.tokens[index]?.text === word),
  );
}
