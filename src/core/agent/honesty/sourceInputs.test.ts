/** What the declared-sources checks are handed (`sourceInputs.ts`); end to end: `test/core/agent/arguments/sources-placed-receipt.test.ts`. */
import { describe, expect, it } from 'vitest';
import { sourceInputsOf } from './sourceInputs.js';

describe('sourceInputsOf', () => {
  it('hands the receipt beside the history, copied', () => {
    const placedTickets = [{ toolCallId: 't1', ref: 'art_1' }];
    const inputs = sourceInputsOf({ history: [], placedTickets });
    expect(inputs.placedTickets).toEqual(placedTickets);
    expect(inputs.placedTickets).not.toBe(placedTickets);
  });

  it('no receipt, no key; never the whole ledger', () => {
    const inputs = sourceInputsOf({
      history: [],
      findingsLedger: [{ kind: 'standing' }, { kind: 'argument', source: 'model' }],
    });
    expect('placedTickets' in inputs).toBe(false);
    expect(inputs.ledger).toEqual([{ kind: 'standing' }]);
  });
});
