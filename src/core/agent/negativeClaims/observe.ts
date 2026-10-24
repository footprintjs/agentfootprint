/** The standalone prose door: observe the terminal model answer without owning
 * its delivery. Native dispatch records are evidence; answer strings never are. */
import type { TypedScope } from 'footprintjs';
import { applyOutputSchema } from '../../../answer-validation/outputSchema.js';
import type { ResolvedNegativeClaimPhrases } from '../../../integrity/negative-claim/phrases.js';
import type { AgentState } from '../types.js';
import type { RouteBranch } from '../stages/route.js';
import { recordFindings } from '../findings/ledger.js';
import { negativeRecordOf } from './capture.js';
import { observeNegativeProse } from './prose.js';

/** After all terminal routing/transforms, before assessment and conversation
 * capture. No correction, schema parser invocation, answer rewrite or verdict. */
export function withNegativeProse(
  decide: (scope: TypedScope<AgentState>) => RouteBranch | Promise<RouteBranch>,
  options: {
    readonly runId: () => string;
    readonly hasOutstandingConsent: () => boolean;
    readonly structured: boolean;
    readonly phrases?: ResolvedNegativeClaimPhrases;
  },
): (scope: TypedScope<AgentState>) => Promise<RouteBranch> {
  return async (scope) => {
    const branch = await decide(scope);
    if (
      branch !== 'final' ||
      scope.messageDeniedReason !== undefined ||
      scope.unsupportedValues?.refused === true ||
      scope.answerValidationBlocked === true ||
      options.hasOutstandingConsent()
    )
      return branch;
    const raw = scope.llmLatestContent;
    let candidate: unknown = raw;
    // Decode only a bounded structured answer. Never invoke the app's parser
    // again: it may transform data or have effects. Invalid JSON stays text.
    if (options.structured && raw.length <= 1024 * 1024) {
      try {
        candidate = applyOutputSchema(raw, { parse: (value: unknown) => value });
      } catch {
        /* The schema's own path retains its verdict; observe the text. */
      }
    }
    const record = negativeRecordOf(scope, options.runId());
    const rows = observeNegativeProse(candidate, record, undefined, options.phrases);
    recordFindings(
      scope,
      rows.map((row) => ({ ...row, iteration: scope.iteration })),
      { turn: record.turn },
    );
    return branch;
  };
}
