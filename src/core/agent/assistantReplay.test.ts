import { describe, expect, it } from 'vitest';
import { modelTurnMessages, settledModelReply } from './assistantReplay.js';
import type { AgentState } from './types.js';

/** A state that lists every key it is asked about, the way a stage's scope records a read. */
function recording(values: Record<string, unknown>): { state: AgentState; asked: string[] } {
  const asked: string[] = [];
  const state = new Proxy(values, {
    has: (target, key) => {
      asked.push(String(key));
      return Reflect.has(target, key);
    },
    get: (target, key, receiver) => {
      asked.push(String(key));
      return Reflect.get(target, key, receiver);
    },
  });
  return { state: state as unknown as AgentState, asked };
}

const values = { userMessage: 'hi', finalContent: 'answer', modelReplyRunId: 'run-a' };
const withOrigin = {
  role: 'assistant',
  content: 'answer',
  replyOrigin: { kind: 'model', runId: 'run-a' },
};

describe('the reply origin is asked for only when the caller says so', () => {
  it('final stage: modelTurnMessages asks for modelReplyRunId only under hostEndedTurns', () => {
    const ordinary = recording(values);
    expect(modelTurnMessages(ordinary.state, false)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'answer' },
    ]);
    expect(ordinary.asked).not.toContain('modelReplyRunId');

    const hostEnded = recording(values);
    expect(modelTurnMessages(hostEnded.state, true)).toEqual([
      { role: 'user', content: 'hi' },
      withOrigin,
    ]);
    expect(hostEnded.asked).toContain('modelReplyRunId');
  });

  it('conversation owner: a plain saved state is asked and keeps the origin it holds', () => {
    expect(settledModelReply({ modelReplyRunId: 'run-a' }, 'answer', true)).toEqual(withOrigin);
    expect(settledModelReply({}, 'answer', true)).toEqual({ role: 'assistant', content: 'answer' });
  });
});
