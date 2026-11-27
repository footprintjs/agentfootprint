import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { accountForAnswer, recordRun } from '../../../src/observe.js';
import type { ArgumentRow } from '../../../src/core/agent/arguments/rows.js';
import { resultCarries } from '../../../src/core/agent/evidence/resultCarries.js';

describe('comma-separated evidence', () => {
  it.each(['host-a,1200,9750,ok', 'host1,1200,9750,ok', 'host1,1200,9750,9ms', '1200,9750,9ms'])(
    'reads compact numeric columns in %s',
    (row) => {
      expect(resultCarries(row, 1200)).toBe('found');
      expect(resultCarries(row, 9750)).toBe('found');
      expect(resultCarries(row, 12009750)).toBe('not-found');
    },
  );

  it.each(['Total: 41,200 ms', 'host1,41,200,ok'])('keeps the grouped value in %s', (row) => {
    expect(resultCarries(row, 41200)).toBe('found');
    expect(resultCarries(row, 200)).toBe('not-found');
  });

  it('reads numeric columns before applying identifier aliases', () => {
    expect(resultCarries('0x123,456', 456)).toBe('found');
    expect(resultCarries('0x123,456', 123456)).toBe('not-found');
  });

  it('keeps a glued unit on the grouped token', () => {
    expect(resultCarries('Total: 41,200ms.', '41,200ms')).toBe('found');
    expect(resultCarries('host1,41,200ms,9ms', '41,200ms')).toBe('not-found');
    expect(resultCarries('host1,41,200ms,9ms', 41)).toBe('not-found');
  });

  it.each([
    { host: 'host-a', content: 'The readings are 1200 and 9750.', candidates: 2 },
    { host: 'host1', content: 'The readings are 1200 and 9750.', candidates: 2 },
    { host: 'host-a', content: 'The readings are 1200,9750.', candidates: 2 },
    { host: 'host1', content: 'The row is host1,1200,9750,ok.', candidates: 3 },
    { tail: '9ms', content: 'The readings are 1200 and 9750.', candidates: 2 },
    { tail: '9ms', content: 'The row is host1,1200,9750,9ms.', candidates: 3 },
    { content: 'Total: 41,200 ms. Ticket: svc-200.', candidates: 2 },
    { content: 'Ticket pair: 6500,8800.', candidates: 1 },
    { content: 'Node reference: node2,6400,8300.', candidates: 1 },
  ])(
    'carries the live verdict into the saved answer for $content',
    async ({ content, candidates, host = 'host1', tail = 'ok' }) => {
      const agent = Agent.create({
        provider: mock({
          replies: [
            { content: '', toolCalls: [{ id: 'row', name: 'read_row', args: {} }] },
            { content },
          ],
        }),
        model: 'mock',
      })
        .tool(
          defineTool({
            name: 'read_row',
            description: 'Read one synthetic row.',
            execute: () =>
              `${host},1200,9750,${tail}\nTotal: 41,200 ms. Ticket: svc-200. Ticket pair: 6500,8800. Node reference: node2,6400,8300.`,
          }),
        )
        .namesAndNumbersFromEvidence({
          posture: 'assist',
          shapes: [
            { name: 'ticket', match: /^svc-\d+$/ },
            { name: 'ticket-pair', match: /^6500,8800$/ },
            { name: 'node-reference', match: /^node2,6400,8300$/ },
          ],
        })
        .answerLayer()
        .build();

      const recorder = recordRun(agent);
      try {
        await agent.run({ message: 'Read the measurements.' });
        expect.soft(agent.unsupportedValues()).toBeUndefined();
        const saved = JSON.parse(JSON.stringify(recorder.toRecording()));
        expect(accountForAnswer(saved).facts.evidence.value).toMatchObject({
          action: 'grounded',
          candidates,
          unsupported: [],
        });
      } finally {
        recorder.stop();
        await agent.shutdown();
      }
    },
  );
});

describe('declared result sources for numeric columns and literal references', () => {
  it.each([
    { result: 'Reference: node2 6400 8300', value: 'node2,6400,8300', matched: false },
    { result: { reference: 'node2,6400,8300' }, value: 'node2 6400 8300', matched: false },
    { result: { reference: 'node2,6400,8300' }, value: 'node2,6400,8300', matched: true },
    { result: 'status: ready for review today', value: 'ready for review', matched: true },
    { result: 'node2,6400,8300,ok', value: '6400', matched: false },
    { result: 'node2,6400,8300,ok', value: 6400, matched: true },
    { result: { columns: 'node2,6400,8300,ok' }, value: 8300, matched: true },
    { result: 'Total: 41,200 ms', value: 41200, matched: true },
    { result: 'Total: 41,200 ms', value: 200, matched: false },
  ])(
    'pairs result $result with $value as a declared source',
    async ({ result, value, matched }) => {
      const fallback = typeof value === 'number' ? 0 : 'unknown';
      const agent = Agent.create({
        model: 'fixture',
        provider: mock({
          replies: [
            { content: '', toolCalls: [{ id: 'read', name: 'read_fixture', args: {} }] },
            {
              content: '',
              toolCalls: [
                {
                  id: 'use',
                  name: 'use_value',
                  args: {
                    value,
                    _findings: {
                      basis: 'direct',
                      from: [{ argument: 'value', source: 'result', id: 'read' }],
                    },
                  },
                },
              ],
            },
            'done',
          ],
        }),
      })
        .tool(
          defineTool({ name: 'read_fixture', description: 'Read fixture.', execute: () => result }),
        )
        .tool(
          defineTool({
            name: 'use_value',
            description: 'Use a recorded value.',
            inputSchema: { type: 'object', properties: { value: { type: typeof value } } },
            askOrAssume: { value: { assume: fallback } },
            execute: () => 'recorded',
          }),
        )
        .findings({ argumentSources: true })
        .build();

      try {
        await expect(agent.run({ message: 'Read and use the fixture value.' })).resolves.toMatch(
          /^done\b/,
        );
        const rows = (agent.findings() ?? []).filter(
          (row): row is ArgumentRow => row.kind === 'argument',
        );
        expect(rows.find((row) => row.toolCallId === 'use')).toMatchObject(
          matched
            ? { argument: 'value', source: 'result', claimed: 'result', result: 'read' }
            : { argument: 'value', claimed: 'result', failed: 'not-in-result' },
        );
      } finally {
        await agent.shutdown();
      }
    },
  );
});
