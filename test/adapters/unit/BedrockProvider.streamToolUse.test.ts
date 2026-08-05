/**
 * BedrockProvider — streamed tool-use accumulation (7.6.1 regression).
 *
 * The bug: `stream()` handled only `contentBlockDelta.delta.text` and
 * returned `toolCalls: []` hardcoded on the terminal chunk. An agent on
 * `bedrock()` with streaming enabled therefore saw `stopReason 'tool_use'`
 * with zero tool calls, and `route.ts` laundered that self-contradiction
 * into "LLM produced no tool calls — final answer". Tool calling via
 * bedrock() + streaming never worked; the non-streaming path was always
 * correct.
 *
 * These tests drive the exact ConverseStream event lists AWS emits through
 * an injected fake `_client` + `_commands` — zero AWS credentials, zero
 * network. Test types (Convention 3): unit / scenario / integration /
 * property / security / performance / ROI.
 */

import { describe, expect, it, vi } from 'vitest';

import { bedrock, type BedrockStreamEvent } from '../../../src/adapters/llm/BedrockProvider.js';
import type { LLMChunk, LLMProvider, LLMRequest } from '../../../src/adapters/types.js';
import { expectScalesLinearly } from '../../helpers/perf.js';

// ─── Fixtures ──────────────────────────────────────────────────────

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

const textOnlyResponse: FakeResponse = {
  output: { message: { role: 'assistant', content: [{ text: 'hello' }] } },
  stopReason: 'end_turn',
  usage: { inputTokens: 1, outputTokens: 1 },
};

/**
 * Unlike the existing `makeFakeFixtures` (which SYNTHESIZES a text-only
 * stream from a static response), this builder takes the exact
 * `BedrockStreamEvent[]` to replay — the point is to exercise the real
 * ConverseStream event shapes.
 */
function makeStreamFixtures(
  events: readonly BedrockStreamEvent[],
  nonStreamResponse: FakeResponse = textOnlyResponse,
) {
  const Converse = class {
    constructor(public input: unknown) {}
  };
  const ConverseStream = class {
    constructor(public input: unknown) {}
  };
  const client = {
    send: vi.fn(async (cmd: { constructor: unknown }) => {
      if (cmd.constructor === ConverseStream) {
        return {
          stream: (async function* () {
            for (const e of events) yield e;
          })(),
        };
      }
      return nonStreamResponse;
    }),
  };
  return { client, Commands: { Converse, ConverseStream } };
}

const baseRequest: LLMRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  model: 'bedrock',
};

// ─── ConverseStream event constructors ─────────────────────────────

const blockStart = (index: number, toolUseId: string, name: string): BedrockStreamEvent => ({
  contentBlockStart: { contentBlockIndex: index, start: { toolUse: { toolUseId, name } } },
});
const toolDelta = (index: number, input: string): BedrockStreamEvent => ({
  contentBlockDelta: { contentBlockIndex: index, delta: { toolUse: { input } } },
});
const textDelta = (index: number, text: string): BedrockStreamEvent => ({
  contentBlockDelta: { contentBlockIndex: index, delta: { text } },
});
const blockStop = (index: number): BedrockStreamEvent => ({
  contentBlockStop: { contentBlockIndex: index },
});
const messageStop = (stopReason: string): BedrockStreamEvent => ({ messageStop: { stopReason } });
const metadata = (inputTokens: number, outputTokens: number): BedrockStreamEvent => ({
  metadata: { usage: { inputTokens, outputTokens } },
});

function provider(events: readonly BedrockStreamEvent[], nonStream?: FakeResponse): LLMProvider {
  const fx = makeStreamFixtures(events, nonStream);
  return bedrock({ _client: fx.client, _commands: fx.Commands });
}

async function collect(p: LLMProvider, req: LLMRequest = baseRequest): Promise<LLMChunk[]> {
  const chunks: LLMChunk[] = [];
  for await (const c of p.stream!(req)) chunks.push(c);
  return chunks;
}

async function terminal(events: readonly BedrockStreamEvent[]) {
  const chunks = await collect(provider(events));
  const last = chunks[chunks.length - 1]!;
  expect(last.done).toBe(true);
  return last.response!;
}

// ─── Unit — a single streamed tool call ────────────────────────────

describe('BedrockProvider stream() — unit (single tool call)', () => {
  it('accumulates contentBlockStart + toolUse input fragments + contentBlockStop into one toolCall', async () => {
    const response = await terminal([
      blockStart(1, 't1', 'weather'),
      toolDelta(1, '{"cit'),
      toolDelta(1, 'y":"Paris"}'),
      blockStop(1),
      messageStop('tool_use'),
      metadata(12, 7),
    ]);

    expect(response.toolCalls).toEqual([{ id: 't1', name: 'weather', args: { city: 'Paris' } }]);
    expect(response.stopReason).toBe('tool_use');
    expect(response.usage).toEqual({ input: 12, output: 7 });
  });
});

// ─── Scenario — parallel tool calls interleave ─────────────────────

describe('BedrockProvider stream() — scenario (parallel tool calls)', () => {
  it('keys blocks by contentBlockIndex, so interleaved fragments do not cross-contaminate', async () => {
    const response = await terminal([
      blockStart(1, 't1', 'weather'),
      blockStart(2, 't2', 'stock'),
      // Fragments ALTERNATE between the two open blocks — this is the
      // shape that breaks any arrival-order accumulator.
      toolDelta(1, '{"city"'),
      toolDelta(2, '{"tick'),
      toolDelta(1, ':"Paris"}'),
      toolDelta(2, 'er":"AMZN"}'),
      blockStop(1),
      blockStop(2),
      messageStop('tool_use'),
      metadata(20, 9),
    ]);

    expect(response.toolCalls).toEqual([
      { id: 't1', name: 'weather', args: { city: 'Paris' } },
      { id: 't2', name: 'stock', args: { ticker: 'AMZN' } },
    ]);
  });
});

// ─── Unit — no-arg tools ───────────────────────────────────────────

describe('BedrockProvider stream() — unit (no-arg tools)', () => {
  it('start + immediate stop with zero deltas yields args {}', async () => {
    const response = await terminal([
      blockStart(1, 't1', 'now'),
      blockStop(1),
      messageStop('tool_use'),
    ]);
    expect(response.toolCalls).toEqual([{ id: 't1', name: 'now', args: {} }]);
  });

  it('a single empty-string input fragment also yields args {} (does not throw)', async () => {
    const response = await terminal([
      blockStart(1, 't1', 'now'),
      toolDelta(1, ''),
      blockStop(1),
      messageStop('tool_use'),
    ]);
    expect(response.toolCalls).toEqual([{ id: 't1', name: 'now', args: {} }]);
  });
});

// ─── Security — malformed tool-args JSON is typed, never swallowed ──

describe('BedrockProvider stream() — security (malformed tool-args JSON)', () => {
  it(
    'throws BEDROCK_MALFORMED_TOOL_ARGS instead of running the tool with dropped arguments',
    { timeout: 30_000, retry: 2 },
    async () => {
      const p = provider([
        blockStart(3, 'tool-use-99', 'transfer'),
        toolDelta(3, '{"a":'),
        blockStop(3),
        messageStop('tool_use'),
      ]);

      const seen: LLMChunk[] = [];
      let caught: (Error & { code?: string; toolName?: string; toolUseId?: string }) | undefined;
      try {
        for await (const c of p.stream!(baseRequest)) seen.push(c);
      } catch (e) {
        caught = e as Error & { code?: string };
      }

      expect(caught?.name).toBe('BedrockProviderError');
      expect(caught?.code).toBe('BEDROCK_MALFORMED_TOOL_ARGS');
      expect(caught?.toolName).toBe('transfer');
      expect(caught?.toolUseId).toBe('tool-use-99');
      // Tool arguments can carry user data and provider error messages land
      // in audit logs unredacted — the raw fragment must not be echoed.
      expect(caught?.message).not.toContain('{"a":');
      // Anti-regression: no terminal chunk with a fabricated `args: {}` was
      // yielded before the throw.
      expect(seen.some((c) => c.done)).toBe(false);
    },
  );

  it('is not re-wrapped by wrapError — the code and tool fields survive', async () => {
    const p = provider([
      blockStart(0, 't1', 'x'),
      toolDelta(0, 'not json'),
      blockStop(0),
      messageStop('tool_use'),
    ]);
    let caught: (Error & { code?: string }) | undefined;
    try {
      await collect(p);
    } catch (e) {
      caught = e as Error & { code?: string };
    }
    expect(caught?.code).toBe('BEDROCK_MALFORMED_TOOL_ARGS');
    // Double-prefixed "[bedrock] [bedrock] …" is the re-wrap signature.
    expect(caught?.message.startsWith('[bedrock] [bedrock]')).toBe(false);
  });
});

// ─── Integration — text and tool blocks together ───────────────────

describe('BedrockProvider stream() — integration (text + tool mixed)', () => {
  it('streams text chunks exactly as before AND parses the tool block', async () => {
    const chunks = await collect(
      provider([
        textDelta(0, 'look'),
        blockStart(1, 't1', 'weather'),
        textDelta(0, 'ing up'),
        toolDelta(1, '{"city":"Rome"}'),
        blockStop(1),
        messageStop('tool_use'),
        metadata(5, 3),
      ]),
    );

    const streamed = chunks.filter((c) => !c.done);
    expect(streamed.map((c) => c.content)).toEqual(['look', 'ing up']);
    // Unchanged streaming UX: tokenIndex still runs 0..n-1 over TEXT only
    // (tool fragments are not yielded as chunks — LLMChunk has no field
    // for them).
    expect(streamed.map((c) => c.tokenIndex)).toEqual([0, 1]);

    const response = chunks[chunks.length - 1]!.response!;
    expect(response.content).toBe('looking up');
    expect(response.toolCalls).toEqual([{ id: 't1', name: 'weather', args: { city: 'Rome' } }]);
  });
});

// ─── Property — stream / non-stream parity ─────────────────────────

describe('BedrockProvider — property (stream/non-stream parity)', () => {
  it('one logical response produces identical toolCalls through complete() and stream()', async () => {
    const nonStream: FakeResponse = {
      output: {
        message: {
          role: 'assistant',
          content: [
            { text: 'looking up' },
            { toolUse: { toolUseId: 't1', name: 'weather', input: { city: 'Paris' } } },
            { toolUse: { toolUseId: 't2', name: 'stock', input: { ticker: 'AMZN' } } },
          ],
        },
      },
      stopReason: 'tool_use',
      usage: { inputTokens: 31, outputTokens: 14 },
    };
    const events: BedrockStreamEvent[] = [
      textDelta(0, 'looking up'),
      blockStart(1, 't1', 'weather'),
      toolDelta(1, '{"city":"Paris"}'),
      blockStop(1),
      blockStart(2, 't2', 'stock'),
      toolDelta(2, '{"ticker":"AMZN"}'),
      blockStop(2),
      messageStop('tool_use'),
      metadata(31, 14),
    ];

    const p = provider(events, nonStream);
    const completed = await p.complete(baseRequest);
    const chunks = await collect(p);
    const streamed = chunks[chunks.length - 1]!.response!;

    // THE tripwire for the two paths drifting apart again.
    expect({
      content: streamed.content,
      toolCalls: streamed.toolCalls,
      stopReason: streamed.stopReason,
    }).toEqual({
      content: completed.content,
      toolCalls: completed.toolCalls,
      stopReason: completed.stopReason,
    });
    expect(streamed.usage).toEqual(completed.usage);
  });
});

// ─── Security — the honesty invariant ──────────────────────────────

describe('BedrockProvider — security (honesty invariant)', () => {
  it("stream(): stopReason 'tool_use' with no tool blocks throws BEDROCK_STREAM_TOOLUSE_LOST", async () => {
    const p = provider([textDelta(0, 'sure'), messageStop('tool_use'), metadata(2, 2)]);
    let caught: (Error & { code?: string }) | undefined;
    try {
      await collect(p);
    } catch (e) {
      caught = e as Error & { code?: string };
    }
    expect(caught?.name).toBe('BedrockProviderError');
    expect(caught?.code).toBe('BEDROCK_STREAM_TOOLUSE_LOST');
  });

  it("complete(): stopReason 'tool_use' with text-only content throws the same code", async () => {
    const p = provider([], {
      output: { message: { role: 'assistant', content: [{ text: 'sure' }] } },
      stopReason: 'tool_use',
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    let caught: (Error & { code?: string }) | undefined;
    try {
      await p.complete(baseRequest);
    } catch (e) {
      caught = e as Error & { code?: string };
    }
    expect(caught?.code).toBe('BEDROCK_STREAM_TOOLUSE_LOST');
  });

  it('inverse: end_turn with zero toolCalls still returns normally on both paths', async () => {
    const p = provider([textDelta(0, 'hello'), messageStop('end_turn'), metadata(1, 1)]);
    const response = await terminal([
      textDelta(0, 'hello'),
      messageStop('end_turn'),
      metadata(1, 1),
    ]);
    expect(response.toolCalls).toEqual([]);
    expect(response.stopReason).toBe('stop');
    await expect(p.complete(baseRequest)).resolves.toMatchObject({ toolCalls: [] });
  });
});

// ─── Unit — truncated wire data ────────────────────────────────────

describe('BedrockProvider stream() — unit (unclosed tool block)', () => {
  it('never emits a half-parsed call; the invariant catches the contradiction', async () => {
    // contentBlockStop NEVER arrives — truncated wire data.
    const p = provider([
      blockStart(1, 't1', 'weather'),
      toolDelta(1, '{"city":"Par'),
      messageStop('tool_use'),
    ]);
    let caught: (Error & { code?: string }) | undefined;
    try {
      await collect(p);
    } catch (e) {
      caught = e as Error & { code?: string };
    }
    expect(caught?.code).toBe('BEDROCK_STREAM_TOOLUSE_LOST');
  });
});

// ─── Performance ───────────────────────────────────────────────────

describe('BedrockProvider stream() — performance', () => {
  /** `blocks` interleaved tool blocks, ten fragments each. */
  function fragmentStream(blocks: number): BedrockStreamEvent[] {
    const events: BedrockStreamEvent[] = [];
    for (let i = 0; i < blocks; i++) events.push(blockStart(i, `t${i}`, `tool${i}`));
    for (let f = 0; f < 9; f++) {
      for (let i = 0; i < blocks; i++) events.push(toolDelta(i, ''));
    }
    for (let i = 0; i < blocks; i++) events.push(toolDelta(i, `{"i":${i}}`));
    for (let i = 0; i < blocks; i++) events.push(blockStop(i));
    events.push(messageStop('tool_use'));
    return events;
  }

  it(
    'accumulating 500 fragments costs ten times what 50 cost — no per-fragment rescan',
    { timeout: 30_000, retry: 2 },
    async () => {
      // Interleaved tool blocks are accumulated into per-index buffers. The
      // claim is that appending a fragment is O(1) in the number of fragments
      // already seen — a re-concat of the whole buffer per fragment would be
      // quadratic and would show up immediately at ten times the size.
      await expectScalesLinearly({
        small: async () => {
          await terminal(fragmentStream(5));
        },
        large: async () => {
          await terminal(fragmentStream(50));
        },
        scale: 10,
        why: 'interleaved fragment accumulation must not rescan per fragment',
      });

      // The correctness half, which no amount of machine load can move.
      const response = await terminal(fragmentStream(50));
      expect(response.toolCalls).toHaveLength(50);
      expect(response.toolCalls[49]).toEqual({ id: 't49', name: 'tool49', args: { i: 49 } });
    },
  );
});

// ─── ROI — works for any Bedrock-hosted model ──────────────────────

describe('BedrockProvider stream() — ROI (model-agnostic Converse API)', () => {
  it.each([
    ['anthropic.claude-sonnet-4-5-20250929-v1:0'],
    ['meta.llama3-3-70b-instruct-v1:0'],
    ['mistral.mistral-large-2407-v1:0'],
    ['amazon.nova-pro-v1:0'],
  ])('recovers streamed tool calls on model "%s"', async (model) => {
    const chunks = await collect(
      provider([
        blockStart(0, 'a', 'search'),
        toolDelta(0, '{"q":"x"}'),
        blockStop(0),
        messageStop('tool_use'),
      ]),
      { ...baseRequest, model },
    );
    expect(chunks[chunks.length - 1]!.response!.toolCalls).toEqual([
      { id: 'a', name: 'search', args: { q: 'x' } },
    ]);
  });
});
