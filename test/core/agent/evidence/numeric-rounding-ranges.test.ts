import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../../../src/index.js';
import { mock } from '../../../../src/providers.js';
import type { NamesAndNumbersOptions } from '../../../../src/core/agent/evidence/types.js';
import { extractCandidates } from '../../../../src/core/agent/evidence/extract.js';
import { figureCheckOf, figureNumbersOf } from '../../../../src/core/agent/evidence/figures.js';
import { checkAnswer, resolveEvidenceGate } from '../../../../src/core/agent/evidence/gate.js';
import { evidenceFromHistory } from '../../../../src/core/agent/evidence/evidenceIndex.js';

const enabled = { decimalRounding: true } as NamesAndNumbersOptions;
const historyOf = (value: unknown) => [
  { role: 'user' as const, content: 'Read the measurements.' },
  { role: 'tool' as const, toolCallId: 'read-1', content: JSON.stringify(value) },
];
const judge = (answer: string, value: unknown, options: NamesAndNumbersOptions = enabled) => {
  const history = historyOf(value);
  const gate = resolveEvidenceGate(options);
  return checkAnswer(answer, {
    gate,
    evidence: evidenceFromHistory(history),
    exempt: new Set(),
    figures: figureCheckOf(answer, history, gate),
  });
};

describe('plain decimal rounding — opt in, one carried number only', () => {
  it.each(['5.20', '5.2', '1234.6'])(
    'grounds the field spelling %s with a named rounding',
    (answer) => {
      const verdict = judge(answer, { reading: answer.startsWith('5') ? 5.203 : 1234.56 });
      expect(verdict.unsupported).toEqual([]);
      expect(verdict.computed).toEqual([
        {
          value: answer === '5.20' ? '5.2' : answer,
          shape: 'number',
          derivation: 'rounded',
          from: `${answer.startsWith('5') ? '5.203' : '1234.56'} at reading`,
        },
      ]);
    },
  );

  it('rejects a wrong decimal, a whole-number approximation and an identifier', () => {
    expect(judge('5.3', { reading: 5.203 }).unsupported).toEqual([
      { value: '5.3', shape: 'number' },
    ]);
    expect(judge('1235', { reading: 1234.56 }).unsupported).toEqual([
      { value: '1235', shape: 'number' },
    ]);
    expect(judge('fc1.3', { reading: 1.299 }).unsupported).toEqual([
      { value: 'fc1.3', shape: 'identifier' },
    ]);
  });

  it('uses the precision written before normalization, including trailing zeroes', () => {
    expect(judge('5.20', { reading: 5.249 }).unsupported).toEqual([
      { value: '5.2', shape: 'number' },
    ]);
    expect(judge('5.2', { reading: 5.249 }).computed?.[0]?.derivation).toBe('rounded');
    expect(judge('5.0', { reading: 5.203 }).unsupported).toEqual([{ value: '5', shape: 'number' }]);
  });

  it('checks the strictest repeated precision and never rounds a declared numeric ID', () => {
    expect(judge('5.2 then 5.20', { reading: 5.249 }).unsupported).toHaveLength(1);
    expect(judge('5.20 then 5.2', { reading: 5.249 }).unsupported).toHaveLength(1);
    expect(judge('05.20 then 5.200', { reading: 5.203 }).unsupported).toHaveLength(1);
    const options = { ...enabled, shapes: [{ name: 'decimal-id', match: /\d+\.\d+/ }] };
    expect(judge('1234.6', { reading: 1234.56 }, options).unsupported).toEqual([
      { value: '1234.6', shape: 'decimal-id' },
    ]);
  });

  it('does not round unsafe large decimal spellings', () => {
    expect(judge('9007199254740992.1', { reading: 9007199254740992 }).unsupported).toHaveLength(1);
  });

  it('does not add bare sums, ratios, differences or unit scaling', () => {
    const rows = [
      { amount: 1234.2, used_tb: 2.2, total_tb: 5.1 },
      { amount: 1000.3, used_tb: 3.1, total_tb: 5.5 },
    ];
    for (const answer of ['2234.5', '50.0', '5.3', '1.2342']) {
      expect(judge(answer, { rows }).unsupported).toHaveLength(1);
    }
  });

  it('exact evidence wins and does not fabricate a derivation', () => {
    const verdict = judge('5.20', { reading: 5.2 });
    expect(verdict.grounded).toEqual([{ value: '5.2', forms: ['5.2'] }]);
    expect(verdict.computed).toEqual([]);
  });

  it('validates the opt-in at setup', () => {
    expect(() =>
      resolveEvidenceGate({ decimalRounding: 'yes' } as unknown as NamesAndNumbersOptions),
    ).toThrow(/decimalRounding must be a boolean/);
  });
});

describe('exactly two numeric range endpoints', () => {
  it.each(['0-13', '0–13'])('uses the ordinary short-number rule for %s', (answer) => {
    expect(extractCandidates(answer, resolveEvidenceGate())).toEqual([]);
    expect(extractCandidates(answer, resolveEvidenceGate({ minDigits: 1 }))).toEqual([
      { value: '0', shape: 'number', rangeToken: answer },
      { value: '13', shape: 'number', rangeToken: answer },
    ]);
  });

  it.each(['2-9ms', '2–9 ms', '2–9%'])(
    'applies the trailing measurement unit to both endpoints of %s',
    (answer) => {
      const gate = resolveEvidenceGate({ figures: true });
      expect(figureNumbersOf(answer)).toEqual(new Set(['2', '9']));
      expect(
        extractCandidates(answer, gate, figureNumbersOf(answer)).map(({ value, shape }) => ({
          value,
          shape,
        })),
      ).toEqual([
        { value: '2', shape: 'figure' },
        { value: '9', shape: 'figure' },
      ]);
    },
  );

  it('reports only the invented endpoint and rounds endpoints independently', () => {
    expect(judge('1000-9000', { start: 1000 }, {}).unsupported).toEqual([
      { value: '9000', shape: 'number' },
    ]);
    expect(
      judge('5.2–9.1', { low: 5.203, high: 9.114 }).computed?.map((v) => v.derivation),
    ).toEqual(['rounded', 'rounded']);
  });

  it('gives declared shapes priority over range heuristics', () => {
    const gate = resolveEvidenceGate({ shapes: [{ name: 'port-id', match: /\d+-\d+/ }] });
    expect(extractCandidates('1-13', gate)).toEqual([{ value: '1-13', shape: 'port-id' }]);
  });

  it.each(['2026-10-19', '10:00-10:10', '21:00:00:24', '1.2.3-4', '1-2-3', 'ORD-1-13'])(
    'does not split %s',
    (answer) => {
      expect(extractCandidates(answer, resolveEvidenceGate({ minDigits: 1 }))).toEqual([
        { value: answer.toLowerCase(), shape: 'identifier' },
      ]);
    },
  );

  it('keeps signed numbers exact, rejects malformed ranges and stays bounded on odd hyphen runs', () => {
    expect(extractCandidates('-1234--5678', resolveEvidenceGate()).map((c) => c.value)).toEqual([
      '-1234',
      '-5678',
    ]);
    expect(() =>
      extractCandidates('1'.repeat(5000) + '-'.repeat(20000), resolveEvidenceGate()),
    ).not.toThrow();
    expect(extractCandidates('1000-2000 '.repeat(21000), resolveEvidenceGate())).toHaveLength(2);
  });
});

it('records the rounded derivation in an actual mock run', async () => {
  const tool = defineTool({
    name: 'read_measurement',
    description: 'Read one measurement.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ reading: 5.203 }),
  });
  const provider = mock({
    respond: (request) =>
      request.messages.some((message) => message.role === 'tool')
        ? { content: 'The reading is 5.20.' }
        : { content: '', toolCalls: [{ id: 'read-1', name: 'read_measurement', args: {} }] },
  });
  const agent = Agent.create({ provider, model: 'mock' })
    .tool(tool)
    .namesAndNumbersFromEvidence(enabled)
    .build();
  const events: unknown[] = [];
  agent.on('agentfootprint.agent.evidence_checked', ({ payload }) => events.push(payload));
  await agent.run({ message: 'Read the measurement.' });
  expect(events).toContainEqual(
    expect.objectContaining({
      unsupported: [],
      computed: [
        { value: '5.2', shape: 'number', derivation: 'rounded', from: '5.203 at reading' },
      ],
    }),
  );
});
