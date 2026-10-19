/** Captured from the unmodified main commit, not restated expectations. */
import { expect, it } from 'vitest';
import fixture from '../fixtures/numeric-rounding-off.json';
import { checkAnswer, resolveEvidenceGate } from '../../../../src/core/agent/evidence/gate.js';
import { evidenceFromHistory } from '../../../../src/core/agent/evidence/evidenceIndex.js';
import { figureCheckOf } from '../../../../src/core/agent/evidence/figures.js';
import type { LLMMessage } from '../../../../src/provider-contract/types.js';
const history = fixture.history as readonly LLMMessage[];
it.each(fixture.cases)(
  'keeps the pre-change verdict bytes with rounding off: $answer / $options',
  ({ answer, options, expected }) => {
    for (const explicitOff of [false, true]) {
      const gate = resolveEvidenceGate({
        ...options,
        ...(explicitOff && { decimalRounding: false }),
      });
      const verdict = checkAnswer(answer, {
        gate,
        evidence: evidenceFromHistory(history),
        exempt: new Set(),
        ...(options.figures && { figures: figureCheckOf(answer, history) }),
      });
      expect(JSON.stringify(verdict)).toBe(expected);
    }
  },
);
