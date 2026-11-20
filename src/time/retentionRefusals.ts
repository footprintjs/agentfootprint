/** A refusal proved by the requested window and the source's declared retention. */
interface RetentionRefusal {
  readonly index: number;
  readonly toolName: string;
}

/** Read pre-dispatch retention refusals whose facts do not already have a period row. */
export function retentionRefusalsOf(
  ledger: readonly unknown[],
  turn: number | undefined,
): readonly RetentionRefusal[] {
  const refusals = new Map<string, RetentionRefusal>();
  const recorded = new Set<string>();
  ledger.forEach((entry, index) => {
    if (entry === null || typeof entry !== 'object') return;
    const row = entry as Record<string, unknown>;
    if (turn !== undefined && row.turn !== turn) return;
    if (typeof row.toolName !== 'string' || typeof row.toolCallId !== 'string') return;
    if (typeof row.turn !== 'number' || typeof row.iteration !== 'number') return;
    const key = JSON.stringify([row.turn, row.iteration, row.toolCallId, row.toolName]);
    if (row.kind === 'period' && row.beyondRetention === true) recorded.add(key);
    if (row.kind === 'call-window' && row.how === 'refused' && row.refused === 'beyond-retention') {
      refusals.set(key, { index, toolName: row.toolName });
    }
  });
  return [...refusals].filter(([key]) => !recorded.has(key)).map(([, refusal]) => refusal);
}

/** The pre-dispatch refusal or the completed read proved the same declared limit. */
export function beyondRetentionLine(toolName: string): string {
  return `${toolName}: the time asked about is older than the oldest data the tool declares its source keeps`;
}
