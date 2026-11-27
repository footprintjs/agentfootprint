import { expect, it } from 'vitest';

import { jsonBytes } from '../../../lib/boundedJson.js';
import { boundTurnEvidence } from './completedTurnBudget.js';

it('measures exact UTF-8 bytes and keeps evidence references whole', () => {
  const first = { reference: 'é"\u0001' };
  const second = { reference: '🎵'.repeat(20) };
  const partial = { runId: 'turn', facts: [first], gaps: ['result-truncated'] };
  const result = boundTurnEvidence(
    { runId: 'turn', facts: [second, first], gaps: [] },
    jsonBytes(partial),
  );
  expect(result).toEqual(partial);
  expect(jsonBytes(result)).toBe(jsonBytes(partial));
});

it('keeps an exact fit and never returns an oversized run identifier', () => {
  const result = { runId: 'turn', facts: [], gaps: [] };
  expect(boundTurnEvidence(result, jsonBytes(result))).toBe(result);
  expect(boundTurnEvidence({ ...result, runId: '漢'.repeat(4_000) })).toEqual({
    gaps: ['result-truncated'],
  });
});
