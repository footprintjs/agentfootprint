import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../src/index.js';
import { bedrock } from '../../../src/adapters/llm/BedrockProvider.js';
import { cacheRecorder, cacheStrategyFor } from '../../../src/cache/index.js';
import {
  observeCacheCommands,
  requestAttempt,
} from '../../../src/provider-contract/requestObserver.js';
import {
  fixture as guardrailFixture,
  request as guardrailRequest,
} from './bedrockGuardrailFixtures.js';
import { receiptAt } from '../../../src/time-travel/servedView.js';
import { recordRun } from '../../../src/doors/observe.js';
import type {
  LLMCallHooks,
  LLMProvider,
  LLMRequest,
} from '../../../src/provider-contract/types.js';

const model = 'anthropic.claude-sonnet-4-5-20250929-v1:0';
const usage = {
  inputTokens: 10,
  outputTokens: 2,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 4,
};

function fixture(
  options: {
    missingStream?: boolean;
    throwAt?: 'constructor' | 'send';
    profiles?: Record<string, string>;
  } = {},
) {
  class Converse {
    constructor(readonly input: unknown) {
      if (options.throwAt === 'constructor') throw new Error('constructor failed');
    }
  }
  class ConverseStream {
    constructor(readonly input: unknown) {}
  }
  const send = vi.fn(async (command: unknown) => {
    if (options.throwAt === 'send') throw new Error('send failed');
    if (command instanceof ConverseStream) {
      if (options.missingStream) return {};
      return {
        stream: (async function* () {
          yield { contentBlockDelta: { delta: { text: 'done' } } };
          yield { metadata: { usage } };
          yield { messageStop: { stopReason: 'end_turn' } };
        })(),
      };
    }
    return { output: { message: { content: [{ text: 'done' }] } }, stopReason: 'end_turn', usage };
  });
  return {
    provider: bedrock({
      _client: { send },
      _commands: { Converse, ConverseStream },
      ...(options.profiles === undefined ? {} : { inferenceProfileModels: options.profiles }),
    }),
    send,
  };
}

function completeOnly(provider: LLMProvider): LLMProvider {
  const { stream: _stream, ...rest } = provider;
  return rest;
}

function agentOf(
  provider: LLMProvider,
  reactMode: 'dynamic' | 'dynamic-grouped' = 'dynamic',
  commitValues: 'full' | 'delta' = 'full',
  route = model,
  prefix = 'Hold this prefix',
) {
  return Agent.create({ model: route, provider, reactMode, commitValues })
    .system(prefix, { cache: 'always' })
    .build();
}

const prepared = (operation: 'Converse' | 'ConverseStream', ordinal = 1) => ({
  ordinal,
  operation,
  points: 2,
  reason: 'prepared',
  wire: 'unknown',
});

describe('Bedrock prepared cache commands in native receipts', () => {
  it.each([false, true])(
    'joins an authoritative response after attempt close (stream %s)',
    async (stream) => {
      const base = fixture();
      const agent = agentOf(stream ? base.provider : completeOnly(base.provider));
      try {
        expect(await agent.run({ message: 'go' })).toBe('done');
        expect(receiptAt(agent.getLastSnapshot(), 1)?.cache).toMatchObject({
          commandPreparations: [prepared(stream ? 'ConverseStream' : 'Converse')],
          acceptedCommand: 1,
        });
      } finally {
        await agent.shutdown();
      }
    },
  );

  it.each([
    { label: 'unchanged', field: 'cacheWrite', value: 4, cacheWrites: 4, command: 1 },
    { label: 'adjusted in place', field: 'cacheWrite', value: 9, cacheWrites: 9, command: null },
    {
      label: 'measured zero removed',
      field: 'cacheRead',
      value: undefined,
      cacheWrites: 4,
      command: null,
    },
    {
      label: 'unknown counter replaced by zero',
      field: 'thinking',
      value: 0,
      cacheWrites: 4,
      command: null,
    },
  ])(
    'links measured usage only when the counters are $label',
    async ({ field, value, cacheWrites, command }) => {
      const base = completeOnly(fixture().provider);
      const wrapped: LLMProvider = {
        ...base,
        async complete(request, hooks) {
          const response = await base.complete(request, hooks);
          if (value === undefined) Reflect.deleteProperty(response.usage, field);
          else Reflect.set(response.usage, field, value);
          return response;
        },
      };
      const meter = cacheRecorder({ strategy: cacheStrategyFor(wrapped, model), model });
      const agent = Agent.create({ provider: wrapped, model })
        .system('Hold this prefix', { cache: 'always' })
        .watch(meter)
        .build();
      try {
        expect(await agent.run({ message: 'go' })).toBe('done');
        expect(meter.report().cacheWriteTokensTotal).toMatchObject({
          kind: 'known',
          value: cacheWrites,
        });
        expect(receiptAt(agent.getLastSnapshot(), 1)?.cache).toMatchObject({
          commandPreparations: [prepared('Converse')],
          acceptedCommand: command,
        });
      } finally {
        await agent.shutdown();
      }
    },
  );

  it('names the fallback parent and attributes only the terminal command', async () => {
    const { provider } = fixture({ missingStream: true });
    const agent = agentOf(provider);
    try {
      await agent.run({ message: 'go' });
      expect(receiptAt(agent.getLastSnapshot(), 1)?.cache).toMatchObject({
        commandPreparations: [
          prepared('ConverseStream'),
          { ...prepared('Converse', 2), fallbackFrom: 1 },
        ],
        acceptedCommand: 2,
      });
    } finally {
      await agent.shutdown();
    }
  });

  it.each([
    ['constructor', 'dynamic', 'full'],
    ['send', 'dynamic', 'delta'],
    ['constructor', 'dynamic-grouped', 'full'],
    ['constructor', 'dynamic-grouped', 'delta'],
    ['send', 'dynamic-grouped', 'full'],
    ['send', 'dynamic-grouped', 'delta'],
  ] as const)(
    'keeps a preparation on a %s failure in %s (%s)',
    async (throwAt, reactMode, commitValues) => {
      const base = fixture({ throwAt });
      const agent = agentOf(completeOnly(base.provider), reactMode, commitValues);
      const recording = recordRun(agent);
      try {
        await expect(agent.run({ message: 'go' })).rejects.toThrow();
        const snapshot = JSON.parse(JSON.stringify(recording.toRecording().snapshot));
        expect(snapshot.commitValues).toBe(commitValues);
        const cache = receiptAt(snapshot, 1)?.cache;
        expect(cache?.commandPreparations).toEqual([prepared('Converse')]);
        expect(cache?.acceptedCommand).toBeUndefined();
        expect(base.send).toHaveBeenCalledTimes(throwAt === 'send' ? 1 : 0);
      } finally {
        recording.stop();
        await agent.shutdown();
      }
    },
  );

  it('observes no preparation when the request is already aborted', async () => {
    const { provider, send } = fixture();
    const observe = vi.fn();
    const scope = requestAttempt(observeCacheCommands({}, observe), guardrailRequest);
    try {
      await expect(
        provider.complete({ ...guardrailRequest, signal: AbortSignal.abort() }, scope.hooks),
      ).rejects.toThrow();
      expect(observe).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    } finally {
      scope.close();
    }
  });

  it('prepares a single guarded stream command if the SDK omits the stream', async () => {
    const { provider, send } = guardrailFixture({ missingStream: true });
    const accept = vi.fn();
    const observe = vi.fn(() => ({ id: Symbol(), response: accept }));
    const scope = requestAttempt(observeCacheCommands({}, observe), guardrailRequest);
    try {
      for await (const _chunk of provider.stream!(guardrailRequest, scope.hooks)) {
        /* Drain. */
      }
      expect(send).toHaveBeenCalledTimes(1);
      expect(observe).toHaveBeenCalledExactlyOnceWith({
        operation: 'ConverseStream',
        points: 0,
        reason: 'no-markers',
      });
      expect(accept).toHaveBeenCalledTimes(1);
    } finally {
      scope.close();
    }
  });

  it('records the reasons for unresolved routes and rejected boundaries', async () => {
    const { provider } = fixture();
    const observe = vi.fn();
    const scope = requestAttempt(observeCacheCommands({}, observe), guardrailRequest);
    const cacheMarkers = [
      { field: 'system', boundaryIndex: 42, ttl: 'short', reason: 'fixture' },
    ] as const;
    try {
      await provider.complete(
        { ...guardrailRequest, model: 'unresolved-model', cacheMarkers: [...cacheMarkers] },
        scope.hooks,
      );
      await provider.complete(
        { ...guardrailRequest, model, cacheMarkers: [...cacheMarkers] },
        scope.hooks,
      );
      expect(observe.mock.calls).toEqual([
        [{ operation: 'Converse', points: 0, reason: 'route-unresolved' }],
        [{ operation: 'Converse', points: 0, reason: 'boundaries-rejected' }],
      ]);
    } finally {
      scope.close();
    }
  });

  it('keeps command evidence invariant when private route, prompt and user text change', async () => {
    const preparations = [];
    for (const canary of ['private-canary-alpha', 'private-canary-bravo']) {
      const base = fixture({ profiles: { [canary]: model } });
      const agent = agentOf(
        completeOnly(base.provider),
        'dynamic-grouped',
        'delta',
        canary,
        canary,
      );
      try {
        await agent.run({ message: canary });
        const cache = receiptAt(agent.getLastSnapshot(), 1)?.cache;
        preparations.push({ rows: cache?.commandPreparations, accepted: cache?.acceptedCommand });
        expect(JSON.stringify(base.send.mock.calls)).toContain(canary);
      } finally {
        await agent.shutdown();
      }
    }
    expect(preparations).toEqual([
      { rows: [prepared('Converse')], accepted: 1 },
      { rows: [prepared('Converse')], accepted: 1 },
    ]);
  });

  it('caps preparations and keeps a later successful response unbound', async () => {
    const { provider, send } = fixture();
    const adapter = completeOnly(provider);
    const agent = agentOf({
      ...adapter,
      async complete(req, hooks) {
        let response = await adapter.complete(req, hooks);
        for (let index = 1; index < 17; index++) response = await adapter.complete(req, hooks);
        return response;
      },
    });
    try {
      await agent.run({ message: 'go' });
      expect(send).toHaveBeenCalledTimes(17);
      const cache = receiptAt(agent.getLastSnapshot(), 1)?.cache;
      expect(cache?.commandPreparations).toHaveLength(16);
      expect(cache?.commandOverflow).toBe(true);
      expect(cache?.acceptedCommand).toBeNull();
    } finally {
      await agent.shutdown();
    }
  });

  it('keeps preparation if an adapter wrapper replaces the response identity', async () => {
    const adapter = completeOnly(fixture().provider);
    const agent = agentOf({
      ...adapter,
      async complete(req: LLMRequest, hooks?: LLMCallHooks) {
        return { ...(await adapter.complete(req, hooks)) };
      },
    });
    try {
      await agent.run({ message: 'go' });
      expect(receiptAt(agent.getLastSnapshot(), 1)?.cache).toMatchObject({
        commandPreparations: [prepared('Converse')],
        acceptedCommand: null,
      });
    } finally {
      await agent.shutdown();
    }
  });
});
