import { defineTool, type PeriodForm, type ToolPeriod } from '../../../src/index.js';
import { compareInstants, instantOf, shiftInstant } from '../../../src/time/instant.js';
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

export function rulerTool({
  period = { forms: [rulerBounds], granularity: '1m' },
  onCall,
}: {
  readonly period?: ToolPeriod;
  readonly onCall?: (args: Readonly<Record<string, unknown>>) => void;
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
    execute: (args) => {
      onCall?.({ ...args });
      if (bounds === undefined) throw new TypeError('The ruler requires its absolute bounds form.');
      const range = { from: args[bounds.from.argument], to: args[bounds.to.argument] };
      return JSON.stringify(rulerRows(range, bounds.to.edge));
    },
  });
}
