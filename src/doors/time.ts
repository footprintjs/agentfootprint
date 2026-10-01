/**
 * agentfootprint/time — the conversion the time layer itself asks, for an app
 * that needs the same answer OUTSIDE a run.
 *
 * Under `.time()` the library writes the person's window into a tool's own
 * arguments (the fill, the time ask's choices, the served line). An app that
 * previews what a tool would read, or builds a call itself, asks the SAME
 * question the run asks — and gets the library's answer, not a copy that
 * drifts:
 *
 *   - `convertForTool` — THE answer: can this tool read this window, and how.
 *     The tool's facts first (a fact it breaks → `{ refused }`), then the
 *     first form that holds the window exactly, then the first that holds it
 *     by reading MORE within the tool's `maxRange`, then `multi-day` for a
 *     `day`-only tool, else `no-form-holds`; a window partly older than
 *     `retention` converts, marked `partlyBeyondRetention`. The time ask and
 *     the bind ask this function (`convert.ts` · `convertForTool`).
 *   - the tool's own declaration, read the run's way: `sugarForms(period)` is
 *     the forms a `period` declares (its `forms`, else the `argument` +
 *     `spelling`/`accepts` sugar); `granularityMsOf(period)` is the clock's
 *     `granularityMs` (its `granularity`, else one minute); `widestMsOf(period)`
 *     is its `maxRange` in milliseconds. A tool's `period` IS its facts — pass
 *     it whole.
 *   - the parts, for a caller that needs one step alone: `convertExact`,
 *     `convertWidened` (asked only AFTER `convertExact` finds nothing — it does
 *     not look for an exact form first), `periodFactProblem`.
 *   - time for a PERSON, as the run writes it: `presentRange(range, { zone,
 *     locale? }, grain?)` — the label the time ask and the served line use (a
 *     half-open range with its end as said, the zone always named), so an
 *     app's panel shows the run's own words; and `isZoneName(value)` — the
 *     run's zone check (an IANA name; `PST` and a bare offset are refused,
 *     although `Intl` takes them), for a session zone before it is passed as
 *     `time.zone`.
 *
 * Pure functions over a clock the caller passes: no run, no record, no
 * `.time()`. A door of its own because the conversions are the time layer's
 * RUN-TIME half, which a plain agent never loads (`src/core/time/README.md` ·
 * "What a plain agent carries"; pinned by
 * `test/lib/trace-toolpack/browserGraph.test.ts`): on the main barrel they
 * would put that half on every consumer's default graph. The shapes they take
 * (`PeriodForm`, `PeriodFacts`, `TimeRange`, `ToolPeriod`) are on the main
 * barrel.
 *
 * @example
 * ```ts
 * import { convertForTool, granularityMsOf, sugarForms } from 'agentfootprint/time';
 *
 * // The tool's own declaration — `defineTool({ …, period })`.
 * const period = { argument: 'window', spelling: 'lookback', direction: 'past', maxRange: '24h' } as const;
 * const clock = { now: '2026-10-09T15:40:00Z', zone: 'America/Los_Angeles', granularityMs: granularityMsOf(period) };
 * const yesterday = { from: '2026-10-08T00:00:00-07:00', to: '2026-10-09T00:00:00-07:00' };
 *
 * convertForTool({ range: yesterday }, sugarForms(period), period, clock);
 * // { refused: 'no-form-holds' } — reaching 8 Oct from now takes a look-back wider than 24h
 * ```
 */

export {
  convertExact,
  convertForTool,
  convertWidened,
  granularityMsOf,
  widestMsOf,
  type Conversion,
  type ConvertContext,
  type ToolConversion,
  type WidenedConversion,
  type WindowToConvert,
} from '../core/time/convert.js';
export {
  periodFactProblem,
  sugarForms,
  type PeriodFactProblem,
  type PeriodShapes,
  type TimeRefusal,
} from '../core/time/periodForm.js';
export { presentRange, type Grain, type Presentation } from '../core/time/present.js';
export { isZoneName, type ZoneName } from '../core/time/zone.js';
