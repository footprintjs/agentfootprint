import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../src/index.js';
import { bedrock, BedrockProvider } from '../../../src/adapters/llm/BedrockProvider.js';
import { cacheStrategyFor } from '../../../src/cache/cacheStrategyFor.js';
import { cacheRecorder } from '../../../src/cache/cacheRecorder.js';
import type { CacheMarker } from '../../../src/cache/types.js';
import type { LLMRequest, LLMResponse } from '../../../src/provider-contract/types.js';

const MODEL = 'anthropic.claude-sonnet-4-5-20250929-v1:0';
const mark = (
  field: CacheMarker['field'],
  boundaryIndex: number,
  ttl: 'short' | 'long' = 'short',
): CacheMarker => ({ field, boundaryIndex, ttl, reason: 'fixture' });

function fixture(
  usage: Record<string, number> | (() => Record<string, number>) = {
    inputTokens: 20,
    outputTokens: 3,
  },
) {
  class Converse {
    constructor(readonly input: unknown) {}
  }
  class ConverseStream {
    constructor(readonly input: unknown) {}
  }
  const send = vi.fn(async (command: unknown) => {
    const counts = typeof usage === 'function' ? usage() : usage;
    const response = {
      output: { message: { content: [{ text: 'ok' }] } },
      usage: counts,
      stopReason: 'end_turn',
    };
    if (command instanceof ConverseStream)
      return {
        stream: (async function* () {
          yield { contentBlockDelta: { delta: { text: 'ok' } } };
          yield { metadata: { usage: counts } };
        })(),
      };
    return response;
  });
  const options = { _client: { send }, _commands: { Converse, ConverseStream } };
  return {
    options,
    send,
    provider: bedrock(options),
    input: () => (send.mock.calls.at(-1)?.[0] as Converse).input as Record<string, unknown>,
  };
}

const request = (cacheMarkers: readonly CacheMarker[], model = MODEL): LLMRequest => ({
  model,
  systemPrompt: 'stable system',
  messages: [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'latest' },
  ],
  tools: [
    { name: 'one', description: 'first', inputSchema: {} },
    { name: 'two', description: 'second', inputSchema: {} },
  ],
  cacheMarkers,
});

describe('Bedrock Converse cache points', () => {
  it('places distinct union blocks after the marked system, tool and message boundaries', async () => {
    const fx = fixture();
    await fx.provider.complete(request([mark('system', 0), mark('tools', 0), mark('messages', 0)]));
    expect(fx.input().system).toEqual([
      { text: 'stable system' },
      { cachePoint: { type: 'default' } },
    ]);
    const tools = (fx.input().toolConfig as { tools: unknown[] }).tools;
    expect(tools).toHaveLength(3);
    expect(tools[1]).toEqual({ cachePoint: { type: 'default' } });
    const messages = fx.input().messages as { content: unknown[] }[];
    expect(messages[0].content).toEqual([{ text: 'first' }, { cachePoint: { type: 'default' } }]);
    expect(messages[2].content).toEqual([{ text: 'latest' }]);
  });

  it('preserves the exact content boundary when tool results merge into a user message', async () => {
    const fx = fixture();
    await fx.provider.complete({
      model: MODEL,
      messages: [
        { role: 'system', content: 'discarded' },
        { role: 'user', content: 'question' },
        { role: 'tool', content: 'result', toolCallId: 't' },
        { role: 'assistant', content: '' },
        { role: 'user', content: 'later' },
      ],
      cacheMarkers: [mark('messages', 1), mark('messages', 0), mark('messages', 3)],
    });
    expect((fx.input().messages as { content: unknown[] }[])[0].content).toEqual([
      { text: 'question' },
      { cachePoint: { type: 'default' } },
      { toolResult: { toolUseId: 't', content: [{ text: 'result' }] } },
    ]);
  });

  it('is capped at four unique valid checkpoints even for direct calls', async () => {
    const fx = fixture();
    await fx.provider.complete(
      request([
        mark('system', 0),
        mark('system', 0),
        mark('tools', -1),
        mark('messages', 99),
        mark('tools', 0),
        mark('tools', 1),
        mark('messages', 0),
        mark('messages', 1),
      ]),
    );
    expect(JSON.stringify(fx.input()).match(/"cachePoint"/g)).toHaveLength(4);
  });

  it.each(['meta.llama3-70b-instruct-v1:0', 'unknown', 'openai.gpt-6.1-sol', `${MODEL}-unknown`])(
    'never sends a checkpoint for unsupported model %s',
    async (model) => {
      const fx = fixture();
      await fx.provider.complete(request([mark('system', 0), mark('tools', 0)], model));
      expect(JSON.stringify(fx.input())).not.toContain('cachePoint');
      expect(cacheStrategyFor(fx.provider, model).name).toBe('none');
    },
  );

  it('honors each model field and TTL restriction without invalid wire parameters', async () => {
    const fx = fixture();
    await fx.provider.complete(
      request(
        [mark('system', 0, 'long'), mark('tools', 0), mark('messages', 0)],
        'amazon.nova-lite-v1:0',
      ),
    );
    expect(JSON.stringify(fx.input()).match(/"cachePoint"/g)).toHaveLength(2);
    expect(JSON.stringify(fx.input())).not.toContain('"ttl"');
    expect((fx.input().toolConfig as { tools: unknown[] }).tools).toHaveLength(2);
  });

  it('sends long TTL only on supported models, ordered before short checkpoints', async () => {
    const fx = fixture();
    await fx.provider.complete(request([mark('messages', 0, 'long'), mark('system', 0)]));
    // Wire order is tools → system → messages. A long checkpoint after a
    // short checkpoint is safely shortened; content is never reordered.
    expect(JSON.stringify(fx.input())).not.toContain('1h');
    await fx.provider.complete(request([mark('system', 0, 'long'), mark('messages', 0)]));
    expect(fx.input().system).toEqual([
      { text: 'stable system' },
      { cachePoint: { type: 'default', ttl: '1h' } },
    ]);
  });

  it('uses the same cache wire on ConverseStream', async () => {
    const fx = fixture();
    const req = request([mark('system', 0)]);
    await fx.provider.complete(req);
    const input = fx.input();
    for await (const _chunk of fx.provider.stream!(req)) {
      /* consume mocked stream */
    }
    expect(fx.input()).toEqual(input);
  });
});

describe('Bedrock cache usage and capabilities', () => {
  it('normalizes complete and stream counts without fabricating missing measurements', async () => {
    const fx = fixture({
      inputTokens: 20,
      outputTokens: 3,
      cacheReadInputTokens: 900,
      cacheWriteInputTokens: 100,
    });
    const expected = { input: 20, output: 3, cacheRead: 900, cacheWrite: 100 };
    expect((await fx.provider.complete(request([]))).usage).toEqual(expected);
    let response: LLMResponse | undefined;
    for await (const chunk of fx.provider.stream!(request([])))
      if (chunk.done) response = chunk.response;
    expect(response?.usage).toEqual(expected);
    const absent = fixture();
    expect((await absent.provider.complete(request([]))).usage).toEqual({ input: 20, output: 3 });
    expect(
      cacheStrategyFor(absent.provider, MODEL).extractMetrics({ input: 20, output: 3 }).kind,
    ).toBe('unknown');
  });

  it('resolves the factory shorthand and class capability identically', () => {
    const fx = fixture();
    expect(cacheStrategyFor(fx.provider, 'bedrock').name).toBe('breakpoints');
    expect(cacheStrategyFor(new BedrockProvider(fx.options), MODEL).name).toBe('breakpoints');
    expect(
      cacheStrategyFor(bedrock({ ...fx.options, defaultModel: 'unknown' }), 'bedrock').name,
    ).toBe('none');
    expect(cacheStrategyFor(fx.provider, `us.${MODEL}`).name).toBe('breakpoints');
  });

  it('the cache recorder reports a measured second-call prefix hit from the mocked SDK', async () => {
    let call = 0;
    const fx = fixture(() => ({
      inputTokens: 20,
      outputTokens: 3,
      cacheReadInputTokens: call++ === 0 ? 0 : 900,
      cacheWriteInputTokens: call === 1 ? 900 : 0,
    }));
    const meter = cacheRecorder({ strategy: cacheStrategyFor(fx.provider, MODEL), model: MODEL });
    const agent = Agent.create({ provider: fx.provider, model: MODEL })
      .system('stable', { cache: 'always' })
      .watch(meter)
      .build();
    await agent.run({ message: 'first' });
    await agent.run({ message: 'second' });
    expect(meter.report().cacheReadTokensTotal).toMatchObject({ kind: 'known', value: 900 });
    expect(meter.report().cacheWriteTokensTotal).toMatchObject({ kind: 'known', value: 900 });
    expect(meter.report().freshInputTokensTotal).toMatchObject({ kind: 'known', value: 40 });
    expect(meter.report().measuredIterations).toBe(2);
    expect(JSON.stringify(fx.input())).toContain('cachePoint');
  });

  it('keeps measured zero while malformed counters stay unknown on both transports', async () => {
    for (const counts of [
      { cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
      { cacheReadInputTokens: -1, cacheWriteInputTokens: NaN },
    ]) {
      const fx = fixture({ inputTokens: 1, outputTokens: 2, ...counts });
      const expected =
        counts.cacheReadInputTokens === 0
          ? { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }
          : { input: 1, output: 2 };
      expect((await fx.provider.complete(request([]))).usage).toEqual(expected);
      for await (const chunk of fx.provider.stream!(request([])))
        if (chunk.done) expect(chunk.response?.usage).toEqual(expected);
    }
  });
});
