/** Fold — the existing masked argument-row event projection. */
import { typedEmit, type EmitableScope } from '../../../recorders/core/typedEmit.js';
import { HIDDEN_VALUE, type ArgumentRow } from './rows.js';
import { callOccurrenceField } from '../../../lib/callOccurrence.js';

/**
 * The inputs layer's row event (`agentfootprint.findings.argument`) — names,
 * enums and counts only. Never the value, the quote or the proposal (they live
 * on the committed row, in the tool's own argument view), and no `valueChars`
 * when that view hides the argument: the length of a hidden value is itself a
 * leak.
 */
export function emitArgumentRow(scope: EmitableScope, row: ArgumentRow): void {
  const hidden = row.value === HIDDEN_VALUE;
  typedEmit(scope, 'agentfootprint.findings.argument', {
    toolCallId: row.toolCallId,
    ...callOccurrenceField(row.callOccurrenceKey),
    toolName: row.toolName,
    iteration: row.iteration,
    turn: row.turn,
    argument: row.argument,
    ...(row.rule !== undefined && { rule: row.rule }),
    ...(row.period === true && { period: true as const }),
    ...(row.source !== undefined && { source: row.source }),
    ...(row.asked !== undefined && { asked: row.asked }),
    ...(row.claimed !== undefined && { claimed: row.claimed }),
    ...(row.correction !== undefined && { correction: row.correction }),
    ...(row.withheld !== undefined && { withheld: row.withheld }),
    ...(row.matched !== undefined && { matched: row.matched }),
    ...(row.reading === true && { reading: true as const }),
    ...(row.earlier === true && { earlier: true as const }),
    ...(row.setAside !== undefined && { setAside: row.setAside }),
    ...(row.argumentsFrom !== undefined && { argumentsFrom: row.argumentsFrom }),
    ...(row.coincides !== undefined && { coincides: row.coincides }),
    ...(row.free === true && { free: true as const }),
    ...(row.failed !== undefined && { failed: row.failed }),
    ...(row.malformed !== undefined && { malformed: row.malformed }),
    ...(row.value !== undefined && !hidden && { valueChars: row.value.length }),
  });
}
