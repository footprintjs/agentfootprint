/**
 * The cached prefix is byte-stable from one call to the next — on the real
 * Anthropic adapter, with no network.
 *
 * A prompt cache hits only when every byte up to a breakpoint repeats. These
 * tests drive a real agent through the package's own `anthropic()` adapter
 * over a stub SDK client that keeps each wire body, then compare the bodies
 * themselves:
 *
 *   - two consecutive calls in one conversation: everything up to the FIRST
 *     call's last breakpoint is byte-identical in the SECOND call (cache
 *     markers stripped — a marker is a placement, not content), so the
 *     second call can read it back;
 *   - the breakpoint MOVES: each call marks its own conversation tail;
 *   - a follow-up turn repeats the previous turn's last cached prefix;
 *   - the name does not matter: `withRetry(anthropic())` marks the same
 *     places (it used to send no markers at all);
 *   - caching changes no content: the same run with `caching: 'off'` sends
 *     the same bodies once the markers are stripped — the model sees the
 *     same words, only cache-marked.
 *
 * Test types: scenario (the conversation) / regression (the renamed
 * provider) / property (content unchanged across every call) / ROI (the
 * share of each request a cache can serve).
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../src/index.js';
import { defineSteering } from '../../src/injection-engine.js';
import { anthropic } from '../../src/adapters/llm/AnthropicProvider.js';
import { withRetry } from '../../src/resilience/withRetry.js';
import type { LLMProvider } from '../../src/adapters/types.js';

type Body = {
  system?: unknown;
  tools?: Record<string, unknown>[];
  messages: { role: string; content: unknown }[];
  tool_choice?: unknown;
  thinking?: unknown;
};

/** A stub SDK client: keeps every body, answers from a script (tool calls, then text). */
function scriptedClient(bodies: Body[], script: readonly ('tool' | 'text')[]) {
  let n = 0;
  const reply = (params: Body) => {
    bodies.push(JSON.parse(JSON.stringify(params)) as Body);
    const step = script[Math.min(n, script.length - 1)];
    n += 1;
    const content =
      step === 'tool'
        ? [{ type: 'tool_use', id: `toolu_${n}`, name: 'lookup', input: { key: `k${n}` } }]
        : [{ type: 'text', text: `answer ${n}` }];
    return {
      id: `msg_${n}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5',
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
            for (const b of message.content)
              if (b.type === 'text')
                yield { type: 'content_block_delta', delta: { type: 'text_delta', text: b.text } };
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

function buildAgent(provider: LLMProvider, opts: { caching?: 'off' } = {}) {
  return Agent.create({ provider, model: 'claude-haiku-4-5', maxIterations: 6, ...opts })
    .system('You answer questions about the reference table. Use the lookup tool.')
    .steering(defineSteering({ id: 'brief', prompt: 'Answer in one sentence.' }))
    .tool(lookup)
    .build();
}

/** Strip every `cache_control`, at any depth — placement, not content. */
function stripMarks(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMarks);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (k !== 'cache_control') out[k] = stripMarks(v);
    return out;
  }
  return value;
}

/**
 * The prompt as Anthropic renders it — tools, system, the settings that
 * invalidate messages, then message blocks — one serialized position each,
 * with the index of every breakpoint. A string `content` is the one text
 * block it stands for.
 */
function rendered(body: Body): { blocks: string[]; breakpoints: number[] } {
  const blocks: string[] = [];
  const breakpoints: number[] = [];
  const push = (kind: string, block: unknown) => {
    const marked =
      block !== null && typeof block === 'object' && 'cache_control' in (block as object);
    if (marked) breakpoints.push(blocks.length);
    blocks.push(`${kind}:${JSON.stringify(stripMarks(block))}`);
  };
  const asBlocks = (c: unknown) =>
    typeof c === 'string' ? [{ type: 'text', text: c }] : (c as unknown[]);
  for (const t of body.tools ?? []) push('tool', t);
  if (body.system !== undefined) for (const b of asBlocks(body.system)) push('system', b);
  blocks.push(
    `settings:${JSON.stringify({ tc: body.tool_choice ?? null, th: body.thinking ?? null })}`,
  );
  for (const m of body.messages) for (const b of asBlocks(m.content)) push(`msg:${m.role}`, b);
  return { blocks, breakpoints };
}

async function runTurns(provider: LLMProvider, turns: string[], opts: { caching?: 'off' } = {}) {
  const agent = buildAgent(provider, opts);
  for (let i = 0; i < turns.length; i++) {
    if (i === 0) await agent.run({ message: turns[i]! });
    else await agent.followUp(turns[i]!);
  }
}

describe('prompt prefix stability — the real Anthropic adapter, $0', () => {
  it('scenario: each call repeats the previous call’s prefix BYTE FOR BYTE up to its last breakpoint', async () => {
    const bodies: Body[] = [];
    await runTurns(
      anthropic({ _client: scriptedClient(bodies, ['tool', 'tool', 'text']) as never }),
      ['What are k1 and k2?'],
    );
    expect(bodies).toHaveLength(3);
    for (let k = 1; k < bodies.length; k++) {
      const prev = rendered(bodies[k - 1]!);
      const next = rendered(bodies[k]!);
      const last = prev.breakpoints[prev.breakpoints.length - 1]!;
      expect(last, `call ${k} placed no breakpoint`).toBeGreaterThan(0);
      expect(next.blocks.slice(0, last + 1).join('\n')).toBe(
        prev.blocks.slice(0, last + 1).join('\n'),
      );
    }
  });

  it('scenario: the breakpoint MOVES — every call marks its own conversation tail', async () => {
    const bodies: Body[] = [];
    await runTurns(
      anthropic({ _client: scriptedClient(bodies, ['tool', 'tool', 'text']) as never }),
      ['What are k1 and k2?'],
    );
    for (const body of bodies) {
      const lastMessage = body.messages[body.messages.length - 1]!;
      const blocks = lastMessage.content as Record<string, unknown>[];
      expect(Array.isArray(blocks)).toBe(true);
      expect(blocks[blocks.length - 1]!.cache_control).toEqual({ type: 'ephemeral' });
    }
    // And the stable head is marked too: the system prompt.
    expect(Array.isArray(bodies[0]!.system)).toBe(true);
  });

  it('scenario: a follow-up turn repeats the previous turn’s last cached prefix', async () => {
    const bodies: Body[] = [];
    await runTurns(
      anthropic({ _client: scriptedClient(bodies, ['tool', 'text', 'text']) as never }),
      ['What is k1?', 'And what does it mean?'],
    );
    expect(bodies).toHaveLength(3);
    const prev = rendered(bodies[1]!); // the first turn's answer call
    const next = rendered(bodies[2]!); // the follow-up's first call
    const last = prev.breakpoints[prev.breakpoints.length - 1]!;
    expect(next.blocks.slice(0, last + 1)).toEqual(prev.blocks.slice(0, last + 1));
  });

  it('regression: withRetry(anthropic()) marks exactly the same places — the name no longer decides', async () => {
    const plain: Body[] = [];
    const retried: Body[] = [];
    await runTurns(anthropic({ _client: scriptedClient(plain, ['tool', 'text']) as never }), [
      'k1?',
    ]);
    await runTurns(
      withRetry(anthropic({ _client: scriptedClient(retried, ['tool', 'text']) as never })),
      ['k1?'],
    );
    expect(retried.map((b) => rendered(b).breakpoints)).toEqual(
      plain.map((b) => rendered(b).breakpoints),
    );
    expect(retried.every((b) => rendered(b).breakpoints.length > 0)).toBe(true);
  });

  it('property: caching changes NO content — the bodies equal the caching-off run once marks are stripped', async () => {
    const on: Body[] = [];
    const off: Body[] = [];
    await runTurns(anthropic({ _client: scriptedClient(on, ['tool', 'tool', 'text']) as never }), [
      'What are k1 and k2?',
    ]);
    await runTurns(
      anthropic({ _client: scriptedClient(off, ['tool', 'tool', 'text']) as never }),
      ['What are k1 and k2?'],
      { caching: 'off' },
    );
    expect(off.every((b) => rendered(b).breakpoints.length === 0)).toBe(true);
    expect(on.map((b) => rendered(b).blocks)).toEqual(off.map((b) => rendered(b).blocks));
  });

  it('ROI: from the second call on, most of each request sits before a breakpoint the previous call wrote — and the share grows', async () => {
    const bodies: Body[] = [];
    await runTurns(
      anthropic({ _client: scriptedClient(bodies, ['tool', 'tool', 'text']) as never }),
      ['What are k1 and k2?'],
    );
    const bytes = (xs: string[]) => xs.reduce((s, x) => s + x.length, 0);
    const shares: number[] = [];
    for (let k = 1; k < bodies.length; k++) {
      const prev = rendered(bodies[k - 1]!);
      const next = rendered(bodies[k]!);
      const last = prev.breakpoints[prev.breakpoints.length - 1]!;
      shares.push(bytes(next.blocks.slice(0, last + 1)) / bytes(next.blocks));
    }
    // This fixture's prompt is tiny, so the newest turn is a large slice of
    // it; on a real agent the readable share only climbs from here.
    expect(shares[0]).toBeGreaterThan(0.6);
    for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeGreaterThan(shares[i - 1]!);
  });
});
