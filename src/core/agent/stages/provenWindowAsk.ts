import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';
import { canDiscloseProvenWindow } from '../honesty/provenWindowVisibility.js';
import { activeTimeReadings } from '../honesty/timeInputs.js';
import type { ArgumentAskDeps } from './argumentAskDeps.js';
import { readCallOccurrenceKey, callOccurrenceField } from '../../../lib/callOccurrence.js';
import { sameRange } from '../../../time/range.js';
import { callWindowOfCall, type TimeAnswerRow, type TimeReadingRow } from '../../../time/rows.js';
import { formArguments } from '../../../time/periodForm.js';
import { isRefused, periodFormsOf, rulesOf } from '../../../tools/declare.js';
import { addressOf } from '../arguments/askAddresses.js';
import type { BatchAddress } from '../arguments/batchAddress.js';
import type { ArgumentResolution, BatchCall, ToolOf } from '../arguments/resolve.js';

/** A frozen proof covers the exact period. Route other proposals to the existing window ask. */
function requireWindowConfirmation(
  calls: readonly BatchCall[],
  entries: Map<BatchAddress, ArgumentResolution>,
  ledger: readonly unknown[] | undefined,
  proof: TimeReadingRow,
  toolOf: ToolOf,
  iteration: number,
  allowProven: boolean,
): boolean {
  const range = proof.candidates?.[0]?.range;
  if (range === undefined) return false;
  const proposals: { address: BatchAddress; resolution: ArgumentResolution; exact: boolean }[] = [];
  for (const call of calls) {
    const key = readCallOccurrenceKey(call);
    const address = addressOf(call);
    const existing = entries.get(address);
    if (key === null || existing?.refused !== undefined || call.argumentsFailure !== undefined)
      continue;
    const plan = callWindowOfCall(
      ledger,
      call.id,
      proof.turn,
      (row) => row.toolName === call.name && readCallOccurrenceKey(row) === key,
    );
    if (plan === undefined || plan.how === 'refused') continue;
    const sent = plan.sent ?? plan.asked;
    const exact =
      allowProven &&
      plan.person?.frozenLookback === true &&
      (plan.how === 'filled' || plan.how === 'bound') &&
      sent !== undefined &&
      sameRange(sent, range);
    const rules = rulesOf(toolOf(call.name));
    if (rules === undefined || isRefused(rules)) continue;
    const arguments_ = [
      ...new Set(
        periodFormsOf(rules.period).flatMap((f) =>
          formArguments(f).map(({ argument }) => argument),
        ),
      ),
    ];
    if (arguments_.length === 0) continue;
    const fills = existing?.fills?.filter((fill) => !arguments_.includes(fill.argument));
    proposals.push({
      address,
      exact,
      resolution: {
        ...existing,
        toolCallId: call.id,
        ...callOccurrenceField(call.callOccurrenceKey),
        iteration,
        fills,
        ask: [...new Set([...(existing?.ask ?? []), ...arguments_])],
        window: true,
        removePeriodArguments: arguments_,
      },
    });
  }
  if (proposals.every(({ exact }) => exact)) return false;
  // The form asks once for the person's interval. Every period call in the batch gets that answer.
  for (const { address, resolution } of proposals) entries.set(address, resolution);
  return true;
}

/** The ordinary ask owns confirmation when any proposed call falls outside the proof. */
export function timeAskForProof(
  scope: TypedScope<AgentState>,
  deps: ArgumentAskDeps,
  calls: readonly BatchCall[],
  entries: Map<BatchAddress, ArgumentResolution>,
  ledger: readonly unknown[] | undefined,
  answers: readonly TimeAnswerRow[],
  iteration: number,
): ArgumentAskDeps {
  if (deps.time?.reader === undefined) return deps;
  const proof = activeTimeReadings(scope, false).find((row) => row.choice?.by === 'proven');
  if (proof === undefined || answers.some((answer) => answer.mention === proof.mention))
    return deps;
  const range = proof.candidates?.[0]?.range;
  const allowProven =
    range !== undefined &&
    activeTimeReadings(scope, deps.time.allowProven === true)[0]?.choice?.by === 'only' &&
    canDiscloseProvenWindow(scope, range);
  return requireWindowConfirmation(
    calls,
    entries,
    ledger,
    proof,
    deps.toolOf,
    iteration,
    allowProven,
  )
    ? { ...deps, time: { ...deps.time, allowProven: false } }
    : deps;
}
