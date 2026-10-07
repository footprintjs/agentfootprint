/**
 * The thinking handler survives a WRAPPED provider — it is declared, not
 * looked up by name.
 *
 * The agent used to pick its handler by `provider.name`, so every renaming
 * wrapper (`withRetry` → `anthropic+retry`, an app's routing wrapper) lost it:
 * no thinking stage, and the signed blocks Anthropic needs echoed back after a
 * tool call never reached the assistant turn. These run a real agent through
 * the package's own Anthropic adapter (a stub SDK client, $0).
 *
 * Test types: regression (the renamed wrappers) / scenario (fallback pairs) /
 * boundary (a malformed declaration, an opt-out) / integration (the signed
 * block lands on the assistant turn of the conversation).
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool, type LLMMessage, type LLMProvider } from '../../src/index.js';
import { anthropic } from '../../src/adapters/llm/AnthropicProvider.js';
import { openai } from '../../src/adapters/llm/OpenAIProvider.js';
import { withRetry } from '../../src/resilience/withRetry.js';
import { withCircuitBreaker } from '../../src/resilience/withCircuitBreaker.js';
import { withFallback } from '../../src/resilience/withFallback.js';
import { anthropicThinkingHandler } from '../../src/thinking/AnthropicThinkingHandler.js';
import { thinkingHandlerFor } from '../../src/thinking/thinkingHandlerFor.js';
import type { ThinkingHandler } from '../../src/thinking/types.js';

const SIG = 'sig-wrapped-provider-1';

/** A stub SDK client: a signed thinking block + a tool call, then an answer. */
function thinkingClient() {
  let n = 0;
  const reply = () => {
    n += 1;
    const content =
      n === 1
        ? [
            { type: 'thinking', thinking: 'look it up first', signature: SIG },
            { type: 'tool_use', id: 'toolu_1', name: 'lookup', input: { key: 'k1' } },
          ]
        : [{ type: 'text', text: 'k1 is green.' }];
    return {
      id: `msg_${n}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5',
      content,
      stop_reason: n === 1 ? 'tool_use' : 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  };
  return {
    messages: {
      create: async () => reply(),
      stream: () => {
        const message = reply();
        return {
          async *[Symbol.asyncIterator]() {},
          finalMessage: async () => message,
        };
      },
    },
  } as never;
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
  execute: async ({ key }) => `${key}: green`,
});

/** Run once; return the signatures on the conversation's assistant turns. */
async function signaturesAfterRun(provider: LLMProvider): Promise<readonly (string | undefined)[]> {
  const agent = Agent.create({ provider, model: 'claude-haiku-4-5', maxIterations: 3 })
    .system('Use the lookup tool.')
    .tool(lookup)
    .build();
  await agent.run({ message: 'What is k1?' });
  const history = (agent.getLastSnapshot()?.sharedState as { history?: readonly LLMMessage[] })
    ?.history;
  return (history ?? [])
    .filter((m) => m.role === 'assistant' && m.thinkingBlocks !== undefined)
    .flatMap((m) => m.thinkingBlocks!.map((b) => b.signature));
}

describe('thinking handler — declared, so a wrapper keeps it', () => {
  it('baseline: anthropic() round-trips the signed block onto the assistant turn', async () => {
    expect(await signaturesAfterRun(anthropic({ _client: thinkingClient() }))).toEqual([SIG]);
  });

  it('regression: withRetry renames the provider and STILL round-trips it', async () => {
    const wrapped = withRetry(anthropic({ _client: thinkingClient() }));
    expect(wrapped.name).toBe('anthropic+retry');
    expect(wrapped.thinkingHandler).toBe(anthropicThinkingHandler);
    expect(await signaturesAfterRun(wrapped)).toEqual([SIG]);
  });

  it("regression: an app's renaming wrapper that forwards the field keeps it", async () => {
    const inner = anthropic({ _client: thinkingClient() });
    const routed: LLMProvider = {
      name: `seo-routing/${inner.name}`,
      ...(inner.thinkingHandler !== undefined && { thinkingHandler: inner.thinkingHandler }),
      complete: (req, hooks) => inner.complete(req, hooks),
    };
    expect(await signaturesAfterRun(routed)).toEqual([SIG]);
  });

  it('withCircuitBreaker forwards it', () => {
    const inner = anthropic({ _client: thinkingClient() });
    expect(thinkingHandlerFor(withCircuitBreaker(inner))).toBe(anthropicThinkingHandler);
  });

  it("withFallback: the same handler on both sides is the pair's", async () => {
    const same = withFallback(
      anthropic({ _client: thinkingClient() }),
      withRetry(anthropic({ _client: thinkingClient() })),
    );
    expect(same.thinkingHandler).toBe(anthropicThinkingHandler);
    expect(await signaturesAfterRun(same)).toEqual([SIG]);
  });

  it('withFallback: different handlers DISPATCH on the side that answered — the signed block still round-trips', async () => {
    // Dropping the handler here lost the block, and the next `.thinking()` +
    // tools call was a 400.
    const mixed = withFallback(
      anthropic({ _client: thinkingClient() }),
      openai({ _client: {} as never }),
    );
    expect(mixed.thinkingHandler?.id).toBe('anthropic-or-openai');
    expect(await signaturesAfterRun(mixed)).toEqual([SIG]);
  });

  it("withFallback: each side's thinking is read by its OWN handler", async () => {
    const reader = (id: string): ThinkingHandler => ({
      id,
      normalize: (raw) => [{ type: 'thinking', content: `${id}:${String(raw)}` }],
    });
    const side = (handler: ThinkingHandler, down: boolean): LLMProvider => ({
      name: handler.id,
      thinkingHandler: handler,
      complete: async () => {
        if (down) throw new Error('down');
        return { content: 'ok', toolCalls: [], usage: { input: 0, output: 0 }, rawThinking: 'x' };
      },
    });
    const blocksOf = async (provider: LLMProvider) => {
      const agent = Agent.create({ provider, model: 'm' }).system('s').build();
      await agent.run({ message: 'go' });
      return (
        agent.getLastSnapshot()?.sharedState as { thinkingBlocks?: { content: string }[] }
      ).thinkingBlocks?.map((b) => b.content);
    };
    const [a, b] = [reader('a'), reader('b')];
    expect(await blocksOf(withFallback(side(a, false), side(b, false)))).toEqual(['a:x']);
    expect(await blocksOf(withFallback(side(a, true), side(b, false)))).toEqual(['b:x']);
  });

  it('boundary: a declaration that is not a handler is refused at build, by provider name', () => {
    const bad = {
      name: 'acme',
      thinkingHandler: { id: 'x' },
      complete: async () => ({ content: '', toolCalls: [], usage: { input: 0, output: 0 } }),
    } as unknown as LLMProvider;
    expect(() => Agent.create({ provider: bad, model: 'm' }).build()).toThrow(
      /the 'acme' provider declares a thinkingHandler that is not one/,
    );
  });

  it('boundary: .thinkingHandler(null) still opts out of a declared handler', async () => {
    const agent = Agent.create({
      provider: withRetry(anthropic({ _client: thinkingClient() })),
      model: 'claude-haiku-4-5',
      maxIterations: 3,
    })
      .system('Use the lookup tool.')
      .tool(lookup)
      .thinkingHandler(null)
      .build();
    await agent.run({ message: 'What is k1?' });
    const history = (agent.getLastSnapshot()?.sharedState as { history?: readonly LLMMessage[] })
      ?.history;
    expect((history ?? []).some((m) => m.thinkingBlocks !== undefined)).toBe(false);
  });
});
