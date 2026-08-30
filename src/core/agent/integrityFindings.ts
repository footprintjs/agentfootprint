/**
 * integrityFindings — the ONE rail every Context Integrity finding is filed
 * on, whichever stage detected it.
 *
 * Pattern: a tiny impure helper over tracked scope; no state of its own.
 * Role:    identity dedup across passes AND across stages. One defect emits
 *          ONE `agentfootprint.integrity.context_error` per run, however many
 *          calls, iterations or seams re-detect it.
 *
 * WHY IT IS A MODULE AND NOT A LOCAL FUNCTION. It lived inside `callLLM` while
 * every seam that filed findings lived there too, with its own header saying
 * "a second copy of this loop would eventually disagree with the first about
 * what 'already filed' means". 9.77.0 put a check at a second STAGE — the
 * write seam runs at the tool-dispatch boundary, where a result exists — and
 * a second copy is exactly what that would have meant. The rail moved instead.
 *
 * The seen-list is `scope.integrityFindingIds`, falling back to
 * `priorIntegrityFindingIds` (a resumed run's carried list) — freshest copy
 * first, since a stage may have extended the list earlier in the same pass.
 * The identity is computed with the EPOCH STRIPPED, so the same defect on a
 * later iteration is the same defect.
 */

import type { TypedScope } from 'footprintjs';
import { typedEmit } from '../../recorders/core/typedEmit.js';
import { contextErrorIdentity, type ContextError } from '../../integrity/finding/types.js';
import type { AgentState } from './types.js';

/** File findings on the shared seen-list rail, one event per new identity. */
export function fileIntegrityFindings(
  scope: TypedScope<AgentState>,
  findings: readonly ContextError[],
  iteration: number,
): void {
  if (findings.length === 0) return;
  const seenIds =
    (scope.$getValue('integrityFindingIds') as readonly string[] | undefined) ??
    (scope.$getValue('priorIntegrityFindingIds') as readonly string[] | undefined) ??
    [];
  const newIds: string[] = [...seenIds];
  for (const f of findings) {
    const id = contextErrorIdentity({ ...f, epoch: undefined });
    if (newIds.includes(id)) continue;
    newIds.push(id);
    typedEmit(scope, 'agentfootprint.integrity.context_error', { ...f, iteration });
  }
  if (newIds.length > seenIds.length) scope.$setValue('integrityFindingIds', newIds);
}
