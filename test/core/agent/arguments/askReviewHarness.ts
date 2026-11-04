import {
  Agent,
  isInputPause,
  isPaused,
  type AgentOutput,
  type RunnerPauseOutcome,
} from '../../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../../src/provider-contract/types.js';
export type Call = { id: string; name: string; args: Readonly<Record<string, unknown>> };

export type Reply = { content: string; toolCalls?: Call[] };

export function scripted(script: readonly Reply[]) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'ask-review-mock',
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        requests.push(req);
        const reply = script[Math.min(i, script.length - 1)] ?? { content: 'done' };
        i += 1;
        return {
          content: reply.content,
          toolCalls: reply.toolCalls ?? [],
          usage: { input: 0, output: 0 },
          stopReason: reply.toolCalls !== undefined ? 'tool_use' : 'end_turn',
        };
      },
    },
  };
}

export const batch = (...calls: Call[]): Reply => ({
  content: '',
  toolCalls: calls,
});

export const answer = (content: string): Reply => ({ content });

export type Event = { type: string; payload: Record<string, unknown> };

export function events(runner: { on: Agent['on'] }): Event[] {
  const out: Event[] = [];
  runner.on('*', (e) => out.push({ type: e.type, payload: e.payload as never }));
  return out;
}

export const replyTo = (out: AgentOutput | RunnerPauseOutcome, values: Record<string, unknown>) => {
  if (!isInputPause(out)) throw new Error(`expected an input pause, got ${JSON.stringify(out)}`);
  return { requestId: out.awaitingInput.requestId, values };
};

export const stored = (out: AgentOutput | RunnerPauseOutcome) => {
  if (!isPaused(out)) throw new Error('expected a pause');
  return JSON.parse(JSON.stringify(out.checkpoint)) as RunnerPauseOutcome['checkpoint'];
};
