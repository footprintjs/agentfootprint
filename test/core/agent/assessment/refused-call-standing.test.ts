import { describe, expect, it, vi } from 'vitest';
import { Agent, defineTool, deny, isInputPause } from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { assessAnswer } from '../../../../src/observe.js';

const TOOL = 'search_fixture_logs';
const BODY = 'Here is what I can report.';
const CALL_REFUSED = `${BODY}\n\n---\n\nNot sure — a call was refused.`;

function call(id: string, args: Record<string, unknown>) {
  return { id, name: TOOL, args };
}

describe('public standing of a refused call', () => {
  it.each([false, true])(
    'REGRESSION — a proposed window describes the call only if it ran (refused: %s)',
    async (refused) => {
      const execute = vi.fn(() => ({ count: 1 }));
      const builder = Agent.create({
        provider: mock({ replies: [{ toolCalls: [call('window', { window: '24h' })] }, BODY] }),
        model: 'mock',
      })
        .tool(
          defineTool({
            name: TOOL,
            description: 'Read fixture logs over a window.',
            inputSchema: { type: 'object', properties: { window: { type: 'string' } } },
            askOrAssume: { window: { assume: '2h' } },
            period: { argument: 'window', spelling: 'lookback' },
            execute,
          }),
        )
        .answerLayer({ standingLine: true });
      if (refused)
        builder.toolMiddleware({ name: 'deny_window', onToolCall: () => deny('Unavailable.') });

      const agent = builder.build();
      const answer = await agent.run({ message: 'Read the logs.' });
      expect(execute).toHaveBeenCalledTimes(refused ? 0 : 1);
      expect(agent.findings()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'argument', toolCallId: 'window', source: 'model' }),
        ]),
      );
      const saved = assessAnswer({ snapshot: agent.getLastSnapshot() });
      const reasons = refused
        ? ['call-not-completed']
        : ['argument-unverified', 'period-undeclared'];
      expect.soft(saved.reasons.map(({ reason }) => reason)).toEqual(reasons);
      expect.soft((await agent.assessment())?.reasons.map(({ reason }) => reason)).toEqual(reasons);
      if (refused) {
        expect.soft(answer).toBe(CALL_REFUSED);
      } else {
        expect(answer).toContain('a value a call ran with came from the model');
        expect(answer).toContain('a tool did not say what time its result covers');
      }
    },
  );

  it.each([false, true])(
    'REGRESSION — a protocol-refused batch contributes the refusal and no proposed input (refused: %s)',
    async (refused) => {
      const execute = vi.fn(() => 'Found one record.');
      const toolCalls = [call('first', { window: '4h' }), call(refused ? 'first' : 'second', {})];
      const agent = Agent.create({
        provider: mock({ replies: [{ toolCalls }, BODY] }),
        model: 'mock',
      })
        .tool(
          defineTool({
            name: TOOL,
            description: 'Read fixture logs over a chosen window.',
            inputSchema: {
              type: 'object',
              required: ['window'],
              properties: { window: { type: 'string' } },
            },
            askOrAssume: { window: { ask: 'Which window?', choices: ['2h', '4h'] } },
            execute,
          }),
        )
        .inputsLayer()
        .answerLayer({ standingLine: true })
        .build();
      const initial = await agent.run({ message: 'Check both fixture logs.' });
      expect(execute).not.toHaveBeenCalled();
      if (!refused) {
        if (!isInputPause(initial))
          throw new Error('Expected the valid batch to ask for its window.');
        const request = initial.awaitingInput;
        const answer = await agent.resume(initial.checkpoint, {
          requestId: request.requestId,
          values: { [request.fields[0]!.id]: '2h' },
        });
        expect(execute).toHaveBeenCalledTimes(2);
        expect(answer).toContain('a value a call ran with came from the model');
        expect((await agent.assessment())?.reasons.map(({ reason }) => reason)).toContain(
          'argument-unverified',
        );
        return;
      }

      expect(isInputPause(initial)).toBe(false);
      const state = agent.getSnapshot()?.sharedState;
      expect(state?.history.some(({ content }) => content.startsWith('[Tool batch refusal'))).toBe(
        true,
      );
      expect(state?.history.filter(({ role }) => role === 'tool')).toEqual([]);
      expect(agent.findings()).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'argument', source: 'model' })]),
      );
      const saved = assessAnswer({ snapshot: agent.getLastSnapshot() });
      expect.soft(saved.reasons.map(({ reason }) => reason)).toEqual(['call-not-completed']);
      expect.soft(initial).toBe(CALL_REFUSED);
    },
  );
});
