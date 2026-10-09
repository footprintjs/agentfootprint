/**
 * The three follow-ups #93 ("thinking per model") named, each reproduced
 * against the bytes an adapter hands its transport.
 *
 *   1. `bedrock()` (the Converse API) silently ignored `.thinking()`.
 *   2. A forced tool choice reached Claude Opus 5.5, Sonnet 5.5, Fable 5.1 and
 *      Mythos 5.1, which reject it on every request (HTTP 400).
 *   3. A thinking block was sent back after the system prompt, the tools or an
 *      earlier message had changed — on Fable 5.1, Opus 5.5, Sonnet 5.5 and
 *      Haiku 5.5 that is a 400 for accounts created on or after 2026-08-31
 *      (preserved thinking's prefix check).
 *
 * No live API calls: a fake SDK client, a recording `fetch` or a fake Converse
 * client records every request body.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool, type LLMRequest } from '../../src/index.js';
import { anthropic } from '../../src/adapters/llm/AnthropicProvider.js';
import { bedrock } from '../../src/adapters/llm/BedrockProvider.js';
import { constrainedEnumPick } from '../../src/lib/injection-engine/constrainedEnumPick.js';
import { defineInstruction } from '../../src/injection-engine.js';
import { UnsupportedThinkingError } from '../../src/thinking/index.js';

// ── Fakes ──────────────────────────────────────────────────────────────

type Body = Record<string, unknown> & {
  system?: unknown;
  messages?: { role: string; content: unknown }[];
  tool_choice?: unknown;
};

const TEXT_REPLY = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'm',
  content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
};

/** A stand-in for `@anthropic-ai/sdk`: records every params object it is handed. */
function sdk(replies: readonly unknown[] = [TEXT_REPLY]) {
  const sent: Body[] = [];
  let n = 0;
  const next = (params: unknown) => {
    sent.push(JSON.parse(JSON.stringify(params)) as Body);
    const reply = replies[Math.min(n, replies.length - 1)];
    n += 1;
    return reply;
  };
  const client = {
    messages: {
      create: async (params: unknown) => next(params),
      stream: (params: unknown) => {
        const reply = next(params);
        return {
          async *[Symbol.asyncIterator]() {},
          finalMessage: async () => reply,
        };
      },
    },
  };
  return { sent, client: client as never };
}

/** A stand-in for `@aws-sdk/client-bedrock-runtime`: records every Converse input. */
function converse() {
  const inputs: unknown[] = [];
  class Converse {
    constructor(readonly input: unknown) {
      inputs.push(input);
    }
  }
  const client = {
    send: async () => ({
      output: { message: { role: 'assistant', content: [{ text: 'ok' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
  };
  return { inputs, provider: bedrock({ _client: client, _commands: { Converse, ConverseStream: Converse } }) };
}

const lookup = defineTool<{ key: string }, string>({
  name: 'lookup',
  description: 'Look a key up.',
  inputSchema: {
    type: 'object',
    properties: { key: { type: 'string' } },
    required: ['key'],
    additionalProperties: false,
  },
  execute: async ({ key }) => `${key} is green`,
});

/** The text of a body's `system`, whichever form the cache markers left it in. */
function systemText(body: Body): string {
  const s = body.system;
  if (typeof s === 'string') return s;
  if (Array.isArray(s)) return s.map((b) => (b as { text?: string }).text ?? '').join('');
  return '';
}

/** Every thinking block a body sends back, in order. */
function replayedThinking(body: Body): unknown[] {
  return (body.messages ?? []).flatMap((m) =>
    m.role === 'assistant' && Array.isArray(m.content)
      ? (m.content as { type: string }[]).filter(
          (b) => b.type === 'thinking' || b.type === 'redacted_thinking',
        )
      : [],
  );
}

// ── 1. bedrock() and .thinking() ───────────────────────────────────────

describe('follow-up 1 — bedrock() (Converse) and .thinking()', () => {
  it('a request to think is refused before anything is sent — never sent without its thinking', async () => {
    const { inputs, provider } = converse();
    const req: LLMRequest = {
      model: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
      messages: [{ role: 'user', content: 'think about it' }],
      thinking: { budget: 2048 },
    };
    await expect(provider.complete(req)).rejects.toBeInstanceOf(UnsupportedThinkingError);
    expect(inputs).toEqual([]);
  });

  it('Agent.build() refuses .thinking() on bedrock(), by name', () => {
    const { provider } = converse();
    expect(() =>
      Agent.create({ provider, model: 'anthropic.claude-sonnet-4-5-20250929-v1:0' })
        .system('s')
        .thinking({ budget: 2048 })
        .build(),
    ).toThrow(UnsupportedThinkingError);
  });
});

// ── 2. A forced tool choice on a model that rejects it ─────────────────

const RESPOND = { name: 'respond', description: 'Answer.', inputSchema: { type: 'object' } };

const forced = (model: string): LLMRequest => ({
  model,
  messages: [{ role: 'user', content: 'answer' }],
  tools: [RESPOND],
  toolChoice: { type: 'tool', name: 'respond' },
});

describe('follow-up 2 — a forced tool choice on Opus 5.5, Sonnet 5.5, Fable 5.1 and Mythos 5.1', () => {
  for (const model of [
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-fable-5-1',
    'claude-mythos-5-1',
    'anthropic.claude-opus-5-5',
  ]) {
    it(`${model}: refused before sending — the API answers 400 on every request`, async () => {
      const { sent, client } = sdk();
      await expect(anthropic({ _client: client }).complete(forced(model))).rejects.toThrow(
        /forced tool choice/,
      );
      expect(sent).toEqual([]);
    });
  }

  it("the agent's 'tool-forced' strategy on Opus 5.5 is refused at run start; nothing is sent", async () => {
    const { sent, client } = sdk();
    const agent = Agent.create({ provider: anthropic({ _client: client }), model: 'claude-opus-5-5' })
      .outputSchema(
        { parse: (v: unknown) => v },
        { strategy: 'tool-forced', jsonSchema: { type: 'object', properties: {} } },
      )
      .build();
    await expect(agent.run({ message: 'answer' })).rejects.toThrow(/claude-opus-5-5/);
    expect(sent).toEqual([]);
  });

  it('a constrained pick on Opus 5.5 asks in words — no forced tool_choice on the wire', async () => {
    const { sent, client } = sdk([{ ...TEXT_REPLY, content: [{ type: 'text', text: 'billing' }] }]);
    const picked = await constrainedEnumPick({
      provider: anthropic({ _client: client }),
      model: 'claude-opus-5-5',
      systemPrompt: 'Classify the message.',
      messages: [{ role: 'user', content: 'my invoice is wrong' }],
      allowed: ['billing', 'none'],
      fallback: 'none',
      pickTool: { name: 'pick', description: 'Pick.', argName: 'id', argDescription: 'The id.' },
    });
    expect(picked).toBe('billing');
    expect(sent.map((b) => b.tool_choice)).toEqual([undefined]);
  });
});

// ── 3. A thinking block sent back after the conversation before it changed ─

const SIG = 'sig-opus-5-5-turn-1';

/** Turn 1 thinks (an empty, signed block — display omitted) and calls `lookup`. */
const THINK_THEN_LOOKUP = {
  ...TEXT_REPLY,
  content: [
    { type: 'thinking', thinking: '', signature: SIG },
    { type: 'tool_use', id: 'tu_1', name: 'lookup', input: { key: 'k' } },
  ],
  stop_reason: 'tool_use',
};
const FINAL = { ...TEXT_REPLY, content: [{ type: 'text', text: 'k is green.' }] };

/** An instruction that joins the system prompt once `lookup` has returned — a dynamic system prompt. */
const citeAfterLookup = defineInstruction({
  id: 'cite-after-lookup',
  activeWhen: (ctx) => ctx.lastToolResult?.toolName === 'lookup',
  prompt: 'Cite the lookup you used.',
});

async function twoCalls(opts: { readonly model: string; readonly dynamic: boolean }): Promise<Body[]> {
  const { sent, client } = sdk([THINK_THEN_LOOKUP, FINAL]);
  const builder = Agent.create({ provider: anthropic({ _client: client }), model: opts.model, maxIterations: 3 })
    .system('Look things up.')
    .tool(lookup);
  const agent = (opts.dynamic ? builder.instruction(citeAfterLookup) : builder).build();
  await agent.run({ message: 'is k green?' });
  return sent;
}

describe('follow-up 3 — preserved thinking: a block goes back only while everything before it is unchanged', () => {
  it('Opus 5.5, the system prompt changes after the first tool call: call 2 does not send the stale block back', async () => {
    const sent = await twoCalls({ model: 'claude-opus-5-5', dynamic: true });
    expect(sent).toHaveLength(2);
    // The prefix the block was produced under changed between the two calls…
    expect(systemText(sent[1]!)).not.toBe(systemText(sent[0]!));
    // …so the API (accounts created on or after 2026-08-31) would reject the
    // block with a 400. It must not be sent back.
    expect(replayedThinking(sent[1]!)).toEqual([]);
  });

  it('control: the same conversation with an unchanged system prompt sends the block back, byte-exact', async () => {
    const sent = await twoCalls({ model: 'claude-opus-5-5', dynamic: false });
    expect(systemText(sent[1]!)).toBe(systemText(sent[0]!));
    expect(replayedThinking(sent[1]!)).toEqual([{ type: 'thinking', thinking: '', signature: SIG }]);
  });

  it('a model that does not run the check (Opus 4.8) sends the block back as before', async () => {
    const sent = await twoCalls({ model: 'claude-opus-4-8', dynamic: true });
    expect(replayedThinking(sent[1]!)).toEqual([{ type: 'thinking', thinking: '', signature: SIG }]);
  });
});
