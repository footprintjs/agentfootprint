import type { PeriodDiffers } from '../../time/checkRecord.js';
import type { BoundPresentation } from '../../time/present.js';

// LENS · late-line · request-ephemeral
// reads: one `period` row's `differs` (asked, missing, extra) and `shifted` — a look-back that ran
//        after the turn's clock moved on — rendered in the person's zone by the bound renderer
// law: the library's CONCLUSION for the MODEL: the part of the window the result does not cover,
//      and that the answer says so and claims nothing about it; never two ranges left to compare.
/**
 * The model's line for a SHIFTED read (`period-shifted` with both `missing`
 * and `extra`): the part of the asked window (or the person's) the result
 * does not cover and the time it read outside it, in the presentation zone,
 * then what the answer does with that — says it, and claims nothing about it
 * from this tool.
 *
 * @example
 * ```ts
 * shiftedConclusion('search_logs', differs, presentation);
 * // "search_logs's look-back ran after the clock moved on, so its result does not cover
 * //  2026-10-09 09:30:00–09:59:59 America/Los_Angeles (UTC-07:00) of the person's window (…),
 * //  and covers …, outside it. So the answer says that search_logs's result does not cover
 * //  2026-10-09 09:30:00–09:59:59 America/Los_Angeles (UTC-07:00), and claims nothing about that
 * //  time from it"
 * ```
 */
export function shiftedConclusion(
  toolName: string,
  d: PeriodDiffers,
  presentation: BoundPresentation,
): string {
  const ranges = (rs: readonly PeriodDiffers['asked'][]): string =>
    rs.map((r) => presentation.range(r, 'second')).join(' and ');
  const reference = d.against === 'person' ? "the person's window" : 'the window asked';
  const missing = ranges(d.missing);
  const asked = ranges([d.asked]);
  const none = missing === asked;
  const gap = none ? `any of ${reference}, ${asked}` : `${missing} of ${reference} (${asked})`;
  return (
    `${toolName}'s look-back ran after the clock moved on, so its result does not cover ${gap}, ` +
    `and covers ${ranges(d.extra)}, outside it. So the answer says that ${toolName}'s result ` +
    `does not cover ${missing}, and claims nothing about that time from it`
  );
}
