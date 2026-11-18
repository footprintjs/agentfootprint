import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { ResolvedEvidenceGate } from '../../../evidence/types.js';
import { type EvidenceCorpus, evidenceFromHistory } from '../../../evidence/evidenceIndex.js';
import type { InputsRouteArm, TimeLineage } from '../../route.js';
import { exemptForTurn } from '../../turnExempt.js';
import type { StandingRow, FindingsLedger } from '../../../findings/types.js';
import { foldLedger } from '../../../findings/ledger.js';
import { hasSetAsideStanding } from '../../../findings/contingent.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';

/**
 * What the dispatch moment of the contingent check needs for one batch
 * (9.110.0), or `undefined` when nothing can be filed: one of the two doors
 * is closed, the ledger is absent, or no result holds a set-aside standing.
 * The corpus and the exempt set are built once per batch — every call of the
 * batch was served the same history.
 */
export function towersFor(
  scope: TypedScope<AgentState>,
  findings: true | undefined,
  gate: ResolvedEvidenceGate | undefined,
  exemptArm?: InputsRouteArm,
  timeLineage?: TimeLineage,
):
  | {
      readonly gate: ResolvedEvidenceGate;
      readonly corpus: EvidenceCorpus;
      readonly exempt: ReadonlySet<string>;
      readonly standingOf: ReadonlyMap<string, StandingRow>;
    }
  | undefined {
  if (findings !== true || gate === undefined) return undefined;
  const rows = [...((scope.findingsLedger as FindingsLedger | undefined) ?? [])];
  const { standingOf } = foldLedger(rows);
  if (!hasSetAsideStanding(standingOf)) return undefined;
  const history = [...((scope.history as readonly LLMMessage[] | undefined) ?? [])];
  // The same corpus the answer moment builds: one gate, one fold.
  const corpus = evidenceFromHistory(history, gate);
  // The index hit its ceiling: a result past the cut carried nothing into
  // it, so a fact carrier there is invisible and a row read off the prefix
  // would be false. The gate downgrades itself under the same flag; the
  // dispatch moment files nothing (`findings/contingent.ts`, the header).
  if (corpus.truncated) return undefined;
  return {
    gate,
    corpus,
    // The answer moment's exempt set, from its one builder and the same arm
    // (`runtime/routing/exemptArm.ts`): a value the person gave the batch
    // ask, a declared default this turn assumed, or a time the person said is
    // exempt here too.
    exempt: exemptForTurn(scope, history, exemptArm, timeLineage?.(scope).said),
    standingOf,
  };
}
