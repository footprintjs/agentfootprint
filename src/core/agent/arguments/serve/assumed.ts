/** Lens: the unchanged Assumed block and its one record fold. */
import { ASSUMED_BLOCK_HEADING } from '../../../../semantics/coverage/answer.js';
import { argumentRewritesOf, type ArgumentRewrite } from '../../middleware/rewrites.js';
import { HIDDEN_VALUE, type ArgumentRow } from '../rows.js';

// ─── The "Assumed" block (under `.limitsTravelWithTheAnswer()`) ───────────

/**
 * The block's opening line. Stable — tests and readers match on it. Owned by
 * the appended section's one composer (`semantics/coverage/answer.ts`), beside the
 * limits block's heading, so a reader of an answer's text finds every block
 * the framework appends through one module; re-exported here, where the block
 * is composed.
 */
export { ASSUMED_BLOCK_HEADING };

/** One assumed value, as the answer's block names it. */
export interface AssumedLine {
  readonly toolName: string;
  readonly argument: string;
  /** The row's value — the tool's own view; `'REDACTED'` when it hides it. */
  readonly value: string;
  readonly hidden: boolean;
}

/**
 * The "Assumed" block: one line per distinct (tool, argument, value) of this
 * turn's `default` rows, in the order the rows were filed. Composed by the
 * framework from the rows — the model does not write it, so it cannot drop
 * it. Empty string when there is nothing assumed.
 */
export function assumedBlock(lines: readonly AssumedLine[]): string {
  const seen = new Set<string>();
  const printed: string[] = [];
  for (const line of lines) {
    const key = JSON.stringify([line.toolName, line.argument, line.hidden ? '' : line.value]);
    if (seen.has(key)) continue;
    seen.add(key);
    printed.push(
      line.hidden
        ? `- ${line.argument} (its value is hidden by the tool's view) (${line.toolName})`
        : `- ${line.argument} = ${JSON.stringify(line.value)} (${line.toolName})`,
    );
  }
  return printed.length === 0 ? '' : `${ASSUMED_BLOCK_HEADING}\n${printed.join('\n')}`;
}

/**
 * The "Assumed" block for THIS turn, read off the record: every `default`
 * argument row of `turn`, in the order it was filed, less each row a
 * before-tool rewrite superseded (its call ran with the rewrite's value, not
 * the one the row names). `readDecisions` hands over `middlewareDecisions`; it
 * is asked only when a row exists (a run with nothing assumed never reads the
 * key), and is absent on an agent with no before-tool chain, whose record can
 * hold no tool rewrite. `''` when nothing is assumed. The final branch's armed
 * variant (`stages/prepareFinal.ts` · `prepareFinalWithLimitsAndAssumedStage`)
 * calls it through `import()`.
 *
 * @example
 * ```ts
 * assumedBlockOf(state.findingsLedger ?? [], state.turnNumber, undefined);
 * // "Assumed (a tool's rule, not your words):\n- window = \"2h\" (search_logs)"
 * ```
 */
export function assumedBlockOf(
  ledger: readonly { readonly kind: string }[],
  turn: number,
  readDecisions: (() => readonly unknown[]) | undefined,
): string {
  return assumedBlock(assumedLinesFor(ledger, turn, readDecisions));
}

// FOLD · the one reading of "what was assumed this turn"
// consumers read this and never re-derive it: the prose "Assumed" block (`assumedBlockOf`, above),
// a TYPED answer's limits as data (`stages/answerCoverage.ts` · `withAnswerCoverage` — the
// `assumed` list on `answerCoverage`) and the answer layer's standing line
// (`assessment/stage.ts` · `assessAnswerStage`). Same rows, same view, same order — so the block,
// the data and the line cannot disagree about which values were assumed.
/**
 * This turn's assumed values, as the "Assumed" block's lines: every `default`
 * argument row of `turn`, in the order it was filed, less each row a
 * before-tool rewrite superseded (its call ran with the rewrite's value, not
 * the one the row names). `readDecisions` hands over `middlewareDecisions`; it
 * is asked only when a row exists, and is absent on an agent with no
 * before-tool chain, whose record can hold no tool rewrite. `[]` when nothing
 * is assumed. The block prints each distinct (tool, argument, value) once.
 *
 * @example
 * ```ts
 * assumedLinesFor(state.findingsLedger ?? [], state.turnNumber, undefined);
 * // [{ toolName: 'search_logs', argument: 'window', value: '2h', hidden: false }]
 * ```
 */
export function assumedLinesFor(
  ledger: readonly { readonly kind: string }[],
  turn: number,
  readDecisions: (() => readonly unknown[]) | undefined,
): AssumedLine[] {
  const rows = defaultRowsOf(ledger, turn);
  const rewrites =
    readDecisions !== undefined && rows.length > 0
      ? argumentRewritesOf(readDecisions())
      : undefined;
  return assumedLinesOf(rows, rewrites);
}

const isArgumentRow = (row: { readonly kind: string }): row is ArgumentRow =>
  row.kind === 'argument';

/** This turn's `default` argument rows, in the order they were filed. */
function defaultRowsOf(ledger: readonly { readonly kind: string }[], turn: number): ArgumentRow[] {
  const rows: ArgumentRow[] = [];
  for (const row of ledger) {
    if (isArgumentRow(row) && row.turn === turn && row.source === 'default') rows.push(row);
  }
  return rows;
}

/**
 * The rows as the "Assumed" block names them — every row a before-tool
 * rewrite superseded left out: its call ran with the rewrite's value, not
 * the one the row names (`middleware/rewrites.ts` · `argumentRewritesOf`).
 */
function assumedLinesOf(
  rows: readonly ArgumentRow[],
  rewrites: ReadonlyMap<string, ReadonlyMap<string, ArgumentRewrite>> | undefined,
): AssumedLine[] {
  const lines: AssumedLine[] = [];
  for (const row of rows) {
    if (rewrites?.get(row.toolCallId)?.has(row.argument) === true) continue;
    const value = row.value ?? '';
    lines.push({
      toolName: row.toolName,
      argument: row.argument,
      value,
      hidden: value === HIDDEN_VALUE,
    });
  }
  return lines;
}
