/**
 * llm-ledger/rules/cited — `cited@1`: a claim or a ruled-out note cites a receipt of this session.
 *
 * Pattern: a table rule (`rules/port.ts`). One fact, `cites`; one row.
 * Role:    the weakest check there is: it sees the note's `cites`, never whether a receipt is
 *          about the claim. Its finding rests on the cited receipts.
 * Emits:   N/A.
 */
import type { LedgerTableRule } from './port.js';

export const cited: LedgerTableRule = {
  id: 'cited',
  version: 1,
  appliesTo: ['claim', 'ruled-out', 'disclosed-gap'],
  facts: (input) => {
    const cites = input.subject.kind === 'draft' ? [] : input.subject.note.cites;
    return { facts: { cites: cites.length }, restsOn: cites };
  },
  table: [{ when: { cites: { eq: 0 } }, then: 'checked-fail', label: 'cites no receipt' }],
  default: { branch: 'checked-pass', label: 'cites a receipt of its session' },
};
