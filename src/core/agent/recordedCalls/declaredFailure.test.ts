import { describe, expect, it } from 'vitest';
import { recordedDeclaredToolFailure } from './declaredFailure.js';
import { readToolSettlements } from './settlement.js';
import { toolSettlementOf } from '../honesty/settledToolCalls.js';
import type { LLMMessage } from '../../../provider-contract/types.js';

const declaration = {
  origin: 'declared',
  category: 'timeout',
  tryInstead: 'Use the replica.',
} as const;
const result: LLMMessage = {
  role: 'tool',
  content: 'Collector offline.',
  toolCallId: 'call',
  toolName: 'collector',
  callOccurrenceKey: [1, 2, 3, 4, 5],
  toolResultExecution: 'returned',
  outcome: 'failed',
  toolDeclaredFailure: declaration,
};

describe('a tool failure declaration is read from the committed occurrence', () => {
  it('reads the same declaration from the live history and the JSON settlement', () => {
    expect(recordedDeclaredToolFailure(result)).toEqual(declaration);
    const settlement = toolSettlementOf(result, []);
    const restored = readToolSettlements(JSON.parse(JSON.stringify([settlement])), true);
    expect(restored?.byKey.get('1.2.3.4.5')?.fact.declaredFailure).toEqual(declaration);
  });

  it('ignores declarations on any replaced or unserved result or throw', () => {
    expect(
      recordedDeclaredToolFailure({ ...result, toolResultDisposition: 'rewritten' }),
    ).toBeUndefined();
    expect(
      recordedDeclaredToolFailure({ ...result, toolResultDisposition: 'withheld' }),
    ).toBeUndefined();
    expect(
      recordedDeclaredToolFailure({ ...result, toolResultExecution: 'returned-unserved' }),
    ).toBeUndefined();
    expect(
      recordedDeclaredToolFailure({ ...result, toolResultExecution: 'threw' }),
    ).toBeUndefined();
    expect(recordedDeclaredToolFailure({ ...result, outcome: 'refused' })).toBeUndefined();
  });
});
