import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { accountForAnswer, recordRun } from '../../../src/observe.js';
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

  it('keeps a glued unit on the grouped token', () => {
    expect(resultCarries('host1,41,200ms,9ms', '41,200ms')).toBe('found');
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
