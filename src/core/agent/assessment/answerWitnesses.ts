import { isRecord } from './recordValues.js';

/** One answer-layer witness row of this turn, where it sits on the ledger. */
interface WitnessRead {
  readonly index: number;
  readonly kind: 'grounded' | 'steps-unfinished' | 'step-skipped';
  /** On a `grounded` row: how many values the gate looked up in the tools' results. */
  readonly lookedUp?: number;
}

/**
 * This turn's witness rows (honesty layer 4, `assessment/witness.ts`): the
 * ledger's `grounded`, `steps-unfinished` and `step-skipped` rows whose `turn` is the run's
 * `turnNumber` — the ledger crosses turns on a continued conversation, and an
 * earlier turn's verdict is about an answer this fold is not reading. A record
 * with no `turnNumber` reads every witness row (it may over-report; it never
 * hides). Filed only while the answer layer is armed, so an unarmed record
 * holds none and this reads nothing.
 */
export function witnessRows(state: Readonly<Record<string, unknown>>): readonly WitnessRead[] {
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  const turn = typeof state.turnNumber === 'number' ? state.turnNumber : undefined;
  const out: WitnessRead[] = [];
  ledger.forEach((row: unknown, index) => {
    if (!isRecord(row)) return;
    const { kind } = row;
    if (kind !== 'grounded' && kind !== 'steps-unfinished' && kind !== 'step-skipped') return;
    if (turn !== undefined && row.turn !== turn) return;
    if (kind === 'step-skipped' && (turn === undefined || row.policy !== 'advance')) return;
    out.push({
      index,
      kind,
      ...(typeof row.lookedUp === 'number' && { lookedUp: row.lookedUp }),
    });
  });
  return out;
}
