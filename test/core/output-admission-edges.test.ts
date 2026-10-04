import { describe, expect, it } from 'vitest';
import { Agent, MessageDeniedError, allow, coverage, defineTool, deny } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import {
  prepareFinalStage,
  prepareFinalWithAnswerLayerStage,
  prepareFinalWithLimitsAndAssumedStage,
  prepareFinalWithLimitsAsDataStage,
  prepareFinalWithLimitsInZoneStage,
  prepareFinalWithLimitsStage,
} from '../../src/core/agent/stages/prepareFinal.js';

const ledger = {
  checked: ['covered-source'],
  notChecked: [{ what: 'review-not-checked', why: 'not available' }],
  cannotCover: [],
} as const;

describe('regression: the executor owns stage arguments after scope', () => {
  const stages = [
    ['plain', prepareFinalStage],
    ['typed limits', prepareFinalWithLimitsAsDataStage],
    ['prose limits', prepareFinalWithLimitsStage],
    ['time limits', prepareFinalWithLimitsInZoneStage],
    ['assumed inputs', prepareFinalWithLimitsAndAssumedStage(false)],
    [
      'answer layer',
      prepareFinalWithAnswerLayerStage({
        validation: false,
        limitsAsData: false,
        limits: false,
        standingLine: false,
      }),
    ],
  ] as const;

  for (const [name, stage] of stages) {
    it(`${name}: an extra engine argument cannot opt into token release`, async () => {
      const events: { name: string; payload: unknown }[] = [];
      const scope: Record<string, unknown> = {
        iteration: 1,
        llmLatestContent: 'hello',
        userMessage: 'question',
        totalInputTokens: 1,
        totalOutputTokens: 1,
        turnStartMs: Date.now(),
        $getValue: (key: string) => scope[key],
        $emit: (event: string, payload: unknown) => events.push({ name: event, payload }),
      };

      await Reflect.apply(stage, undefined, [scope, { engineArgument: true }]);

      expect(events.filter((event) => event.name === 'agentfootprint.stream.token')).toEqual([]);
      expect(scope.finalContent).toBe('hello');
      expect(scope).not.toHaveProperty('answerValidationCommitted');
    });
  }
});

const choices = [
  'typed-limits',
  'limits',
  'limits-time',
  'limits-inputs',
  'standing',
  'standing-limits',
] as const;

for (const reactMode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
  describe(`integration: output admission with final composers (${reactMode})`, () => {
    for (const choice of choices) {
      for (const refused of [false, true]) {
        it(`${choice}: ${
          refused ? 'refusal releases nothing' : 'one token equals the captured answer'
        }`, async () => {
          const tool = defineTool({
            name: 'read',
            description: 'Local covered result',
            inputSchema: { type: 'object', properties: {} },
            execute: () => coverage({ count: 1 }, ledger),
          });
          const text = choice === 'typed-limits' ? ' {"count":1} ' : 'safe-model-answer';
          let policySaw: string | undefined;
          let builder = Agent.create({
            model: 'mock',
            reactMode,
            provider: mock({
              chunkDelayMs: 0,
              replies: [{ toolCalls: [{ id: 'c1', name: 'read', args: {} }] }, text],
            }),
          })
            .tool(tool)
            .act({
              output: [
                {
                  name: 'review-policy',
                  onMessage(message) {
                    policySaw = message.content;
                    return refused ? deny('stop') : allow();
                  },
                },
              ],
            });
          if (choice === 'typed-limits') {
            builder = builder
              .outputSchema({ parse: (value: unknown) => value })
              .limitsTravelWithTheAnswer();
          }
          if (choice === 'limits') builder = builder.limitsTravelWithTheAnswer();
          if (choice === 'limits-time') {
            builder = builder.time({ zone: 'UTC' }).limitsTravelWithTheAnswer();
          }
          if (choice === 'limits-inputs') {
            builder = builder.inputsLayer().limitsTravelWithTheAnswer();
          }
          if (choice === 'standing') builder = builder.answerLayer({ standingLine: true });
          if (choice === 'standing-limits') {
            builder = builder.answerLayer({ standingLine: true }).limitsTravelWithTheAnswer();
          }
          const agent = builder.build();
          const tokens: string[] = [];
          const turns: { finalContent: string; answerCoverage?: unknown }[] = [];
          const assessments: unknown[] = [];
          agent.on('agentfootprint.stream.token', (event) => tokens.push(event.payload.content));
          agent.on('agentfootprint.agent.turn_end', (event) => turns.push(event.payload));
          agent.on('agentfootprint.answer.assessed', (event) => assessments.push(event.payload));

          if (refused) {
            const error: unknown = await agent.run('hello').catch((caught: unknown) => caught);
            expect(
              error instanceof MessageDeniedError ||
                (error instanceof Error && error.cause instanceof MessageDeniedError),
            ).toBe(true);
            expect(tokens).toEqual([]);
            expect(turns).toEqual([]);
          } else {
            const value = await agent.run('hello');
            expect(tokens).toEqual([value]);
            expect(turns).toHaveLength(1);
            expect(turns[0]?.finalContent).toBe(value);
            if (choice.includes('limits') && choice !== 'typed-limits') {
              expect(value).toContain('review-not-checked');
            }
            if (choice === 'typed-limits') {
              expect(value).toBe(text);
              expect(turns[0]?.answerCoverage).toBeDefined();
            }
            if (choice.includes('standing')) {
              expect(assessments).toHaveLength(1);
              expect(value).not.toBe(text);
            }
          }
          // The framework still appends its own declared limits/standing after
          // the existing policy chain; do not claim the policy inspected them.
          expect(policySaw).toBe(text);
        });
      }
    }
  });
}
