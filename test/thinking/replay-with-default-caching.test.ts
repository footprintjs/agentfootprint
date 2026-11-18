/**
 * Saved thinking is checked against what was sent, not against the cache
 * marks (finding r3-59-adapters-llm-1).
 *
 * WHY: with default caching, `anthropicCacheWire.ts · applyCacheMarkers` turns
 * a string turn into a one-block array to carry `cache_control`. The thinking
 * replay binding used to digest that MARKED body, while the check
 * (`anthropicThinkingReplay.ts · inconsistency`) re-projects the history with
 * no marks — so the two never matched on the models that bind thinking to the
 * prefix. An agent with thinking and a tool stopped before its second call
 * with `UnsafeThinkingReplayError: prefix-changed`, and a completed thinking
 * turn was dropped from the next request for that same false reason.
 *
 * What this exercises: a real `Agent` (default options, so caching is ON)
 * through the package's own `anthropic()` adapter, over a stub SDK client that
 * keeps every wire body and answers from a script — both the streaming path
 * (what an agent uses by default) and `complete`. The adapter, the cache
 * decision, the replay check and the binding are all the shipped code; only
 * the SDK client is scripted. What only a real model call would show: that
 * Anthropic's server accepts these replayed signatures (the stub signatures
 * are not real ones) — this test proves the library no longer refuses or
 * drops them on its own false reading.
 *
 * Records saved before the fix still pass: `fixtures/replay-records.main.json`
 * was made with main's code (the commit it names in `producedBy`) — each
 * saved assistant turn, the request it answered and the request that replays
 * it, for every shape that passed the check there (no marks; system and tools
 * marked; the tail mark on a tool result or an assistant turn), plus whole
 * caching-off agent checkpoints. Only a turn whose binding digested a mark
 * that rewrote a string turn changes; none of those ever passed.
 *
 * Test type: integration (the real agent loop) / regression / compatibility.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../src/index.js';
import { anthropic } from '../../src/adapters/llm/AnthropicProvider.js';
import { prepareAnthropicReplay } from '../../src/adapters/llm/anthropicThinkingReplay.js';
import type { AgentRunCheckpoint } from '../../src/core/runCheckpoint.js';
import type { LLMMessage, LLMProvider, LLMRequest } from '../../src/provider-contract/types.js';

/** The models whose table row sets `thinkingPrefixBinding` (anthropicModels.ts). */
const BOUND = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];

type Block = Record<string, unknown> & { type: string };
type Body = { messages: { role: string; content: string | Block[] }[] };

/** A stub SDK client: keeps every body; each reply thinks (signature `sig-<n>`), then a tool or text. */
function scriptedClient(model: string, bodies: Body[], script: readonly ('tool' | 'text')[]) {
  let n = 0;
  const reply = (params: Body) => {
    bodies.push(JSON.parse(JSON.stringify(params)) as Body);
    const step = script[Math.min(n, script.length - 1)];
    n += 1;
    const content: Block[] = [
      { type: 'thinking', thinking: `reasoning ${n}`, signature: `sig-${n}` },
      step === 'tool'
        ? { type: 'tool_use', id: `toolu_${n}`, name: 'lookup', input: { key: `k${n}` } }
        : { type: 'text', text: `answer ${n}` },
    ];
    return {
      id: `msg_${n}`,
      type: 'message',
      role: 'assistant',
      model,
      content,
      stop_reason: step === 'tool' ? 'tool_use' : 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  };
  return {
    messages: {
      create: async (params: Body) => reply(params),
      stream: (params: Body) => {
        const message = reply(params);
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'message_start',
              message: { ...message, content: [], stop_reason: null },
            };
            for (const [index, block] of message.content.entries()) {
              yield {
                type: 'content_block_start',
                index,
                content_block: block.type === 'tool_use' ? { ...block, input: {} } : block,
              };
              if (block.type === 'tool_use')
                yield {
                  type: 'content_block_delta',
                  index,
                  delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
                };
              if (block.type === 'text')
                yield {
                  type: 'content_block_delta',
                  index,
                  delta: { type: 'text_delta', text: block.text },
                };
              yield { type: 'content_block_stop', index };
            }
            yield {
              type: 'message_delta',
              delta: { stop_reason: message.stop_reason },
              usage: message.usage,
            };
            yield { type: 'message_stop' };
          },
          finalMessage: async () => message,
        };
      },
    },
  };
}

const lookup = defineTool<{ key: string }, string>({
  name: 'lookup',
  description: 'Look a key up in the reference table.',
  inputSchema: {
    type: 'object',
    properties: { key: { type: 'string' } },
    required: ['key'],
    additionalProperties: false,
  },
  execute: async ({ key }) => `value of ${key}`,
});

function setup(model: string, mode: 'stream' | 'complete', script: readonly ('tool' | 'text')[]) {
  const bodies: Body[] = [];
  const real = anthropic({ _client: scriptedClient(model, bodies, script) as never });
  // `complete` mode: the same adapter without `stream`, so the agent calls `complete`.
  const provider: LLMProvider =
    mode === 'stream' ? real : (({ stream: _stream, ...rest }) => rest)(real);
  // Default options: no `caching` key, so the cache strategy marks the wire.
  const agent = Agent.create({ provider, model, maxIterations: 5 })
    .system('You answer questions about the reference table. Use the lookup tool.')
    .tool(lookup)
    .thinking({ budget: 2048 })
    .build();
  return { agent, bodies };
}

/** Every thinking signature the body replays, in wire order. */
function replayedSignatures(body: Body): string[] {
  return body.messages.flatMap((m) =>
    typeof m.content === 'string'
      ? []
      : m.content.filter((b) => b.type === 'thinking').map((b) => String(b.signature)),
  );
}

describe.each(['stream', 'complete'] as const)(
  'saved thinking under default caching — %s (r3-59-adapters-llm-1)',
  (mode) => {
    it.each(BOUND)(
      '%s: thinking and a tool complete a second and a third model call',
      async (model) => {
        const { agent, bodies } = setup(model, mode, ['tool', 'tool', 'text']);
        expect(await agent.run({ message: 'What are k1 and k2?' })).toBe('answer 3');
        expect(bodies).toHaveLength(3);
        // The precondition the finding needs: default caching marked the first
        // user turn, turning its string into a one-block array.
        const firstUser = bodies[0]!.messages[0]!.content as Block[];
        expect(Array.isArray(firstUser)).toBe(true);
        expect(firstUser.at(-1)).toHaveProperty('cache_control');
        // Each later call replays every earlier signed thinking block — none
        // was refused or dropped.
        expect(replayedSignatures(bodies[1]!)).toEqual(['sig-1']);
        expect(replayedSignatures(bodies[2]!)).toEqual(['sig-1', 'sig-2']);
      },
    );

    it.each(BOUND)(
      '%s: a completed thinking turn is kept in the next request, not retired',
      async (model) => {
        const { agent, bodies } = setup(model, mode, ['text', 'text']);
        expect(await agent.run({ message: 'What is k1?' })).toBe('answer 1');
        expect(await agent.followUp('And k2?')).toBe('answer 2');
        expect(bodies).toHaveLength(2);
        expect(replayedSignatures(bodies[1]!)).toEqual(['sig-1']);
        const first = agent.checkpoint()!.history.find((m) => m.role === 'assistant')!;
        expect(first.replay?.thinkingRetired).toBeUndefined();
        expect(first.thinkingBlocks?.map((b) => b.signature)).toEqual(['sig-1']);
      },
    );
  },
);

// ─── Records saved on main ──────────────────────────────────────────

interface MainRecord {
  readonly model: string;
  readonly scenario: string;
  readonly request: LLMRequest;
  readonly record: LLMMessage;
  readonly next: LLMRequest;
  readonly mainVerdict: string;
}
const MAIN = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/replay-records.main.json'), 'utf8'),
) as {
  readonly records: readonly MainRecord[];
  readonly checkpoints: readonly {
    readonly model: string;
    readonly checkpoint: AgentRunCheckpoint;
  }[];
};

/** The SDK reply main's generator scripted for this record, rebuilt from the record itself. */
function replyFor(r: MainRecord) {
  const n = Number(/^msg_main_(\d+)$/.exec(r.record.replay!.id!)![1]);
  const tool = (r.record.toolCalls?.length ?? 0) > 0;
  return {
    id: `msg_main_${n}`,
    type: 'message',
    role: 'assistant',
    model: r.model,
    content: [
      { type: 'thinking', thinking: `reasoning ${n}`, signature: `main-sig-${n}` },
      tool
        ? { type: 'tool_use', id: `toolu_main_${n}`, name: 'lookup', input: { key: `k${n}` } }
        : { type: 'text', text: `answer ${n}` },
    ],
    stop_reason: tool ? 'tool_use' : 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

describe('records saved on main still pass (r3-59-adapters-llm-1)', () => {
  it('the fixture covers every bound model and only records main passed', () => {
    expect(new Set(MAIN.records.map((r) => r.model))).toEqual(new Set(BOUND));
    expect(MAIN.records.every((r) => r.mainVerdict === 'passes')).toBe(true);
  });

  it.each(MAIN.records.map((r) => [r.model, r.scenario, r] as const))(
    '%s %s: the saved turn is replayed, not refused or retired',
    (model, _scenario, r) => {
      const prepared = prepareAnthropicReplay(r.next, model, 'anthropic');
      expect(prepared.omissions).toEqual([]);
      expect(prepared.request).toBe(r.next);
    },
  );

  it.each(MAIN.records.map((r) => [r.model, r.scenario, r] as const))(
    '%s %s: the same call today saves the same binding',
    async (_model, _scenario, r) => {
      const sdk = { messages: { create: async () => replyFor(r) } };
      const provider = anthropic({ _client: sdk as never });
      const answer = await provider.complete(JSON.parse(JSON.stringify(r.request)));
      expect(JSON.parse(JSON.stringify(answer.replay))).toEqual(r.record.replay);
    },
  );

  it.each(MAIN.checkpoints.map((c) => [c.model, c] as const))(
    '%s: a caching-off conversation saved on main continues under default caching',
    async (model, c) => {
      const { agent, bodies } = setup(model, 'stream', ['tool', 'text']);
      const answer = await agent.run({
        message: 'And k2?',
        continueFrom: JSON.parse(JSON.stringify(c.checkpoint)),
      });
      expect(answer).toBe('answer 2');
      expect(replayedSignatures(bodies[0]!)).toEqual(['agent-sig-1', 'agent-sig-2']);
      expect(replayedSignatures(bodies[1]!)).toEqual(['agent-sig-1', 'agent-sig-2', 'sig-1']);
    },
  );
});
