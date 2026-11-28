/**
 * llm-ledger/reader — one loaded log, read by seq and by kind.
 *
 * Pattern: a read-only index over one `LedgerStore.load` (one per attempt of a call). Stages hold
 *          it in their closure; it never enters a run's scope, so no entry's content reaches a run
 *          record.
 * Role:    the one place that answers "what does the log say" for the facts, the rules and the
 *          fold. It never writes and never loads.
 * Emits:   N/A.
 */
import {
  COVERAGE_RULE_KEY,
  entryFault,
  gapNoteAllowed,
  mixesTimeWindowVersions,
} from './entries.js';
import { LEDGER_LIMITS as L } from './limits.js';
import { LedgerStoreError } from './store.js';
import type { LedgerLog } from './store.js';
import type {
  LedgerCheck,
  LedgerDelivered,
  LedgerEntry,
  LedgerNote,
  LedgerOpened,
  LedgerReceipt,
  LedgerReleased,
  LedgerSubmit,
  LedgerSupplied,
  LedgerWithdrawal,
} from './types.js';

/** What one log says, indexed. */
export interface LedgerReader {
  /** The last entry's seq: 0 for a session that does not exist. */
  readonly seq: number;
  /** The session's `opened` entry, when its first entry is one. */
  readonly opened: LedgerOpened | undefined;
  /** At the entry cap: every append is refused (`ledger-full`). */
  readonly full: boolean;
  entry(seq: number): LedgerEntry | undefined;
  receipt(seq: number): LedgerReceipt | undefined;
  note(seq: number): LedgerNote | undefined;
  /** The withdrawal of `note`, when there is one. */
  withdrawalOf(note: number): LedgerWithdrawal | undefined;
  readonly entries: readonly LedgerEntry[];
  noteAdmissionFault(note: LedgerNote): 'noteKind' | 'claimStanding' | undefined;
  readonly receipts: readonly LedgerReceipt[];
  readonly supplied: readonly LedgerSupplied[];
  readonly notes: readonly LedgerNote[];
  /** The last `submit`, when there is one. */
  readonly lastSubmit: LedgerSubmit | undefined;
  /** The `check` entries of `submit`, in log order. */
  checksOf(submit: number): readonly LedgerCheck[];
  /** The `released` entry of `submit`, when there is one. */
  releasedOf(submit: number): LedgerReleased | undefined;
  /** The last `delivered` entry, when there is one. */
  readonly lastDelivered: LedgerDelivered | undefined;
}

/** The reader of `log`. */
export function readerOf(log: LedgerLog): LedgerReader {
  const entries = log.entries;
  const byKind = <K extends LedgerEntry['kind']>(kind: K) =>
    entries.filter((e): e is Extract<LedgerEntry, { kind: K }> => e.kind === kind);
  const receipts = byKind('receipt');
  const withdrawals = new Map(byKind('withdrawal').map((w) => [w.note, w]));
  const checks = new Map<number, LedgerCheck[]>();
  for (const c of byKind('check')) checks.set(c.submit, [...(checks.get(c.submit) ?? []), c]);
  const released = new Map(byKind('released').map((r) => [r.submit, r]));
  const submits = byKind('submit');
  const delivered = byKind('delivered');
  const first = entries[0];
  const opened = first?.kind === 'opened' ? first : undefined;
  if (opened !== undefined && mixesTimeWindowVersions(opened.rules))
    throw new LedgerStoreError('malformed', 'rules');
  for (const delivery of delivered) {
    if (delivery.coverageOmissions === undefined) continue;
    const submit = delivery.submit === null ? undefined : entries[delivery.submit - 1];
    if (
      opened?.coverageOmissions !== true ||
      entryFault(delivery) !== undefined ||
      submit?.kind !== 'submit' ||
      submit.draftDigest !== delivery.digest
    )
      throw new LedgerStoreError('malformed', 'coverageOmissions');
  }
  const admitsClaimStanding = opened?.rules.includes(COVERAGE_RULE_KEY) === true;
  function noteAdmissionFault(note: LedgerNote): 'noteKind' | 'claimStanding' | undefined {
    if (!gapNoteAllowed(opened, note)) return 'noteKind';
    if (note.claimStanding !== undefined && !admitsClaimStanding) return 'claimStanding';
    return undefined;
  }
  const notes = byKind('note');
  for (const note of notes) {
    const fault = noteAdmissionFault(note);
    if (fault !== undefined) throw new LedgerStoreError('malformed', fault);
  }
  const entry = (seq: number): LedgerEntry | undefined =>
    Number.isSafeInteger(seq) && seq >= 1 ? entries[seq - 1] : undefined;
  const as =
    <K extends LedgerEntry['kind']>(kind: K) =>
    (seq: number): Extract<LedgerEntry, { kind: K }> | undefined => {
      const e = entry(seq);
      return e?.kind === kind ? (e as Extract<LedgerEntry, { kind: K }>) : undefined;
    };
  return Object.freeze({
    seq: log.seq,
    opened,
    noteAdmissionFault,
    entries,
    full: log.seq >= L.maxEntries,
    entry,
    receipt: as('receipt'),
    note: as('note'),
    withdrawalOf: (note: number) => withdrawals.get(note),
    receipts,
    supplied: byKind('supplied'),
    notes,
    lastSubmit: submits[submits.length - 1],
    checksOf: (submit: number) => checks.get(submit) ?? [],
    releasedOf: (submit: number) => released.get(submit),
    lastDelivered: delivered[delivered.length - 1],
  });
}
