import { expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  type LLMMessage,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
} from '../../../src/index.js';
import { notApplicable, type CacheStrategy } from '../../../src/cache/index.js';

const firstCallId = 'count-first';
const firstResult = 'Counted 1.';
const input = 'Count twice.';

const tool = defineTool<{ n: number }, string>({
  name: 'count',
  description: 'Reports the given count.',
  inputSchema: {
    type: 'object',
    properties: { n: { type: 'integer' } },
    required: ['n'],
  },
  execute: ({ n }) => `Counted ${n}.`,
});

function firstToolCall(messages: readonly LLMMessage[]) {
  return messages
    .flatMap((message) => message.toolCalls ?? [])
    .find(({ id }) => id === firstCallId);
}

function firstToolResult(messages: readonly LLMMessage[]) {
  return messages.find((message) => message.role === 'tool' && message.toolCallId === firstCallId);
}

function userMessage(messages: readonly LLMMessage[]) {
  return messages.find((message) => message.role === 'user');
}

function firstExchange(messages: readonly LLMMessage[]) {
  return {
    arguments: firstToolCall(messages)?.args.n,
    result: firstToolResult(messages)?.content,
    user: userMessage(messages)?.content,
  };
}

function editRequest(messages: readonly LLMMessage[]): void {
  // Ordinary JavaScript adapters may edit request data in place.
  (firstToolCall(messages)!.args as { n: number }).n = 999;
  (firstToolResult(messages)! as { content: string }).content = 'Edited tool result.';
  (userMessage(messages)! as { content: string }).content = 'Edited user message.';
}

it.each(['complete', 'stream', 'stream fallback', 'reliability retry'] as const)(
  'adapter edits through %s stay within that model call',
  async (transport) => {
    const sameCallHandoff = transport === 'stream fallback' || transport === 'reliability retry';
    const seen: ReturnType<typeof firstExchange>[] = [];
    const answeredRequests: LLMRequest[] = [];
    const prepared: LLMRequest[] = [];
    let firstAttempt: LLMRequest | undefined;
    const cacheStrategy: CacheStrategy = {
      name: 'passthrough-fixture',
      async prepareRequest(request) {
        prepared.push(request);
        return { request, markersApplied: [] };
      },
      extractMetrics: () => notApplicable('fixture'),
    };

    function editFirstAttempt(request: LLMRequest): void {
      firstAttempt = request;
      editRequest(request.messages);
    }

    function respond(request: LLMRequest): LLMResponse {
      if (transport === 'reliability retry' && seen.length === 1 && firstAttempt === undefined) {
        editFirstAttempt(request);
        throw Object.assign(new Error('Service unavailable'), { status: 503 });
      }
      answeredRequests.push(request);
      seen.push(firstExchange(request.messages));
      if (seen.length === 2 && !sameCallHandoff) editRequest(request.messages);
      const toolCalls =
        seen.length <= 2
          ? [
              {
                id: seen.length === 1 ? firstCallId : 'count-second',
                name: 'count',
                args: { n: seen.length },
              },
            ]
          : [];
      return {
        content: toolCalls.length ? '' : 'Done.',
        toolCalls,
        usage: { input: 1, output: 1 },
        stopReason: toolCalls.length ? 'tool_use' : 'stop',
      };
    }

    const provider: LLMProvider = {
      name: 'editing-adapter',
      complete: async (request) => respond(request),
      ...((transport === 'stream' || transport === 'stream fallback') && {
        async *stream(request: LLMRequest) {
          if (transport === 'stream fallback') {
            if (seen.length === 1) editFirstAttempt(request);
            yield { tokenIndex: 0, content: '', done: true };
            return;
          }
          yield { tokenIndex: 0, content: '', done: true, response: respond(request) };
        },
      }),
    };
    const builder = Agent.create({
      provider,
      model: 'mock',
      ...(sameCallHandoff && { cacheStrategy }),
    }).tool(tool);
    if (transport === 'reliability retry') {
      builder.reliability({
        postDecide: [
          {
            when: (s) => s.errorKind === '5xx-transient' && s.attempt < 2,
            then: 'retry',
            kind: 'transient-retry',
          },
        ],
      });
    }
    const agent = builder.build();
    try {
      expect(await agent.run({ message: input })).toBe('Done.');
      expect(seen).toHaveLength(3);
      const untouched = { arguments: 1, result: firstResult, user: input };
      if (sameCallHandoff) {
        expect(prepared).toHaveLength(3);
        expect.soft(firstAttempt, 'first dispatch of the second model call').toBe(prepared[1]);
        expect
          .soft(answeredRequests[1], 'second dispatch of the same model call')
          .toBe(firstAttempt);
        expect.soft(seen[1], 'edits visible to the second dispatch').toEqual({
          arguments: 999,
          result: 'Edited tool result.',
          user: 'Edited user message.',
        });
      } else {
        expect(seen[1], 'second provider request before its edit').toEqual(untouched);
      }
      expect.soft(seen[2], 'third provider request').toEqual(untouched);
      const { history } = agent.getLastSnapshot()?.sharedState as {
        history: readonly LLMMessage[];
      };
      expect.soft(firstExchange(history), 'final recorded history').toEqual(untouched);
    } finally {
      await agent.shutdown();
    }
  },
);
