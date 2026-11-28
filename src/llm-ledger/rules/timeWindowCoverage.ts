/** The opt-in time rule limits what a sure note can say about incomplete cited reads. */
import type { LedgerReceipt } from '../types.js';
import { timeWindow } from './timeWindow.js';
import { ruleKey } from './port.js';
import type { LedgerTableRule } from './port.js';

function coverageFacts(receipts: readonly LedgerReceipt[]) {
  return {
    cut: receipts.filter(
      (receipt) =>
        receipt.cut !== undefined && (receipt.cut.tokensDropped > 0 || receipt.cut.bytesUnread > 0),
    ).length,
    limited: receipts.filter((receipt) => receipt.limit?.hit === true).length,
    nothingFound: receipts.filter((receipt) => receipt.nothingFound).length,
  };
}

export const timeWindowCoverage = {
  ...timeWindow,
  version: 2,
  facts: (input) => {
    const window = timeWindow.facts(input);
    const note = input.subject.kind === 'draft' ? undefined : input.subject.note;
    if (note?.claimStanding !== 'sure' || input.receipts.length === 0)
      return {
        ...window,
        facts: { ...window.facts, sure: false, gap: false, ...coverageFacts([]) },
      };

    // The pinned v1 projection already computes the half-open overlap and interval union.
    const overlapping = new Set(window.restsOn);
    const relevant =
      note.window === undefined
        ? input.receipts
        : input.receipts.filter(
            (receipt) => receipt.window === undefined || overlapping.has(receipt.seq),
          );
    const gap = note.window !== undefined && window.facts.uncoveredMs > 0;
    return {
      facts: { ...window.facts, sure: true, gap, ...coverageFacts(relevant) },
      restsOn: relevant.map((receipt) => receipt.seq),
    };
  },
  table: [
    {
      when: { sure: { eq: true }, cut: { gt: 0 } },
      then: 'unreachable',
      label: 'coverage: a cited receipt was cut',
    },
    {
      when: { sure: { eq: true }, limited: { gt: 0 } },
      then: 'unreachable',
      label: 'coverage: a cited receipt hit its row limit',
    },
    {
      when: { sure: { eq: true }, nothingFound: { gt: 0 } },
      then: 'unreachable',
      label: 'coverage: a cited search reported no result',
    },
    {
      when: { sure: { eq: true }, gap: { eq: true } },
      then: 'unreachable',
      label: 'coverage: cited windows do not establish the claimed extent',
    },
    {
      when: { sure: { eq: true } },
      then: 'not-applicable',
      label: 'coverage: no gap shown in the relevant citations',
    },
    ...timeWindow.table,
  ],
} satisfies LedgerTableRule;

export const COVERAGE_RULE_KEY = ruleKey(timeWindowCoverage);
