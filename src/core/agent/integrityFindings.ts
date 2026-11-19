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
 * write the ledger. While the answer layer is armed, new findings and
 * call-bound findings hold rows on `integrityFindingRows` beside
 * the seen-list, and the Route decider files them through the one writer
 * (`stages/routeIntegrity.ts`). Unarmed, the key is never read or written.
 */

import { typedEmit } from '../../recorders/core/typedEmit.js';
import {
  integrityFindingRowOf,
  type IntegrityCallWitness,
  type IntegrityFindingRow,
} from '../../integrity/finding/row.js';
import { contextErrorIdentity, type ContextError } from '../../integrity/finding/types.js';

/** The run's integrity holder as a seam has it: `answerLayer` says rows are wanted. */
export interface IntegrityRun {
  readonly current: unknown;
  readonly answerLayer?: true;
}

/**
 * What the rail needs of a scope: the seen-list keys and the emit channel.
 * Structural, so a stage inside a subflow with its own state type (the tools
 * slot's compose backstop) files on the same rail instead of keeping a copy.
 */
type RailScope = Parameters<typeof holdIntegrityRows>[0] & Parameters<typeof typedEmit>[0];

/** File findings on the shared seen-list rail, one event per new identity. */
export function fileIntegrityFindings(
  scope: RailScope,
  findings: readonly ContextError[],
  iteration: number,
  run?: IntegrityRun,
  callOf?: (finding: ContextError) => IntegrityCallWitness | undefined,
): void {
  if (findings.length === 0) return;
  const seenIds =
    (scope.$getValue('integrityFindingIds') as readonly string[] | undefined) ??
    (scope.$getValue('priorIntegrityFindingIds') as readonly string[] | undefined) ??
    [];
  const newIds: string[] = [...seenIds];
  const rows: IntegrityFindingRow[] = [];
  for (const finding of findings) {
    const id = contextErrorIdentity({ ...finding, epoch: undefined });
    const newFinding = !newIds.includes(id);
    if (run?.answerLayer === true) {
      const candidate = callOf?.(finding);
      const call = candidate?.toolCallId ? candidate : undefined;
      // Preserve call witnesses even when the host event already filed the same defect.
      if (call !== undefined || newFinding) {
        rows.push(integrityFindingRowOf(finding, iteration, call));
      }
    }
    if (newFinding) {
      newIds.push(id);
      typedEmit(scope, 'agentfootprint.integrity.context_error', { ...finding, iteration });
    }
  }
  if (newIds.length > seenIds.length) scope.$setValue('integrityFindingIds', newIds);
  holdIntegrityRows(scope, rows);
}

/** Hold call witnesses and whole-run findings for the answer layer. */
function holdIntegrityRows(
  scope: { $getValue(key: string): unknown; $setValue(key: string, value: unknown): void },
  rows: readonly IntegrityFindingRow[],
): void {
  if (rows.length === 0) return;
  const held =
    (scope.$getValue('integrityFindingRows') as readonly unknown[] | undefined) ??
    (scope.$getValue('priorIntegrityFindingRows') as readonly unknown[] | undefined) ??
    [];
  scope.$setValue('integrityFindingRows', [...held, ...rows]);
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
