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
import type { AgentfootprintEvent } from '../../../src/events.js';
import {
  PROGRESS_MESSAGE_LIMIT,
  defaultStatusTemplates,
  progressMessageOf,
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

// ── Mid-call reports (9.54.0) ─────────────────────────────────────
//
// Through 9.53.0 `ctx.progress` filed a real, ordered, recorded event that
// NOTHING projected onto a surface: it landed on the record, not in the
// browser, and consumers hand-rolled a side channel for the live middle of a
// long call. These are the bindings that close that — and the ones that keep
// the closing honest, because `payload` is author-defined `unknown` and a
// status line that pretty-printed it would be a field dump wearing prose.
//
//   T10  progress carrying `message`         → the author's sentence, verbatim
//   T11  progress carrying no `message`      → the generic line, with a count
//   T12  several reports                     → count climbs, last message wins
//   T13  two parallel calls                  → keyed by toolCallId, no crossing
//   T14  a report for a call that ended      → nothing resurrected
//   T15  an over-long `message`              → cut, and the cut is STATED
//   T16  message that is not a usable string → falls to the generic line
//   T17  a template map without the new keys → the pre-9.54.0 line survives
//   T18  a tool that never reports           → byte-identical to before

const progressEvt = (toolCallId: string, toolName: string, payload: unknown): AgentfootprintEvent =>
  evt('agentfootprint.stream.tool_progress', { toolCallId, toolName, iteration: 1, payload });

const startEvt = (toolCallId: string, toolName: string): AgentfootprintEvent =>
  evt('agentfootprint.stream.tool_start', { toolName, toolCallId, args: {} });

const endEvt = (toolCallId: string): AgentfootprintEvent =>
  evt('agentfootprint.stream.tool_end', { toolCallId, result: 'ok', durationMs: 1 });

const lineFor = (
  events: AgentfootprintEvent[],
  templates = defaultStatusTemplates,
): string | null => renderStatusLine(selectStatus(events), { appName: 'Chatbot' }, templates);

// ── T10: the author's own sentence ────────────────────────────────

describe('selectStatus — T10: a report carrying `message`', () => {
  it('shows the author’s sentence verbatim, while the call is still in flight', () => {
    const events = [
      startEvt('c1', 'screen_reader'),
      progressEvt('c1', 'screen_reader', { message: 'Looking at your screen…', page: 4 }),
    ];
    const state = selectStatus(events);
    expect(state?.state).toBe('tool');
    expect(state?.vars.progressMessage).toBe('Looking at your screen…');
    expect(lineFor(events)).toBe('Looking at your screen…');
  });

  it('does not read any other field — the numbers stay on the record', () => {
    const state = selectStatus([
      startEvt('c1', 'walk_graph'),
      progressEvt('c1', 'walk_graph', { message: 'Hop 3 of 12', done: 3, total: 12 }),
    ]);
    expect(state?.vars.progressMessage).toBe('Hop 3 of 12');
    expect(state?.vars.done).toBeUndefined();
    expect(state?.vars.total).toBeUndefined();
  });
});

// ── T11: the generic line ─────────────────────────────────────────

describe('selectStatus — T11: a report carrying no `message`', () => {
  it('renders the honest generic line — name, that it reported, how often', () => {
    const events = [
      startEvt('c1', 'walk_graph'),
      progressEvt('c1', 'walk_graph', { done: 1, total: 12, hop: 'api-gateway' }),
    ];
    expect(lineFor(events)).toBe('`walk_graph` reported progress (1 so far)…');
  });

  it('never dumps the payload into the sentence', () => {
    const line = lineFor([
      startEvt('c1', 'walk_graph'),
      progressEvt('c1', 'walk_graph', { done: 1, total: 12, hop: 'api-gateway' }),
    ]);
    expect(line).not.toContain('api-gateway');
    expect(line).not.toContain('{');
    expect(line).not.toContain('12');
  });
});

// ── T12: several reports ──────────────────────────────────────────

describe('selectStatus — T12: a call that keeps reporting', () => {
  it('counts the reports and shows the most recent message', () => {
    const events = [
      startEvt('c1', 'walk_graph'),
      progressEvt('c1', 'walk_graph', { message: 'hop 1' }),
      progressEvt('c1', 'walk_graph', { message: 'hop 2' }),
      progressEvt('c1', 'walk_graph', { message: 'hop 3' }),
    ];
    expect(selectStatus(events)?.vars.progressCount).toBe('3');
    expect(lineFor(events)).toBe('hop 3');
  });

  it('a later message-less report drops back to the generic line, count intact', () => {
    const events = [
      startEvt('c1', 'walk_graph'),
      progressEvt('c1', 'walk_graph', { message: 'hop 1' }),
      progressEvt('c1', 'walk_graph', { done: 2 }),
    ];
    expect(lineFor(events)).toBe('`walk_graph` reported progress (2 so far)…');
  });
});

// ── T13: parallel calls ───────────────────────────────────────────

describe('selectStatus — T13: parallel tool calls interleave by toolCallId', () => {
  const two = [startEvt('c1', 'walk_graph'), startEvt('c2', 'read_docs')];

  it('the newest report wins the line, and it names the call that made it', () => {
    expect(lineFor([...two, progressEvt('c1', 'walk_graph', { message: 'walking…' })])).toBe(
      'walking…',
    );
    expect(
      lineFor([
        ...two,
        progressEvt('c1', 'walk_graph', { message: 'walking…' }),
        progressEvt('c2', 'read_docs', { message: 'reading…' }),
      ]),
    ).toBe('reading…');
  });

  it('counts are per call — one chatty call does not inflate the quiet one', () => {
    const state = selectStatus([
      ...two,
      progressEvt('c1', 'walk_graph', { done: 1 }),
      progressEvt('c1', 'walk_graph', { done: 2 }),
      progressEvt('c1', 'walk_graph', { done: 3 }),
      progressEvt('c2', 'read_docs', { done: 1 }),
    ]);
    expect(state?.toolName).toBe('read_docs');
    expect(state?.vars.progressCount).toBe('1');
  });

  it('one call ending leaves the other on the line — it does not close its sibling', () => {
    const state = selectStatus([
      ...two,
      progressEvt('c1', 'walk_graph', { message: 'walking…' }),
      endEvt('c2'),
    ]);
    expect(state?.toolName).toBe('walk_graph');
    expect(state?.vars.progressMessage).toBe('walking…');
  });

  it('with nobody reporting, the most recently STARTED call holds the line', () => {
    expect(selectStatus(two)?.toolName).toBe('read_docs');
  });
});

// ── T14: a stale report ───────────────────────────────────────────

describe('selectStatus — T14: a report for a call that already ended', () => {
  it('resurrects nothing — the run is quiescent and stays that way', () => {
    const state = selectStatus([
      startEvt('c1', 'walk_graph'),
      endEvt('c1'),
      progressEvt('c1', 'walk_graph', { message: 'too late' }),
    ]);
    expect(state).toBeNull();
  });
});

// ── T15: the length cap, stated ───────────────────────────────────

describe('progressMessageOf — T15: an over-long message', () => {
  it('cuts at the cap and SAYS how much it cut', () => {
    const long = 'x'.repeat(PROGRESS_MESSAGE_LIMIT + 40);
    const out = progressMessageOf({ message: long });
    expect(out).toBe(`${'x'.repeat(PROGRESS_MESSAGE_LIMIT)}… (+40 more)`);
    expect(out).toContain('(+40 more)');
  });

  it('leaves a message at exactly the cap alone', () => {
    const exact = 'y'.repeat(PROGRESS_MESSAGE_LIMIT);
    expect(progressMessageOf({ message: exact })).toBe(exact);
  });

  it('trims surrounding whitespace before measuring', () => {
    expect(progressMessageOf({ message: '  still walking  ' })).toBe('still walking');
  });
});

// ── T16: not a usable string ──────────────────────────────────────

describe('progressMessageOf — T16: anything that is not a usable `message`', () => {
  it.each([
    ['no message field', { done: 3, total: 12 }],
    ['a non-string message', { message: 42 }],
    ['an object message', { message: { text: 'hi' } }],
    ['an empty message', { message: '' }],
    ['a whitespace-only message', { message: '   ' }],
    ['a bare string payload', 'Looking at your screen…'],
    ['an array payload', [1, 2, 3]],
    ['null', null],
    ['undefined', undefined],
  ])('falls to the generic line: %s', (_label, payload) => {
    expect(progressMessageOf(payload)).toBeNull();
  });

  it('a bare string payload still reaches the surface as the generic line', () => {
    expect(
      lineFor([startEvt('c1', 'walk_graph'), progressEvt('c1', 'walk_graph', 'working')]),
    ).toBe('`walk_graph` reported progress (1 so far)…');
  });
});

// ── T17: template ladder falls through ────────────────────────────

describe('renderStatusLine — T17: a template map that predates the progress keys', () => {
  const preTool: Record<string, string> = {
    idle: 'Thinking…',
    streaming: '{{partial}}',
    tool: 'Working on `{{toolName}}`…',
    paused: 'Waiting on you: {{question}}',
  };

  it('keeps rendering the tool line rather than blanking the bubble mid-call', () => {
    const events = [startEvt('c1', 'walk_graph'), progressEvt('c1', 'walk_graph', { done: 1 })];
    expect(lineFor(events, preTool)).toBe('Working on `walk_graph`…');
  });

  it('a curated per-tool line survives when the consumer drops the generic key', () => {
    const curated = { ...defaultStatusTemplates, 'tool.walk_graph': 'Mapping your services…' };
    delete (curated as Record<string, string>)['tool.progress.generic'];
    const events = [startEvt('c1', 'walk_graph'), progressEvt('c1', 'walk_graph', { done: 1 })];
    expect(lineFor(events, curated)).toBe('Mapping your services…');
  });

  it('a per-tool progress override beats the bundled one', () => {
    const events = [startEvt('c1', 'walk_graph'), progressEvt('c1', 'walk_graph', { done: 1 })];
    expect(
      lineFor(events, {
        ...defaultStatusTemplates,
        'tool.walk_graph.progress.generic': 'Still mapping…',
      }),
    ).toBe('Still mapping…');
    const withMsg = [
      startEvt('c1', 'walk_graph'),
      progressEvt('c1', 'walk_graph', { message: 'm' }),
    ];
    expect(
      lineFor(withMsg, { ...defaultStatusTemplates, 'tool.walk_graph.progress': 'hushed' }),
    ).toBe('hushed');
  });
});

// ── T18: nothing changes for a tool that never reports ────────────

describe('selectStatus — T18: a tool that never reports', () => {
  it('projects exactly what it projected before mid-call reports existed', () => {
    const events = [startEvt('c1', 'walk_graph')];
    expect(selectStatus(events)).toEqual({
      state: 'tool',
      toolName: 'walk_graph',
      vars: { toolName: 'walk_graph', toolCallId: 'c1' },
    });
    expect(lineFor(events)).toBe('Working on `walk_graph`…');
  });
});
