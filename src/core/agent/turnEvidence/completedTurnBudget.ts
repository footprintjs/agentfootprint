import { jsonBytes } from '../../../lib/boundedJson.js';

const MAX_RESULT_BYTES = 8_000;
const truncated = 'result-truncated';
const gapOnly = Object.freeze({ gaps: Object.freeze([truncated]) });
const MIN_RESULT_BYTES = jsonBytes(gapOnly);

export interface TurnEvidenceResult<Fact> {
  readonly runId: string;
  readonly facts: readonly Fact[];
  readonly gaps: readonly string[];
}

/** Keep whole admitted facts and reserve space for the gap that names a partial result. */
export function boundTurnEvidence<Fact>(
  result: TurnEvidenceResult<Fact>,
  maxBytes = MAX_RESULT_BYTES,
): TurnEvidenceResult<Fact> | { readonly gaps: readonly string[] } {
  const limit = Number.isSafeInteger(maxBytes)
    ? Math.max(MIN_RESULT_BYTES, Math.min(maxBytes, MAX_RESULT_BYTES))
    : MAX_RESULT_BYTES;
  if (jsonBytes(result) <= limit) return result;

  const gaps = result.gaps.includes(truncated) ? result.gaps : [...result.gaps, truncated];
  const facts: Fact[] = [];
  const partial: TurnEvidenceResult<Fact> = { runId: result.runId, gaps, facts };
  let remaining = limit - jsonBytes(partial);
  if (remaining < 0) return gapOnly;

  for (const fact of result.facts) {
    // JSON serializes a non-value array slot as null.
    const nextBytes = (jsonBytes(fact) || 4) + (facts.length === 0 ? 0 : 1);
    if (nextBytes > remaining) continue;
    facts.push(fact);
    remaining -= nextBytes;
  }
  return partial;
}
