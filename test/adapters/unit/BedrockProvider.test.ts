/**
 * BedrockProvider — 7-pattern tests.
 * Uses injected fake `_client` + `_commands` instead of AWS SDK.
 */

import { describe, expect, it, vi } from 'vitest';

import { bedrock, BedrockProvider } from '../../../src/adapters/llm/BedrockProvider.js';
import type { LLMRequest, LLMMessage } from '../../../src/adapters/types.js';

interface FakeResponse {
  output?: {
    message?: {
      role: 'assistant';
      content: Array<
        | { text: string }
        | { toolUse: { toolUseId: string; name: string; input: Record<string, unknown> } }
      >;
    };
  };
  stopReason?: string;
  usage?: { inputTokens: number; outputTokens: number };
  ResponseMetadata?: { RequestId: string };
}

function makeFakeFixtures(
  result: FakeResponse | ((p: unknown) => FakeResponse),
  recorder?: { commands: unknown[] },
) {
  // Synthesize a stream from the static text portion.
  const Converse = class {
    constructor(public input: unknown) {}
  };
  const ConverseStream = class {
    constructor(public input: unknown) {}
  };
  const client = {
    send: vi.fn(async (cmd: { input: unknown; constructor: unknown }) => {
      recorder?.commands.push(cmd);
      const final = typeof result === 'function' ? result(cmd.input) : result;
      if (cmd.constructor === ConverseStream) {
        const text =
          (final.output?.message?.content?.find((b) => 'text' in b) as { text: string } | undefined)
            ?.text ?? '';
        const events: Array<{
          contentBlockDelta?: { delta?: { text?: string } };
          messageStop?: { stopReason?: string };
          metadata?: { usage?: { inputTokens: number; outputTokens: number } };
        }> = [];
        for (const ch of text.split('')) {
          events.push({ contentBlockDelta: { delta: { text: ch } } });
        }
        events.push({ messageStop: { stopReason: final.stopReason ?? 'end_turn' } });
        if (final.usage) events.push({ metadata: { usage: final.usage } });
        return {
          stream: (async function* () {
            for (const e of events) yield e;
          })(),
        };
      }
      return final;
    }),
  };
  return { client, Commands: { Converse, ConverseStream } };
}

const baseResponse: FakeResponse = {
  output: {
    message: { role: 'assistant', content: [{ text: 'hello' }] },
  },
  stopReason: 'end_turn',
  usage: { inputTokens: 10, outputTokens: 2 },
  ResponseMetadata: { RequestId: 'req-1' },
};

const baseRequest: LLMRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  model: 'bedrock',
};

// ─── Unit ──────────────────────────────────────────────────────────

describe('BedrockProvider — unit', () => {
  it('provider name is "bedrock"', () => {
    const fx = makeFakeFixtures(baseResponse);
    expect(bedrock({ _client: fx.client, _commands: fx.Commands }).name).toBe('bedrock');
  });

  it('complete() normalizes inputTokens/outputTokens → input/output', async () => {
    const fx = makeFakeFixtures(baseResponse);
    const p = bedrock({ _client: fx.client, _commands: fx.Commands });
    const res = await p.complete(baseRequest);
    expect(res.content).toBe('hello');
    expect(res.usage).toEqual({ input: 10, output: 2 });
    expect(res.stopReason).toBe('stop');
    expect(res.providerRef).toBe('req-1');
  });

  it('translates "bedrock" model shorthand to defaultModel', async () => {
    const recorder = { commands: [] as unknown[] };
    const fx = makeFakeFixtures(baseResponse, recorder);
    const p = bedrock({
      defaultModel: 'anthropic.claude-haiku-4-5-v1:0',
      _client: fx.client,
      _commands: fx.Commands,
    });
    await p.complete(baseRequest);
    const cmd = recorder.commands[0] as { input: { modelId: string } };
    expect(cmd.input.modelId).toBe('anthropic.claude-haiku-4-5-v1:0');
  });

  it('class form behaves identically to factory', async () => {
    const fx = makeFakeFixtures(baseResponse);
    const provider = new BedrockProvider({ _client: fx.client, _commands: fx.Commands });
    const res = await provider.complete(baseRequest);
    expect(res.content).toBe('hello');
  });
});

// ─── Scenario — tool round-trip ────────────────────────────────────

describe('BedrockProvider — scenario (tool round-trip)', () => {
  it('builds toolUse blocks from LLMMessage.toolCalls; tool messages map to toolResult', async () => {
    const recorder = { commands: [] as unknown[] };
    const fx = makeFakeFixtures(baseResponse, recorder);
    const p = bedrock({ _client: fx.client, _commands: fx.Commands });

    const history: LLMMessage[] = [
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: 'looking up',
        toolCalls: [{ id: 'c1', name: 'weather', args: { city: 'SF' } }],
      },
      { role: 'tool', content: '72F', toolCallId: 'c1' },
    ];
    await p.complete({ ...baseRequest, messages: history });

    const cmd = recorder.commands[0] as {
      input: { messages: Array<{ role: string; content: Array<Record<string, unknown>> }> };
    };
    const asst = cmd.input.messages[1]!;
    expect(asst.role).toBe('assistant');
    expect(asst.content[0]).toEqual({ text: 'looking up' });
    expect(asst.content[1]).toEqual({
      toolUse: { toolUseId: 'c1', name: 'weather', input: { city: 'SF' } },
    });
    const trMsg = cmd.input.messages[2]!;
    expect(trMsg.role).toBe('user');
    expect(trMsg.content[0]).toEqual({
      toolResult: { toolUseId: 'c1', content: [{ text: '72F' }] },
    });
  });
});

// ─── Integration — stream ──────────────────────────────────────────

describe('BedrockProvider — integration (stream)', () => {
  it('yields per-character text deltas then a terminal chunk with usage', async () => {
    const fx = makeFakeFixtures(baseResponse);
    const p = bedrock({ _client: fx.client, _commands: fx.Commands });
    const chunks: { content: string; done: boolean }[] = [];
    let final: { usage: { input: number; output: number }; stopReason: string } | undefined;
    for await (const c of p.stream!(baseRequest)) {
      chunks.push({ content: c.content, done: c.done });
      if (c.done && c.response) {
        final = { usage: c.response.usage, stopReason: c.response.stopReason };
      }
    }
    expect(chunks.length).toBe('hello'.length + 1);
    expect(final).toEqual({ usage: { input: 10, output: 2 }, stopReason: 'stop' });
  });
});

// ─── Property ──────────────────────────────────────────────────────

describe('BedrockProvider — property', () => {
  it('systemPrompt always lives in `system` field, never in messages', async () => {
    const recorder = { commands: [] as unknown[] };
    const fx = makeFakeFixtures(baseResponse, recorder);
    const p = bedrock({ _client: fx.client, _commands: fx.Commands });
    await p.complete({ ...baseRequest, systemPrompt: 'You are concise.' });
    const cmd = recorder.commands[0] as {
      input: { system?: Array<{ text: string }>; messages: Array<{ role: string }> };
    };
    expect(cmd.input.system).toEqual([{ text: 'You are concise.' }]);
    expect(cmd.input.messages.every((m) => m.role !== 'system')).toBe(true);
  });

  it('toolCalls.args round-trip preserves nested structure exactly', async () => {
    const recorder = { commands: [] as unknown[] };
    const fx = makeFakeFixtures(baseResponse, recorder);
    const p = bedrock({ _client: fx.client, _commands: fx.Commands });
    const args = { nested: { deep: [1, { k: 'v' }] }, str: 'x' };
    await p.complete({
      ...baseRequest,
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'fn', args }] },
        { role: 'tool', content: 'ok', toolCallId: 'c1' },
      ],
    });
    const cmd = recorder.commands[0] as {
      input: { messages: Array<{ content: unknown[] }> };
    };
    const block = (cmd.input.messages[1]!.content as Array<{ toolUse?: { input: unknown } }>).find(
      (b) => 'toolUse' in b,
    );
    expect(block?.toolUse?.input).toEqual(args);
  });
});

// ─── Security ──────────────────────────────────────────────────────

describe('BedrockProvider — security', () => {
  it('wraps SDK errors with httpStatusCode and "bedrock" tag', async () => {
    const broken = {
      send: () => {
        throw Object.assign(new Error('AccessDeniedException'), {
          $metadata: { httpStatusCode: 403 },
        });
      },
    };
    const Commands = {
      Converse: class {
        constructor(public input: unknown) {}
      },
      ConverseStream: class {
        constructor(public input: unknown) {}
      },
    } as never;
    const p = bedrock({ _client: broken as never, _commands: Commands });
    let caught: Error | undefined;
    try {
      await p.complete(baseRequest);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.name).toBe('BedrockProviderError');
    expect(caught?.message).toContain('AccessDeniedException');
    expect((caught as { status?: number }).status).toBe(403);
  });

  it('content_filtered stop reason normalizes to content_filter', async () => {
    const filtered: FakeResponse = { ...baseResponse, stopReason: 'content_filtered' };
    const fx = makeFakeFixtures(filtered);
    const p = bedrock({ _client: fx.client, _commands: fx.Commands });
    const res = await p.complete(baseRequest);
    expect(res.stopReason).toBe('content_filter');
  });
});

// ─── Performance ───────────────────────────────────────────────────

describe('BedrockProvider — performance', () => {
  it('1000 complete() calls under 500ms with fake client', async () => {
    const fx = makeFakeFixtures(baseResponse);
    const p = bedrock({ _client: fx.client, _commands: fx.Commands });
    const start = performance.now();
    for (let i = 0; i < 1000; i++) await p.complete(baseRequest);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});

// ─── ROI — multi-vendor model ids ──────────────────────────────────

describe('BedrockProvider — ROI (any Bedrock-hosted model)', () => {
  it.each([
    ['anthropic.claude-sonnet-4-5-20250929-v1:0'],
    ['meta.llama3-3-70b-instruct-v1:0'],
    ['mistral.mistral-large-2407-v1:0'],
    ['amazon.nova-pro-v1:0'],
  ])('passes model id "%s" through unchanged', async (modelId) => {
    const recorder = { commands: [] as unknown[] };
    const fx = makeFakeFixtures(baseResponse, recorder);
    const p = bedrock({ _client: fx.client, _commands: fx.Commands });
    await p.complete({ ...baseRequest, model: modelId });
    expect((recorder.commands[0] as { input: { modelId: string } }).input.modelId).toBe(modelId);
  });
});
