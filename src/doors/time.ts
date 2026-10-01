/**
 * agentfootprint/time — the conversion the time layer itself asks, for an app
 * that needs the same answer OUTSIDE a run.
 *
 * Under `.time()` the library writes the person's window into a tool's own
 * arguments (the fill, the time ask's choices, the served line). An app that
 * previews what a tool would read, or builds a call itself, asks the same
 * three questions — and gets the library's answer, not a copy that drifts:
 *
 *   - `convertExact` — the first declared form that holds the window EXACTLY,
 *     as the argument values to send (or `undefined`);
 *   - `convertWidened` — else the first form that holds it by reading MORE (a
 *     whole day; the covering look-back from now), with the range the tool
 *     reads (`sent`) and the parts nobody asked for (`extra`);
 *   - `periodFactProblem` — which of the tool's declared facts (`direction`,
 *     `retention`, `maxRange`) a range breaks, as a code.
 *
 * Pure functions over a clock the caller passes: no run, no record, no
 * `.time()`. A door of its own because the conversions are the time layer's
 * RUN-TIME half, which a plain agent never loads (`src/core/time/README.md` ·
 * "What a plain agent carries"; pinned by
 * `test/lib/trace-toolpack/browserGraph.test.ts`): on the main barrel they
 * would put that half on every consumer's default graph. The shapes they take
 * (`PeriodForm`, `PeriodFacts`, `TimeRange`) are on the main barrel.
 *
 * @example
 * ```ts
 * import { convertExact, convertWidened, periodFactProblem } from 'agentfootprint/time';
 *
 * const clock = { now: '2026-10-09T15:40:00Z', zone: 'America/Los_Angeles', granularityMs: 60_000 };
 * const yesterday = { from: '2026-10-08T00:00:00-07:00', to: '2026-10-09T00:00:00-07:00' };
 * const lookback = [{ kind: 'lookback', argument: 'w', signed: false }] as const;
 *
 * convertExact({ range: yesterday }, lookback, clock);   // undefined — a look-back ends at now
 * convertWidened({ range: yesterday }, lookback, clock); // { form: 0, values: { w: '1960m' }, sent, extra }
 * periodFactProblem(yesterday, { direction: 'future' }, clock.now); // 'time-past'
 * ```
 */

export {
  convertExact,
  convertWidened,
  type Conversion,
  type ConvertContext,
  type WidenedConversion,
  type WindowToConvert,
} from '../core/time/convert.js';
export { periodFactProblem, type PeriodFactProblem } from '../core/time/periodForm.js';
