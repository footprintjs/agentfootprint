/**
 * v2 API pattern tests — the selector + humanizer surface.
 *
 *   P1  selectActivities  — event-reduction state machine (llm + tool)
 *   P2  selectStatus      — latest one-liner reflects most recent event
 *   P3  selectCommentary  — one line per event, humanized
 *   P4  selectRunSummary  — totals (tokens, tool counts, skill activations)
 *   P5  setHumanizer      — domain override wins over library default;
 *                           returning undefined falls through to default;
 *                           swapping invalidates memoized selector results
 *   P6  selectIterationRanges — iter ↔ event index map; dense byEventIndex
 *   P7  memoization       — same selector call twice returns the same
 *                           reference until an event arrives
 */
import { describe, it, expect } from 'vitest';
import { agentTimeline } from '../../src/recorders/AgentTimelineRecorder';
import type { Humanizer } from '../../src/recorders/AgentTimelineRecorder';
import type { EmitEvent } from 'footprintjs';

function evt(name: string, payload: Record<string, unknown>): EmitEvent {
  return {
    name,
    payload,
    runtimeStageId: `${name}#${Math.random().toString(36).slice(2, 8)}`,
    stageName: 'test',
    subflowPath: [],
    pipelineId: 'test-pipeline',
    timestamp: Date.now(),
  };
}

function simpleReActRun(t: ReturnType<typeof agentTimeline>) {
  t.onEmit(evt('agentfootprint.agent.turn_start', { userMessage: 'find port errors' }));
  t.onEmit(evt('agentfootprint.stream.llm_start', { iteration: 1 }));
  t.onEmit(
    evt('agentfootprint.stream.llm_end', {
      iteration: 1,
      content: 'need to check ports',
      toolCallCount: 2,
      usage: { inputTokens: 100, outputTokens: 40 },
      durationMs: 320,
    }),
  );
  t.onEmit(
    evt('agentfootprint.stream.tool_start', {
      toolName: 'influx_get_port_status',
      toolCallId: 'c1',
      args: { switchName: 'switch-3' },
    }),
  );
  t.onEmit(
    evt('agentfootprint.stream.tool_end', { toolCallId: 'c1', result: 'ok', durationMs: 50 }),
  );
  t.onEmit(
    evt('agentfootprint.stream.tool_start', {
      toolName: 'read_skill',
      toolCallId: 'c2',
      args: { id: 'port-error-triage' },
    }),
  );
  t.onEmit(
    evt('agentfootprint.stream.tool_end', { toolCallId: 'c2', result: 'skill', durationMs: 20 }),
  );
  t.onEmit(evt('agentfootprint.stream.llm_start', { iteration: 2 }));
  t.onEmit(
    evt('agentfootprint.stream.llm_end', {
      iteration: 2,
      content: 'final findings',
      toolCallCount: 0,
      usage: { inputTokens: 200, outputTokens: 80 },
      durationMs: 410,
    }),
  );
  t.onEmit(evt('agentfootprint.agent.turn_complete', { content: 'final findings' }));
}

// ── P1: selectActivities ───────────────────────────────────────────────

describe('AgentTimelineRecorder v2 — selectActivities', () => {
  it('P1 event-reduction state machine: llm_start pushes, llm_end marks done; tool_start/end pair up by toolCallId', () => {
    const t = agentTimeline();
    simpleReActRun(t);

    const acts = t.selectActivities();
    // Expect 2 llm + 2 tool activities, in emission order.
    expect(acts.map((a) => a.kind)).toEqual(['llm', 'tool', 'tool', 'llm']);
    // All done — run completed.
    expect(acts.every((a) => a.done)).toBe(true);
    // LLM iter 1: default humanizer meta "Running 2 steps"
    expect(acts[0].meta).toMatch(/Running 2 steps/);
    // LLM iter 2: no tool calls → "Writing response"
    expect(acts[3].meta).toMatch(/Writing response/);
  });

  it('P1 cursor parameter: progressive reveal up to event index', () => {
    const t = agentTimeline();
    simpleReActRun(t);

    // Events 0..1 = turn_start + llm_start → 1 activity, not done
    const early = t.selectActivities(1);
    expect(early).toHaveLength(1);
    expect(early[0].kind).toBe('llm');
    expect(early[0].done).toBe(false);
  });
});

// ── P2: selectStatus ───────────────────────────────────────────────────

describe('AgentTimelineRecorder v2 — selectStatus', () => {
  it('P2 latest status reflects the most recent event; idle before any events', () => {
    const t = agentTimeline();
    expect(t.selectStatus().kind).toBe('idle');

    simpleReActRun(t);
    const latest = t.selectStatus();
    expect(latest.kind).toBe('turn');
    expect(latest.text).toMatch(/Done|Getting started/i);
  });

  it('P2 cursor returns status at a specific event', () => {
    const t = agentTimeline();
    simpleReActRun(t);
    // Event 3 is a tool_start (influx_get_port_status) → status should be tool-kind
    const atTool = t.selectStatus(3);
    expect(atTool.kind).toBe('tool');
    expect(atTool.text).toMatch(/Running influx_get_port_status/);
  });
});

// ── P3: selectCommentary ───────────────────────────────────────────────

describe('AgentTimelineRecorder v2 — selectCommentary', () => {
  it('P3 one line per significant event, humanized', () => {
    const t = agentTimeline();
    simpleReActRun(t);

    const commentary = t.selectCommentary();
    // 1 turn_start + 2 llm_start + 2 llm_end + 2 tool_start + 2 tool_end + 1 turn_end = 10
    expect(commentary.length).toBeGreaterThanOrEqual(10);
    expect(commentary[0].kind).toBe('turn');
    expect(commentary[commentary.length - 1].kind).toBe('turn');
    // Every line has text
    expect(commentary.every((c) => c.text.length > 0)).toBe(true);
  });
});

// ── P4: selectRunSummary ───────────────────────────────────────────────

describe('AgentTimelineRecorder v2 — selectRunSummary', () => {
  it('P4 totals: turn count, iterations, tool count, tokens, durations, skills', () => {
    const t = agentTimeline();
    simpleReActRun(t);

    const s = t.selectRunSummary();
    expect(s.turnCount).toBe(1);
    expect(s.iterationCount).toBe(2);
    expect(s.toolCallCount).toBe(2);
    expect(s.inputTokens).toBe(300);
    expect(s.outputTokens).toBe(120);
    expect(s.totalDurationMs).toBe(730);
    expect(s.toolUsage.influx_get_port_status).toEqual({ count: 1, totalDurationMs: 50 });
    expect(s.toolUsage.read_skill).toEqual({ count: 1, totalDurationMs: 20 });
    expect(s.skillsActivated).toEqual(['port-error-triage']);
  });
});

// ── P5: humanizer override ─────────────────────────────────────────────

describe('AgentTimelineRecorder v2 — humanizer', () => {
  it('P5 domain humanizer wins over default; returning undefined falls through', () => {
    const t = agentTimeline();
    const neoStyle: Humanizer = {
      describeToolStart: (e) => {
        if (e.toolName === 'influx_get_port_status') return `Checking port status on ${e.args.switchName}`;
        return undefined; // fall through for other tools
      },
    };
    t.setHumanizer(neoStyle);
    simpleReActRun(t);

    const activities = t.selectActivities();
    const portTool = activities.find((a) => a.id === 'c1')!;
    const skillTool = activities.find((a) => a.id === 'c2')!;

    // Domain override wins for known tool.
    expect(portTool.label).toBe('Checking port status on switch-3');
    // Unknown tool falls through to library default.
    expect(skillTool.label).toBe('Running read_skill');
  });

  it('P5 swapping humanizer invalidates memoized selector result — next read re-phrases', () => {
    const t = agentTimeline();
    simpleReActRun(t);

    const before = t.selectActivities();
    const portLabelBefore = before.find((a) => a.id === 'c1')?.label;
    expect(portLabelBefore).toBe('Running influx_get_port_status');

    // Swap humanizer AFTER events are recorded. Cache must invalidate.
    t.setHumanizer({
      describeToolStart: (e) => `Doing ${e.toolName}`,
    });
    const after = t.selectActivities();
    expect(after.find((a) => a.id === 'c1')?.label).toBe('Doing influx_get_port_status');
  });
});

// ── P6: iteration range index ──────────────────────────────────────────

describe('AgentTimelineRecorder v2 — selectIterationRanges', () => {
  it('P6 iter ↔ event-index map: 2 iterations, byEventIndex dense', () => {
    const t = agentTimeline();
    simpleReActRun(t);

    const idx = t.selectIterationRanges();
    expect(idx.iterations).toHaveLength(2);
    expect(idx.iterations[0].iterationIndex).toBe(1);
    expect(idx.iterations[1].iterationIndex).toBe(2);
    // byEventIndex covers every event in the stream.
    expect(idx.byEventIndex.length).toBe(t.getEvents().length);
  });
});

// ── P7: memoization ────────────────────────────────────────────────────

describe('AgentTimelineRecorder v2 — memoization', () => {
  it('P7 same selector called twice returns the same reference until events arrive', () => {
    const t = agentTimeline();
    simpleReActRun(t);
    const a1 = t.selectActivities();
    const a2 = t.selectActivities();
    expect(a2).toBe(a1); // referential equality — memoized

    // New event invalidates the cache.
    t.onEmit(evt('agentfootprint.agent.turn_start', { userMessage: 'another' }));
    const a3 = t.selectActivities();
    expect(a3).not.toBe(a1);
  });

  it('P7 clear() invalidates all memoized results', () => {
    const t = agentTimeline();
    simpleReActRun(t);
    expect(t.selectActivities().length).toBeGreaterThan(0);

    t.clear();
    expect(t.selectActivities()).toEqual([]);
    expect(t.selectRunSummary().turnCount).toBe(0);
  });
});
