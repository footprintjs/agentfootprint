import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { accountForAnswer, recordRun } from '../../../src/observe.js';
import { resultCarries } from '../../../src/core/agent/evidence/resultCarries.js';

describe('comma-separated evidence', () => {
  it('reads compact numeric columns without taking fragments from a grouped value', () => {
    const row = 'host-a,1200,9750,ok';
    expect(resultCarries(row, 1200)).toBe('found');
    expect(resultCarries(row, 9750)).toBe('found');
    expect(resultCarries(row, 12009750)).toBe('not-found');
    expect(resultCarries('Total: 41,200 ms', 41200)).toBe('found');
    expect(resultCarries('Total: 41,200 ms', 200)).toBe('not-found');
  });

  it.each([
    { content: 'The readings are 1200 and 9750.', candidates: 2 },
    { content: 'The readings are 1200,9750.', candidates: 2 },
    { content: 'Total: 41,200 ms. Ticket: svc-200.', candidates: 2 },
    { content: 'Ticket pair: 6500,8800.', candidates: 1 },
  ])(
    'carries the live verdict into the saved answer for $content',
    async ({ content, candidates }) => {
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
              'host-a,1200,9750,ok\nTotal: 41,200 ms. Ticket: svc-200. Ticket pair: 6500,8800.',
          }),
        )
        .namesAndNumbersFromEvidence({
          posture: 'assist',
          shapes: [
            { name: 'ticket', match: /^svc-\d+$/ },
            { name: 'ticket-pair', match: /^6500,8800$/ },
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
