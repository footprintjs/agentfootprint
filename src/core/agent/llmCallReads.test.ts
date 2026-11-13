/** The read-only records that cross into `sf-llm-call` (`llmCallReads.ts`). */
import { describe, expect, it } from 'vitest';
import { llmCallReadsInto } from './llmCallReads.js';

describe('llmCallReadsInto', () => {
  it('crosses each record the parent holds, in a fixed order', () => {
    const parent = { placedTickets: [], findingsLedger: [], compactions: [], other: 1 };
    expect(Object.keys(llmCallReadsInto(parent))).toEqual([
      'compactions',
      'findingsLedger',
      'placedTickets',
    ]);
  });

  it('a parent that wrote none crosses no new key', () => {
    expect(llmCallReadsInto({ history: [] })).toEqual({});
  });
});
