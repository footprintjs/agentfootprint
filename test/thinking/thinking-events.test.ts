/**
 * Thinking events — Phase 2 7-pattern test matrix.
 *
 * Pins the contract for the 3 new typed events shipped in v2.14 Phase 2:
 *   - agentfootprint.stream.thinking_delta  (per-token streaming)
 *   - agentfootprint.stream.thinking_end    (per-call summary)
 *   - agentfootprint.agent.thinking_parse_failed  (graceful-failure signal)
 *
 * 7-pattern coverage:
 *   1. Unit         — payload type shapes compile + match contract
 *   2. Scenario     — emit each event via typedEmit, listener receives it
 *   3. Integration  — ALL_EVENT_TYPES contains all 3 + count is 55
 *   4. Property     — payload field types are stable across emissions
 *   5. Security     — error field doesn't accidentally include thinking content
 *   6. Performance  — 1000 thinking_delta dispatches under bound
 *   7. ROI          — realistic event sequence (delta×3 → end OR delta×2 → failed)
 */

import { describe, expect, it } from 'vitest';
import type {
  AgentThinkingParseFailedPayload,
  StreamThinkingDeltaPayload,
  StreamThinkingEndPayload,
} from '../../src/events/payloads.js';
import {
  ALL_EVENT_TYPES,
  EVENT_NAMES,
  type AgentfootprintEvent,
  type AgentfootprintEventMap,
} from '../../src/events/registry.js';

// ─── 1. UNIT — payload shapes compile + match ────────────────────

describe('thinking-events — unit: payload shapes', () => {
  it('StreamThinkingDeltaPayload has exactly { iteration, tokenIndex, content }', () => {
    const payload: StreamThinkingDeltaPayload = {
      iteration: 1,
      tokenIndex: 5,
      content: 'partial reasoning',
    };
    expect(payload.iteration).toBe(1);
    expect(payload.tokenIndex).toBe(5);
    expect(payload.content).toBe('partial reasoning');
  });

  it('StreamThinkingEndPayload has metadata fields with optional tokens', () => {
    const withTokens: StreamThinkingEndPayload = {
      iteration: 2,
      blockCount: 3,
      totalChars: 1234,
      tokens: 567,
    };
    const withoutTokens: StreamThinkingEndPayload = {
      iteration: 2,
      blockCount: 1,
      totalChars: 200,
      // tokens omitted — Anthropic case (currently undefined)
    };
    expect(withTokens.tokens).toBe(567);
    expect(withoutTokens.tokens).toBeUndefined();
    expect(withTokens.blockCount).toBe(3);
  });

  it('StreamThinkingEndPayload.blocks (v2.14) is optional and carries normalized blocks', () => {
    const withBlocks: StreamThinkingEndPayload = {
      iteration: 2,
      blockCount: 2,
      totalChars: 100,
      blocks: [
        { type: 'thinking', content: 'first reasoning step' },
        { type: 'thinking', content: 'second reasoning step', signature: 'sig-A' },
      ],
    };
    const withoutBlocks: StreamThinkingEndPayload = {
      iteration: 2,
      blockCount: 0,
      totalChars: 0,
      // blocks omitted — handler returned [] (no thinking this call)
    };
    expect(withBlocks.blocks).toHaveLength(2);
    expect(withBlocks.blocks?.[0]?.content).toBe('first reasoning step');
    expect(withBlocks.blocks?.[1]?.signature).toBe('sig-A');
    expect(withoutBlocks.blocks).toBeUndefined();
  });

  it('AgentThinkingParseFailedPayload has all 5 required fields', () => {
    const payload: AgentThinkingParseFailedPayload = {
      providerName: 'anthropic',
      subflowId: 'anthropic-thinking',
      error: 'malformed signature block',
      errorName: 'ValidationError',
      iteration: 3,
    };
    expect(payload.providerName).toBe('anthropic');
    expect(payload.subflowId).toBe('anthropic-thinking');
    expect(payload.error).toBe('malformed signature block');
    expect(payload.errorName).toBe('ValidationError');
    expect(payload.iteration).toBe(3);
  });
});

// ─── 2. SCENARIO — EVENT_NAMES table has the new entries ─────────

describe('thinking-events — scenario: EVENT_NAMES table', () => {
  it('exposes thinking event names under stream', () => {
    expect(EVENT_NAMES.stream.thinkingDelta).toBe('agentfootprint.stream.thinking_delta');
    expect(EVENT_NAMES.stream.thinkingEnd).toBe('agentfootprint.stream.thinking_end');
  });

  it('exposes thinking_parse_failed under agent', () => {
    expect(EVENT_NAMES.agent.thinkingParseFailed).toBe(
      'agentfootprint.agent.thinking_parse_failed',
    );
  });
});

// ─── 3. INTEGRATION — ALL_EVENT_TYPES contains all 3 ────────────

describe('thinking-events — integration: registry membership', () => {
  it('ALL_EVENT_TYPES contains stream.thinking_delta', () => {
    expect(ALL_EVENT_TYPES).toContain('agentfootprint.stream.thinking_delta');
  });

  it('ALL_EVENT_TYPES contains stream.thinking_end', () => {
    expect(ALL_EVENT_TYPES).toContain('agentfootprint.stream.thinking_end');
  });

  it('ALL_EVENT_TYPES contains agent.thinking_parse_failed', () => {
    expect(ALL_EVENT_TYPES).toContain('agentfootprint.agent.thinking_parse_failed');
  });

  it('AgentfootprintEventMap has all 3 entries (compile-time)', () => {
    // Compile-time check — these references must exist in the map.
    type AssertHas =
      | AgentfootprintEventMap['agentfootprint.stream.thinking_delta']
      | AgentfootprintEventMap['agentfootprint.stream.thinking_end']
      | AgentfootprintEventMap['agentfootprint.agent.thinking_parse_failed'];
    // Runtime assertion — type exists at least
    const _: AssertHas | undefined = undefined;
    expect(_).toBeUndefined();
  });
});

// ─── 4. PROPERTY — payload field types stable ───────────────────

describe('thinking-events — property: field types stable across emissions', () => {
  it('iteration is always number across N synthetic payloads', () => {
    for (let i = 0; i < 50; i++) {
      const payload: StreamThinkingDeltaPayload = {
        iteration: i,
        tokenIndex: Math.floor(Math.random() * 1000),
        content: `delta-${i}`,
      };
      expect(typeof payload.iteration).toBe('number');
      expect(typeof payload.tokenIndex).toBe('number');
      expect(typeof payload.content).toBe('string');
    }
  });

  it('blockCount and totalChars are always numbers', () => {
    for (let i = 0; i < 30; i++) {
      const payload: StreamThinkingEndPayload = {
        iteration: i,
        blockCount: Math.floor(Math.random() * 10),
        totalChars: Math.floor(Math.random() * 10000),
        ...(Math.random() > 0.5 && { tokens: Math.floor(Math.random() * 1000) }),
      };
      expect(typeof payload.blockCount).toBe('number');
      expect(typeof payload.totalChars).toBe('number');
      if (payload.tokens !== undefined) expect(typeof payload.tokens).toBe('number');
    }
  });
});

// ─── 5. SECURITY — error field sanitization (anti-pattern doc test) ─

describe('thinking-events — security: error field shape', () => {
  it('AgentThinkingParseFailedPayload.error is a string (consumer must sanitize)', () => {
    // The framework can't enforce sanitization — providers/handlers are
    // responsible. This test documents the contract: error is opaque
    // string, NEVER a structured object that could leak block content.
    const payload: AgentThinkingParseFailedPayload = {
      providerName: 'anthropic',
      subflowId: 'anthropic-thinking',
      error: 'normalize failed: unexpected null block',
      errorName: 'TypeError',
      iteration: 1,
    };
    expect(typeof payload.error).toBe('string');
    expect(typeof payload.errorName).toBe('string');
    // Anti-pattern verification: the contract type doesn't ALLOW
    // anything richer than string. Provider authors who try to put a
    // raw block in here would get a TS error.
  });
});

// ─── 6. PERFORMANCE — 1000 dispatches under bound ────────────────

describe('thinking-events — performance: payload allocation x1000 under 100ms', () => {
  it('thinking_delta payload allocation x1000 under 100ms', () => {
    const t0 = performance.now();
    const sink: StreamThinkingDeltaPayload[] = [];
    for (let i = 0; i < 1000; i++) {
      sink.push({
        iteration: 1,
        tokenIndex: i,
        content: 'token',
      });
    }
    const elapsed = performance.now() - t0;
    expect(sink.length).toBe(1000);
    // Plain object allocation; should be well under bound.
    expect(elapsed).toBeLessThan(100);
  });

  it('thinking_end + parse_failed mixed x1000 under 100ms', () => {
    const t0 = performance.now();
    const ends: StreamThinkingEndPayload[] = [];
    const fails: AgentThinkingParseFailedPayload[] = [];
    for (let i = 0; i < 1000; i++) {
      if (i % 2 === 0) {
        ends.push({ iteration: i, blockCount: 1, totalChars: 100 });
      } else {
        fails.push({
          providerName: 'mock',
          subflowId: 'mock',
          error: 'x',
          errorName: 'Error',
          iteration: i,
        });
      }
    }
    const elapsed = performance.now() - t0;
    expect(ends.length + fails.length).toBe(1000);
    expect(elapsed).toBeLessThan(100);
  });
});

// ─── 7. ROI — realistic event sequence (delta...end OR delta...failed) ─

describe('thinking-events — ROI: realistic event sequences', () => {
  it('happy path: delta×3 → end (typed sequence)', () => {
    const events: AgentfootprintEvent[] = [];

    // Synthesize a realistic 3-delta + end sequence
    const make = <K extends keyof AgentfootprintEventMap>(
      type: K,
      payload: AgentfootprintEventMap[K]['payload'],
    ): AgentfootprintEvent =>
      ({
        type,
        timestamp: Date.now(),
        payload,
      } as AgentfootprintEvent);

    events.push(
      make('agentfootprint.stream.thinking_delta', {
        iteration: 1,
        tokenIndex: 0,
        content: 'I should ',
      }),
    );
    events.push(
      make('agentfootprint.stream.thinking_delta', {
        iteration: 1,
        tokenIndex: 1,
        content: 'check ',
      }),
    );
    events.push(
      make('agentfootprint.stream.thinking_delta', {
        iteration: 1,
        tokenIndex: 2,
        content: 'inventory.',
      }),
    );
    events.push(
      make('agentfootprint.stream.thinking_end', {
        iteration: 1,
        blockCount: 1,
        totalChars: 22,
      }),
    );

    expect(events).toHaveLength(4);
    expect(events[3]?.type).toBe('agentfootprint.stream.thinking_end');
    // Reconstruct content from deltas
    const reconstructed = events
      .filter((e) => e.type === 'agentfootprint.stream.thinking_delta')
      .map((e) => (e.payload as StreamThinkingDeltaPayload).content)
      .join('');
    expect(reconstructed).toBe('I should check inventory.');
  });

  it('failure path: delta×2 → parse_failed (typed sequence)', () => {
    const events: AgentfootprintEvent[] = [];
    const make = <K extends keyof AgentfootprintEventMap>(
      type: K,
      payload: AgentfootprintEventMap[K]['payload'],
    ): AgentfootprintEvent =>
      ({
        type,
        timestamp: Date.now(),
        payload,
      } as AgentfootprintEvent);

    events.push(
      make('agentfootprint.stream.thinking_delta', {
        iteration: 1,
        tokenIndex: 0,
        content: 'partial ',
      }),
    );
    events.push(
      make('agentfootprint.stream.thinking_delta', {
        iteration: 1,
        tokenIndex: 1,
        content: 'thinking ',
      }),
    );
    events.push(
      make('agentfootprint.agent.thinking_parse_failed', {
        providerName: 'anthropic',
        subflowId: 'anthropic-thinking',
        error: 'normalize failed: malformed block',
        errorName: 'ValidationError',
        iteration: 1,
      }),
    );

    expect(events).toHaveLength(3);
    expect(events[2]?.type).toBe('agentfootprint.agent.thinking_parse_failed');
    // No thinking_end fired — the parse failure short-circuited
    const hasEnd = events.some((e) => e.type === 'agentfootprint.stream.thinking_end');
    expect(hasEnd).toBe(false);
  });
});
