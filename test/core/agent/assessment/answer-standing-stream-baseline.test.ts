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

describe.each(['default', 'explicit', 'filtered'] as const)(
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
      const expected = arm === 'filtered' ? ANSWER : DELIVERED;
      if (arm !== 'default') {
        builder.answerLayer({
          standingLine: { when: 'not-sure-or-ask', ...(arm === 'filtered' && { raiseOn: [] }) },
        });
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
      expect(await agent.run({ message: 'Please do the work.' })).toBe(expected);
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
          text: expected,
          assessment: {
            assessment: assessed[0]!.assessment,
            standing: assessed[0]!.standing,
            reasons: assessed[0]!.reasons,
            checked: assessed[0]!.checked,
          },
        },
      ]);
      if (stream === 'output admission') expect(tokens).toEqual([expected]);
      else expect(tokens.join('')).toBe(ANSWER);
    });
  },
);

describe('SCENARIO — the standing line follows the output formatter', () => {
  const formatted = `<card>\n${ANSWER}\n</card>`;
  const withWarning = formatted + DELIVERED.slice(ANSWER.length);

  it.each([
    { mode: 'default', options: undefined, expected: withWarning },
    {
      mode: 'explicit',
      options: { standingLine: { when: 'not-sure-or-ask' } } as const,
      expected: withWarning,
    },
    {
      mode: 'data only',
      options: { standingLine: false } as const,
      expected: formatted,
    },
    { mode: 'layer off', options: false as const, expected: formatted },
  ])('$mode', async ({ options, expected }) => {
    const formatterInputs: string[] = [];
    const builder = Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        replies: [{ toolCalls: [{ id: 'c1', name: 'submit', args: {} }] }, ANSWER],
      }),
      model: 'mock',
    })
      .tool(submit)
      .messageMiddleware({
        name: 'card-formatter',
        onMessage({ phase, content }) {
          if (phase === 'input') return allow();
          formatterInputs.push(content);
          return allow(`<card>\n${content}\n</card>`, 'Format the text as a card.');
        },
      });
    const agent = (options === undefined ? builder : builder.answerLayer(options)).build();
    const tokens: string[] = [];
    const endings: { text: string; standing?: string }[] = [];
    const assessed: string[] = [];
    agent.on('agentfootprint.stream.token', ({ payload }) => tokens.push(payload.content));
    agent.on('agentfootprint.answer.assessed', ({ payload }) => assessed.push(payload.standing));
    agent.on('agentfootprint.agent.turn_end', ({ payload }) =>
      endings.push({ text: payload.finalContent, standing: payload.answerAssessment?.standing }),
    );

    expect(await agent.run({ message: 'Please do the work.' })).toBe(expected);
    expect(formatterInputs).toEqual([ANSWER]);
    expect(tokens).toEqual([expected]);
    const standing = options === false ? undefined : 'not-sure';
    expect(endings).toEqual([{ text: expected, standing }]);
    expect(assessed).toEqual(standing === undefined ? [] : [standing]);
  });
});
