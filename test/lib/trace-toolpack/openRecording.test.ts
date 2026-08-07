/**
 * openRecording — a saved run reopened as evidence a model can navigate.
 *
 * Convention-3 tiers: unit (the two refusals, the narrative lift) ·
 * integration (a REAL recording, serialized to JSON and parsed back, drives
 * the whole toolpack) · honesty (what a serialized run cannot carry back
 * says so through the toolpack's existing ⚠ markers, rather than being
 * quietly absent).
 *
 * The round trip is the point: `recordRun` and the trace toolpack always
 * described the same run and had no way to hand it over. Every assertion
 * here goes through `JSON.parse(JSON.stringify(...))` so nothing passes by
 * holding a live reference.
 */

import { narrative } from 'footprintjs/recorders';
import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { callTraceTool, recordRun, traceToolpack, type Recording } from '../../../src/observe.js';
import { openRecording } from '../../../src/debug.js';

/* ── fixture: one real agent turn, recorded ───────────────────────────── */

const lookupOrder = defineTool<{ orderId: string }, string>({
  name: 'lookup_order',
  description: 'Look up an order by id',
  inputSchema: {
    type: 'object',
    properties: { orderId: { type: 'string' } },
    required: ['orderId'],
  },
  execute: ({ orderId }) => `Order ${orderId}: sku KB-88, warranty ACTIVE, $189.00`,
});

interface Req {
  readonly messages: readonly { role: string; content?: unknown }[];
}

async function recordOneTurn(withNarrative: boolean): Promise<Recording> {
  const provider = mock({
    chunkDelayMs: 0,
    respond: (req) =>
      [...(req as Req).messages].reverse().some((m) => m.role === 'tool')
        ? { content: 'Replacement sent — no refund needed.' }
        : { toolCalls: [{ id: 'c1', name: 'lookup_order', args: { orderId: '7712' } }] },
  });
  const agent = Agent.create({ provider, model: 'mock-1', maxIterations: 4 })
    .system('support')
    .tool(lookupOrder)
    .build();
  if (withNarrative) agent.attach(narrative());

  const recorder = recordRun(agent);
  await agent.run({ message: 'Order 7712 arrived damaged' });
  const recording = recorder.toRecording();
  recorder.stop();
  return recording;
}

/** The whole point: nothing survives except through JSON. */
const roundTrip = (recording: Recording): Recording =>
  JSON.parse(JSON.stringify(recording)) as Recording;

const live = await recordOneTurn(false);
const liveWithNarrative = await recordOneTurn(true);

/* ── integration — the round trip drives the whole toolpack ───────────── */

describe('openRecording — a JSON round trip still answers every question', () => {
  it('rebuilds artifacts a full toolpack can navigate', async () => {
    const artifacts = openRecording(roundTrip(live));
    const tools = traceToolpack(artifacts);

    const overview = await callTraceTool(tools, 'run_overview');
    expect(overview).toContain('TRACE RUN OVERVIEW');
    expect(overview).toContain('tool-calls ×1');

    // Free-text search over a run parsed back from disk.
    const found = await callTraceTool(tools, 'find_in_trace', { query: 'KB-88' });
    expect(found).toContain('FOUND');
    expect(found).toMatch(/→ get_value\('.*#\d+', '.*'\)/);

    // And a tool call resolves end to end, timings included — the event
    // tail is plain JSON, so it survives where a lookup function cannot.
    const call = await callTraceTool(tools, 'inspect_tool_call', { toolCallId: 'c1' });
    expect(call).toContain('TOOL CALL c1 — lookup_order');
    expect(call).toContain('proposed by the model: {"orderId":"7712"}');
    expect(call).toMatch(/duration: \d+ms/);
  });

  it('carries the event tail through verbatim', () => {
    const artifacts = openRecording(roundTrip(live));
    expect(artifacts.events?.length).toBe(live.events.length);
    expect(artifacts.events?.length).toBeGreaterThan(0);
  });

  it('lifts the narrative from the snapshot recorder row when one was attached', async () => {
    const artifacts = openRecording(roundTrip(liveWithNarrative));
    expect(artifacts.narrative?.length).toBeGreaterThan(0);
    const tools = traceToolpack(artifacts);
    expect(tools.map((t) => t.schema.name)).toContain('read_narrative');
    const page = await callTraceTool(tools, 'read_narrative', { maxLines: 3 });
    expect(page).toMatch(/NARRATIVE lines 0–2 of \d+/);
  });

  it('mounts no read_narrative when nobody recorded one — absence, not an empty tool', () => {
    // `recordRun` deliberately attaches no narrative recorder; a recording
    // made without one simply has no story to page through.
    const artifacts = openRecording(roundTrip(live));
    expect(artifacts.narrative).toBeUndefined();
    expect(traceToolpack(artifacts).map((t) => t.schema.name)).not.toContain('read_narrative');
  });
});

/* ── honesty — what a serialized run cannot carry back ────────────────── */

describe('openRecording — honest about what does not survive', () => {
  it('carries no controlDeps, and the slice says so rather than staying silent', async () => {
    const artifacts = openRecording(roundTrip(live));
    expect(artifacts.controlDeps).toBeUndefined(); // a function cannot serialize
    const tools = traceToolpack(artifacts);
    const bundle = artifacts.snapshot.commitLog.at(-1)!;
    const slice = await callTraceTool(tools, 'trace_slice', {
      runtimeStageId: bundle.runtimeStageId,
    });
    expect(slice).toContain('⚠ control edges unavailable');
  });
});

/* ── unit — the two refusals ──────────────────────────────────────────── */

describe('openRecording — teaching refusals', () => {
  it('refuses a bundle with no snapshot, naming the producer', () => {
    expect(() => openRecording({ snapshot: undefined })).toThrow(/has no snapshot/);
    expect(() => openRecording({ snapshot: undefined })).toThrow(/recordRun\(agent\)/);
  });

  it('refuses an object that is not a run snapshot, naming what is missing', () => {
    expect(() => openRecording({ snapshot: { executionTree: {} } })).toThrow(/missing commitLog/);
    expect(() => openRecording({ snapshot: { commitLog: [] } })).toThrow(/missing executionTree/);
    expect(() => openRecording({ snapshot: {} })).toThrow(/commitLog and executionTree/);
    // The refusal teaches the fix rather than only naming the fault.
    expect(() => openRecording({ snapshot: {} })).toThrow(/recordRun\(agent\)\.toRecording\(\)/);
  });

  it('accepts a recording with no events (a recording is allowed to be lean)', () => {
    const lean = { snapshot: roundTrip(live).snapshot };
    const artifacts = openRecording(lean);
    expect(artifacts.events).toBeUndefined();
    expect(artifacts.snapshot.commitLog.length).toBeGreaterThan(0);
  });
});
