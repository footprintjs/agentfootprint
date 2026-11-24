import {
  callWindowOf,
  type CallWindow,
  type TurnWindow,
  type TurnWindows,
} from '../../../time/bind.js';
import { exactComparisonArguments } from '../../../time/comparison/arguments.js';
import { comparisonForTool } from '../../../time/comparisonSelection.js';
import { formArguments, granularityMsOf } from '../../../time/convert.js';
import type { InstantText } from '../../../time/instant.js';
import type { ClockRow, TimeAnswerRow } from '../../../time/rows.js';
import type { ZoneName } from '../../../time/zone.js';
import {
  isMissing,
  isRefused,
  periodArgumentsOf,
  periodFactsOf,
  periodFormsOf,
  rulesOf,
} from '../../../tools/declare.js';
import { carriesArgumentView } from '../../toolShownArgs.js';
import { batchAddress, type BatchAddress } from './batchAddress.js';
import type { BatchCall, PlannedCall, SourcesArm, ToolOf } from './resolve.js';
import { periodQuotesOf } from './sources.js';

/** Current-turn time input for the declaration, recording and resolution stages. */
export interface TimeArm {
  readonly turn: TurnWindows;
  readonly now: InstantText;
  readonly zone: ZoneName;
  readonly appZone?: ZoneName;
  readonly comparison?: {
    readonly clock: ClockRow;
    readonly currentTurn: number;
    readonly answers?: readonly TimeAnswerRow[];
    readonly boundWindow?: TurnWindow;
  };
}

/** Decide a call from its declared period forms and the existing turn evidence. */
export function timeDecisionsOf(
  plan: readonly PlannedCall[],
  calls: readonly BatchCall[],
  toolOf: ToolOf,
  time: TimeArm | undefined,
  sources?: SourcesArm,
): ReadonlyMap<BatchAddress, CallWindow> {
  const decisions = new Map<BatchAddress, CallWindow>();
  if (time === undefined) return decisions;
  const byAddress = new Map(
    calls.map((call) => [batchAddress(call.id, call.callOccurrenceKey), call]),
  );
  for (const planned of plan) {
    if (planned.refused !== undefined) continue;
    const address = batchAddress(planned.toolCallId, planned.callOccurrenceKey);
    const call = byAddress.get(address);
    const tool = toolOf(planned.toolName);
    const declared = rulesOf(tool);
    const rules = declared !== undefined && !isRefused(declared) ? declared : undefined;
    const compare = time.comparison;
    const selected =
      compare === undefined
        ? undefined
        : comparisonForTool(
            compare.clock,
            compare.currentTurn,
            planned.toolName,
            time.turn,
            compare,
          );
    const forms = periodFormsOf(rules?.period);
    if (call === undefined || (selected === undefined && forms.length === 0)) continue;
    const facts = periodFactsOf(rules?.period);
    const ctx = {
      now: time.now,
      zone: time.zone,
      appZone: time.appZone,
      granularityMs: granularityMsOf(facts),
    };
    const input = {
      args: call.args,
      forms,
      facts,
      isMissing: (argument: string) => isMissing(call.args, argument),
    };
    if (selected === undefined) {
      const quotes = periodQuotesOf(
        sources?.declared.get(address),
        periodArgumentsOf(rules?.period),
      );
      decisions.set(address, callWindowOf({ ...input, quotes }, time.turn, ctx));
      continue;
    }
    const window = selected.window;
    if (window === undefined && forms.length > 0) {
      decisions.set(address, { how: 'not-filled', why: 'open-reading', comparisonAsk: 'confirm' });
      continue;
    }
    const exact = window === undefined ? undefined : exactComparisonArguments(input, window, ctx);
    if (window === undefined || exact === undefined) {
      decisions.set(address, {
        how: 'refused',
        refused: 'no-form-holds',
        comparisonAsk: 'omit',
        ...(window !== undefined && { asked: window.range, person: window }),
      });
      continue;
    }
    if (exact.same) {
      decisions.set(address, {
        how: 'bound',
        form: exact.form,
        asked: window.range,
        window,
        by: 'value',
        comparison: {},
      });
      continue;
    }
    const corrected = forms.some((form) =>
      formArguments(form).some(({ argument }) => !input.isMissing(argument)),
    );
    decisions.set(address, {
      how: 'filled',
      window,
      conversion: { form: exact.form, values: exact.values },
      replacedForm: true,
      comparison: {
        ...(corrected && { corrected: true }),
        ...(corrected &&
          exact.original !== undefined &&
          !carriesArgumentView(tool) && { original: exact.original }),
      },
    });
  }
  return decisions;
}
