/**
 * llm-ledger/report — the fold: what the last submit's checks say, as AgentFootprint's standing.
 *
 * Pattern: one pure fold over a `LedgerReader` (and, for a dry `ask`, over findings that were not
 *          appended). Its result holds real values (a note's text, missing tokens) and is never
 *          served as it is: `serve.ts` is the one funnel.
 * Role:    the report vocabulary (case table §10). Standing follows AgentFootprint's precedence
 *          without `known`: `ask`, then `not-sure`, then `consistent`, then `not-assessed`.
 * Emits:   N/A.
 *
 * A claim's verdict is the weakest of its checks' verdicts (`rules/port.ts` · `weakest`). A claim with no
 * check is NOT CHECKED, never a pass: a submit whose checks are missing reads `not-assessed` at best
 * (the batch mark makes it impossible in a log; the fold does not rely on that). A claim with no
 * visible token is never a pass: the value law runs in every session and gives it `unreachable`.
 *
 * The fold never trusts that the value law ran. A log written by hand, or checked by a build
 * without it, can hold passing records for a value no receipt holds, so: a subject with no
 * `traceable-values@1` record reads at most `open` (`check-unreachable`), and a submit with no
 * value-law record for its draft reads `not-assessed` at best.
 */
import { isIncomplete } from './entries.js';
import type { LedgerReader } from './reader.js';
import { weakest } from './rules/port.js';
import type { LedgerCheckCounts } from './rules/port.js';
import { VALUE_LAW } from './rules/traceableValues.js';
import type { LedgerCheckWhy, LedgerDisposition, LedgerNote, LedgerVerdict } from './types.js';

/** The report's standing, in AgentFootprint's words. */
export type LedgerStanding = 'ask' | 'not-sure' | 'consistent' | 'not-assessed';

/** Why a standing is not `consistent`. `report-withheld` and `delivery-differs` are new (§10.1). */
export type LedgerReason =
  | 'asked'
  | 'value-unsupported'
  | 'claim-unsettled'
  | 'check-unreachable'
  | 'report-withheld'
  | 'delivery-differs';

/** One check as the fold reads it: a stored `check` entry, or a dry run's finding. */
export interface LedgerCheckView {
  readonly subject: { readonly note: number } | { readonly draft: true };
  readonly rule: string;
  readonly disposition: LedgerDisposition;
  readonly verdict?: LedgerVerdict;
  readonly restsOn: readonly number[];
  readonly counts: LedgerCheckCounts;
  readonly missing?: readonly string[];
  readonly why?: LedgerCheckWhy;
}

/** One subject's line in the report. */
export interface LedgerSubjectReport {
  readonly verdict?: LedgerVerdict;
  readonly reason?: 'claim-unsettled' | 'check-unreachable';
  readonly checks: readonly LedgerCheckView[];
  /** Tokens no receipt holds, the first ones each check kept. */
  readonly missing: readonly string[];
  /** Whether what it rests on was observed, only reported, or nothing. */
  readonly restsOn: 'observed' | 'reported' | 'nothing';
}

/** A named claim (or ruled-out note) in the report. */
export interface LedgerClaimReport extends LedgerSubjectReport {
  readonly note: number;
  readonly kind: 'claim' | 'ruled-out';
  /** The agent's own words: served only through `serve.ts`. */
  readonly text: string;
}

/** The fold's result. Holds real values: serve it through `serve.ts` only. */
export interface LedgerReport {
  readonly standing: LedgerStanding;
  readonly reasons: readonly LedgerReason[];
  readonly submit: number | null;
  readonly draftDigest?: string;
  readonly preview: boolean;
  readonly claims: readonly LedgerClaimReport[];
  readonly draft?: LedgerSubjectReport;
  /** Kept apart, never summed. */
  readonly counts: {
    readonly verified: number;
    readonly consistentWithReported: number;
    readonly unsupported: number;
    readonly open: number;
    readonly notAssessed: number;
  };
  readonly receipts: {
    readonly observed: number;
    readonly reported: number;
    readonly incomplete: readonly number[];
  };
  readonly withdrawnAfterCheck: readonly {
    readonly note: number;
    readonly verdict?: LedgerVerdict;
  }[];
  /** Live claim and ruled-out notes the last submit did not name. */
  readonly notChecked: readonly number[];
  readonly openQuestions: readonly number[];
  readonly delivery: 'not-compared' | 'matches' | 'differs';
  readonly release: 'not-asked' | 'waiting' | 'released' | 'withheld' | 'no-person-channel';
  readonly full: boolean;
}

/** The two sentences every report carries. */
export const REPORT_SENTENCES: readonly string[] = Object.freeze([
  'Traceable to what was read; not a proof that it is true.',
  'Reads made outside this ledger are not visible to it.',
]);

/** Why an `open` check is open: nothing to compare (`claim-unsettled`), or the check could not run. */
function openReason(check: LedgerCheckView): 'claim-unsettled' | 'check-unreachable' {
  // The value law's `unreachable` with nothing missing: no value seen, all supplied, or one it cannot read.
  const unsettled =
    check.why === undefined &&
    check.rule.startsWith('traceable-values@') &&
    check.counts.missing === 0;
  return unsettled ? 'claim-unsettled' : 'check-unreachable';
}

/** Whether `checks` hold a record of the value law (whatever its disposition). */
const valueLawRan = (checks: readonly LedgerCheckView[]): boolean =>
  checks.some((c) => c.rule === VALUE_LAW);

/** One subject's line, from its checks: at most `open` without a value-law record. */
function subjectOf(reader: LedgerReader, checks: readonly LedgerCheckView[]): LedgerSubjectReport {
  const found = weakest(checks.map((c) => c.verdict));
  const lawless = !valueLawRan(checks);
  const verdict = lawless && found !== undefined ? weakest([found, 'open']) : found;
  const reason: LedgerSubjectReport['reason'] =
    verdict !== 'open'
      ? undefined
      : lawless || checks.some((c) => c.verdict === 'open' && openReason(c) === 'check-unreachable')
      ? 'check-unreachable'
      : 'claim-unsettled';
  const seqs = [...new Set(checks.flatMap((c) => c.restsOn))];
  const restsOn =
    seqs.length === 0
      ? 'nothing'
      : seqs.every((s) => reader.receipt(s)?.how === 'observed')
      ? 'observed'
      : 'reported';
  return {
    ...(verdict === undefined ? {} : { verdict }),
    ...(reason === undefined ? {} : { reason }),
    checks,
    missing: [...new Set(checks.flatMap((c) => c.missing ?? []))],
    restsOn,
  };
}

const isLive = (reader: LedgerReader, note: LedgerNote): boolean =>
  reader.withdrawalOf(note.seq) === undefined;

/**
 * The report of `reader`'s last submit. `preview` gives the findings of a dry run over `claims`
 * instead (nothing appended): the report then reads them, and says `preview: true`.
 */
export function foldReport(
  reader: LedgerReader,
  preview?: { readonly claims: readonly number[]; readonly checks: readonly LedgerCheckView[] },
): LedgerReport {
  const submit = reader.lastSubmit;
  const named = preview?.claims ?? submit?.claims ?? [];
  const checks: readonly LedgerCheckView[] =
    preview?.checks ?? (submit === undefined ? [] : reader.checksOf(submit.seq));
  const claims: LedgerClaimReport[] = [];
  const withdrawnAfterCheck: { note: number; verdict?: LedgerVerdict }[] = [];
  for (const seq of named) {
    const note = reader.note(seq);
    if (note === undefined || note.noteKind === 'question') continue;
    const own = checks.filter((c) => 'note' in c.subject && c.subject.note === seq);
    const line = subjectOf(reader, own);
    if (!isLive(reader, note)) {
      withdrawnAfterCheck.push({ note: seq, ...(line.verdict ? { verdict: line.verdict } : {}) });
      continue;
    }
    claims.push({ note: seq, kind: note.noteKind, text: note.text, ...line });
  }
  const draftChecks = checks.filter((c) => 'draft' in c.subject);
  const draft = draftChecks.length > 0 ? subjectOf(reader, draftChecks) : undefined;
  const subjects: LedgerSubjectReport[] = [...claims, ...(draft === undefined ? [] : [draft])];
  const count = (v: LedgerVerdict) => claims.filter((c) => c.verdict === v).length;

  const opened = reader.opened;
  const released = submit === undefined ? undefined : reader.releasedOf(submit.seq);
  const release: LedgerReport['release'] =
    preview !== undefined || submit === undefined || opened?.confirm !== true
      ? 'not-asked'
      : released === undefined
      ? 'waiting'
      : released.answer === 'release'
      ? 'released'
      : released.why === 'no-person-channel'
      ? 'no-person-channel'
      : 'withheld';
  const delivered = reader.lastDelivered;
  const delivery: LedgerReport['delivery'] =
    delivered === undefined || submit === undefined || delivered.seq < submit.seq
      ? 'not-compared'
      : delivered.matches && delivered.submit === submit.seq
      ? 'matches'
      : 'differs';

  const reasons = new Set<LedgerReason>();
  if (release === 'waiting') reasons.add('asked');
  if (subjects.some((s) => s.verdict === 'unsupported')) reasons.add('value-unsupported');
  for (const s of subjects) if (s.reason !== undefined) reasons.add(s.reason);
  if (release === 'withheld' || release === 'no-person-channel') reasons.add('report-withheld');
  if (delivery === 'differs') reasons.add('delivery-differs');

  // A dry `ask` has no draft; a submit does, and its draft never passes unchecked by the value law.
  const assessed =
    claims.length > 0 &&
    claims.every((c) => c.verdict !== undefined) &&
    (preview !== undefined || valueLawRan(draftChecks));
  const standing: LedgerStanding = reasons.has('asked')
    ? 'ask'
    : reasons.size > 0
    ? 'not-sure'
    : assessed &&
      subjects.every((s) => s.verdict === 'verified' || s.verdict === 'consistent-with-reported')
    ? 'consistent'
    : 'not-assessed';

  const liveNotes = reader.notes.filter((n) => isLive(reader, n));
  return {
    standing,
    reasons: [...reasons],
    submit: preview !== undefined || submit === undefined ? null : submit.seq,
    ...(preview === undefined && submit !== undefined ? { draftDigest: submit.draftDigest } : {}),
    preview: preview !== undefined,
    claims,
    ...(draft === undefined ? {} : { draft }),
    counts: {
      verified: count('verified'),
      consistentWithReported: count('consistent-with-reported'),
      unsupported: count('unsupported'),
      open: count('open'),
      notAssessed: claims.filter((c) => c.verdict === undefined).length,
    },
    receipts: {
      observed: reader.receipts.filter((r) => r.how === 'observed').length,
      reported: reader.receipts.filter((r) => r.how === 'reported').length,
      incomplete: reader.receipts.filter(isIncomplete).map((r) => r.seq),
    },
    withdrawnAfterCheck,
    notChecked: liveNotes
      .filter((n) => n.noteKind !== 'question' && !named.includes(n.seq))
      .map((n) => n.seq),
    openQuestions: liveNotes.filter((n) => n.noteKind === 'question').map((n) => n.seq),
    delivery,
    release,
    full: reader.full,
  };
}
