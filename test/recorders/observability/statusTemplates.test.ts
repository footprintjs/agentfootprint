/**
 * statusTemplates — selector + renderer specs.
 *
 * The thinking surface is the FIRST-PERSON status the chat UI shows
 * mid-call (different from `commentaryTemplates`, which is the
 * THIRD-PERSON narration Lens shows in its commentary panel).
 *
 * 9 patterns covering the state machine consumers depend on:
 *   T1  No events                            → null (idle, no run yet)
 *   T2  llm.start, no tokens                 → 'idle'
 *   T3  llm.start + tokens                   → 'streaming' with partial
 *   T4  tool.start, not yet ended            → 'tool' with toolName
 *   T5  tool.end                             → falls back to LLM state
 *   T6  llm.end                              → null (run quiescent)
 *   T7  pause.request, no resume yet         → 'paused' overrides everything
 *   T8  pause.request + pause.resume         → falls back to underlying state
 *   T9  Per-tool override:
 *        renderer prefers `tool.<name>` over generic `tool`
 *
 * These are the EXACT bindings every chat-bubble consumer relies on.
 * Library-quality tests so future selector changes don't silently
 * break the contract.
 */

import { describe, expect, it } from 'vitest';
import type { AgentfootprintEvent } from '../../../src/index.js';
import {
  defaultStatusTemplates,
  renderStatusLine,
  selectStatus,
} from '../../../src/recorders/observability/status/statusTemplates.js';

// ── Helpers ────────────────────────────────────────────────────────

function evt(type: string, payload: Record<string, unknown> = {}): AgentfootprintEvent {
  return {
    type,
    payload,
    meta: {
      wallClockMs: 0,
      runOffsetMs: 0,
      runtimeStageId: 'test#0',
      subflowPath: [],
      compositionPath: [],
      runId: 'r',
    },
  } as unknown as AgentfootprintEvent;
}

// ── T1: empty event log ───────────────────────────────────────────

describe('selectStatus — T1: no events', () => {
  it('returns null when the log is empty', () => {
    expect(selectStatus([])).toBeNull();
  });
});

// ── T2: llm.start, no tokens yet ──────────────────────────────────

describe('selectStatus — T2: llm.start without tokens', () => {
  it('returns "idle" state', () => {
    const out = selectStatus([
      evt('agentfootprint.stream.llm_start', {
        iteration: 1,
        provider: 'm',
        model: 'm',
        messagesCount: 1,
        toolsCount: 0,
      }),
    ]);
    expect(out).toEqual({ state: 'idle', vars: {} });
  });
});

// ── T3: llm.start + tokens ────────────────────────────────────────

describe('selectStatus — T3: streaming tokens accumulate', () => {
  it('returns "streaming" with the concatenated partial', () => {
    const out = selectStatus([
      evt('agentfootprint.stream.llm_start', {}),
      evt('agentfootprint.stream.token', { tokenIndex: 0, content: 'Hello ' }),
      evt('agentfootprint.stream.token', { tokenIndex: 1, content: 'there' }),
    ]);
    expect(out).toEqual({ state: 'streaming', vars: { partial: 'Hello there' } });
  });
});

// ── T4: tool.start active ─────────────────────────────────────────

describe('selectStatus — T4: tool active', () => {
  it('returns "tool" with the toolName when tool.start has no matching end', () => {
    const out = selectStatus([
      evt('agentfootprint.stream.llm_start', {}),
      evt('agentfootprint.stream.llm_end', {
        toolCallCount: 1,
        usage: { input: 1, output: 1 },
        stopReason: 'tool_use',
        durationMs: 1,
      }),
      evt('agentfootprint.stream.tool_start', {
        toolName: 'weather',
        toolCallId: 'c1',
        args: { city: 'SF' },
      }),
    ]);
    expect(out?.state).toBe('tool');
    expect(out?.toolName).toBe('weather');
    expect(out?.vars.toolName).toBe('weather');
  });
});

// ── T5: tool.end → falls back to LLM state (or null) ──────────────

describe('selectStatus — T5: tool.end clears tool state', () => {
  it('after tool.end with no further llm.start, returns null (run quiescent between calls)', () => {
    const out = selectStatus([
      evt('agentfootprint.stream.llm_start', {}),
      evt('agentfootprint.stream.llm_end', {
        toolCallCount: 1,
        usage: { input: 1, output: 1 },
        stopReason: 'tool_use',
        durationMs: 1,
      }),
      evt('agentfootprint.stream.tool_start', { toolName: 'weather', toolCallId: 'c1', args: {} }),
      evt('agentfootprint.stream.tool_end', { toolCallId: 'c1', result: '72F', durationMs: 1 }),
    ]);
    expect(out).toBeNull();
  });
});

// ── T6: llm.end → null ────────────────────────────────────────────

describe('selectStatus — T6: llm.end terminal', () => {
  it('returns null after llm.end with no tool active', () => {
    const out = selectStatus([
      evt('agentfootprint.stream.llm_start', {}),
      evt('agentfootprint.stream.llm_end', {
        toolCallCount: 0,
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
        durationMs: 1,
      }),
    ]);
    expect(out).toBeNull();
  });
});

// ── T7: pause overrides everything ────────────────────────────────

describe('selectStatus — T7: pause.request active', () => {
  it('returns "paused" with question even if a tool is also "active"', () => {
    const out = selectStatus([
      evt('agentfootprint.stream.tool_start', {
        toolName: 'askOperator',
        toolCallId: 'c1',
        args: {},
      }),
      evt('agentfootprint.pause.request', {
        stage: 'tool-calls',
        reason: 'awaiting human approval',
        toolCallId: 'c1',
      }),
    ]);
    expect(out?.state).toBe('paused');
    expect(out?.vars.question).toContain('awaiting');
  });
});

// ── T8: pause + resume → falls through ────────────────────────────

describe('selectStatus — T8: pause + resume', () => {
  it('after pause.resume, no longer in "paused" state', () => {
    const out = selectStatus([
      evt('agentfootprint.stream.tool_start', {
        toolName: 'askOperator',
        toolCallId: 'c1',
        args: {},
      }),
      evt('agentfootprint.pause.request', {
        stage: 'tool-calls',
        reason: 'wait',
        toolCallId: 'c1',
      }),
      evt('agentfootprint.pause.resume', { pausedDurationMs: 100, hasInput: true }),
    ]);
    // Tool is still active (no tool.end yet) so falls back to 'tool' state.
    expect(out?.state).toBe('tool');
  });
});

// ── T9: renderer resolves per-tool override ───────────────────────

describe('renderStatusLine — T9: per-tool template fallback', () => {
  it('prefers `tool.<name>` over generic `tool` when present', () => {
    const state = { state: 'tool' as const, toolName: 'weather', vars: { toolName: 'weather' } };
    const line = renderStatusLine(
      state,
      { appName: 'Chatbot' },
      {
        ...defaultStatusTemplates,
        'tool.weather': 'Looking up the weather…',
      },
    );
    expect(line).toBe('Looking up the weather…');
  });

  it('falls back to generic `tool` when no per-tool key exists', () => {
    const state = { state: 'tool' as const, toolName: 'unknown', vars: { toolName: 'unknown' } };
    const line = renderStatusLine(state, { appName: 'Chatbot' }, defaultStatusTemplates);
    expect(line).toBe('Working on `unknown`…');
  });
});

// ── Renderer: substitution + null contract ─────────────────────────

describe('renderStatusLine — substitution + null contract', () => {
  it('substitutes appName and partial in streaming template', () => {
    const state = { state: 'streaming' as const, vars: { partial: 'Hello' } };
    const line = renderStatusLine(state, { appName: 'Chatbot' }, defaultStatusTemplates);
    expect(line).toBe('Hello');
  });

  it('returns null when state is null (no-op for the chat bubble)', () => {
    const line = renderStatusLine(null, { appName: 'Chatbot' });
    expect(line).toBeNull();
  });

  it('consumer can override defaults — full Spanish swap', () => {
    const state = { state: 'idle' as const, vars: {} };
    const line = renderStatusLine(
      state,
      { appName: 'Chatbot' },
      {
        ...defaultStatusTemplates,
        idle: 'Pensando…',
      },
    );
    expect(line).toBe('Pensando…');
  });
});
