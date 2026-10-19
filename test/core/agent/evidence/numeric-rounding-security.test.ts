import { describe, expect, it } from 'vitest';
import { checkAnswer, resolveEvidenceGate } from '../../../../src/core/agent/evidence/gate.js';
import { evidenceFromHistory } from '../../../../src/core/agent/evidence/evidenceIndex.js';
import { figureCheckOf } from '../../../../src/core/agent/evidence/figures.js';
import { roundsTo } from '../../../../src/core/agent/evidence/numberPrecision.js';

const check = (answer: string, reading: string | number, match?: RegExp) => {
  const gate = resolveEvidenceGate({
    decimalRounding: true,
    ...(match && { shapes: [{ name: 'exact-source-id', match }] }),
  });
  const history = [
    { role: 'tool' as const, toolCallId: 'read-1', content: JSON.stringify({ reading }) },
  ];
  return checkAnswer(answer, {
    gate,
    evidence: evidenceFromHistory(history),
    exempt: new Set(),
    figures: figureCheckOf(answer, history, gate),
  });
};

describe('strict decimal precision after security review', () => {
  it.each([
    ['1.000000000001', 1],
    ['-1.000000000001', -1],
    ['5.200000000001', 5.2],
    ['-5.200000000001', -5.2],
    ['1.0000000000001', 1],
    ['-1.0000000000001', -1],
    ['0.000000000001', 0],
    ['-0.000000000001', 0],
    ['0.0000000000001', 0],
    ['-0.0000000000001', 0],
    ['0.00000000000001', 0],
    ['-0.00000000000001', 0],
  ] as const)('rejects invented low-order digits %s from %s', (answer, reading) => {
    expect(check(answer, reading).unsupported).toHaveLength(1);
    expect(check(answer, reading).computed).toEqual([]);
  });

  it.each([
    ['1.000000000001', 1.0000000000014],
    ['-1.000000000001', -1.0000000000014],
    ['0.000000000001', 0.0000000000014],
    ['-0.000000000001', -0.0000000000014],
    ['0.00000000000001', 0.000000000000014],
    ['-0.00000000000001', -0.000000000000014],
  ] as const)('keeps honest high-precision rounding %s from %s', (answer, reading) => {
    expect(check(answer, reading).unsupported).toEqual([]);
    expect(check(answer, reading).computed?.[0]?.derivation).toBe('rounded');
  });
});

it.each([
  ['5.2', '5.2500000000000001'],
  ['-5.2', '-5.2500000000000001'],
] as const)(
  'does not move a source across the half-unit boundary during Number conversion: %s ← %s',
  (answer, reading) => {
    expect(check(answer, reading).unsupported).toHaveLength(1);
  },
);

describe('original carried spelling must win before Number conversion', () => {
  it.each([
    ['1234.6', '1234.567890123456789', /1234\.567890123456789/],
    ['1.3', '000000000000001.3', /000000000000001\.3/],
    ['-1234.6', '-1234.567890123456789', /-1234\.567890123456789/],
    ['-1.3', '-000000000000001.3', /-000000000000001\.3/],
  ] as const)('never reinterprets declared source ID %s ← %s', (answer, reading, match) => {
    expect(check(answer, reading, match).unsupported).toHaveLength(1);
    expect(check(answer, reading, match).computed).toEqual([]);
  });
});

it('bounds retained spellings and decimal scales before BigInt arithmetic', () => {
  expect(check('1.3', '0'.repeat(256) + '1.3').unsupported).toHaveLength(1);
  expect(roundsTo(1, 1, 1e9, { source: '1', answer: '1.0' })).toBe(false);
  expect(roundsTo(1, 1, -1, { source: '1', answer: '1.0' })).toBe(false);
  expect(roundsTo(1, 1, 1, { source: '1e500', answer: '1.0' })).toBe(false);
  expect(roundsTo(1, 1, 1, { source: '0'.repeat(256) + '1', answer: '1.0' })).toBe(false);
});
