/**
 * How a REFUSED answer ends a standalone run — the pins for what moved when a
 * refusal stopped breaking inside the Route decider (so a composition mounting
 * the chart reads the verdict, not the branch name):
 *
 * - The answer layer does not assess an answer that is never delivered: an
 *   answer-validation refusal, or a validated answer the output policy denied,
 *   emits no `answer.assessed` (the guard runs BEFORE AssessAnswer).
 * - The record keeps its bytes: a validation refusal leaves the agent's
 *   `finalContent` as it was (`''`), never `undefined`.
 * - An answer the evidence rails refused still rides `turn_end` for the record
 *   — the answer account explains the refusal from it — but carries
 *   `refused: { by: 'evidence-rails' }`, so no consumer shows it as the answer.
 */
import { describe, expect, it } from 'vitest';
import { Agent, defineTool, deny, type LLMProvider } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';

const MODES = ['classic', 'dynamic', 'dynamic-grouped'] as const;

function scripted(reply: string): LLMProvider {
  return {
    name: 'scripted',
    complete: async () => ({
      content: reply,
      toolCalls: [],
      usage: { input: 1, output: 1 },
      stopReason: 'end_turn',
    }),
  };
}

const validation = (disposition: 'checked-pass' | 'checked-fail') => ({
  id: 'n',
  version: '1',
  mode: 'enforce' as const,
  validate: () => ({ checks: [{ id: 'n', disposition }] }),
});

const lookup = defineTool({
  name: 'lookup',
  description: 'look it up',
  inputSchema: { type: 'object', properties: {} },
  execute: () => 'value 42',
});

function railsAgent(mode: (typeof MODES)[number], answer: string): Agent {
  return Agent.create({
    provider: mock({
      replies: [
        {
          content: '',
          toolCalls: [{ id: 't1', name: 'lookup', args: {} }],
          stopReason: 'tool_use',
        },
        { content: answer },
        { content: answer },
      ],
    }),
    model: 'mock',
    reactMode: mode,
    maxIterations: 8,
  })
    .tool(lookup)
    .namesAndNumbersFromEvidence({ posture: 'rails' })
    .build();
}

describe('a refused answer ends a standalone run without delivering it', () => {
  for (const mode of MODES) {
    it(`the answer layer never assesses an undelivered validated answer (${mode})`, async () => {
      for (const extra of [
        (b: ReturnType<typeof Agent.create>) => b.answerValidation(validation('checked-fail')),
        (b: ReturnType<typeof Agent.create>) =>
          b
            .answerValidation(validation('checked-pass'))
            .act({ output: [{ name: 'gate', onMessage: () => deny('no') }] }),
      ]) {
        const agent = extra(
          Agent.create({
            provider: scripted('{"n":1}'),
            model: 'mock',
            reactMode: mode,
            answerLayer: true,
          }).outputSchema({ parse: (value: unknown) => value }),
        ).build();
        let assessed = 0;
        agent.on('agentfootprint.answer.assessed', () => {
          assessed += 1;
        });
        await expect(agent.run('hi')).rejects.toThrow();
        expect(assessed).toBe(0);
      }
    });

    it(`a validation refusal leaves finalContent as it was (${mode})`, async () => {
      const agent = Agent.create({ provider: scripted('{"n":1}'), model: 'mock', reactMode: mode })
        .outputSchema({ parse: (value: unknown) => value })
        .answerValidation(validation('checked-fail'))
        .build();
      await expect(agent.run('hi')).rejects.toThrow();
      expect(agent.getLastSnapshot()?.sharedState.finalContent).toBe('');
    });

    it(`a rails-refused answer rides turn_end flagged refused (${mode})`, async () => {
      for (const [answer, refused] of [
        ['The port is ZZZ-999 with id 0xdeadbe.', true],
        ['The value is 42.', false],
      ] as const) {
        const agent = railsAgent(mode, answer);
        const ends: Record<string, unknown>[] = [];
        agent.on('agentfootprint.agent.turn_end', (e) => ends.push(e.payload as never));
        await agent.run('hi').catch(() => undefined);
        expect(ends).toHaveLength(1);
        expect(ends[0]!.finalContent).toBe(answer);
        if (refused) expect(ends[0]!.refused).toEqual({ by: 'evidence-rails' });
        else expect(ends[0]).not.toHaveProperty('refused');
      }
    });
  }
});
