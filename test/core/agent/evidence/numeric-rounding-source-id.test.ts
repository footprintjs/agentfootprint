import { expect, it } from 'vitest';
import { checkAnswer, resolveEvidenceGate } from '../../../../src/core/agent/evidence/gate.js';
import { evidenceFromHistory } from '../../../../src/core/agent/evidence/evidenceIndex.js';
import { figureCheckOf } from '../../../../src/core/agent/evidence/figures.js';

it.each([1234.56, '1234.56'])(
  'does not turn a declared source ID into a rounded measurement: %s',
  (reading) => {
    const gate = resolveEvidenceGate({
      decimalRounding: true,
      shapes: [{ name: 'exact-source-id', match: /1234\.56/ }],
    });
    const history = [
      { role: 'tool' as const, toolCallId: 'id-1', content: JSON.stringify({ reading }) },
    ];
    const verdict = checkAnswer('1234.6', {
      gate,
      evidence: evidenceFromHistory(history),
      exempt: new Set(),
      figures: figureCheckOf('1234.6', history, gate),
    });
    expect(verdict.unsupported).toEqual([{ value: '1234.6', shape: 'number' }]);
    expect(verdict.computed).toEqual([]);
  },
);
