/**
 * Phase 6.5 — Request-side thinking activation 7-pattern matrix.
 *
 * Phase 1-6 built the response side: AnthropicProvider extracts thinking
 * blocks from responses, handler normalizes, framework persists for
 * round-trip. But there was no way to ASK Anthropic to think — the API
 * requires `thinking: { type: 'enabled', budget_tokens }` on the request.
 *
 * Phase 6.5 closes the request side:
 *   - LLMRequest.thinking?: { budget }
 *   - AnthropicProvider.buildParams translates to wire format
 *   - AgentBuilder.thinking({ budget }) sets it agent-wide
 *   - callLLM threads the budget into baseRequest
 *
 * 7-pattern coverage:
 *   1. Unit         — buildParams maps thinking.budget → API params
 *   2. Scenario     — Agent end-to-end: builder.thinking() → fake SDK sees thinking on each call
 *   3. Integration  — full activation + response round-trip (request asks, response delivers)
 *   4. Property     — random budgets pass through unmodified
 *   5. Security     — thinking config doesn't pollute systemPrompt / messages / tools
 *   6. Performance  — adding .thinking() doesn't measurably slow agent build/run
 *   7. ROI          — realistic agent: ask 5000-token budget, see request shape on every turn
 */

import { describe, expect, it, vi } from 'vitest';
import {
  Agent,
  defineTool,
  type LLMProvider,
  type LLMResponse,
  type LLMRequest,
} from '../../src/index.js';
import { AnthropicProvider } from '../../src/adapters/llm/AnthropicProvider.js';

// ─── Fake Anthropic SDK ───────────────────────────────────────────

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

function makeClient(turns: readonly FakeMessage[], recorder: { params: unknown[] }) {
  let i = 0;
  const next = (params: unknown): FakeMessage => {
    recorder.params.push(params);
    const t = turns[i] ?? turns[turns.length - 1]!;
    i += 1;
    return t;
  };
  return {
    messages: {
      create: vi.fn(async (params: unknown) => next(params)),
      stream: vi.fn((params: unknown) => {
        const final = next(params);
        const events = (
          final.content.filter((b) => b.type === 'text') as { text: string }[]
        ).flatMap((b) =>
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

const baseTurn: FakeMessage = {
  id: 'msg_1',
  model: 'claude-sonnet-4-5-20250929',
  role: 'assistant',
  content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
};

// ─── 1. UNIT — buildParams direct ─────────────────────────────────

describe('Phase 6.5 — unit: buildParams maps LLMRequest.thinking → API', () => {
  it('LLMRequest.thinking present → API params include thinking activation', async () => {
    const recorder = { params: [] as unknown[] };
    const client = makeClient([baseTurn], recorder);
    const provider = new AnthropicProvider({ apiKey: 'x', _client: client as never });

    const req: LLMRequest = {
      model: 'claude-sonnet-4-5-20250929',
      messages: [{ role: 'user', content: 'go' }],
      thinking: { budget: 5000 },
    };
    await provider.complete(req);

    const params = recorder.params[0] as { thinking?: { type: string; budget_tokens: number } };
    expect(params.thinking).toEqual({ type: 'enabled', budget_tokens: 5000 });
  });

  it('LLMRequest.thinking omitted → API params have no thinking field', async () => {
    const recorder = { params: [] as unknown[] };
    const client = makeClient([baseTurn], recorder);
    const provider = new AnthropicProvider({ apiKey: 'x', _client: client as never });

    await provider.complete({
      model: 'claude-sonnet-4-5-20250929',
      messages: [{ role: 'user', content: 'go' }],
    });
    const params = recorder.params[0] as { thinking?: unknown };
    expect(params.thinking).toBeUndefined();
  });

  it('streaming path also forwards thinking activation', async () => {
    const recorder = { params: [] as unknown[] };
    const client = makeClient([baseTurn], recorder);
    const provider = new AnthropicProvider({ apiKey: 'x', _client: client as never });

    const stream = provider.stream({
      model: 'claude-sonnet-4-5-20250929',
      messages: [{ role: 'user', content: 'go' }],
      thinking: { budget: 2048 },
    });
    // Drain the stream
    for await (const _ of stream) void _;
    const params = recorder.params[0] as { thinking?: { budget_tokens: number } };
    expect(params.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
  });
});

// ─── 2. SCENARIO — AgentBuilder.thinking() end-to-end ────────────

describe('Phase 6.5 — scenario: AgentBuilder.thinking({budget}) reaches every LLM call', () => {
  it('every LLM request the agent makes carries thinking.budget', async () => {
    const recorder = { params: [] as unknown[] };
    // Two turns: tool_use → end_turn
    const turns: FakeMessage[] = [
      {
        id: 'msg_1',
        model: 'claude-sonnet-4-5-20250929',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu-1', name: 'echo', input: {} }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      {
        id: 'msg_2',
        model: 'claude-sonnet-4-5-20250929',
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ];
    const client = makeClient(turns, recorder);
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
      .thinking({ budget: 3000 })
      .build();

    await agent.run({ message: 'go' });

    expect(recorder.params).toHaveLength(2);
    for (const p of recorder.params) {
      const params = p as { thinking?: { budget_tokens: number } };
      expect(params.thinking).toEqual({ type: 'enabled', budget_tokens: 3000 });
    }
  });

  it('agent without .thinking() never sets thinking on requests', async () => {
    const recorder = { params: [] as unknown[] };
    const client = makeClient([baseTurn], recorder);
    const provider = new AnthropicProvider({ apiKey: 'x', _client: client as never });

    const agent = Agent.create({ provider, model: 'claude-sonnet-4-5-20250929' })
      .system('s')
      .build();
    await agent.run({ message: 'go' });

    const params = recorder.params[0] as { thinking?: unknown };
    expect(params.thinking).toBeUndefined();
  });

  it('builder rejects calling .thinking() twice', () => {
    const provider: LLMProvider = {
      name: 'mock',
      complete: async () => ({
        content: '',
        toolCalls: [],
        usage: { input: 0, output: 0 },
        stopReason: 'end_turn',
      }),
    };
    const builder = Agent.create({ provider, model: 'mock' })
      .system('s')
      .thinking({ budget: 1000 });
    expect(() => builder.thinking({ budget: 2000 })).toThrow(/already set/);
  });

  it('builder rejects non-positive / non-finite budgets', () => {
    const provider: LLMProvider = {
      name: 'mock',
      complete: async () => ({
        content: '',
        toolCalls: [],
        usage: { input: 0, output: 0 },
        stopReason: 'end_turn',
      }),
    };
    const fresh = () => Agent.create({ provider, model: 'mock' }).system('s');
    expect(() => fresh().thinking({ budget: 0 })).toThrow(/positive/);
    expect(() => fresh().thinking({ budget: -1 })).toThrow(/positive/);
    expect(() => fresh().thinking({ budget: Number.NaN })).toThrow(/positive/);
    expect(() => fresh().thinking({ budget: Number.POSITIVE_INFINITY })).toThrow(/positive/);
  });
});

// ─── 3. INTEGRATION — full request → response loop ────────────────

describe('Phase 6.5 — integration: ask + receive thinking blocks', () => {
  it('agent with .thinking() asks for thinking AND receives blocks AND round-trips signature', async () => {
    const sig = 'phase65-roundtrip-sig-9876';
    const recorder = { params: [] as unknown[] };
    const turns: FakeMessage[] = [
      {
        id: 'msg_1',
        model: 'claude-sonnet-4-5-20250929',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Let me reason about this', signature: sig },
          { type: 'tool_use', id: 'tu-1', name: 'lookup', input: { id: 'x' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      {
        id: 'msg_2',
        model: 'claude-sonnet-4-5-20250929',
        role: 'assistant',
        content: [{ type: 'text', text: 'final' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 3 },
      },
    ];
    const client = makeClient(turns, recorder);
    const provider = new AnthropicProvider({ apiKey: 'x', _client: client as never });
    const lookupTool = defineTool({
      name: 'lookup',
      description: 'l',
      inputSchema: { type: 'object' },
      execute: async () => 'data',
    });

    const agent = Agent.create({ provider, model: 'claude-sonnet-4-5-20250929', maxIterations: 4 })
      .system('s')
      .tool(lookupTool)
      .thinking({ budget: 4096 })
      .build();
    await agent.run({ message: 'go' });

    // Turn 1: request asks for thinking
    const turn1 = recorder.params[0] as { thinking?: { budget_tokens: number } };
    expect(turn1.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });

    // Turn 2: STILL asks (every call), AND echoes prior thinking with signature
    const turn2 = recorder.params[1] as {
      thinking?: { budget_tokens: number };
      messages: { role: string; content: FakeContentBlock[] | string }[];
    };
    expect(turn2.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });

    const assistantMsg = turn2.messages.find(
      (m): m is { role: string; content: FakeContentBlock[] } =>
        m.role === 'assistant' && Array.isArray(m.content),
    );
    const echoedThinking = assistantMsg!.content.find((b) => b.type === 'thinking');
    expect(echoedThinking?.signature).toBe(sig);
  });
});

// ─── 4. PROPERTY — random budgets ────────────────────────────────

describe('Phase 6.5 — property: random valid budgets pass through unmodified', () => {
  it('20 random positive budgets all reach API as budget_tokens', async () => {
    for (let trial = 0; trial < 20; trial++) {
      const budget = 1 + Math.floor(Math.random() * 64000);
      const recorder = { params: [] as unknown[] };
      const client = makeClient([baseTurn], recorder);
      const provider = new AnthropicProvider({ apiKey: 'x', _client: client as never });

      await provider.complete({
        model: 'claude-sonnet-4-5-20250929',
        messages: [{ role: 'user', content: 'x' }],
        thinking: { budget },
      });
      const p = recorder.params[0] as { thinking?: { budget_tokens: number } };
      expect(p.thinking?.budget_tokens).toBe(budget);
    }
  });
});

// ─── 5. SECURITY — config isolation ──────────────────────────────

describe('Phase 6.5 — security: thinking config does not pollute other request fields', () => {
  it('thinking field does not leak into systemPrompt / messages / tools', async () => {
    const recorder = { params: [] as unknown[] };
    const client = makeClient([baseTurn], recorder);
    const provider = new AnthropicProvider({ apiKey: 'x', _client: client as never });

    await provider.complete({
      model: 'claude-sonnet-4-5-20250929',
      systemPrompt: 'you are helpful',
      messages: [{ role: 'user', content: 'go' }],
      thinking: { budget: 1234 },
    });
    const p = recorder.params[0] as {
      thinking?: unknown;
      system?: string;
      messages: { content: unknown }[];
    };
    // budget should be on `thinking` field ONLY
    expect(p.thinking).toEqual({ type: 'enabled', budget_tokens: 1234 });
    // System prompt unchanged
    expect(p.system).toBe('you are helpful');
    // No '1234' or 'budget' string leak into other fields
    const otherFields = JSON.stringify({ system: p.system, messages: p.messages });
    expect(otherFields).not.toContain('1234');
    expect(otherFields).not.toContain('budget_tokens');
  });
});

// ─── 6. PERFORMANCE — no overhead when omitted ───────────────────

describe('Phase 6.5 — performance: setting .thinking() has minimal overhead', () => {
  it('agent with vs without .thinking() — comparable build+run perf', async () => {
    const provider: LLMProvider = {
      name: 'mock',
      complete: async () => ({
        content: 'ok',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'end_turn',
      }),
    };

    const t1 = performance.now();
    for (let i = 0; i < 20; i++) {
      const a = Agent.create({ provider, model: 'mock' }).system('s').build();
      await a.run({ message: 'x' });
    }
    const dur1 = performance.now() - t1;

    const t2 = performance.now();
    for (let i = 0; i < 20; i++) {
      const a = Agent.create({ provider, model: 'mock' })
        .system('s')
        .thinking({ budget: 1000 })
        .build();
      await a.run({ message: 'x' });
    }
    const dur2 = performance.now() - t2;

    // Generous slack — assert .thinking() doesn't 2x the run cost.
    expect(dur2).toBeLessThan(dur1 * 2 + 200);
  });
});

// ─── 7. ROI — realistic agent with thinking ──────────────────────

describe('Phase 6.5 — ROI: realistic .thinking() agent', () => {
  it('refund agent with .thinking({budget: 5000}) — every turn requests thinking', async () => {
    const recorder = { params: [] as unknown[] };
    let turn = 0;
    const provider: LLMProvider = {
      name: 'mock',
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        recorder.params.push(req);
        turn += 1;
        if (turn === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'tu-1', name: 'lookup_order', args: { id: 'ord-42' } }],
            usage: { input: 50, output: 30 },
            stopReason: 'tool_use',
          };
        }
        return {
          content: 'Refund processed',
          toolCalls: [],
          usage: { input: 80, output: 40 },
          stopReason: 'end_turn',
        };
      },
    };
    const lookup = defineTool({
      name: 'lookup_order',
      description: 'fetch',
      inputSchema: { type: 'object' },
      execute: async () => JSON.stringify({ total: 50 }),
    });

    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .system('Refund agent.')
      .tool(lookup)
      .thinking({ budget: 5000 })
      .build();

    await agent.run({ message: 'Refund ord-42' });

    expect(recorder.params).toHaveLength(2);
    for (const r of recorder.params as LLMRequest[]) {
      expect(r.thinking).toEqual({ budget: 5000 });
    }
  });
});
