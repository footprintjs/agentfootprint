/**
 * llm-ledger/rules/timeWindow — `time-window@1`: the cited receipts' stated windows cover the
 * claim's window.
 *
 * Pattern: a table rule (`rules/port.ts`). Facts `claimWindow`, `windowed`, `unwindowed`,
 *          `uncoveredMs`, `cutInWindow`.
 * Role:    the time check, on typed windows only (`window.ts`): times written in prose, whether
 *          the rows really span a declared window, zones and wall times are out of its sight.
 * Emits:   N/A.
 *
 * Windows are half-open `[from, to)`. Coverage is the claim's window minus the union of the cited
 * receipts' windows, in milliseconds. A cited receipt without a window cannot cover anything; one
 * that is incomplete (`isIncomplete`) and overlaps the claim's window may have been cut short
 * inside it. The finding rests on the cited receipts whose windows overlap the claim's.
 */
import { isIncomplete } from '../entries.js';
import { instantMs } from '../window.js';
import type { LedgerWindow } from '../types.js';
import type { LedgerTableRule } from './port.js';

/** `[from, to)` in epoch milliseconds. */
const spanOf = (w: LedgerWindow): readonly [number, number] => [
  instantMs(w.from) as number,
  instantMs(w.to) as number,
];

/** Milliseconds of `[from, to)` that no span in `spans` covers: subtraction of a merged union. */
function uncovered(
  from: number,
  to: number,
  spans: readonly (readonly [number, number])[],
): number {
  let left = to - from;
  let reach = from;
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    const start = Math.max(a, reach);
    const end = Math.min(b, to);
    if (end > start) {
      left -= end - start;
      reach = end;
    }
  }
  return left;
}

export const timeWindow: LedgerTableRule = {
  id: 'time-window',
  version: 1,
  appliesTo: ['claim', 'ruled-out'],
  facts: (input) => {
    const window = input.subject.kind === 'draft' ? undefined : input.subject.note.window;
    if (window === undefined)
      return {
        facts: { claimWindow: 0, windowed: 0, unwindowed: 0, uncoveredMs: 0, cutInWindow: 0 },
        restsOn: [],
      };
    const [from, to] = spanOf(window);
    const windowed = input.receipts.filter((r) => r.window !== undefined);
    const overlapping = windowed.filter((r) => {
      const [a, b] = spanOf(r.window as LedgerWindow);
      return a < to && b > from;
    });
    return {
      facts: {
        claimWindow: 1,
        windowed: windowed.length,
        unwindowed: input.receipts.length - windowed.length,
        uncoveredMs: uncovered(
          from,
          to,
          windowed.map((r) => spanOf(r.window as LedgerWindow)),
        ),
        cutInWindow: overlapping.filter(isIncomplete).length,
      },
      restsOn: overlapping.map((r) => r.seq),
    };
  },
  table: [
    {
      when: { claimWindow: { eq: 0 } },
      then: 'not-applicable',
      label: 'the claim states no window',
    },
    {
      when: { windowed: { eq: 0 } },
      then: 'unreachable',
      label: 'no cited receipt states its window',
    },
    {
      when: { uncoveredMs: { gt: 0 }, unwindowed: { gt: 0 } },
      then: 'unreachable',
      label: 'part of the window is covered by no stated window',
    },
    {
      when: { uncoveredMs: { gt: 0 } },
      then: 'checked-fail',
      label: "the claim's window is wider than its receipts",
    },
    {
      when: { cutInWindow: { gt: 0 } },
      then: 'unreachable',
      label: 'a receipt covering the window was cut short',
    },
  ],
  default: { branch: 'checked-pass', label: "the cited receipts cover the claim's window" },
};
