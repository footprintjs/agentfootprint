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
 *
 * WHY A ROW IS HELD. The answer's standing reads committed ledger rows, never
 * events, and the compose, wire and choice seams run inside subflows that cannot
 * write the ledger. So while the answer layer is armed, each new finding also
 * holds one row on `integrityFindingRows`, which crosses every boundary beside
 * the seen-list, and the Route decider files them through the one writer
 * (`stages/routeIntegrity.ts`). Unarmed, the key is never read or written.
 */

import type { TypedScope } from 'footprintjs';
import { typedEmit } from '../../recorders/core/typedEmit.js';
import { integrityFindingRowOf } from '../../integrity/finding/row.js';
import { contextErrorIdentity, type ContextError } from '../../integrity/finding/types.js';
import type { AgentState } from './types.js';

/** The run's integrity holder as a seam has it: `answerLayer` says rows are wanted. */
export interface IntegrityRun {
  readonly current: unknown;
  readonly answerLayer?: true;
}

/** File findings on the shared seen-list rail, one event per new identity. */
export function fileIntegrityFindings(
  scope: TypedScope<AgentState>,
  findings: readonly ContextError[],
  iteration: number,
  run?: IntegrityRun,
): void {
  if (findings.length === 0) return;
  const seenIds =
    (scope.$getValue('integrityFindingIds') as readonly string[] | undefined) ??
    (scope.$getValue('priorIntegrityFindingIds') as readonly string[] | undefined) ??
    [];
  const newIds: string[] = [...seenIds];
  const filed: ContextError[] = [];
  for (const f of findings) {
    const id = contextErrorIdentity({ ...f, epoch: undefined });
    if (newIds.includes(id)) continue;
    newIds.push(id);
    filed.push(f);
    typedEmit(scope, 'agentfootprint.integrity.context_error', { ...f, iteration });
  }
  if (newIds.length > seenIds.length) scope.$setValue('integrityFindingIds', newIds);
  holdIntegrityRows(scope, filed, iteration, run);
}

/** Hold one row per finding just filed, while the answer layer is armed. */
export function holdIntegrityRows(
  scope: { $getValue(key: string): unknown; $setValue(key: string, value: unknown): void },
  filed: readonly ContextError[],
  iteration: number,
  run: IntegrityRun | undefined,
): void {
  if (run?.answerLayer !== true || filed.length === 0) return;
  const held =
    (scope.$getValue('integrityFindingRows') as readonly unknown[] | undefined) ??
    (scope.$getValue('priorIntegrityFindingRows') as readonly unknown[] | undefined) ??
    [];
  scope.$setValue('integrityFindingRows', [
    ...held,
    ...filed.map((f) => integrityFindingRowOf(f, iteration)),
  ]);
}

/** The rail's two keys OUT of a subflow, under their own names. Value-conditional. */
export function integrityRail(from: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return {
    ...(from.integrityFindingIds !== undefined && {
      integrityFindingIds: from.integrityFindingIds,
    }),
    ...(from.integrityFindingRows !== undefined && {
      integrityFindingRows: from.integrityFindingRows,
    }),
  };
}

/**
 * The rail's two keys INTO a subflow, under the aliases its stages read them by:
 * an input key is read-only inside a subflow, and a stage there writes the fresh
 * list under the base key. A subflow nested in another passes on what it holds.
 */
export function integrityRailInto(
  parent: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const ids = parent.integrityFindingIds ?? parent.priorIntegrityFindingIds;
  const rows = parent.integrityFindingRows ?? parent.priorIntegrityFindingRows;
  return {
    ...(ids !== undefined && { priorIntegrityFindingIds: ids }),
    ...(rows !== undefined && { priorIntegrityFindingRows: rows }),
  };
}
