import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../../../src/index.js';
import { NoOpCacheStrategy, type CacheStrategy } from '../../../../src/cache/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { recordRun } from '../../../../src/observe.js';
import { requestAttempt } from '../../../../src/provider-contract/requestObserver.js';
import type {
  LLMCallHooks,
  LLMMessage,
  LLMProvider,
  LLMRequest,
} from '../../../../src/provider-contract/types.js';
import type { ReliabilityConfig } from '../../../../src/reliability/types.js';
import { withFallback, withRetry } from '../../../../src/resilience/index.js';
import { epochLocations, readAfterCall } from '../../../../src/time-travel/index.js';

const key = 'sourceLinkServedRows';
const question = 'Read the complete label.';

async function record(
  provider: LLMProvider,
  {
    cacheStrategy,
    reliability,
  }: { cacheStrategy?: CacheStrategy; reliability?: ReliabilityConfig } = {},
) {
  const builder = Agent.create({
    provider,
    model: 'mock',
    ...(cacheStrategy !== undefined && { cacheStrategy }),
  });
  if (reliability !== undefined) builder.reliability(reliability);
  const agent = builder.build();
  const recorder = recordRun(agent);
  try {
    expect(await agent.run(question)).toBe('The label was recorded.');
    const epochs = epochLocations(recorder.toRecording().snapshot);
    expect(epochs).toHaveLength(1);
    const [epoch] = epochs;
    return {
      consumer: epoch!.callRuntimeStageId,
      rows: readAfterCall(epoch!, key) ?? [],
      writes: epoch!.log[epoch!.callIdx]!.trace.filter(({ path }) => path === key),
    };
  } finally {
    recorder.stop();
  }
}

describe('served rows at the provider port', () => {
  it.each([
    ['untouched message', true, (request: LLMRequest) => request],
    ['new request with the same messages', true, (request: LLMRequest) => ({ ...request })],
    [
      'new messages array',
      false,
      (request: LLMRequest) => ({ ...request, messages: [...request.messages] }),
    ],
    [
      'messages getter',
      false,
      (request: LLMRequest) =>
        Object.defineProperty({ ...request }, 'messages', { get: () => request.messages }),
    ],
    [
      'message appended to the same array',
      false,
      (request: LLMRequest) => {
        (request.messages as LLMMessage[]).push({ role: 'user', content: 'Extra.' });
        return request;
      },
    ],
    [
      'same message object with edited content',
      false,
      (request: LLMRequest) => {
        (request.messages[0] as { content: string }).content = 'Edited.';
        return request;
      },
    ],
    [
      'same message object with edited tool arguments',
      false,
      (request: LLMRequest) => {
        const call = request.messages.find((message) => message.toolCalls?.length)?.toolCalls?.[0];
        if (call !== undefined) (call.args as { q: { n: number } }).q.n = 999;
        return request;
      },
    ],
    [
      'same message object with edited tool result identity',
      false,
      (request: LLMRequest) => {
        const result = request.messages.find(({ role }) => role === 'tool');
        if (result !== undefined) (result as { toolCallId?: string }).toolCallId = 'different';
        return request;
      },
    ],
    ['provider edits a message after the port', true, (request: LLMRequest) => request, true],
  ] as const)(
    'records whole history at the port for %s',
    async (_name, keepsRow, prepare, postPort) => {
      const fixture = mock({
        replies: [
          { content: '', toolCalls: [{ id: 'c1', name: 'lookup', args: { q: { n: 1 } } }] },
          'The label was recorded.',
        ],
      });
      const agent = Agent.create({
        provider: {
          name: fixture.name,
          complete(request) {
            if (postPort) (request.messages[0] as { content: string }).content = 'After the port.';
            return fixture.complete(request);
          },
        },
        model: 'mock',
        cacheStrategy: {
          name: 'fixture-cache',
          extractMetrics: new NoOpCacheStrategy().extractMetrics,
          async prepareRequest(request, _markers, { iteration }) {
            return { request: iteration === 2 ? prepare(request) : request, markersApplied: [] };
          },
        },
      })
        .tool(
          defineTool({
            name: 'lookup',
            description: 'Read the label.',
            inputSchema: { type: 'object', properties: { q: { type: 'object' } } },
            execute: () => 'The complete label.',
          }),
        )
        .build();
      const recorder = recordRun(agent);
      try {
        expect(await agent.run(question)).toBe('The label was recorded.');
        const epochs = epochLocations(recorder.toRecording().snapshot);
        expect(epochs).toHaveLength(2);
        const [first, second] = epochs;
        const initialRows = readAfterCall(first!, key);
        expect(initialRows).toEqual([
          {
            kind: 'served',
            version: 1,
            consumer: first!.callRuntimeStageId,
            served: [{ key: 'history', elements: [[0, 1]] }],
          },
        ]);
        const retained = readAfterCall(second!, key);
        if (keepsRow) {
          expect(retained).toEqual([
            ...(initialRows as readonly unknown[]),
            {
              kind: 'served',
              version: 1,
              consumer: second!.callRuntimeStageId,
              served: [{ key: 'history', elements: [[0, 3]] }],
            },
          ]);
        } else {
          expect(retained).toEqual(initialRows);
          expect(second!.log[second!.callIdx]!.trace.some(({ path }) => path === key)).toBe(false);
        }
      } finally {
        recorder.stop();
      }
    },
  );

  it('writes one row when the same provider retries the same request', async () => {
    const fixture = mock({ reply: 'The label was recorded.' });
    const requests: LLMRequest[] = [];
    const provider = withRetry(
      {
        name: fixture.name,
        async complete(request) {
          requests.push(request);
          if (requests.length === 1) throw new Error('Try again');
          return fixture.complete(request);
        },
      },
      { maxAttempts: 2, initialDelayMs: 0, shouldRetry: () => true },
    );

    const { consumer, rows, writes } = await record(provider);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    expect(requests[1]?.messages).toEqual([{ role: 'user', content: question }]);
    expect(writes).toMatchObject([{ path: key }]);
    expect(rows).toEqual([
      { kind: 'served', version: 1, consumer, served: [{ key: 'history', elements: [[0, 1]] }] },
    ]);
  });

  it('drops the row when a reliability retry appends feedback to the request', async () => {
    const fixture = mock({ reply: 'The label was recorded.' });
    const requests: LLMRequest[] = [];
    const feedback = 'Repeat the complete label.';
    const { rows, writes } = await record(
      {
        name: fixture.name,
        async complete(request) {
          requests.push(request);
          if (requests.length === 1) throw new Error('Try again with feedback');
          return fixture.complete(request);
        },
      },
      {
        reliability: {
          postDecide: [
            {
              when: ({ attempt, error }) => attempt === 1 && error !== undefined,
              then: 'retry',
              kind: 'retry-once',
              feedbackForLLM: feedback,
            },
          ],
        },
      },
    );
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages).toEqual([
      ...requests[0]!.messages,
      { role: 'user', content: feedback, ephemeral: true },
    ]);
    expect(writes).toEqual([]);
    expect(rows).toEqual([]);
  });

  it('drops the row when fallback uses another provider with the same name and request', async () => {
    const fixture = mock({ reply: 'The label was recorded.' });
    const primaryRequests: LLMRequest[] = [];
    const fallbackRequests: LLMRequest[] = [];
    const provider = withFallback(
      {
        name: fixture.name,
        async complete(request) {
          primaryRequests.push(request);
          throw new Error('Primary is unavailable');
        },
      },
      {
        name: fixture.name,
        complete(request) {
          fallbackRequests.push(request);
          return fixture.complete(request);
        },
      },
    );

    const { rows, writes } = await record(provider);
    expect(primaryRequests).toHaveLength(1);
    expect(fallbackRequests).toEqual(primaryRequests);
    expect(writes).toEqual([]);
    expect(rows).toEqual([]);
  });

  it('drops the row when a cache strategy shortens an entry without replacing the array', async () => {
    const fixture = mock({ reply: 'The label was recorded.' });
    const requests: LLMRequest[] = [];
    const cacheStrategy: CacheStrategy = {
      name: 'fixture-cache',
      extractMetrics: new NoOpCacheStrategy().extractMetrics,
      async prepareRequest(request) {
        const mutable = request.messages as LLMMessage[];
        mutable[0] = { ...mutable[0]!, content: 'Short label.' };
        return { request, markersApplied: [] };
      },
    };

    const { rows, writes } = await record(
      {
        name: fixture.name,
        complete(request) {
          requests.push(request);
          return fixture.complete(request);
        },
      },
      { cacheStrategy },
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.messages).toEqual([{ role: 'user', content: 'Short label.' }]);
    expect(writes).toEqual([]);
    expect(rows).toEqual([]);
  });

  it('keeps the row when the closed stream reports a fallback during completion', async () => {
    const fixture = mock({ reply: 'The label was recorded.' });
    const requests: LLMRequest[] = [];
    let streamHooks: LLMCallHooks | undefined;
    const { rows } = await record({
      name: fixture.name,
      async *stream(request, hooks) {
        requests.push(request);
        streamHooks = hooks;
        yield { tokenIndex: 0, content: '', done: true };
      },
      complete(request) {
        requests.push(request);
        const late = requestAttempt(streamHooks, { ...request, model: 'stale' });
        late.close();
        streamHooks?.onResilience?.({
          kind: 'fell-back',
          primary: fixture.name,
          fallback: 'stale',
          reason: 'Stream already closed',
        });
        return fixture.complete(request);
      },
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    expect(rows).toHaveLength(1);
  });
});
