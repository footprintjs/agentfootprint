import { negativeProseRowIsWellFormed } from './agent/findings/negativeProse.js';
import { argumentRowIsWellFormed } from './agent/arguments/rows.js';
import { referenceRefusalRowIsWellFormed } from './agent/findings/refusal.js';
import { periodRowIsWellFormed } from '../semantics/coverage/period.js';
import { witnessRowIsWellFormed } from './agent/assessment/witness.js';
import { scriptRowIsWellFormed } from './agent/scripts/rows.js';
import { isTimeRowKind, timeRowIsWellFormed } from '../time/rows.js';
import { isClaimVerificationRow } from './agent/findings/verificationRow.js';
import { ownConfigArray } from '../integrity/claim-binding/scope.js';
import { BASIS_VALUES, EXPECT_VALUES, STANDING_VALUES } from './agent/findings/types.js';

/**
 * One ledger row is well-formed when it carries the fields its kind's reader
 * consumes (`findings/ledger.ts · foldLedger` and the row builders). Shape
 * only — a standing's `assertions` must be an array, never "an array of
 * assertions whose values look right" — because the continued run re-seeds
 * the row verbatim and the fold reads exactly these fields. Every value
 * vocabulary is the one `findings/types.ts` declares.
 */
function ledgerRowIsWellFormed(row: unknown): boolean {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return false;
  // Admit the new closed protocol before legacy field reads. Its reader refuses
  // accessors and unsafe values, and never runs a checker while restoring.
  const kind = Object.getOwnPropertyDescriptor(row, 'kind');
  if (kind !== undefined && !('value' in kind)) return false;
  if (kind?.value === 'negative-claim' || kind?.value === 'negative-claim-note')
    return negativeProseRowIsWellFormed(row);
  if (kind?.value === 'claim-verification') return isClaimVerificationRow(row);
  if (kind?.value === 'reference-refusal') return referenceRefusalRowIsWellFormed(row);
  const r = row as Record<string, unknown>;
  const isIn = (value: unknown, vocabulary: readonly string[]) =>
    typeof value === 'string' && vocabulary.includes(value);
  const isIdentity = (value: unknown) =>
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { toolCallId?: unknown }).toolCallId === 'string';
  // The honesty layers' turn stamp may ride EVERY kind (the one writer stamps
  // each row it files while a layer is armed); readers compare it as a number,
  // so a stamp of any other type would quietly drop its row from its own turn.
  if (r.turn !== undefined && typeof r.turn !== 'number') return false;
  // The time layer's rows (`.time()`): the turn's clock stamp, a resume's
  // differing `time`, each call's dispatch moment, and each time mention the
  // armed reader found (`time-reading`). One owner of their kinds and shape
  // (`time/rows.ts`). An older runtime refuses a checkpoint carrying one.
  if (isTimeRowKind(r.kind)) return timeRowIsWellFormed(r);
  switch (r.kind) {
    case 'basis':
      return (
        typeof r.toolCallId === 'string' &&
        typeof r.toolName === 'string' &&
        typeof r.iteration === 'number' &&
        isIn(r.basis, BASIS_VALUES) &&
        (r.expect === undefined || isIn(r.expect, EXPECT_VALUES))
      );
    case 'standing':
      return (
        typeof r.toolCallId === 'string' &&
        isIn(r.standing, STANDING_VALUES) &&
        Array.isArray(r.assertions) &&
        typeof r.iteration === 'number' &&
        (r.declaredOn === 'answer' || isIdentity(r.declaredOn))
      );
    case 'conflict':
      return (
        typeof r.key === 'string' && Array.isArray(r.witnesses) && typeof r.iteration === 'number'
      );
    // The judge's two rows (9.104.0) — the door had no arm for them until
    // 9.110.0, so a checkpoint of a judged run was refused on resume. The
    // fold reads `toolCallId` and `standing` off a judgment row and nothing
    // off an error row but its kind.
    case 'judgment':
      return (
        typeof r.toolCallId === 'string' &&
        isIn(r.standing, STANDING_VALUES) &&
        typeof r.iteration === 'number'
      );
    case 'judgment-error':
      return typeof r.toolCallId === 'string' && typeof r.iteration === 'number';
    // The towers (9.110.0): the served piece reads `declaredOn`, `value` and
    // every carrier's `toolCallId` and `standing`. The rule that writes the
    // row never files an empty carrier list and never a `fact` carrier (one
    // fact carrier means the value stands), so the door refuses both — a
    // row with either is not one `recordFindings` wrote.
    case 'contingent':
      return (
        (r.declaredOn === 'answer' || isIdentity(r.declaredOn)) &&
        typeof r.value === 'string' &&
        Array.isArray(r.carriers) &&
        r.carriers.length >= 1 &&
        r.carriers.every(
          (c: unknown) =>
            c !== null &&
            typeof c === 'object' &&
            typeof (c as { toolCallId?: unknown }).toolCallId === 'string' &&
            isIn((c as { standing?: unknown }).standing, ['open', 'noise', 'ruled-out']),
        ) &&
        typeof r.iteration === 'number'
      );
    // The row beside a ruled-out standing that rests on an absence
    // (9.113.0): the fold reads `toolCallId`, the piece reads each list's
    // items and `tryInstead`. The rule writes a list only when it holds an
    // item with a string `what`, and `tryInstead` only as a non-empty
    // string, so the door refuses anything else — a row with an empty list
    // is not one `recordFindings` wrote.
    case 'unsettled-by-absence':
      return (
        typeof r.toolCallId === 'string' &&
        (r.notChecked === undefined || isCoverageList(r.notChecked)) &&
        (r.cannotCover === undefined || isCoverageList(r.cannotCover)) &&
        (r.tryInstead === undefined || (typeof r.tryInstead === 'string' && r.tryInstead !== '')) &&
        typeof r.iteration === 'number'
      );
    // The inputs layer's verdict on one ruled argument (honesty layer 2) —
    // the arm ships in the SAME change as the row kind (the judge rows were
    // refused until 9.110.0 because their arm came later). One owner of the
    // row's shape: `arguments/rows.ts`. An older runtime refuses a checkpoint
    // that carries this kind.
    case 'argument':
      return argumentRowIsWellFormed(r);
    // The results layer's verdict on one call's period (honesty layer 3, step
    // 7b) — the arm ships in the SAME change as the row kind. One owner of the
    // row's shape: `agent/coverage/period.ts`. An older runtime refuses a
    // checkpoint that carries this kind.
    case 'period':
      return periodRowIsWellFormed(r);
    // The answer layer's witness rows (honesty layer 4): the evidence gate's
    // clean verdict, an answer before its declared steps finished, a skipped
    // step, and the script match's verdict on a shown block. The arms
    // ship in the SAME change as the kinds; one owner of their shape
    // (`assessment/witness.ts`). An older runtime refuses a checkpoint that
    // carries any of them.
    case 'grounded':
    case 'steps-unfinished':
    case 'step-skipped':
    case 'script-shown':
    case 'integrity-finding':
    case 'claim-unsettled':
      return witnessRowIsWellFormed(r);
    // The script record (`core/agent/scripts/`): one owner of its shape
    // (`scripts/rows.ts`). An older runtime refuses a checkpoint that carries it.
    case 'script':
      return scriptRowIsWellFormed(r);
    default:
      return false;
  }
}

/** A non-empty list of `{ what, why? }` coverage items, both strings — the shape the rule files. */
function isCoverageList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.every(
      (item: unknown) =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as { what?: unknown }).what === 'string' &&
        ((item as { why?: unknown }).why === undefined ||
          typeof (item as { why?: unknown }).why === 'string'),
    )
  );
}

/** Validate a findings ledger before a continued run seeds it into scope. */
export function validateCheckpointLedger(checkpoint: { readonly findingsLedger?: unknown }): void {
  // The findings ledger (9.101.0), by the same present-only rule: a checkpoint
  // without the key is every pre-ledger conversation and deserializes
  // byte-identically. When present it must be the shape `recordFindings`
  // writes, because a continued run re-seeds it VERBATIM into
  // `AgentState.findingsLedger` and the next `foldLedger` reads the fields
  // below without looking: a row that names a known `kind` but lacks the
  // fields that kind's reader consumes (`standing` without `assertions`,
  // say) would fail deep inside that fold. So the door checks the fields the
  // fold consumes, per kind — never the values the model wrote.
  if (checkpoint.findingsLedger !== undefined) {
    let ledger: readonly unknown[] | undefined;
    try {
      ledger = ownConfigArray(checkpoint.findingsLedger, Number.MAX_SAFE_INTEGER);
    } catch {
      // A saved array cannot run a getter/iterator to choose the rows admitted.
    }
    if (ledger === undefined || !ledger.every(ledgerRowIsWellFormed)) {
      throw new TypeError(
        '[resumeOnError] checkpoint `findingsLedger` must be an array of ledger rows when ' +
          "present — each a plain object whose `kind` is 'basis' (with toolCallId, toolName, " +
          "iteration, basis), 'standing' (with toolCallId, standing, assertions[], declaredOn, " +
          "iteration), 'reference-refusal' (with declaredOn, iteration, a refusal reason and optional bounded diagnostic), 'conflict' (with key, witnesses[], iteration), 'judgment' (with " +
          "toolCallId, standing, iteration), 'judgment-error' (with toolCallId, iteration) or " +
          "'contingent' (with declaredOn, value, at least one carrier { toolCallId, standing: " +
          "open | noise | ruled-out }, iteration) or 'unsettled-by-absence' (with toolCallId, " +
          'iteration, and optional non-empty notChecked / cannotCover lists of { what, why? } ' +
          "and a non-empty tryInstead string) or 'argument' (with toolCallId, toolName, " +
          'argument, iteration, turn, and a source or an asked in its vocabulary) or ' +
          "'period' (with toolCallId, toolName, iteration, turn, and a verdict of covered, " +
          'partly-held, not-held, unknown or undeclared) or ' +
          "'grounded' (with turn, iteration, posture, candidates, lookedUp) or " +
          "'steps-unfinished' (with turn, iteration, skillId, remaining[] of { index, tool }, " +
          'total, action: accepted | cut-short) or ' +
          "'step-skipped' (with turn, iteration, skillId, index, total, tool, toolCallId, " +
          'policy: advance) or ' +
          "'script-shown' (with turn, iteration, block, a script label or 'unmatched' with a " +
          "reason) or 'integrity-finding' (with turn, iteration, a finding kind, seam) or " +
          "'claim-unsettled' (with turn, iteration, field) or " +
          "'script' (with toolCallId, tool, argument, bytes, lines, a script outcome, turn, " +
          'iteration, and text only as long as bytes says, within the bound) or ' +
          "'clock' (with turn, iteration, now, nowSource, zone, zoneSource) or " +
          "'clock-on-resume' (with turn, iteration, passed, kept) or " +
          "'call' (with turn, iteration, toolCallId, toolName, dispatchedAt) or " +
          "'time-reading' (with turn, iteration, reader, tzdata, mentions and, per mention, " +
          'mention with quote, parses, candidates and choice, or refused) or ' +
          "'time-answer' (with turn, iteration, mention, from, to, zone, how: confirmed | edited); " +
          "or 'claim-verification' (the closed scoped-comparison protocol); " +
          "or 'negative-claim' / 'negative-claim-note' (bounded observe-only prose findings); " +
          'a row of any kind may carry a numeric turn. ' +
          'It is written by an agent with `.findings()`, an honesty layer or `.time()` armed, and ' +
          're-seeded verbatim on continuation.',
      );
    }
  }
}
