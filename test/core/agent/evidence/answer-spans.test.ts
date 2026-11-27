import { describe, expect, it } from 'vitest';
import { readAnswer } from '../../../../src/core/agent/evidence/extract.js';
import { resolveEvidenceGate } from '../../../../src/core/agent/evidence/gate.js';

const gate = resolveEvidenceGate();

describe('answer candidate spans', () => {
  it('keeps UTF-16 coordinates across decoration, grouped digits and list commas', () => {
    const answer = '📊 **$41,200.** FC1/3,FC1/4.';
    const reading = readAnswer(answer, gate, { captureSpans: true });
    expect(reading.candidateSpans).toEqual([
      [6, 12],
      [16, 21],
      [22, 27],
    ]);
    expect(reading.candidates.map(({ value }) => value)).toEqual(['41200', 'fc1/3', 'fc1/4']);
    expect(Object.hasOwn(readAnswer(answer, gate), 'candidateSpans')).toBe(false);
  });

  it('locates numeric columns between text fields and keeps the grouped column whole', () => {
    const answer = '📊 **host1,1200,9750,9ms** and **host2,41,200,4ms**.';
    const reading = readAnswer(answer, gate, { captureSpans: true });
    expect(reading.candidates.map(({ value }) => value)).toEqual([
      'host1,1200,9750,9ms',
      '1200',
      '9750',
      'host2,41,200,4ms',
      '41200',
    ]);
    expect(reading.candidateSpans?.map((span) => span && answer.slice(...span))).toEqual([
      'host1,1200,9750,9ms',
      '1200',
      '9750',
      'host2,41,200,4ms',
      '41,200',
    ]);
  });

  it('uses the spelled endpoints rather than the unit synthesized for lookup', () => {
    const answer = 'The range is 4200–5700ms.';
    const split = readAnswer(answer, gate, { captureSpans: true });
    expect(split.candidateSpans?.map((span) => span && answer.slice(...span))).toEqual([
      '4200',
      '5700',
    ]);
    const whole = readAnswer(answer, gate, {
      captureSpans: true,
      exactTokens: new Set(['4200–5700ms']),
    });
    expect(whole.candidateSpans?.map((span) => span && answer.slice(...span))).toEqual([
      '4200–5700ms',
    ]);
  });

  it('carries the position of the stricter spelling that was actually checked', () => {
    const answer = 'First 5.2, then 5.20.';
    const reading = readAnswer(answer, resolveEvidenceGate({ decimalRounding: true }), {
      captureSpans: true,
    });
    expect(reading.candidates).toMatchObject([{ value: '5.2', decimalSpelling: '5.20' }]);
    expect(reading.candidateSpans?.map((span) => span && answer.slice(...span))).toEqual(['5.20']);
  });

  it('locates unescaped JSON values and leaves a decoded escape without a span', () => {
    const answer = String.raw`{"key4200":"\u0034200","raw":"FC1/3","other":9750}`;
    const reading = readAnswer(answer, gate, { captureSpans: true, typed: true });
    expect(reading.candidates.map(({ value }) => value)).toEqual(['4200', 'fc1/3', '9750']);
    expect(reading.candidateSpans?.map((span) => span && answer.slice(...span))).toEqual([
      undefined,
      'FC1/3',
      '9750',
    ]);
  });
});
