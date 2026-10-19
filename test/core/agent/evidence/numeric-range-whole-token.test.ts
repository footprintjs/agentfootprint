import { expect, it } from 'vitest';
import { Agent, defineTool } from '../../../../src/index.js';
import { mock } from '../../../../src/doors/providers.js';
import { extractCandidates } from '../../../../src/core/agent/evidence/extract.js';
import { checkAnswer, resolveEvidenceGate } from '../../../../src/core/agent/evidence/gate.js';
import { evidenceFromHistory } from '../../../../src/core/agent/evidence/evidenceIndex.js';
import { groundedArgumentValues } from '../../../../src/core/agent/findings/contingent.js';

const GATE = resolveEvidenceGate();
const result = (value: string | number) => ({
  role: 'tool' as const,
  toolCallId: 'result-1',
  content: JSON.stringify({ value }),
});

it.each([
  ['ZIP+4', '12345-6789'],
  ['part', '1020-3040'],
  ['rack', '10-20'],
])('preserves the exact carried %s identifier as one whole claim: %s', (_kind, value) => {
  const evidence = evidenceFromHistory([result(value)]);
  const verdict = checkAnswer(value, { gate: GATE, evidence, exempt: new Set() });
  // These already passed before this fix: rangeToken met the intact corpus.
  expect(verdict.unsupported).toEqual([]);
  // The actual regression is identity/attribution: two endpoints or no claim.
  expect(verdict.grounded).toEqual([{ value, forms: [value] }]);
  expect(verdict.candidates).toBe(1);
  expect(verdict.lookedUp).toBe(1);
  expect(verdict.grounding.fromThisTurn).toBe(1);
});

it('splits an uncarried numeric range and flags only the unsupported endpoint', () => {
  const evidence = evidenceFromHistory([result(1200)]);
  const verdict = checkAnswer('1200-1350', { gate: GATE, evidence, exempt: new Set() });
  expect(verdict.unsupported).toEqual([{ value: '1350', shape: 'number' }]);
  expect(verdict.grounded).toEqual([{ value: '1200', forms: ['1200', '1200-1350'] }]);
  expect(verdict.candidates).toBe(2);
});

it('does not let a new endpoint rewrite the recorded age of an older intact identifier', () => {
  const history = [
    { role: 'user' as const, content: 'Read the identifier.' },
    result('1200-1350'),
    { role: 'user' as const, content: 'Read a separate count.' },
    result(1200),
  ];
  const evidence = evidenceFromHistory(history);
  const verdict = checkAnswer('1200-1350', { gate: GATE, evidence, exempt: new Set() });
  expect(verdict.grounded).toEqual([{ value: '1200-1350', forms: ['1200-1350'] }]);
  expect(verdict.grounding.fromThisTurn).toBe(0);
  expect(verdict.grounding.fromPriorTurns).toBe(1);
});

it('keeps the dispatch argument reader on the same whole-token rule', () => {
  const corpus = evidenceFromHistory([result('12345-6789')]);
  expect(groundedArgumentValues({ id: '12345-6789' }, GATE, corpus, new Set())).toEqual([
    { value: '12345-6789', forms: ['12345-6789'] },
  ]);
});

it('never treats one carried range as authority for another identifier', () => {
  const evidence = evidenceFromHistory([result('1200-1350')]);
  const verdict = checkAnswer('1200-9999', { gate: GATE, evidence, exempt: new Set() });
  expect(verdict.unsupported.map((value) => value.value)).toEqual(['1200', '9999']);
  expect(extractCandidates('1200-9999', GATE).map((value) => value.value)).toEqual([
    '1200',
    '9999',
  ]);
});

it.each(['12345-6789', '1020-3040', '10-20'])(
  'keeps one carried claim through the public agent facade: %s',
  async (value) => {
    const tool = defineTool({
      name: 'read_identifier',
      description: 'Read the identifier.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ identifier: value }),
    });
    const provider = mock({
      replies: [
        { content: '', toolCalls: [{ id: 'read-1', name: 'read_identifier', args: {} }] },
        { content: value },
      ],
    });
    const agent = Agent.create({ provider, model: 'mock' })
      .tool(tool)
      .namesAndNumbersFromEvidence()
      .build();
    const checks: unknown[] = [];
    agent.on('agentfootprint.agent.evidence_checked', ({ payload }) => checks.push(payload));
    expect(await agent.run({ message: 'Read the identifier.' })).toBe(value);
    expect(checks).toContainEqual(
      expect.objectContaining({
        action: 'grounded',
        unsupported: [],
        candidates: 1,
        lookedUp: 1,
        carriedBy: [{ toolCallId: 'read-1', values: 1, only: 1 }],
      }),
    );
  },
);
