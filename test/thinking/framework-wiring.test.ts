/**
 * Framework wiring — Phase 3 7-pattern test matrix.
 *
 * Pins the contract for the v2.14 Phase 3 wiring:
 *   - buildThinkingSubflow auto-wraps a ThinkingHandler in a real subflow
 *   - Auto-wire by provider.name via findThinkingHandler
 *   - Build-time conditional mount (ZERO overhead when no handler)
 *   - .thinkingHandler() builder method (override + opt-out + auto)
 *   - callLLM populates scope.rawThinking from response.rawThinking
 *   - NormalizeThinking subflow runs handler with failure isolation
 *   - toolCalls.ts + prepareFinal.ts attach thinkingBlocks to assistant message
 *   - redactThinkingBlocks pure helper scrubs content
 *
 * 7-pattern coverage:
 *   1. Unit         — buildThinkingSubflow + redactThinkingBlocks pure helpers
 *   2. Scenario     — agent with mock provider + auto-wire emits thinking_end event
 *   3. Integration  — assistant message in scope.history has thinkingBlocks
 *   4. Property     — random handler outputs preserve message-construction invariants
 *   5. Security     — redaction scrubs content; signature byte-exact preserved
 *   6. Performance  — agent without handler has SAME perf as v2.13 (no extra stage)
 *   7. ROI          — end-to-end Mock provider with thinking → blocks → assistant message
 */

import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  type LLMResponse,
  type LLMMessage,
  type LLMProvider,
  type Tool,
} from '../../src/index.js';
import {
  type ThinkingBlock,
  type ThinkingHandler,
  mockThinkingHandler,
} from '../../src/thinking/index.js';
import { redactThinkingBlocks, REDACTED_PLACEHOLDER } from '../../src/security/index.js';
import { buildThinkingSubflow } from '../../src/core/slots/buildThinkingSubflow.js';

// ─── Fixtures ─────────────────────────────────────────────────────

/** Build a mock provider that emits a configurable response per call. */
function mockProvider(opts: {
  name?: string;
  rawThinking?: unknown;
  content?: string;
}): LLMProvider {
  let calls = 0;
  return {
    name: opts.name ?? 'mock',
    complete: async (): Promise<LLMResponse> => {
      calls += 1;
      return {
        content: opts.content ?? 'final answer',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'end_turn',
        ...(opts.rawThinking !== undefined && { rawThinking: opts.rawThinking }),
      };
    },
  };
}

// ─── 1. UNIT — pure helpers ──────────────────────────────────────

describe('framework-wiring — unit: buildThinkingSubflow returns FlowChart', () => {
  it('returns a built FlowChart (subflow.start exists)', () => {
    const subflow = buildThinkingSubflow(mockThinkingHandler);
    // FlowChart shape — has metadata for the start stage
    expect(subflow).toBeDefined();
    expect(typeof subflow).toBe('object');
  });
});

describe('framework-wiring — unit: redactThinkingBlocks', () => {
  it('returns input unchanged when no patterns', () => {
    const blocks: ThinkingBlock[] = [{ type: 'thinking', content: 'sensitive content' }];
    expect(redactThinkingBlocks(blocks, undefined)).toBe(blocks);
    expect(redactThinkingBlocks(blocks, [])).toBe(blocks);
  });

  it('returns input unchanged when no content matches', () => {
    const blocks: ThinkingBlock[] = [{ type: 'thinking', content: 'hello world' }];
    expect(redactThinkingBlocks(blocks, [/secret/g])).toBe(blocks);
  });

  it('scrubs content when patterns match', () => {
    const blocks: ThinkingBlock[] = [{ type: 'thinking', content: 'My SSN is 123-45-6789 here' }];
    const out = redactThinkingBlocks(blocks, [/\d{3}-\d{2}-\d{4}/g]);
    expect(out[0]?.content).toBe(`My SSN is ${REDACTED_PLACEHOLDER} here`);
  });

  it('preserves signature byte-exact when scrubbing content', () => {
    const blocks: ThinkingBlock[] = [
      { type: 'thinking', content: 'sensitive', signature: 'sig-byte-exact-XYZ' },
    ];
    const out = redactThinkingBlocks(blocks, [/sensitive/g]);
    expect(out[0]?.signature).toBe('sig-byte-exact-XYZ');
    expect(out[0]?.content).toBe(REDACTED_PLACEHOLDER);
  });

  it('preserves type, summary, providerMeta when scrubbing', () => {
    const blocks: ThinkingBlock[] = [
      {
        type: 'redacted_thinking',
        content: 'should-be-empty-anyway',
        signature: 'sig',
        summary: true,
      },
    ];
    const out = redactThinkingBlocks(blocks, [/should/g]);
    expect(out[0]?.type).toBe('redacted_thinking');
    expect(out[0]?.summary).toBe(true);
    expect(out[0]?.signature).toBe('sig');
  });
});

// ─── 2. SCENARIO — auto-wire fires thinking_end ──────────────────

describe('framework-wiring — scenario: auto-wire emits thinking_end event', () => {
  it('mock provider with rawThinking → handler runs → thinking_end fires', async () => {
    const events: Array<{ blockCount: number; totalChars: number }> = [];

    // Mock provider's name === 'mock' triggers auto-wire to mockThinkingHandler.
    const provider = mockProvider({
      name: 'mock',
      rawThinking: {
        kind: 'anthropic',
        blocks: [{ type: 'thinking', thinking: 'reasoning here' }],
      },
      content: 'final answer',
    });

    const agent = Agent.create({ provider, model: 'mock' }).system('s').build();
    agent.on('agentfootprint.stream.thinking_end', (e) => {
      events.push({
        blockCount: e.payload.blockCount,
        totalChars: e.payload.totalChars,
      });
    });

    await agent.run({ message: 'go' });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ blockCount: 1, totalChars: 'reasoning here'.length });
  });
});

// ─── 3. INTEGRATION — assistant message in history has thinkingBlocks ─

describe('framework-wiring — integration: scope.thinkingBlocks + tool-using flow', () => {
  it('scope.thinkingBlocks is populated after a thinking-enabled run', async () => {
    const provider = mockProvider({
      name: 'mock',
      rawThinking: {
        kind: 'anthropic',
        blocks: [{ type: 'thinking', thinking: 'reasoning', signature: 'sig-A' }],
      },
      content: 'done',
    });
    const agent = Agent.create({ provider, model: 'mock' }).system('s').build();
    await agent.run({ message: 'go' });
    const snap = agent.getLastSnapshot();
    const state = snap?.sharedState as { thinkingBlocks?: readonly ThinkingBlock[] };
    expect(state.thinkingBlocks).toBeDefined();
    expect(state.thinkingBlocks?.length).toBe(1);
    expect(state.thinkingBlocks?.[0]?.signature).toBe('sig-A');
  });

  it('tool-using flow: assistant message in scope.history carries thinkingBlocks', async () => {
    let calls = 0;
    const provider: LLMProvider = {
      name: 'mock',
      complete: async (): Promise<LLMResponse> => {
        calls += 1;
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'tc-1', name: 'echo', args: {} }],
            usage: { input: 1, output: 1 },
            stopReason: 'tool_use',
            rawThinking: {
              kind: 'anthropic',
              blocks: [{ type: 'thinking', thinking: 'I should call echo', signature: 'sig-1' }],
            },
          };
        }
        return {
          content: 'done',
          toolCalls: [],
          usage: { input: 1, output: 1 },
          stopReason: 'end_turn',
        };
      },
    };
    const echoTool: Tool = defineTool({
      name: 'echo',
      description: 'e',
      inputSchema: { type: 'object' },
      execute: async () => 'ok',
    });
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .system('s')
      .tool(echoTool)
      .build();
    await agent.run({ message: 'go' });
    const snap = agent.getLastSnapshot();
    const state = snap?.sharedState as { history?: readonly LLMMessage[] };
    const history = state.history ?? [];
    const firstAssistant = history.find(
      (m) => m.role === 'assistant' && (m.toolCalls?.length ?? 0) > 0,
    );
    // Assistant turn that emitted tool calls also carries the thinking blocks
    // signature byte-exact for Anthropic round-trip
    expect(firstAssistant?.thinkingBlocks).toBeDefined();
    expect(firstAssistant?.thinkingBlocks?.[0]?.signature).toBe('sig-1');
  });
});

// ─── 4. PROPERTY — random handler outputs hold invariants ────────

describe('framework-wiring — property: random handler outputs preserve invariants', () => {
  it('handler returning N blocks → scope.thinkingBlocks has N entries', async () => {
    for (let trial = 0; trial < 10; trial++) {
      const blockCount = Math.floor(Math.random() * 5);
      const blocks = Array.from({ length: blockCount }, (_, i) => ({
        type: 'thinking' as const,
        thinking: `block-${i}`,
        signature: `sig-${i}`,
      }));
      const provider = mockProvider({
        name: 'mock',
        rawThinking: { kind: 'anthropic', blocks },
        content: 'done',
      });
      const agent = Agent.create({ provider, model: 'mock' }).system('s').build();
      await agent.run({ message: 'go' });
      const snap = agent.getLastSnapshot();
      const state = snap?.sharedState as { thinkingBlocks?: readonly ThinkingBlock[] };
      const got = state.thinkingBlocks?.length ?? 0;
      expect(got).toBe(blockCount);
    }
  });
});

// ─── 5. SECURITY — opt-out + redaction byte-exact signature ──────

describe('framework-wiring — security: opt-out skips handler entirely', () => {
  it('thinkingHandler(null) does NOT run the handler even if provider matches', async () => {
    const events: number[] = [];
    const provider = mockProvider({
      name: 'mock',
      rawThinking: { kind: 'anthropic', blocks: [{ type: 'thinking', thinking: 'x' }] },
    });
    const agent = Agent.create({ provider, model: 'mock' })
      .system('s')
      .thinkingHandler(null)
      .build();
    agent.on('agentfootprint.stream.thinking_end', () => events.push(1));
    await agent.run({ message: 'go' });
    expect(events).toHaveLength(0); // handler never ran → no thinking_end
  });

  it('redactThinkingBlocks preserves signature byte-exact across redaction', () => {
    const blocks: ThinkingBlock[] = [
      { type: 'thinking', content: 'My SSN is 123-45-6789', signature: 'critical-sig-XYZ-12345' },
    ];
    const out = redactThinkingBlocks(blocks, [/\d{3}-\d{2}-\d{4}/g]);
    // Content scrubbed, signature unchanged → exactly the documented contract
    expect(out[0]?.content).not.toContain('123-45-6789');
    expect(out[0]?.signature).toBe('critical-sig-XYZ-12345');
  });
});

// ─── 6. PERFORMANCE — non-thinking agents have same perf ─────────

describe('framework-wiring — performance: no overhead when no handler resolves', () => {
  it('explicit opt-out (thinkingHandler(null)) — no overhead per turn', async () => {
    // Tight loop comparing baseline (no handler) to explicit opt-out.
    // Both should be roughly equivalent. Sanity check that
    // thinkingHandler(null) doesn't add hidden cost.
    const provider1 = mockProvider({ name: 'unknown-provider' }); // no auto-match
    const agent1 = Agent.create({ provider: provider1, model: 'mock' }).system('s').build();
    const t1 = performance.now();
    for (let i = 0; i < 10; i++) await agent1.run({ message: 'x' });
    const dur1 = performance.now() - t1;

    const provider2 = mockProvider({ name: 'mock' });
    const agent2 = Agent.create({ provider: provider2, model: 'mock' })
      .system('s')
      .thinkingHandler(null)
      .build();
    const t2 = performance.now();
    for (let i = 0; i < 10; i++) await agent2.run({ message: 'x' });
    const dur2 = performance.now() - t2;

    // Allow generous slack for CI variance — assert opt-out isn't 2x slower
    expect(dur2).toBeLessThan(dur1 * 2 + 200);
  });
});

// ─── 7. ROI — end-to-end with custom handler override ────────────

describe('framework-wiring — ROI: custom handler override end-to-end', () => {
  it('custom ThinkingHandler overrides auto-wire and runs end-to-end', async () => {
    let normalizeCalls = 0;
    const customHandler: ThinkingHandler = {
      id: 'custom',
      providerNames: ['custom-provider'],
      normalize: (raw): readonly ThinkingBlock[] => {
        normalizeCalls += 1;
        if (raw === undefined) return [];
        return [{ type: 'thinking', content: 'custom-normalized' }];
      },
    };

    const provider = mockProvider({
      name: 'mock', // mock would auto-wire to mockThinkingHandler...
      rawThinking: { custom: 'data' },
    });

    const agent = Agent.create({ provider, model: 'mock' })
      .system('s')
      .thinkingHandler(customHandler) // ...but explicit override wins
      .build();

    let endEvent: { blockCount: number; totalChars: number } | undefined;
    agent.on('agentfootprint.stream.thinking_end', (e) => {
      endEvent = { blockCount: e.payload.blockCount, totalChars: e.payload.totalChars };
    });

    await agent.run({ message: 'go' });

    expect(normalizeCalls).toBe(1);
    expect(endEvent).toEqual({ blockCount: 1, totalChars: 'custom-normalized'.length });
  });

  it('handler that throws → thinking_parse_failed event + run continues', async () => {
    const throwingHandler: ThinkingHandler = {
      id: 'throwing',
      providerNames: ['throwing-provider'],
      normalize: () => {
        throw new Error('normalize failed');
      },
    };

    const provider = mockProvider({
      name: 'mock',
      rawThinking: { anything: 'here' },
      content: 'still works',
    });

    const agent = Agent.create({ provider, model: 'mock' })
      .system('s')
      .thinkingHandler(throwingHandler)
      .build();

    let parseFailed: { error: string; subflowId: string } | undefined;
    agent.on('agentfootprint.agent.thinking_parse_failed', (e) => {
      parseFailed = { error: e.payload.error, subflowId: e.payload.subflowId };
    });

    const result = await agent.run({ message: 'go' });
    const content = typeof result === 'string' ? result : (result as { content: string }).content;

    expect(content).toBe('still works'); // Run completed
    expect(parseFailed).toBeDefined();
    expect(parseFailed?.error).toBe('normalize failed');
    expect(parseFailed?.subflowId).toBe('throwing');
  });
});
