/**
 * route/integrity — the Route decider's half of the integrity family: the claim
 * seam, and the one moment the rows the seams held reach the findings ledger.
 *
 * Pattern: impure helpers over tracked scope, one call each from `route.ts`.
 * Role:    every Route shape funnels through `buildRouteDeciderStage`, so
 *          `fileHeldRows` runs once per decision under the answer
 *          layer's arm, on the outer scope, after every judge filed its finding
 *          and before the final branch folds. The compose, wire and choice seams
 *          run inside subflows that cannot write the ledger; they hold a row on
 *          `integrityFindingRows` (`integrityFindings.ts`), and the one writer
 *          files them here.
 */

import type { TypedScope } from 'footprintjs';
import { applyOutputSchema } from '../../../answer-validation/outputSchema.js';
import type { Disposition } from '../../../integrity/disposition/types.js';
import type { DispositionLedger } from '../../../integrity/disposition/ledger.js';
import type { IntegrityFindingRow } from '../../../integrity/finding/row.js';
import {
  unsupportedClaimsOf,
  type DeclaredClaim,
} from '../../../integrity/unsupported-claim/check.js';
import type { ClaimUnsettledRow } from '../assessment/witness.js';
import { recordFindings } from '../findings/ledger.js';
import { fileIntegrityFindings, type IntegrityRun } from '../integrityFindings.js';
import type { AgentState } from '../types.js';

/** File the rows this turn's seams held, through the one writer, then clear them. */
export function fileHeldRows(scope: TypedScope<AgentState>): void {
  const held = scope.$getValue('integrityFindingRows') as
    | readonly IntegrityFindingRow[]
    | undefined;
  if (held === undefined || held.length === 0) return;
  recordFindings(scope, [...held], { turn: scope.turnNumber as number });
  scope.$delete('integrityFindingRows');
}

/**
 * THE CLAIM SEAM (9.61.0) — the last judge, and the only one that changes
 * nothing.
 *
 * It runs where the answer is about to be handed back: after the schema
 * accepted it, after the procedure judge, after the evidence gate grounded
 * its values. That order is the point — this check reads the VALIDATED
 * answer object, so it can only run on an answer the schema already let
 * stand, and it asks a question none of the others can: does what the
 * answer SAYS agree with what the run SETTLED?
 *
 * It never re-routes. The other three judges can send the turn back for a
 * revision; a contradiction between the answer and the ledger is a fact
 * about a finished run, and re-asking the model would invite it to change
 * the claim rather than the run to change the facts. So this files a
 * finding and returns — detection converting a silent disagreement into an
 * attributable one, exactly as every other seam in this family does.
 * Withholding is the validation's: under `agentChecks: ['claims']`,
 * `answerValidation.ts` asks the same comparison of the delivered answer.
 */
export function judgeClaims(
  scope: TypedScope<AgentState>,
  claims: readonly DeclaredClaim[] | undefined,
  ledgerHolder: (IntegrityRun & { current: DispositionLedger | undefined }) | undefined,
): void {
  if (claims === undefined || claims.length === 0) return;
  const answer = readValidatedAnswer(scope);
  const iteration = (scope.iteration as number | undefined) ?? 0;
  if (answer === undefined) {
    // The answer is not readable as the typed stratum (a parser that
    // returns a non-object, an answer that is bare prose). Incomparable —
    // stated per declared claim, never guessed at.
    noteUncompared(scope, claims, ledgerHolder);
    return;
  }
  const { findings, dispositions } = unsupportedClaimsOf(
    claims,
    (scope.claimFacts as Parameters<typeof unsupportedClaimsOf>[1] | undefined) ?? [],
    answer,
    iteration,
  );
  for (const d of dispositions) {
    ledgerHolder?.current?.note(
      'unsupported-claim',
      'claim',
      d.disposition,
      d.disposition === 'checked-fail' ? Date.now() : undefined,
    );
  }
  fileIntegrityFindings(scope, findings, iteration, ledgerHolder);
  // A field the answer states and no tool settled: nothing could compare it. An
  // agreeing field files nothing.
  fileUnsettledClaims(
    scope,
    dispositions.filter((d) => d.disposition === 'unreachable').map((d) => d.claim),
    ledgerHolder,
  );
}

/**
 * Every declared claim, when no value could be read from the answer at all: the
 * answer is not an object, or never satisfied the schema. Same disposition, and
 * the same row as a field no tool settled, so the answer cannot read "consistent"
 * over a comparison that did not happen.
 */
export function noteUncompared(
  scope: TypedScope<AgentState>,
  claims: readonly DeclaredClaim[] | undefined,
  ledgerHolder: (IntegrityRun & { current: DispositionLedger | undefined }) | undefined,
): void {
  noteClaims(claims, ledgerHolder, 'unreachable');
  fileUnsettledClaims(
    scope,
    (claims ?? []).map((claim) => claim.answerField),
    ledgerHolder,
  );
}

/** One row per field, while the answer layer is armed. `field` is the app's declared path. */
function fileUnsettledClaims(
  scope: TypedScope<AgentState>,
  fields: readonly string[],
  run: IntegrityRun | undefined,
): void {
  if (run?.answerLayer !== true) return;
  const iteration = (scope.iteration as number | undefined) ?? 0;
  recordFindings(
    scope,
    fields.map(
      (field): ClaimUnsettledRow => ({
        kind: 'claim-unsettled',
        turn: scope.turnNumber as number,
        iteration,
        field,
      }),
    ),
  );
}

/**
 * File one disposition per declared claim WITHOUT comparing anything.
 *
 * The two terminal exits an answer can leave by without ever being judged —
 * a schema the model never satisfied, and a middleware denial — still hand
 * something back to the caller, so a claim contract that filed nothing there
 * would leave the run's accounting silent about checks it registered. And
 * silence is the one thing this ledger exists to make impossible: the
 * difference between "the checker ran and agreed" and "no checker was
 * watching" is exactly what a disposition row carries.
 */
export function noteClaims(
  claims: readonly DeclaredClaim[] | undefined,
  ledgerHolder: { current: DispositionLedger | undefined } | undefined,
  disposition: Disposition,
): void {
  if (claims === undefined || claims.length === 0) return;
  for (let i = 0; i < claims.length; i++) {
    ledgerHolder?.current?.note('unsupported-claim', 'claim', disposition);
  }
}

/**
 * The answer as a typed object, or `undefined` when there is none to read.
 *
 * Deliberately re-parses the STRING the caller will receive rather than
 * reaching for a parsed object: both output strategies normalize to that
 * string (`tool-forced` re-serializes its tool args into it), so this is
 * the one shape that exists on every path — and checking anything else
 * would check an answer nobody gets.
 */
function readValidatedAnswer(scope: TypedScope<AgentState>): unknown | undefined {
  const raw = scope.llmLatestContent as string | undefined;
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  try {
    // Called only after output-schema acceptance. Decode the same permitted
    // wrapper without invoking the application's potentially stateful parser.
    const parsed = applyOutputSchema(raw, { parse: (value: unknown) => value });
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}
