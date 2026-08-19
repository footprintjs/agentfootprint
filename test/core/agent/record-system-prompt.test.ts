/**
 * Opt-in system-prompt capture (9.50.0) — `recordSystemPrompt: true` puts the
 * ASSEMBLED system prompt on `agentfootprint.stream.llm_start` as
 * `systemPromptText`, verbatim as sent.
 *
 * The default is the feature: OFF. The assembled prompt is as sensitive as
 * everything injected into it (skill bodies, RAG passages, memory, per-user
 * instructions) and can be large once per iteration — so absent the dial,
 * `llm_start` keeps its exact prior bytes and the recording honestly does NOT
 * carry the string (only `systemPromptChars`, the length). This file pins the
 * three-way contract: absent by default · present and VERBATIM when on ·
 * identical to what the provider actually received.
 *
 * Sections follow Convention 3: Integration (Agent, multi-piece assembly,
 * per-iteration) · The twin (LLMCall) · Zero-delta (the privacy default).
 */

import { describe, expect, it } from 'vitest';
import { Agent, LLMCall } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { defineSkill, skillGraph } from '../../../src/injection-engine.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

type LLMStart = { iteration: number; systemPromptChars: number; systemPromptText?: string };

const watchStarts = (runner: {
  on: (n: 'agentfootprint.stream.llm_start', f: (e: { payload: LLMStart }) => void) => unknown;
}) => {
  const starts: LLMStart[] = [];
  runner.on('agentfootprint.stream.llm_start', (e) => starts.push(e.payload));
  return starts;
};

/** A mock that also keeps every request it was handed — the wire truth. */
const wireTap = () => {
  const requests: LLMRequest[] = [];
  const provider = mock({
    respond: (req: LLMRequest) => {
      requests.push(req);
      return { content: 'done', toolCalls: [], stopReason: 'stop' } as LLMResponse;
    },
  });
  return { provider, requests };
};

// ─── 1. INTEGRATION — the Agent ──────────────────────────────────────

describe('recordSystemPrompt — Agent', () => {
  it('ON: llm_start carries the assembled prompt VERBATIM — the exact string the provider received', async () => {
    const { provider, requests } = wireTap();
    const agent = Agent.create({ provider, model: 'mock', recordSystemPrompt: true })
      .system('You are support.')
      .skillGraph(
        skillGraph()
          .entry(defineSkill({ id: 'triage', description: 'first look', body: 'TRIAGE BODY' }))
          .build(),
      )
      .build();
    const starts = watchStarts(agent);
    await agent.run({ message: 'hello' });

    expect(starts.length).toBeGreaterThan(0);
    const start = starts[0]!;
    expect(start.systemPromptText).toBeDefined();
    // Verbatim as sent: byte-equal to the request's own systemPrompt…
    expect(start.systemPromptText).toBe(requests[0]!.systemPrompt);
    // …assembled from MORE than the base prompt (the skill body is in it),
    // which is the whole point — the pieces were always on the record, the
    // joined string was not.
    expect(start.systemPromptText).toContain('You are support.');
    expect(start.systemPromptText).toContain('TRIAGE BODY');
    // The length field and the text agree — one fact, two encodings.
    expect(start.systemPromptChars).toBe(start.systemPromptText!.length);
  });

  it('ON: every iteration carries ITS OWN assembled prompt (the string can change per call)', async () => {
    let i = 0;
    const provider = mock({
      respond: (): LLMResponse =>
        ++i === 1
          ? {
              content: 'thinking',
              toolCalls: [{ id: 't1', name: 'probe', args: {} }],
              stopReason: 'tool_use',
            }
          : { content: 'done', toolCalls: [], stopReason: 'stop' },
    });
    const agent = Agent.create({
      provider,
      model: 'mock',
      recordSystemPrompt: true,
      maxIterations: 3,
    })
      .system('base')
      .tool({
        schema: { name: 'probe', description: 'probe', inputSchema: { type: 'object' } },
        execute: async () => 'ok',
      })
      .build();
    const starts = watchStarts(agent);
    await agent.run({ message: 'go' });
    expect(starts.length).toBeGreaterThanOrEqual(2);
    for (const s of starts) {
      expect(typeof s.systemPromptText).toBe('string');
      expect(s.systemPromptChars).toBe(s.systemPromptText!.length);
    }
  });
});

// ─── 2. THE TWIN — LLMCall ───────────────────────────────────────────

describe('recordSystemPrompt — LLMCall (the twin option)', () => {
  it('ON: the one-shot call carries its prompt; OFF (default): it does not', async () => {
    const on = LLMCall.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      recordSystemPrompt: true,
    })
      .system('Be brief.')
      .build();
    const onStarts = watchStarts(on);
    await on.run({ message: 'hi' });
    expect(onStarts[0]!.systemPromptText).toBe('Be brief.');

    const off = LLMCall.create({ provider: mock({ reply: 'done' }), model: 'mock' })
      .system('Be brief.')
      .build();
    const offStarts = watchStarts(off);
    await off.run({ message: 'hi' });
    expect(offStarts.length).toBeGreaterThan(0);
    expect('systemPromptText' in offStarts[0]!).toBe(false);
  });
});

// ─── 3. ZERO-DELTA — the privacy default ─────────────────────────────

describe('recordSystemPrompt — the default is OFF, and OFF means absent', () => {
  it('an agent that never asked emits llm_start WITHOUT the key — length only, text honestly absent', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' })
      .system('secret-adjacent prompt')
      .build();
    const starts = watchStarts(agent);
    await agent.run({ message: 'hello' });

    expect(starts.length).toBeGreaterThan(0);
    for (const s of starts) {
      expect('systemPromptText' in s).toBe(false);
      expect(s.systemPromptChars).toBeGreaterThan(0);
    }
  });

  it('`recordSystemPrompt: false` is the same as omitting it', async () => {
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      recordSystemPrompt: false,
    })
      .system('prompt')
      .build();
    const starts = watchStarts(agent);
    await agent.run({ message: 'hello' });
    expect('systemPromptText' in starts[0]!).toBe(false);
  });
});
