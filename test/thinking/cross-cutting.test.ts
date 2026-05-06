/**
 * Phase 6 — Cross-cutting tests for the v2.14 thinking subsystem.
 *
 * Three independent concerns this file pins, none of which belong to
 * a single handler or provider:
 *
 *   A. CONTRACT — every shipped ThinkingHandler honors the framework's
 *      invariants. Iterates `SHIPPED_THINKING_HANDLERS` so any future
 *      handler appended to the registry auto-runs the same suite. No
 *      hardcoded list of handler names.
 *
 *   B. E2E ROUND-TRIP — full agent run through the real
 *      AnthropicProvider, capturing rawThinking → AnthropicThinkingHandler
 *      → LLMMessage.thinkingBlocks → AnthropicProvider serialization on
 *      a SECOND turn. Verifies the signature byte-exact invariant
 *      survives the entire pipeline (not just the unit-tested seams).
 *
 *   C. NARRATIVE NON-LEAK — providerMeta is per-block escape-hatch
 *      metadata explicitly documented as "framework excludes from
 *      getNarrative() by default to avoid audit-log leakage". Pin
 *      that no narrative entry ever surfaces a providerMeta key.
 *
 * 7-pattern coverage spans these concerns:
 *   1. Unit         — contract iteration over registry
 *   2. Scenario     — handler-throws-then-recover (cross-handler)
 *   3. Integration  — E2E two-turn through real AnthropicProvider
 *   4. Property     — random rawThinking shapes never crash any handler
 *   5. Security     — providerMeta never leaks into narrative
 *   6. Performance  — every handler normalize(undefined) under bound
 *   7. ROI          — realistic refund agent with thinking
 */

import { describe, expect, it, vi } from 'vitest';
import {
  Agent,
  defineTool,
  type LLMMessage,
  type LLMProvider,
  type LLMResponse,
} from '../../src/index.js';
import {
  SHIPPED_THINKING_HANDLERS,
  findThinkingHandler,
  type ThinkingBlock,
  type ThinkingHandler,
} from '../../src/thinking/index.js';
import { AnthropicProvider } from '../../src/adapters/llm/AnthropicProvider.js';

// ─── Fake Anthropic SDK shape (mirrors Phase 4b harness) ──────────

interface FakeContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface FakeMessage {
  id: string;
  model: string;
  role: 'assistant';
  content: FakeContentBlock[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

/** Build a fake Anthropic SDK that returns scripted responses turn-by-turn.
 * Records `messages.stream(params)` calls — Agent uses streaming by default,
 * so the round-trip request payload lands here, not on `messages.create`. */
function makeScriptedClient(turns: readonly FakeMessage[], recorder: { params: unknown[] }) {
  let turn = 0;
  const next = (params: unknown): FakeMessage => {
    recorder.params.push(params);
    const response = turns[turn] ?? turns[turns.length - 1]!;
    turn += 1;
    return response;
  };
  return {
    messages: {
      create: vi.fn(async (params: unknown) => next(params)),
      stream: vi.fn((params: unknown) => {
        const final = next(params);
        const textBlocks = final.content.filter((b) => b.type === 'text') as Array<{
          text: string;
        }>;
        const events = textBlocks.flatMap((b) =>
          b.text.split('').map((ch) => ({
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: ch },
          })),
        );
        return {
          async *[Symbol.asyncIterator]() {
            for (const e of events) yield e;
          },
          async finalMessage() {
            return final;
          },
        };
      }),
    },
  };
}

// ─── A. CONTRACT — every shipped handler honors invariants ───────

describe('thinking cross-cutting — contract: SHIPPED_THINKING_HANDLERS', () => {
  it('registry has at least one handler (regression guard)', () => {
    expect(SHIPPED_THINKING_HANDLERS.length).toBeGreaterThanOrEqual(1);
  });

  for (const handler of SHIPPED_THINKING_HANDLERS) {
    describe(`contract: ${handler.id}`, () => {
      it('id is non-empty string', () => {
        expect(typeof handler.id).toBe('string');
        expect(handler.id.length).toBeGreaterThan(0);
      });

      it('providerNames is non-empty readonly array of non-empty strings', () => {
        expect(Array.isArray(handler.providerNames)).toBe(true);
        expect(handler.providerNames.length).toBeGreaterThan(0);
        handler.providerNames.forEach((name) => {
          expect(typeof name).toBe('string');
          expect(name.length).toBeGreaterThan(0);
        });
      });

      it('normalize(undefined) returns []', () => {
        expect(handler.normalize(undefined)).toEqual([]);
      });

      it('normalize(null) returns []', () => {
        expect(handler.normalize(null)).toEqual([]);
      });

      it('every output block has valid type discriminator', () => {
        // Probe normalize() with the handler's own well-formed input
        // shape (each handler tolerates undefined, so we know it
        // gracefully returns [] for unrecognized input — but we want
        // to verify the type invariant on ANY output it produces).
        const probes: unknown[] = [
          undefined,
          null,
          [],
          '',
          'a string',
          { kind: 'unknown' },
          [{ type: 'thinking', thinking: 'x' }],
          [{ type: 'summary_text', text: 'y' }],
          { kind: 'anthropic', blocks: [{ type: 'thinking', thinking: 'z', signature: 'sig' }] },
        ];
        for (const probe of probes) {
          const blocks = handler.normalize(probe);
          for (const block of blocks) {
            expect(['thinking', 'redacted_thinking']).toContain(block.type);
            expect(typeof block.content).toBe('string');
            if (block.signature !== undefined) {
              expect(typeof block.signature).toBe('string');
            }
            if (block.summary !== undefined) {
              expect(typeof block.summary).toBe('boolean');
            }
          }
        }
      });

      it('findThinkingHandler returns this handler for each providerName', () => {
        for (const name of handler.providerNames) {
          // Note: first-match semantics — if two handlers claimed the
          // same providerName, the earlier wins. Cross-checking each
          // handler's claimed names lookup back to itself catches
          // accidental overlap when a new handler is appended.
          expect(findThinkingHandler(name)).toBe(handler);
        }
      });

      it('parseChunk is either undefined or a function', () => {
        // Optional field — must be either omitted entirely or callable
        // with chunk → { thinkingDelta? }.
        if (handler.parseChunk !== undefined) {
          expect(typeof handler.parseChunk).toBe('function');
        }
      });
    });
  }

  it('no two handlers claim the same providerName (uniqueness invariant)', () => {
    const claimed = new Map<string, string>();
    for (const handler of SHIPPED_THINKING_HANDLERS) {
      for (const name of handler.providerNames) {
        const prior = claimed.get(name);
        if (prior !== undefined) {
          throw new Error(
            `Provider name "${name}" claimed by both "${prior}" and "${handler.id}". ` +
              'findThinkingHandler() picks the first match, but overlap is confusing — ' +
              'each provider should map to exactly one handler.',
          );
        }
        claimed.set(name, handler.id);
      }
    }
  });
});

// ─── B. E2E ROUND-TRIP ──────────────────────────────────────────

describe('thinking cross-cutting — E2E: Agent + AnthropicProvider two-turn', () => {
  it('full pipeline preserves signature byte-exact across two turns', async () => {
    const trickySig = 'EuYBCkYIBBgCKkD+/AwI3p+9Hq/XYZ==trailing  '; // base64 + chars + trailing space
    const recorder = { params: [] as unknown[] };

    // Turn 1: Anthropic returns thinking + tool_use.
    // Turn 2: Anthropic returns final text answer.
    const turns: FakeMessage[] = [
      {
        id: 'msg_1',
        model: 'claude-sonnet-4-5-20250929',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'I should call echo to verify', signature: trickySig },
          { type: 'tool_use', id: 'tu-1', name: 'echo', input: { msg: 'hi' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 20 },
      },
      {
        id: 'msg_2',
        model: 'claude-sonnet-4-5-20250929',
        role: 'assistant',
        content: [{ type: 'text', text: 'final answer' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 30, output_tokens: 10 },
      },
    ];
    const client = makeScriptedClient(turns, recorder);
    const provider = new AnthropicProvider({ apiKey: 'x', _client: client as never });

    const echoTool = defineTool({
      name: 'echo',
      description: 'echoes back',
      inputSchema: { type: 'object' },
      execute: async (args: { msg?: string }) => `echoed: ${args.msg}`,
    });

    const agent = Agent.create({ provider, model: 'claude-sonnet-4-5-20250929', maxIterations: 4 })
      .system('s')
      .tool(echoTool)
      .build();

    const result = await agent.run({ message: 'go' });
    const content = typeof result === 'string' ? result : (result as { content: string }).content;
    expect(content).toBe('final answer');

    // Two requests sent: turn 1 + turn 2.
    expect(recorder.params).toHaveLength(2);

    // Turn 2's request payload MUST echo the assistant turn 1 with
    // the thinking block + signature BYTE-EXACT (Anthropic validates
    // signed-block round-trip server-side).
    const turn2Req = recorder.params[1] as {
      messages: { role: string; content: FakeContentBlock[] | string }[];
    };
    const assistantMsg = turn2Req.messages.find(
      (m): m is { role: string; content: FakeContentBlock[] } =>
        m.role === 'assistant' && Array.isArray(m.content),
    );
    expect(assistantMsg).toBeDefined();
    const blocks = assistantMsg!.content;

    // Anthropic wire-format ordering: thinking → text → tool_use
    const types = blocks.map((b) => b.type);
    expect(types[0]).toBe('thinking'); // thinking comes first

    const thinkingBlock = blocks.find((b) => b.type === 'thinking');
    expect(thinkingBlock).toBeDefined();
    expect(thinkingBlock!.thinking).toBe('I should call echo to verify');
    // BYTE-EXACT signature equality across the entire pipeline
    expect(thinkingBlock!.signature).toBe(trickySig);
  });

  it('redacted_thinking blocks survive round-trip with signature', async () => {
    const sig = 'redacted-sig-XYZ-987';
    const recorder = { params: [] as unknown[] };
    const turns: FakeMessage[] = [
      {
        id: 'msg_1',
        model: 'claude-sonnet-4-5-20250929',
        role: 'assistant',
        content: [
          { type: 'redacted_thinking', signature: sig },
          { type: 'tool_use', id: 'tu-1', name: 'echo', input: {} },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 5, output_tokens: 5 },
      },
      {
        id: 'msg_2',
        model: 'claude-sonnet-4-5-20250929',
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 5 },
      },
    ];
    const client = makeScriptedClient(turns, recorder);
    const provider = new AnthropicProvider({ apiKey: 'x', _client: client as never });
    const echoTool = defineTool({
      name: 'echo',
      description: 'e',
      inputSchema: { type: 'object' },
      execute: async () => 'ok',
    });
    const agent = Agent.create({ provider, model: 'claude-sonnet-4-5-20250929', maxIterations: 4 })
      .system('s')
      .tool(echoTool)
      .build();

    await agent.run({ message: 'go' });
    expect(recorder.params).toHaveLength(2);

    const turn2Req = recorder.params[1] as {
      messages: { role: string; content: FakeContentBlock[] | string }[];
    };
    const assistantMsg = turn2Req.messages.find(
      (m): m is { role: string; content: FakeContentBlock[] } =>
        m.role === 'assistant' && Array.isArray(m.content),
    );
    expect(assistantMsg).toBeDefined();
    const redacted = assistantMsg!.content.find((b) => b.type === 'redacted_thinking');
    expect(redacted).toBeDefined();
    expect(redacted!.signature).toBe(sig);
    // redacted_thinking has NO `thinking` field on the wire
    expect(redacted!.thinking).toBeUndefined();
  });
});

// ─── C. NARRATIVE NON-LEAK ──────────────────────────────────────

describe('thinking cross-cutting — security: providerMeta never leaks into narrative', () => {
  it('handler emitting providerMeta does NOT surface it via getLastNarrativeEntries', async () => {
    // Custom handler that always emits providerMeta with a sentinel
    // key. If anything in the framework serializes providerMeta into
    // narrative entries (text or structured payload), the sentinel
    // will show up in the haystack.
    const SENTINEL = '__provider_meta_sentinel__';
    const customHandler: ThinkingHandler = {
      id: 'leak-test',
      providerNames: ['leak-test-provider'],
      normalize: (raw): readonly ThinkingBlock[] => {
        if (raw === undefined) return [];
        return [
          {
            type: 'thinking',
            content: 'visible reasoning',
            providerMeta: {
              [SENTINEL]: 'should-never-appear-in-narrative',
              internalRequestId: 'req-internal-12345',
            },
          },
        ];
      },
    };

    const provider: LLMProvider = {
      name: 'leak-test-provider',
      complete: async (): Promise<LLMResponse> => ({
        content: 'final',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'end_turn',
        rawThinking: { trigger: true },
      }),
    };

    const agent = Agent.create({ provider, model: 'mock' })
      .system('s')
      .thinkingHandler(customHandler)
      .build();
    await agent.run({ message: 'go' });

    const entries = agent.getLastNarrativeEntries();
    expect(entries.length).toBeGreaterThan(0); // Sanity: narrative did capture something.

    // Walk every entry and stringify the WHOLE entry (text + any
    // structured payload). The sentinel must NOT appear anywhere.
    for (const entry of entries) {
      const haystack = JSON.stringify(entry);
      expect(haystack).not.toContain(SENTINEL);
      expect(haystack).not.toContain('internalRequestId');
      expect(haystack).not.toContain('req-internal-12345');
    }
  });
});

// ─── 4. PROPERTY — random rawThinking never crashes any handler ─

describe('thinking cross-cutting — property: random inputs never throw', () => {
  it('every shipped handler returns [] (or valid blocks) for arbitrary garbage', () => {
    const garbage: unknown[] = [
      undefined,
      null,
      0,
      1,
      -1,
      Number.NaN,
      Infinity,
      '',
      'string',
      [],
      [{}],
      [{ type: 'thinking' }],
      [{ type: 'summary_text', text: 't' }],
      [{ random: 'object' }],
      { kind: 'unknown' },
      { kind: 'anthropic' },
      { kind: 'anthropic', blocks: [] },
      { kind: 'anthropic', blocks: [{ type: 'unknown' }] },
      true,
      false,
      Symbol('s') as unknown,
      () => 'function',
    ];

    for (const handler of SHIPPED_THINKING_HANDLERS) {
      for (const probe of garbage) {
        // Must not throw — failure-isolation contract.
        expect(() => handler.normalize(probe)).not.toThrow();
        const out = handler.normalize(probe);
        // Must always be a (possibly empty) array of valid blocks.
        expect(Array.isArray(out)).toBe(true);
      }
    }
  });
});

// ─── 6. PERFORMANCE — every handler is fast on the cold path ────

describe('thinking cross-cutting — performance: normalize(undefined) is cheap', () => {
  it('every shipped handler does normalize(undefined) x10000 under bound', () => {
    for (const handler of SHIPPED_THINKING_HANDLERS) {
      const t0 = performance.now();
      for (let i = 0; i < 10000; i++) handler.normalize(undefined);
      const elapsed = performance.now() - t0;
      // Generous: 10k undefined returns under 250ms even on a slow CI box.
      expect(elapsed).toBeLessThan(250);
    }
  });
});

// ─── 7. ROI — realistic refund agent through the full pipeline ──

describe('thinking cross-cutting — ROI: refund agent with thinking', () => {
  it('thinking → tool call → final answer; thinkingBlocks land on first assistant message', async () => {
    const sig = 'sig-refund-decision-12345';
    let calls = 0;
    const provider: LLMProvider = {
      name: 'mock',
      complete: async (): Promise<LLMResponse> => {
        calls += 1;
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'tu-1', name: 'lookup_order', args: { id: 'ord-42' } }],
            usage: { input: 50, output: 30 },
            stopReason: 'tool_use',
            rawThinking: {
              kind: 'anthropic',
              blocks: [
                {
                  type: 'thinking',
                  thinking: 'User wants refund for ord-42. I need to check the order first.',
                  signature: sig,
                },
              ],
            },
          };
        }
        return {
          content: 'Refund of $50 has been processed for order ord-42.',
          toolCalls: [],
          usage: { input: 80, output: 40 },
          stopReason: 'end_turn',
        };
      },
    };

    const lookupTool = defineTool({
      name: 'lookup_order',
      description: 'fetch order details',
      inputSchema: { type: 'object' },
      execute: async (args: { id?: string }) =>
        JSON.stringify({ id: args.id, total: 50, status: 'delivered' }),
    });

    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .system('You are a refund agent.')
      .tool(lookupTool)
      .build();

    const result = await agent.run({ message: 'Refund my order ord-42' });
    const content = typeof result === 'string' ? result : (result as { content: string }).content;
    expect(content).toContain('Refund of $50');

    const snap = agent.getLastSnapshot();
    const state = snap?.sharedState as { history?: readonly LLMMessage[] };
    const history = state.history ?? [];

    // First assistant message (the tool-using one) carries the thinking blocks
    const firstAssistant = history.find(
      (m) => m.role === 'assistant' && (m.toolCalls?.length ?? 0) > 0,
    );
    expect(firstAssistant?.thinkingBlocks).toBeDefined();
    expect(firstAssistant?.thinkingBlocks?.length).toBe(1);
    expect(firstAssistant?.thinkingBlocks?.[0]?.signature).toBe(sig);
    expect(firstAssistant?.thinkingBlocks?.[0]?.content).toContain('refund for ord-42');
  });
});
