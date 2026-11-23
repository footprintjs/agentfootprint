import { fire, type Gathered } from '../gathered.js';
import { statePointer } from '../pointer.js';
import { isRecord, str } from '../recordValues.js';
import type { AssessmentPointer } from '../types.js';
import { witnessRows } from '../answerWitnesses.js';
import { answerCompletionReasons } from './completion/completion.js';

/**
 * Layer 4, the answer's own rows: the evidence gate's verdict (a flag —
 * `unsupportedValues` — or, while the answer layer is armed, its clean pass,
 * the `grounded` witness row), a cut-short turn, an answer given before its
 * declared steps finished (the `steps-unfinished` witness row), the app's
 * checks. A clean pass is a MEMBERSHIP pass — every value found somewhere in
 * the tools' results — so it files the check as having run and supports
 * nothing: "known" needs a tie check.
 */
export function readAnswerRows(state: Readonly<Record<string, unknown>>, g: Gathered): void {
  const witnesses = witnessRows(state);
  const unsupported = state.unsupportedValues;
  if (isRecord(unsupported)) {
    const at = statePointer('unsupportedValues', 'candidates');
    fire(g, unsupported.revised === true ? 'value-survived-revision' : 'value-unsupported', at);
    g.checked.push({ layer: 4, check: 'names-and-numbers', ran: 1, of: 1, witness: [at] });
  } else {
    // The gate's clean pass on this turn's answer — the LAST one, the verdict
    // on the answer that stands (an earlier draft's verdict never reaches a
    // row: a draft sent back for revision files `evidenceUnsupported`, not a
    // witness, and the Route decider files a `steps-unfinished` row only once
    // its answer has stood every later judge). A pass that looked NOTHING up
    // (the answer stated no name or number, or every one was exempt) did not
    // apply: it is absent from `checked`, never a check that "ran" on an
    // answer it could not read.
    const grounded = witnesses.filter((w) => w.kind === 'grounded').at(-1);
    if (grounded !== undefined && (grounded.lookedUp ?? 0) > 0) {
      g.checked.push({
        layer: 4,
        check: 'names-and-numbers',
        ran: 1,
        of: 1,
        witness: [statePointer('findingsLedger', grounded.index, 'kind')],
      });
    }
  }
  for (const { reason, witness } of answerCompletionReasons(state)) fire(g, reason, witness);
  for (const w of witnesses) {
    if (w.kind !== 'grounded') fire(g, w.kind, statePointer('findingsLedger', w.index, 'kind'));
  }
  readTimeDerived(state, g);
  readScriptsShown(state, g);
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  ledger.forEach((row: unknown, index) => {
    if (!isRecord(row) || (row.kind !== 'negative-claim' && row.kind !== 'negative-claim-note'))
      return;
    if (typeof state.turnNumber === 'number' && row.turn !== state.turnNumber) return;
    fire(g, 'negative-prose-unverified', statePointer('findingsLedger', index, 'kind'));
  });
  const report = state.answerValidation;
  if (!isRecord(report) || typeof report.status !== 'string') return;
  const at = statePointer('answerValidation', 'status');
  g.checked.push({ layer: 4, check: 'answer-checks', ran: 1, of: 1, witness: [at] });
  // By index over the list's own length — never its iterator or its own `entries`.
  const checks: readonly unknown[] = Array.isArray(report.checks) ? report.checks : [];
  for (let index = 0; index < checks.length; index++) {
    const check: unknown = Object.getOwnPropertyDescriptor(checks, String(index))?.value;
    if (!isRecord(check) || typeof check.id !== 'string') continue;
    if (!check.id.startsWith('agent:negative-claims:')) continue;
    if (check.disposition === 'checked-fail')
      fire(g, 'claim-exceeds-search', statePointer('answerValidation', 'checks', index));
    if (check.reason === 'declaration-overclaimed')
      fire(g, 'declaration-overclaimed', statePointer('answerValidation', 'checks', index));
  }
  if (report.status === 'failed') fire(g, 'answer-check-failed', at);
  if (report.status === 'unverified') fire(g, 'check-unreachable', at);
  // A failed report can also hold checks that could not reach a verdict — a
  // contradiction found beside unreachable rows, or beside a validator that
  // did not finish (`reason`): both are true, so both are said.
  else if (report.status === 'failed') {
    if (typeof report.unreachable === 'number' && report.unreachable > 0) {
      fire(g, 'check-unreachable', statePointer('answerValidation', 'unreachable'));
    } else if (typeof report.reason === 'string') {
      fire(g, 'check-unreachable', statePointer('answerValidation', 'reason'));
    }
  }
  const digest = str(report.candidateDigest);
  // The ONE tie check this version can read: a passed ENFORCE report that names its bytes.
  if (report.status === 'passed' && report.mode === 'enforce' && digest !== undefined) {
    g.support = { kind: 'answer-validation', reportDigest: digest };
  }
}

/**
 * The answer's time values the library itself spelled from a reading of this
 * turn (time design § 9.5, step T7): a `time-derived` row of this turn fires
 * `derived-from-reading` — folded like `argument-assumed`, "not sure" at most,
 * never "known". Filed only under `.time()` beside the evidence gate, so an
 * unarmed record holds none and this reads nothing. A record with no
 * `turnNumber` reads every such row (it may over-report; it never hides).
 */
function readTimeDerived(state: Readonly<Record<string, unknown>>, g: Gathered): void {
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  const turn = typeof state.turnNumber === 'number' ? state.turnNumber : undefined;
  ledger.forEach((row: unknown, index) => {
    if (!isRecord(row) || row.kind !== 'time-derived') return;
    if (turn !== undefined && row.turn !== turn) return;
    fire(g, 'derived-from-reading', statePointer('findingsLedger', index, 'values'));
  });
}

/**
 * The script match's verdicts on the blocks THIS turn's answer showed
 * (`.namesAndNumbersFromEvidence({ code: 'match' })`, the `script-shown`
 * witness rows): each block reached a verdict, so the `script-match` check ran
 * on every one; an `unmatched` block fires `script-unmatched` — "not sure",
 * its own reason (a script can miss while every number in the answer is in a
 * result). A MATCHED block fires nothing and supports nothing: it says which
 * call submitted the program, never that a value is right. Filed only under
 * the arm while the answer layer is armed, so an unarmed record reads nothing.
 * A record with no `turnNumber` reads every such row (it may over-report; it
 * never hides).
 */
function readScriptsShown(state: Readonly<Record<string, unknown>>, g: Gathered): void {
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  const turn = typeof state.turnNumber === 'number' ? state.turnNumber : undefined;
  const witness: AssessmentPointer[] = [];
  ledger.forEach((row: unknown, index) => {
    if (!isRecord(row) || row.kind !== 'script-shown') return;
    if (turn !== undefined && row.turn !== turn) return;
    const at = statePointer('findingsLedger', index, 'label');
    witness.push(at);
    if (row.label === 'unmatched') fire(g, 'script-unmatched', at);
  });
  if (witness.length === 0) return;
  g.checked.push({
    layer: 4,
    check: 'script-match',
    ran: witness.length,
    of: witness.length,
    witness,
  });
}
