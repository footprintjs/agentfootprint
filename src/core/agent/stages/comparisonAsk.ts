import { interrupt, type TypedScope } from 'footprintjs';
import { parseRange } from '../../../time/range.js';
import { answersOf, clockOf, readingsOf, timeAnswerRow } from '../../../time/rows.js';
import { readControlWindow } from '../../../time/windowEndpoint.js';
import { turnWindowsOf } from '../../../time/windows.js';
import { stampInputRequest, type InputField } from '../../../tools/inputRequest.js';
import { initialAskState, readAskAnswer } from '../arguments/ask.js';
import { addressOf } from '../arguments/askAddresses.js';
import { ARGUMENT_ASK_KIND, ASK_CONTEXT_KEY } from '../arguments/askMarker.js';
import type { BatchAddress } from '../arguments/batchAddress.js';
import {
  declareBatch,
  resolutionsOf,
  type ArgumentResolution,
  type BatchCall,
} from '../arguments/resolve.js';
import { callWindowRowsOf } from '../arguments/resolutionRows.js';
import { timeDecisionsOf } from '../arguments/timeDecisions.js';
import { recordFindings } from '../findings/ledger.js';
import type { FindingsLedger } from '../findings/types.js';
import type { AgentState } from '../types.js';
import type { AskedBatch } from './argumentAsk.js';
import type { ArgumentAskDeps } from './argumentAskDeps.js';

const omitField: InputField = {
  id: 'omitUnavailable',
  type: 'boolean',
  enum: [true],
  description: 'Continue without sources that cannot read the confirmed window exactly.',
};

const windowField: InputField = {
  id: 'window',
  type: 'string',
  format: 'time-range',
  description: 'Use two ISO 8601 instants with offsets. The end is exclusive.',
};

const omitted =
  'This source could not read the confirmed comparison window exactly and was omitted.';

/** Uses the native batch pause before any selected call can run. */
export function askComparisonBeforeDispatch(
  scope: TypedScope<AgentState>,
  entries: Map<BatchAddress, ArgumentResolution>,
  calls: readonly BatchCall[],
  deps: ArgumentAskDeps,
): AskedBatch | undefined {
  const waiting = calls.find((call) => entries.get(addressOf(call))?.comparisonAsk !== undefined);
  if (waiting === undefined) return undefined;
  const confirm = [...entries.values()].some((entry) => entry.comparisonAsk === 'confirm');
  const ledger = scope.findingsLedger as FindingsLedger | undefined;
  const clock = clockOf(ledger);
  const turn = scope.turnNumber as number;
  const iteration = scope.iteration as number;
  if (clock?.turn !== turn) throw new TypeError('The comparison pause has no current turn clock.');
  const persisted = scope.$getValue('argumentAsk') as AgentState['argumentAsk'];
  const restored = persisted?.iteration === iteration ? persisted.waiting : undefined;
  if (
    restored !== undefined &&
    (restored.awaiting.id !== 'agentfootprint.comparison' ||
      restored.awaiting.origin.toolCallId !== waiting.id)
  )
    throw new TypeError('The saved ask does not match this comparison batch.');
  const requestId =
    restored?.requestId ?? `${deps.runId?.() ?? scope.turnStartMs}:comparison:${iteration}`;
  const awaiting =
    restored?.awaiting ??
    stampInputRequest(
      {
        id: 'agentfootprint.comparison',
        question: confirm
          ? 'Which time window should these sources compare?'
          : 'A source cannot read the confirmed window exactly. Continue without it?',
        fields: confirm ? [windowField, omitField] : [omitField],
        context: { [ASK_CONTEXT_KEY]: { ask: ARGUMENT_ASK_KIND } },
      },
      requestId,
      { originalRequest: scope.userMessage as string, toolCallId: waiting.id },
    );
  const request = restored ?? { requestId, fieldIndexes: confirm ? [0, 1] : [0], awaiting };
  if (restored === undefined) {
    scope.argumentAsk = { ...initialAskState(iteration, []), waiting: request };
    deps.saveParties?.();
    deps.beforePause?.([]);
  }
  const pause = {
    reason: awaiting.question,
    question: awaiting.question,
    awaitingInput: awaiting,
  };
  const response = interrupt(scope, pause);
  const values = readAskAnswer(request, response);
  if (values.omitUnavailable !== true)
    throw new TypeError('Confirm that unavailable sources may be omitted.');
  scope.argumentAsk = undefined;
  deps.settledAsk?.();
  deps.admitAnswer?.();

  const stamp = { turn, iteration };
  if (confirm) {
    const supplied = typeof values.window === 'string' ? parseRange(values.window) : undefined;
    const window = readControlWindow(supplied);
    if (window === undefined)
      throw new TypeError('The comparison answer has no exact time window.');
    const answer = timeAnswerRow(
      {
        mention: 0,
        range: window,
        endpoint: window.endpoint,
        zone: clock.zone,
        how: 'edited',
        comparison: true,
      },
      stamp,
    );
    recordFindings(scope, [answer], { turn });

    const snapshot = scope.findingsLedger as FindingsLedger | undefined;
    const plan = declareBatch(calls, deps.toolOf);
    const decisions = timeDecisionsOf(plan, calls, deps.toolOf, {
      turn: turnWindowsOf(readingsOf(snapshot, turn), clock, answersOf(snapshot, turn)),
      now: clock.now,
      zone: clock.zone,
      appZone: deps.time?.appZone,
      comparison: { clock, currentTurn: turn, answers: [answer] },
    });
    const selected = calls.filter(
      (call) => entries.get(addressOf(call))?.comparisonAsk !== undefined,
    );
    recordFindings(scope, callWindowRowsOf(decisions, selected, stamp), { turn });
    const refreshed = resolutionsOf(
      plan,
      [],
      deps.toolOf,
      iteration,
      undefined,
      undefined,
      decisions,
    );
    const refreshedByCall = new Map(
      refreshed.map((entry) => [
        addressOf({ id: entry.toolCallId, callOccurrenceKey: entry.callOccurrenceKey }),
        entry,
      ]),
    );
    for (const call of selected) {
      const address = addressOf(call);
      const original = entries.get(address);
      const decision = decisions.get(address);
      if (original !== undefined && decision?.comparison !== undefined) {
        const exact = refreshedByCall.get(address);
        const fills = [...(original.fills ?? []), ...(exact?.fills ?? [])];
        entries.set(address, { ...original, ...exact, fills, comparisonAsk: undefined });
      }
    }
  }
  const refused: BatchAddress[] = [];
  for (const [address, entry] of entries) {
    if (entry.comparisonAsk !== undefined || (entry.ask?.length ?? 0) > 0) {
      refused.push(address);
      entries.set(address, {
        toolCallId: entry.toolCallId,
        callOccurrenceKey: entry.callOccurrenceKey,
        iteration,
        refused:
          entry.comparisonAsk !== undefined
            ? omitted
            : 'This call still needs an answer before it can run.',
      });
    }
  }
  deps.refusedCalls?.(refused);
  return { resolutions: entries, answered: true };
}
