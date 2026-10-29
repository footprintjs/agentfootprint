/**
 * With `decimalRounding` off, scientific notation reads exactly as it did
 * before the dial learned it. Captured from the unmodified main commit (the
 * fixture's `note`), not restated expectations: the corpus, the figures basis
 * and every verdict, byte for byte — scientific spellings in stdout, in JSON
 * strings and numbers, after a JSON value, identifier lookalikes and values
 * outside the bounds, under the default gate, `figures` and `minDigits: 1`.
 */
import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/numeric-scientific-off.json';
import { checkAnswer, resolveEvidenceGate } from '../../../../src/core/agent/evidence/gate.js';
import { evidenceFromHistory } from '../../../../src/core/agent/evidence/evidenceIndex.js';
import { figureBasisOf, figureCheckOf } from '../../../../src/core/agent/evidence/figures.js';
import type { LLMMessage } from '../../../../src/provider-contract/types.js';

const history = fixture.history as readonly LLMMessage[];

describe('scientific notation with decimalRounding off: byte-identical', () => {
  it('the corpus, built with the gate as the Route stage builds it, and without one', () => {
    for (const options of [{}, { decimalRounding: false }, { figures: true }, { minDigits: 1 }]) {
      for (const gate of [resolveEvidenceGate(options), undefined]) {
        const corpus = evidenceFromHistory(history, gate);
        expect(
          JSON.stringify({
            values: [...corpus.values],
            carriers: [...corpus.carriers],
            truncated: corpus.truncated,
            currentTurn: corpus.currentTurn,
            toolResultsThisTurn: corpus.toolResultsThisTurn,
          }),
        ).toBe(fixture.corpus);
      }
    }
  });

  it('the figures basis', () => {
    expect(JSON.stringify(figureBasisOf(history))).toBe(fixture.basis);
  });

  it.each(fixture.cases)('the verdict: $answer / $options', ({ answer, options, expected }) => {
    for (const explicitOff of [false, true]) {
      const gate = resolveEvidenceGate({
        ...options,
        ...(explicitOff && { decimalRounding: false }),
      });
      const verdict = checkAnswer(answer, {
        gate,
        evidence: evidenceFromHistory(history, gate),
        exempt: new Set(),
        ...(options.figures && { figures: figureCheckOf(answer, history, gate) }),
      });
      expect(JSON.stringify(verdict)).toBe(expected);
    }
  });
});
