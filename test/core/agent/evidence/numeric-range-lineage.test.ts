import { expect, it } from 'vitest';
import { checkAnswer, resolveEvidenceGate } from '../../../../src/core/agent/evidence/gate.js';
import {
  evidenceFromHistory,
  exemptFromRun,
} from '../../../../src/core/agent/evidence/evidenceIndex.js';

it('keeps the whole-token exemption when the person supplied a hyphen range', () => {
  const history = [{ role: 'user' as const, content: 'Inspect ports 1000-9000.' }];
  const verdict = checkAnswer('Ports 1000-9000 were requested.', {
    gate: resolveEvidenceGate(),
    evidence: evidenceFromHistory(history),
    exempt: exemptFromRun({ history }),
  });
  expect(verdict.unsupported).toEqual([]);
  expect(verdict.lookedUp).toBe(0);
});

it('can meet a literal tool-result range without widening the evidence index', () => {
  const history = [
    { role: 'tool' as const, toolCallId: 'r1', content: JSON.stringify({ range: '1000-9000' }) },
  ];
  const evidence = evidenceFromHistory(history);
  expect(evidence.values.has('1000')).toBe(false);
  const verdict = checkAnswer('Ports 1000-9000 were observed.', {
    gate: resolveEvidenceGate(),
    evidence,
    exempt: new Set(),
  });
  expect(verdict.unsupported).toEqual([]);
  expect(verdict.grounded.map((value) => value.value)).toEqual(['1000', '9000']);
});
