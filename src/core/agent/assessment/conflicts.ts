import { fire, type Gathered } from './gathered.js';
import { statePointer } from './pointer.js';
import { isRecord } from './recordValues.js';
import { rowList } from './sources.js';
import type { AssessmentPointer } from './types.js';

type PlaceCall = (ref: unknown) => 'current' | 'earlier' | undefined;

/** A witness for a conflict whose readings could not all be placed. */
export function legacyConflictWitness(pointer: AssessmentPointer): boolean {
  return (
    pointer.kind === 'state' &&
    pointer.key === 'findingsLedger' &&
    /^\/\d+\/kind$/.test(pointer.path ?? '')
  );
}

/**
 * Layer 3, the model's readings: a conflict row of THIS turn
 * (`conflictOfThisTurn`). A row the one writer stamped with its `turn` (the
 * honesty layers' turn stamp, filed while a layer is armed) is this turn's
 * only when the stamp says so — a provider that reuses call ids across turns
 * no longer makes an earlier turn's conflict read as this one's.
 */
export function readConflicts(
  state: Readonly<Record<string, unknown>>,
  place: PlaceCall,
  g: Gathered,
  legacyConflictCheck: boolean,
): void {
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  const turn = typeof state.turnNumber === 'number' ? state.turnNumber : undefined;
  ledger.forEach((row: unknown, index) => {
    if (!isRecord(row) || row.kind !== 'conflict' || !conflictOfThisTurn(row, turn, place)) return;
    const witness = statePointer('findingsLedger', index, 'kind');
    if (fire(g, 'sources-conflict', witness)) return;
    if (!legacyConflictCheck) return;
    const refs = rowList(row.witnesses);
    if (
      refs === undefined ||
      refs.unread > 0 ||
      (refs.entries.length >= 2 && refs.entries.some((ref) => place(ref) === undefined))
    ) {
      fire(g, 'check-unreachable', witness);
    }
  });
}

/**
 * Whether a conflict row is this turn's — THE INCOMPLETE-RECORD POLICY. Each
 * reading (`witnesses`) is placed by the call it names, as the record shows
 * it: CURRENT (a call of this turn), EARLIER (a call `history` places before
 * this turn began — its result, or the request that asked for it) or
 * UNRESOLVED (no identifiable call: a hole, a getter's entry, a missing
 * result, or multiple results that could be the witness).
 *
 * - a row stamped with ANOTHER turn is never this turn's;
 * - a CURRENT reading places the row here, stamped or not;
 * - a row stamped with THIS turn stays this turn's unless EVERY reading is
 *   EARLIER — a contrary placement the record establishes. An unresolved
 *   reading establishes none: the stamp keeps its doubt, and the source
 *   counts the reading in `unnamed` (`sources.ts`). No readings at all, or a
 *   list the fold cannot read whole (not a plain array, or longer than it
 *   reads — `sources.ts` · `rowList`), establish none either;
 * - an UNSTAMPED row is never placed by a reading that is not current: an
 *   earlier turn's conflict whose ids are gone, or unresolved, stays out of
 *   this turn. Without a `turnNumber`, only a current reading can place the
 *   row because there is no turn number to compare a stamp with.
 */
function conflictOfThisTurn(
  row: Readonly<Record<string, unknown>>,
  turn: number | undefined,
  place: PlaceCall,
): boolean {
  const stamped = typeof row.turn === 'number' && turn !== undefined;
  if (stamped && row.turn !== turn) return false;
  const witnesses = rowList(row.witnesses);
  const placement = (witnesses?.entries ?? []).map((w) => place(w));
  if (placement.includes('current')) return true;
  if (!stamped) return false;
  const readWhole = witnesses !== undefined && witnesses.unread === 0;
  return !(readWhole && placement.length > 0 && placement.every((at) => at === 'earlier'));
}
