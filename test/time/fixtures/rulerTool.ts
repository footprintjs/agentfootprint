import { defineTool, type PeriodForm, type ToolPeriod } from '../../../src/index.js';
import { durationMs } from '../../../src/time/duration.js';
import {
  compareInstants,
  instantOf,
  shiftInstant,
  spellInstant,
} from '../../../src/time/instant.js';
import { sugarForms } from '../../../src/time/periodForm.js';
import type { Edge } from '../../../src/time/range.js';

const MINUTE_MS = 60_000;
const MAX_RANGE = '48h';
const MAX_RANGE_MS = 48 * 60 * MINUTE_MS;

export const rulerBounds = {
  kind: 'bounds',
  from: { argument: 'from', as: 'iso' },
  to: { argument: 'to', as: 'iso', edge: 'exclusive' },
  maxRange: MAX_RANGE,
} as const satisfies PeriodForm;

export function rulerRows(
  { from, to }: { readonly from: unknown; readonly to: unknown },
  edge: Edge = 'exclusive',
): string[] {
  const start = instantOf(from, 'strict');
  const end = instantOf(to, 'strict');
  if (start?.offsetMinutes !== 0 || end?.offsetMinutes !== 0) {
    throw new TypeError('The ruler requires absolute UTC ISO bounds.');
  }

  const order = compareInstants(start, end);
  if (order > 0 || (order === 0 && edge === 'exclusive')) {
    throw new RangeError('The ruler requires a nonempty, ordered window.');
  }
  if (compareInstants(end, shiftInstant(start, MAX_RANGE_MS)) > 0) {
    throw new RangeError(`The ruler window exceeds ${MAX_RANGE}.`);
  }

  const startMinute = Math.floor(start.ms / MINUTE_MS);
  const endMinute = Math.floor(end.ms / MINUTE_MS);
  const startOnGrid = start.ms % MINUTE_MS === 0 && start.nanos === 0;
  const endOnGrid = end.ms % MINUTE_MS === 0 && end.nanos === 0;
  const first = startOnGrid ? startMinute : startMinute + 1;
  const last = edge === 'exclusive' && endOnGrid ? endMinute - 1 : endMinute;
  const count = Math.max(0, last - first + 1);
  return Array.from(
    { length: count },
    (_, index) => `R-${new Date((first + index) * MINUTE_MS).toISOString().slice(0, 16)}Z`,
  );
}

/**
 * A source that takes only a length reads `[its now − length, its now]`, both
 * ends inside — the rows a duration names on the clock the source reads it at.
 */
export function rulerRowsBack(length: unknown, sourceNow: unknown): string[] {
  const at = instantOf(sourceNow, 'strict');
  const ms = typeof length === 'string' ? durationMs(length.replace(/^-/, ''), 'smhdw') : undefined;
  if (at === undefined || ms === undefined) {
    throw new TypeError('The ruler requires a duration and the clock it is read at.');
  }
  const from = spellInstant(shiftInstant({ ms: at.ms, nanos: at.nanos }, -ms), 0);
  const to = spellInstant({ ms: at.ms, nanos: at.nanos }, 0);
  return rulerRows({ from, to }, 'inclusive');
}

export function rulerTool({
  period = { forms: [rulerBounds], granularity: '1m' },
  onCall,
  sourceNow,
}: {
  readonly period?: ToolPeriod;
  readonly onCall?: (args: Readonly<Record<string, unknown>>) => void;
  /** The source's own clock for a duration; absent, the moment the call was handed over. */
  readonly sourceNow?: () => string;
} = {}) {
  const forms = sugarForms(period);
  const bounds = forms.find((form) => form.kind === 'bounds');
  const duration = forms.find((form) => form.kind === 'lookback')?.argument;
  const from = bounds?.from.argument;
  const to = bounds?.to.argument;
  return defineTool({
    name: 'ruler',
    description: 'List the UTC minute names within the requested time window.',
    inputSchema: {
      type: 'object',
      properties: {
        ...(from !== undefined && { [from]: { type: 'string' } }),
        ...(to !== undefined && { [to]: { type: 'string' } }),
        ...(duration !== undefined && { [duration]: { type: 'string' } }),
      },
    },
    askOrAssume: {
      ...(from !== undefined && { [from]: { ask: 'What is the start of the window?' } }),
      ...(to !== undefined && { [to]: { ask: 'What is the end of the window?' } }),
      ...(duration !== undefined && { [duration]: { ask: 'What is the duration?' } }),
    },
    period,
    execute: (args, ctx) => {
      onCall?.({ ...args });
      if (bounds !== undefined && args[bounds.from.argument] !== undefined) {
        const range = { from: args[bounds.from.argument], to: args[bounds.to.argument] };
        return JSON.stringify(rulerRows(range, bounds.to.edge));
      }
      if (duration === undefined || args[duration] === undefined) {
        throw new TypeError('The ruler requires its absolute bounds form.');
      }
      return JSON.stringify(
        rulerRowsBack(args[duration], sourceNow?.() ?? ctx?.time?.dispatchedAt),
      );
    },
  });
}
