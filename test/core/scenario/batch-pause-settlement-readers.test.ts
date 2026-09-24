/**
 * THE SETTLED BRACKET ON THE EVENT STREAM (9.113.0) — every in-library reader
 * reads the typed field, and none infers a failed call.
 *
 * When a batch pauses, the resume SETTLES each call after the paused one: a
 * fixed sentence as its result and a bracket — `tool_start`, then `tool_end`
 * with `durationMs: 0` (`core/agent/stages/toolCalls.ts` · "── The batch
 * settlement (9.113.0)"). Both payloads carry
 * `notDispatched: { pausedCall: { toolCallId, toolName } }`, the same shape as
 * the history message's `LLMMessage.notDispatched` — the ONE owner of "this
 * call never ran" on the stream. The `tool_end` carries no `error`: the call
 * did not fail — the library chose not to dispatch it, the permission-deny
 * precedent (`toolCalls.ts` · `bracketSettled`).
 *
 * One REAL run feeds every reader here: a batch of three whose MIDDLE call
 * asks a person (`requestInput`), then — after the answer — a call to a tool
 * that throws (the control: a real failure must still read as one), then the
 * answer. Each reader is asked the question it answers, and the settled `c3`
 * must never be narrated, filed, spanned or counted as a call that ran — nor
 * as one that failed:
 *
 *   causal evidence · audit chain · OpenTelemetry · X-Ray · live status line ·
 *   chat-bubble status · commentary · live tool tracker · thinking trace ·
 *   bug-report transcript · domain events + step graph + rollup · route hops
 *
 * The trace toolpack's reader is pinned beside its own suite
 * (`test/lib/trace-toolpack/inspectToolCall.test.ts`).
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool, isInputPause, requestInput } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { recordRun } from '../../../src/observe.js';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';
import { causalEvidenceRecorder } from '../../../src/memory/causal/evidenceRecorder.js';
import { auditExport, verifyAuditBundle } from '../../../src/adapters/observability/audit.js';
import {
  otelObservability,
  type OtelAttributeValue,
  type OtelSpanLike,
  type OtelTracerLike,
} from '../../../src/adapters/observability/otel.js';
import { xrayObservability } from '../../../src/adapters/observability/xray.js';
import { attachStatus } from '../../../src/recorders/observability/StatusRecorder.js';
import { selectStatus } from '../../../src/recorders/observability/status/statusTemplates.js';
import {
  defaultCommentaryTemplates,
  extractCommentaryVars,
  renderCommentary,
  selectCommentaryKey,
} from '../../../src/recorders/observability/commentary/commentaryTemplates.js';
import { LiveToolTracker } from '../../../src/recorders/observability/LiveStateRecorder.js';
import { agentThinkingTrace } from '../../../src/recorders/observability/AgentThinkingTraceRecorder.js';
import { deriveTranscript } from '../../../src/lib/bug-report/transcript.js';
import {
  BoundaryRecorder,
  type DomainEvent,
} from '../../../src/recorders/observability/BoundaryRecorder.js';
import { buildStepGraphFromEvents } from '../../../src/recorders/observability/FlowchartRecorder.js';
import { routeRecorder } from '../../../src/recorders/observability/RouteRecorder.js';
import { notDispatchedResult } from '../../../src/core/agent/stages/toolCalls.js';

// ─── The run ───────────────────────────────────────────────────────────

const MARKER = { pausedCall: { toolCallId: 'c2', toolName: 'second' } } as const;
const SENTENCE = notDispatchedResult('third', { toolName: 'second', toolCallId: 'c2' });

interface SettledRun {
  /** Every typed event of both legs, in dispatch order. */
  readonly events: readonly AgentfootprintEvent[];
  readonly evidence: ReturnType<typeof causalEvidenceRecorder>;
  readonly thinking: ReturnType<typeof agentThinkingTrace>;
  /** The resume leg's domain events (a resume is a new run to the recorder). */
  readonly domain: readonly DomainEvent[];
  /** Per tool_start, whether the live tracker held the call open at that moment. */
  readonly liveAtStart: ReadonlyMap<string, boolean>;
  readonly ran: readonly string[];
}

async function settledRun(): Promise<SettledRun> {
  const ran: string[] = [];
  const tool = (name: string) =>
    defineTool({
      name,
      description: `the ${name} tool`,
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        if (name === 'second') {
          return requestInput({
            id: 'year',
            question: 'Which year?',
            fields: [{ id: 'year', type: 'number', required: true }],
          });
        }
        if (name === 'broken') throw new Error('the broken tool failed on purpose');
        ran.push(name);
        return `${name} ran`;
      },
    });
  const evidence = causalEvidenceRecorder();
  const thinking = agentThinkingTrace({ agent: 'Acme' });
  const agent = Agent.create({
    provider: mock({
      replies: [
        {
          toolCalls: [
            { id: 'c1', name: 'first', args: {} },
            { id: 'c2', name: 'second', args: {} },
            { id: 'c3', name: 'third', args: { q: 'x' } },
          ],
        },
        { toolCalls: [{ id: 'e1', name: 'broken', args: {} }] },
        { content: 'done' },
      ],
    }),
    model: 'mock',
  })
    .tools(['first', 'second', 'third', 'broken'].map(tool))
    .watch(evidence)
    .watch(thinking)
    .build();

  const events: AgentfootprintEvent[] = [];
  agent.on('*', (e) => events.push(e));
  // The live tracker first, the probe after it: listeners run in the order
  // they subscribed, so the probe reads what the tracker did with the event.
  const tracker = new LiveToolTracker();
  tracker.subscribe(agent);
  const liveAtStart = new Map<string, boolean>();
  agent.on('agentfootprint.stream.tool_start', (e) => {
    liveAtStart.set(e.payload.toolCallId, tracker.getActive(e.payload.toolCallId) !== undefined);
  });
  const recorder = recordRun(agent);

  const paused = await agent.run({ message: 'go' });
  if (!isInputPause(paused)) throw new Error('expected an input pause');
  const answer = await agent.resume(paused.checkpoint, {
    requestId: paused.awaitingInput.requestId,
    values: { year: 2026 },
  });
  expect(answer).toBe('done');
  const domain = recorder.boundary.getEvents();
  recorder.stop();
  return { events, evidence, thinking, domain, liveAtStart, ran };
}

const isBracket = (e: AgentfootprintEvent): boolean =>
  e.type === 'agentfootprint.stream.tool_start' || e.type === 'agentfootprint.stream.tool_end';
const idOf = (e: AgentfootprintEvent): unknown =>
  (e.payload as unknown as Record<string, unknown>).toolCallId;
const indexOf = (events: readonly AgentfootprintEvent[], type: string, id: string): number =>
  events.findIndex((e) => e.type === type && idOf(e) === id);

/** The same stream re-anchored on one run id. The two trace adapters open a
 *  turn on `agent.turn_start` and join its events by `meta.runId`; a resume
 *  emits no turn_start and mints a new id, so a REAL resumed leg is not traced
 *  at all (the stated limit, pinned in each adapter's block below). Re-anchored,
 *  the resumed leg lands on the paused turn, and the adapters' settled
 *  branches — which no real run reaches yet — can be exercised. */
const oneRun = (events: readonly AgentfootprintEvent[]): AgentfootprintEvent[] =>
  events.map((e) => ({ ...e, meta: { ...e.meta, runId: 'one-run' } } as AgentfootprintEvent));

// ─── 0. the stream itself ─────────────────────────────────────────────

describe('the settled bracket on the stream', () => {
  it('both halves carry the marker, the end carries no `error`, and no other bracket carries it', async () => {
    const { events, ran } = await settledRun();
    expect(ran).toEqual(['first']);
    const settled = events.filter((e) => isBracket(e) && idOf(e) === 'c3');
    expect(settled.map((e) => e.payload)).toEqual([
      {
        toolName: 'third',
        toolCallId: 'c3',
        args: { q: 'x' },
        parallelCount: 3,
        notDispatched: MARKER,
      },
      { toolCallId: 'c3', result: SENTENCE, durationMs: 0, notDispatched: MARKER },
    ]);
    expect('error' in (settled[1]!.payload as object)).toBe(false);
    // The control: the thrower's end says it failed.
    const thrower = events.find(
      (e) => e.type === 'agentfootprint.stream.tool_end' && idOf(e) === 'e1',
    );
    expect((thrower?.payload as { error?: boolean }).error).toBe(true);
    const others = events.filter((e) => isBracket(e) && idOf(e) !== 'c3');
    expect(others.map(idOf)).toEqual(['c1', 'c1', 'c2', 'c2', 'e1', 'e1']);
    expect(others.filter((e) => 'notDispatched' in (e.payload as object))).toEqual([]);
  });
});

// ─── 1. causal memory's evidence ──────────────────────────────────────

describe('causal evidence (`memory/causal/evidenceRecorder.ts`)', () => {
  it('files no ToolCallRecord for the settled call — it passed no args to a tool and got no result', async () => {
    const { evidence } = await settledRun();
    const calls = evidence.collect().toolCalls;
    expect(calls.map((c) => c.name)).not.toContain('third');
    expect(calls.some((c) => c.resultPreview.includes('was not executed'))).toBe(false);
    // The control: a tool that really threw is still filed as errored.
    expect(calls.filter((c) => c.errored).map((c) => c.name)).toEqual(['broken']);
  });
});

// ─── 2. the audit chain ───────────────────────────────────────────────

describe('audit chain (`adapters/observability/audit.ts`)', () => {
  it('carries the marker verbatim on both records, still bounds the result, and verifies', async () => {
    const { events } = await settledRun();
    for (const payloadMode of ['bounded', 'verbatim'] as const) {
      const audit = auditExport({ payloadMode });
      for (const e of events) audit.exportEvent(e);
      const bundle = audit.bundle();
      expect(verifyAuditBundle(bundle).valid).toBe(true);
      const records = bundle.records.filter(
        (r) =>
          r.eventType === 'agentfootprint.stream.tool_start' ||
          r.eventType === 'agentfootprint.stream.tool_end',
      );
      const payloadOf = (type: string, id: string) =>
        records.find(
          (r) => r.eventType === type && (r.payload as { toolCallId?: string }).toolCallId === id,
        )?.payload as Record<string, unknown>;
      const end = payloadOf('agentfootprint.stream.tool_end', 'c3');
      expect(end.notDispatched).toEqual(MARKER);
      // Neither a success nor a failure on the chained record: no `error`.
      expect('error' in end).toBe(false);
      expect(payloadOf('agentfootprint.stream.tool_start', 'c3').notDispatched).toEqual(MARKER);
      if (payloadMode === 'bounded') expect(end.result).toBe('[type: string]');
      expect(
        records.filter(
          (r) =>
            (r.payload as { toolCallId?: string }).toolCallId !== 'c3' &&
            'notDispatched' in (r.payload as object),
        ),
      ).toEqual([]);
    }
  });
});

// ─── 3. OpenTelemetry ─────────────────────────────────────────────────

interface Span {
  readonly name: string;
  readonly attributes: Record<string, OtelAttributeValue>;
  readonly events: { name: string; attributes: Record<string, OtelAttributeValue> }[];
  status?: number;
  ended: boolean;
}

function tracerOf(spans: Span[]): OtelTracerLike {
  return {
    startSpan(name, options) {
      const span: Span = {
        name,
        attributes: { ...(options?.attributes ?? {}) },
        events: [],
        ended: false,
      };
      spans.push(span);
      const like: OtelSpanLike = {
        setAttribute: (key, value) => {
          span.attributes[key] = value;
          return undefined;
        },
        setStatus: (status) => {
          span.status = status.code;
          return undefined;
        },
        end: () => {
          span.ended = true;
        },
        spanContext: () => ({ traceId: 't', spanId: `s${spans.indexOf(span)}`, traceFlags: 1 }),
        addEvent: (eventName, attributes) => {
          span.events.push({ name: eventName, attributes: { ...(attributes ?? {}) } });
          return undefined;
        },
      };
      return like;
    },
  };
}

describe('OpenTelemetry (`adapters/observability/otel.ts`)', () => {
  it('the stated limit: a real resumed leg is not traced, so no run records the span event yet', async () => {
    // A trace opens on `agent.turn_start`, which only `seed` emits. A resume
    // emits none and mints a new `meta.runId`, so every event of the resumed
    // leg — the settled bracket, and the thrower e1 beside it — finds no turn
    // and is dropped. The docs say so beside the claim (the `otel.ts` header's
    // KNOWN LIMIT, the reader table in `src/core/README.md`, the CHANGELOG).
    // The day resumed legs are traced this test fails, and the claim can be
    // made without the caveat.
    const { events } = await settledRun();
    const legOf = (type: string, id: string) => events[indexOf(events, type, id)]!.meta.runId;
    const pausedLeg = legOf('agentfootprint.stream.tool_start', 'c1');
    const resumedLeg = legOf('agentfootprint.stream.tool_start', 'c3');
    expect(resumedLeg).not.toBe(pausedLeg);
    const turnStarts = (runId: string) =>
      events.filter((e) => e.type === 'agentfootprint.agent.turn_start' && e.meta.runId === runId);
    expect(turnStarts(pausedLeg)).toHaveLength(1);
    expect(turnStarts(resumedLeg)).toEqual([]);
    const spans: Span[] = [];
    const strategy = otelObservability({ serviceName: 'svc', tracer: tracerOf(spans) });
    for (const e of events) strategy.exportEvent(e);
    expect(
      spans.flatMap((s) => s.events).filter((e) => e.name === 'agentfootprint.tool.not_dispatched'),
    ).toEqual([]);
    const names = spans.map((s) => s.name);
    expect(names).toContain('tool:first'); // the leg that paused IS traced
    expect(names).not.toContain('tool:third');
    expect(names).not.toContain('tool:broken'); // nothing of the resumed leg is
  });

  it('opens no `execute_tool` span for a call that never executed, and records the fact as a span event — on a leg it traces (the resumed leg re-anchored onto the paused turn)', async () => {
    const { events } = await settledRun();
    const spans: Span[] = [];
    const strategy = otelObservability({ serviceName: 'svc', tracer: tracerOf(spans) });
    const stream = oneRun(events);
    const startAt = indexOf(stream, 'agentfootprint.stream.tool_start', 'c3');
    const endAt = indexOf(stream, 'agentfootprint.stream.tool_end', 'c3');
    stream.forEach((e, i) => {
      const openedBefore = spans.length;
      const endedBefore = spans.filter((s) => s.ended).length;
      strategy.exportEvent(e);
      if (i === startAt)
        expect(spans.length, 'the settled tool_start opened a span').toBe(openedBefore);
      // The settled tool_end closes nothing — least of all the iteration span
      // a name-less fallback would have popped.
      if (i === endAt) expect(spans.filter((s) => s.ended).length).toBe(endedBefore);
    });
    expect(spans.map((s) => s.name)).not.toContain('tool:third');
    const noted = spans
      .flatMap((s) => s.events)
      .filter((e) => e.name === 'agentfootprint.tool.not_dispatched');
    expect(noted.map((e) => e.attributes)).toEqual([
      {
        'gen_ai.tool.name': 'third',
        'gen_ai.tool.call.id': 'c3',
        'agentfootprint.tool.paused_call.id': 'c2',
        'agentfootprint.tool.paused_call.name': 'second',
      },
    ]);
    // The controls: the paused call's span ended clean, the thrower's in ERROR.
    expect(spans.find((s) => s.name === 'tool:second')).toMatchObject({ ended: true });
    expect(spans.find((s) => s.name === 'tool:second')?.status).toBeUndefined();
    expect(spans.find((s) => s.name === 'tool:broken')).toMatchObject({ ended: true, status: 2 });
    // Every span the run opened was closed.
    expect(spans.filter((s) => !s.ended).map((s) => s.name)).toEqual([]);
  });

  it('a settled tool_end closes nothing — not even a tool span another call left open (a hand-fed stream)', () => {
    // The library never emits a settled bracket while another tool span is
    // open, but the adapter also takes hand-built streams, and its name-less
    // fallback (kept for legacy events) closes the newest open tool span. The
    // settled tool_end opened nothing, so it must not reach that fallback.
    const spans: Span[] = [];
    const strategy = otelObservability({ serviceName: 'svc', tracer: tracerOf(spans) });
    const meta = {
      wallClockMs: 0,
      runOffsetMs: 0,
      runtimeStageId: 'call-tool#2',
      subflowPath: [],
      compositionPath: [],
      runId: 'hand-fed',
    };
    const feed = (type: string, payload: Record<string, unknown>) =>
      strategy.exportEvent({ type, payload, meta } as unknown as AgentfootprintEvent);
    feed('agentfootprint.agent.turn_start', { turnIndex: 0, userPrompt: 'go' });
    feed('agentfootprint.agent.iteration_start', { turnIndex: 0, iterIndex: 1 });
    feed('agentfootprint.stream.tool_start', { toolName: 'slow', toolCallId: 'a1', args: {} });
    feed('agentfootprint.stream.tool_start', {
      toolName: 'third',
      toolCallId: 'c3',
      args: {},
      notDispatched: MARKER,
    });
    feed('agentfootprint.stream.tool_end', {
      toolCallId: 'c3',
      result: SENTENCE,
      durationMs: 0,
      notDispatched: MARKER,
    });
    expect(spans.find((s) => s.name === 'tool:slow')?.ended).toBe(false);
    feed('agentfootprint.stream.tool_end', { toolCallId: 'a1', result: 'ok', durationMs: 5 });
    expect(spans.find((s) => s.name === 'tool:slow')?.ended).toBe(true);
  });
});

// ─── 4. X-Ray ─────────────────────────────────────────────────────────

describe('X-Ray (`adapters/observability/xray.ts`)', () => {
  /** Every segment the adapter shipped for `stream`. */
  async function segmentsOf(stream: readonly AgentfootprintEvent[]) {
    const puts: { TraceSegmentDocuments: readonly string[] }[] = [];
    const strategy = xrayObservability({
      serviceName: 'svc',
      flushIntervalMs: 0,
      _client: {
        putTraceSegments: async (input) => {
          puts.push(input as { TraceSegmentDocuments: readonly string[] });
        },
      },
    });
    for (const e of stream) strategy.exportEvent(e);
    await strategy.flush?.();
    return puts.flatMap((p) =>
      p.TraceSegmentDocuments.map(
        (d) => JSON.parse(d) as { name: string; error?: boolean; parent_id?: string; id: string },
      ),
    );
  }

  it('the stated limit: a real resumed leg is not traced, so the settled branch is moot today', async () => {
    // Same anchor as OpenTelemetry: a trace opens on `agent.turn_start`, and a
    // resumed leg emits none under a new `meta.runId` (the `xray.ts` header).
    const { events } = await settledRun();
    const names = (await segmentsOf(events)).map((s) => s.name);
    expect(names).toContain('tool:first'); // the leg that paused IS traced
    expect(names).not.toContain('tool:third');
    expect(names).not.toContain('tool:broken'); // nothing of the resumed leg is
  });

  it('opens no tool subsegment for the settled call and closes nothing on its tool_end — on a leg it traces (re-anchored)', async () => {
    const { events } = await settledRun();
    const segments = await segmentsOf(oneRun(events));
    const names = segments.map((s) => s.name);
    expect(names).not.toContain('tool:third');
    expect(names.filter((n) => n.startsWith('tool:')).sort()).toEqual([
      'tool:broken',
      'tool:first',
      'tool:second',
    ]);
    expect(segments.find((s) => s.name === 'tool:broken')?.error).toBe(true);
    expect(segments.find((s) => s.name === 'tool:second')?.error).toBeFalsy();
    // Each tool subsegment still hangs off an iteration, not off the root: a
    // settled tool_end that popped the iteration early would re-parent later
    // segments onto the root.
    const root = segments.find((s) => s.parent_id === undefined)!;
    const tools = segments.filter((s) => s.name.startsWith('tool:'));
    expect(tools.every((s) => s.parent_id !== root.id)).toBe(true);
  });
});

// ─── 5. the live status line and the chat-bubble status ───────────────

describe('live status (`recorders/observability/StatusRecorder.ts`, `status/statusTemplates.ts`)', () => {
  it('the default status line never says the settled call was called, or failed', async () => {
    const { events } = await settledRun();
    const dispatcher = new EventDispatcher();
    const lines: string[] = [];
    attachStatus(dispatcher, { onStatus: (line) => lines.push(line) });
    for (const e of events) dispatcher.dispatch(e);
    expect(lines.filter((l) => l.includes('third') || l.includes('c3'))).toEqual([]);
    // The controls.
    expect(lines).toContain('Calling second(…)');
    expect(lines).toContain('Tool e1 failed');
  });

  it('the chat bubble never shows the settled call as the tool at work', async () => {
    const { events } = await settledRun();
    const atSettledStart = indexOf(events, 'agentfootprint.stream.tool_start', 'c3');
    expect(selectStatus(events.slice(0, atSettledStart + 1))?.toolName).not.toBe('third');
    const atThrowerStart = indexOf(events, 'agentfootprint.stream.tool_start', 'e1');
    expect(selectStatus(events.slice(0, atThrowerStart + 1))).toMatchObject({
      state: 'tool',
      toolName: 'broken',
    });
  });
});

// ─── 6. commentary ────────────────────────────────────────────────────

describe('commentary (`recorders/observability/commentary/commentaryTemplates.ts`)', () => {
  const line = (event: AgentfootprintEvent): string | null | undefined => {
    const key = selectCommentaryKey(event);
    if (typeof key !== 'string') return key;
    return renderCommentary(
      defaultCommentaryTemplates[key] ?? '',
      extractCommentaryVars(event, { appName: 'Acme' }),
    );
  };

  it('narrates the settled call as not called, once, and never as a tool that returned', async () => {
    const { events } = await settledRun();
    const start = events[indexOf(events, 'agentfootprint.stream.tool_start', 'c3')]!;
    const end = events[indexOf(events, 'agentfootprint.stream.tool_end', 'c3')]!;
    expect(selectCommentaryKey(start)).toBe('stream.tool_start.notDispatched');
    expect(line(start)).toBe(
      'Acme did not call the `third` tool. The LLM asked for it together with `second`, and ' +
        'the run paused at `second` before reaching it.',
    );
    // One line per fact: the start already said it.
    expect(selectCommentaryKey(end)).toBeNull();
    // The controls keep the keys consumers override.
    expect(
      selectCommentaryKey(events[indexOf(events, 'agentfootprint.stream.tool_start', 'c1')]!),
    ).toBe('stream.tool_start');
    expect(
      selectCommentaryKey(events[indexOf(events, 'agentfootprint.stream.tool_end', 'e1')]!),
    ).toBe('stream.tool_end');
  });
});

// ─── 7. the live tool tracker ─────────────────────────────────────────

describe('live tool tracker (`recorders/observability/LiveStateRecorder.ts`)', () => {
  it('never holds the settled call open as executing', async () => {
    const { liveAtStart } = await settledRun();
    expect(liveAtStart.get('c3')).toBe(false);
    expect(liveAtStart.get('c1')).toBe(true);
    expect(liveAtStart.get('e1')).toBe(true);
  });
});

// ─── 8. the thinking trace ────────────────────────────────────────────

describe('thinking trace (`recorders/observability/AgentThinkingTraceRecorder.ts`)', () => {
  it('adds no ask or return beat for the settled call — never a "tool failed" about a call that did not run', async () => {
    const { thinking } = await settledRun();
    const steps = thinking.getTrace().steps as readonly {
      kind: string;
      toolCallId?: string;
      error?: string;
    }[];
    expect(steps.filter((s) => s.toolCallId === 'c3')).toEqual([]);
    expect(steps.find((s) => s.kind === 'return' && s.toolCallId === 'e1')?.error).toBe(
      'tool failed',
    );
  });
});

// ─── 9. the bug-report transcript ─────────────────────────────────────

describe('bug-report transcript (`lib/bug-report/transcript.ts`)', () => {
  it('mirrors the event: the settled step carries the marker and no `error`', async () => {
    const { events } = await settledRun();
    const steps = (deriveTranscript(events)?.turns ?? []).flatMap((t) => t.steps);
    const tools = steps.filter((s) => s.kind === 'tool') as readonly {
      toolCallId?: string;
      error?: boolean;
      notDispatched?: unknown;
    }[];
    const settled = tools.find((s) => s.toolCallId === 'c3');
    expect(settled).toMatchObject({ notDispatched: MARKER });
    expect(settled?.error).toBeUndefined();
    expect(tools.filter((s) => s.toolCallId !== 'c3' && s.notDispatched !== undefined)).toEqual([]);
    expect(tools.find((s) => s.toolCallId === 'e1')?.error).toBe(true);
  });
});

// ─── 10. domain events, the step graph and the rollup ─────────────────

describe('domain events (`recorders/observability/BoundaryRecorder.ts`)', () => {
  it('the domain log carries the marker on both settled events and on no other', async () => {
    const { domain } = await settledRun();
    const toolEvents = domain.filter(
      (e) => e.type === 'tool.start' || e.type === 'tool.end',
    ) as readonly (DomainEvent & {
      toolCallId: string;
      notDispatched?: unknown;
    })[];
    expect(
      toolEvents.filter((e) => e.toolCallId === 'c3').map((e) => [e.type, e.notDispatched]),
    ).toEqual([
      ['tool.start', MARKER],
      ['tool.end', MARKER],
    ]);
    expect(
      toolEvents.filter((e) => e.toolCallId !== 'c3' && e.notDispatched !== undefined),
    ).toEqual([]);
  });

  it("a boundary's rollup counts the calls that ran, not the settled one", () => {
    const rec = new BoundaryRecorder();
    const dispatcher = new EventDispatcher();
    rec.subscribe(dispatcher);
    rec.onRunStart!({ payload: undefined } as never);
    const boundary = {
      name: 'A',
      subflowId: 'agent-a',
      description: 'Agent: a',
      traversalContext: {
        stageId: 'agent-a',
        runtimeStageId: 'agent-a#0',
        stageName: 'A',
        depth: 0,
      },
    };
    rec.onSubflowEntry!(boundary as never);
    const dispatch = (type: string, payload: Record<string, unknown>) =>
      dispatcher.dispatch({
        type,
        payload,
        meta: {
          wallClockMs: 1000,
          runOffsetMs: 0,
          runtimeStageId: 'agent-a/call-tool#2',
          subflowPath: ['agent-a'],
          compositionPath: [],
          runId: 'test',
        },
      } as never);
    dispatch('agentfootprint.stream.tool_start', {
      toolName: 'second',
      toolCallId: 'c2',
      args: {},
    });
    dispatch('agentfootprint.stream.tool_end', { toolCallId: 'c2', result: 'R2', durationMs: 5 });
    dispatch('agentfootprint.stream.tool_start', {
      toolName: 'third',
      toolCallId: 'c3',
      args: {},
      notDispatched: MARKER,
    });
    dispatch('agentfootprint.stream.tool_end', {
      toolCallId: 'c3',
      result: SENTENCE,
      durationMs: 0,
      notDispatched: MARKER,
    });
    rec.onSubflowExit!(boundary as never);
    expect(rec.aggregateForBoundary('agent-a#0')?.toolCalls).toBe(1);
  });
});

describe('step graph (`recorders/observability/FlowchartRecorder.ts`)', () => {
  it('draws no llm → tool step for the settled call, and the next tool → llm step shows the real result', () => {
    const base = {
      runtimeStageId: 's#1',
      subflowPath: ['__root__'],
      depth: 0,
      ts: 1,
      commitIdxBefore: 0,
      commitIdxAfter: 0,
    };
    const events = [
      { ...base, type: 'llm.start', model: 'm', provider: 'p', actorArrow: 'user→llm' },
      {
        ...base,
        type: 'llm.end',
        content: '',
        toolCallCount: 2,
        usage: { input: 1, output: 1 },
        actorArrow: 'llm→tool',
      },
      { ...base, type: 'tool.start', toolName: 'second', toolCallId: 'c2', args: {} },
      { ...base, type: 'tool.end', toolCallId: 'c2', result: 'R2', durationMs: 5 },
      {
        ...base,
        type: 'tool.start',
        toolName: 'third',
        toolCallId: 'c3',
        args: {},
        notDispatched: MARKER,
      },
      {
        ...base,
        type: 'tool.end',
        toolCallId: 'c3',
        result: SENTENCE,
        durationMs: 0,
        notDispatched: MARKER,
      },
      { ...base, type: 'llm.start', model: 'm', provider: 'p', actorArrow: 'tool→llm' },
    ] as unknown as readonly DomainEvent[];
    const { nodes } = buildStepGraphFromEvents(events);
    expect(nodes.filter((n) => n.kind === 'llm->tool').map((n) => n.toolName)).toEqual(['second']);
    expect(nodes.find((n) => n.kind === 'tool->llm')?.toolResult).toBe('R2');
  });
});

// ─── 11. route hops ───────────────────────────────────────────────────

describe('route hops (`recorders/observability/RouteRecorder.ts`)', () => {
  it("a hop's driving tool is the last call that ran, never a settled one", () => {
    const r = routeRecorder();
    r.onRunStart({ traversalContext: { runId: 'run-1' } } as never);
    const emit = (name: string, runtimeStageId: string, payload: Record<string, unknown>) =>
      r.onEmit({ name, runtimeStageId, payload } as never);
    emit('agentfootprint.context.evaluated', 's#1', {
      iteration: 1,
      routing: [{ injectionId: 'a', via: 'entry' }],
    });
    emit('agentfootprint.stream.tool_start', 't#2', { toolName: 'get_wwn', toolCallId: 'w1' });
    emit('agentfootprint.stream.tool_start', 't#2', {
      toolName: 'third',
      toolCallId: 'c3',
      notDispatched: MARKER,
    });
    emit('agentfootprint.context.evaluated', 's#3', {
      iteration: 2,
      routing: [{ injectionId: 'b', via: 'route', from: 'a', label: 'has WWN' }],
    });
    const hop = r.getHops().find((h) => h.outcome === 'route');
    expect(hop?.lastTool).toBe('get_wwn');
  });
});
