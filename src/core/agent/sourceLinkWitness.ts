import type { SourceLinkRow } from 'foottrace/cause';
import type { TypedScope } from 'footprintjs';
import { canRecordSourceLinkPath } from '../../redaction/runRedaction.js';
import type { AgentState } from './types.js';
import type { SourceLinkConsumer } from './types/state/records.js';

const MAX_WITNESSES = 256;

/** A captured position is tied to the caller-owned occurrence from its served history. */
export function sourceLinkInputFor(
  consumer: SourceLinkConsumer,
  occurrence: string,
): { key: 'history'; element: number } | undefined {
  const found = consumer.historyPositions.find((position) => position.occurrence === occurrence);
  return found === undefined ? undefined : { key: 'history', element: found.element };
}

/** Commit only the rows supplied by the stage that performed the check. */
export function appendSourceLinkWitnesses(
  scope: TypedScope<AgentState>,
  rows: readonly SourceLinkRow[],
): void {
  if (rows.length === 0 || !canRecordSourceLinkPath(scope, ['sourceLinkRows'])) return;
  const consumer = scope.sourceLinkConsumer?.consumer;
  const selected = rows.filter((row) => row.consumer === consumer);
  if (selected.length === 0) return;
  const retained = scope.sourceLinkRows ?? [];
  const room = Math.max(0, MAX_WITNESSES - retained.length);
  if (room > 0) scope.sourceLinkRows = [...retained, ...selected.slice(0, room)];
  if (selected.length > room && scope.sourceLinkRowsBounded !== true)
    scope.sourceLinkRowsBounded = true;
}
