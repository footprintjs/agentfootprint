import { describe, expect, it } from 'vitest';

import { Agent, allow, defineTool } from '../../../../src/index.js';
import type {
  AnswerAssessedPayload,
  AnswerAssessmentPayload,
} from '../../../../src/events/payloads/answer.js';
import { mock } from '../../../../src/llm-providers.js';

const ANSWER = 'The work is done.';
const DELIVERED = ANSWER + '\n\n---\n\nNot sure — a tool reported unfinished work.';

const submit = defineTool({
  name: 'submit',
  description: 'Submit a request for work.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => ({ content: 'Request received.', effects: [], status: 'pending' }),
});

describe.each(['default', 'explicit'] as const)(
  'SCENARIO — the %s standing line and streaming',
  (arm) => {
    it.each(['ordinary', 'output admission'] as const)('%s', async (stream) => {
      const builder = Agent.create({
        provider: mock({
          chunkDelayMs: 0,
          replies: [{ toolCalls: [{ id: 'c1', name: 'submit', args: {} }] }, ANSWER],
        }),
        model: 'mock',
      }).tool(submit);
      if (arm === 'explicit') {
        builder.answerLayer({ standingLine: { when: 'not-sure-or-ask' } });
      }
      if (stream === 'output admission') {
        builder.messageMiddleware({ name: 'pass-through', onMessage: () => allow() });
      }
      const agent = builder.build();
      const tokens: string[] = [];
      const final: { text: string; assessment?: AnswerAssessmentPayload }[] = [];
      const assessed: AnswerAssessedPayload[] = [];
      agent.on('agentfootprint.stream.token', ({ payload }) => tokens.push(payload.content));
      agent.on('agentfootprint.answer.assessed', ({ payload }) => assessed.push(payload));
      agent.on('agentfootprint.agent.turn_end', ({ payload }) =>
        final.push({ text: payload.finalContent, assessment: payload.answerAssessment }),
      );
      expect(await agent.run({ message: 'Please do the work.' })).toBe(DELIVERED);
      expect(assessed).toEqual([
        expect.objectContaining({
          turn: 1,
          iteration: 2,
          assessment: 'unknown',
          standing: 'not-sure',
          reasons: ['work-not-finished'],
        }),
      ]);
      expect(final).toEqual([
        {
          text: DELIVERED,
          assessment: {
            assessment: assessed[0]!.assessment,
            standing: assessed[0]!.standing,
            reasons: assessed[0]!.reasons,
            checked: assessed[0]!.checked,
          },
        },
      ]);
      if (stream === 'output admission') expect(tokens).toEqual([DELIVERED]);
      else expect(tokens.join('')).toBe(ANSWER);
    });
  },
);
