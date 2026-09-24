/**
 * inspect_tool_call — one tool call resolved across the four records its
 * evidence is scattered over.
 *
 * Convention-3 tiers: unit (the join, per source) · functional (the
 * proposed-vs-ran-with split, which is the reason the tool exists) ·
 * honesty (every absent source names itself with ⚠ rather than guessing) ·
 * security (a denied call's real result is not invented, and redaction
 * survives the join).
 *
 * The four records:
 *   assistant turn in `history`   → the args the model PROPOSED
 *   `middlewareDecisions` ledger  → the args it actually RAN with
 *   `role:'tool'` turn in history → the result
 *   the typed event tail          → the clock, and error/paused outcomes
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  allow,
  defineTool,
  deny,
  isInputPause,
  requestInput,
  slidingWindow,
  type ToolMiddleware,
} from '../../../src/index.js';
import type { LLMMessage } from '../../../src/adapters/types.js';
import { mock } from '../../../src/llm-providers.js';
import { recordRun } from '../../../src/observe.js';
import { callTraceTool, traceToolpack, type TraceToolpackArtifacts } from '../../../src/observe.js';

/* ── fixture ──────────────────────────────────────────────────────────── */

const lookupOrder = defineTool<{ orderId: string; limit?: number }, string>({
  name: 'lookup_order',
  description: 'Look up an order by id',
  inputSchema: {
    type: 'object',
    properties: { orderId: { type: 'string' }, limit: { type: 'number' } },
    required: ['orderId'],
  },
  execute: ({ orderId, limit }) =>
    `Order ${orderId}: sku KB-88, warranty ACTIVE${limit !== undefined ? ` (limit ${limit})` : ''}`,
});

const explode = defineTool<Record<string, never>, string>({
  name: 'explode',
  description: 'Always throws',
  inputSchema: { type: 'object', properties: {} },
  execute: () => {
    throw new Error('tool blew up');
  },
});

interface Req {
  readonly messages: readonly { role: string; content?: unknown }[];
  readonly tools?: readonly { readonly name: string }[];
}
const lastTool = (req: Req): string => {
  const message = [...req.messages].reverse().find((m) => m.role === 'tool');
  return message ? String(message.content ?? '') : '';
};

/** One tool round then an answer, with the model-chosen id `c1`. */
function scripted(toolName: string, args: Record<string, unknown>) {
  return mock({
    chunkDelayMs: 0,
    respond: (req) =>
      lastTool(req as Req)
        ? { content: 'done' }
        : { toolCalls: [{ id: 'c1', name: toolName, args }] },
  });
}

async function runAgent(options: {
  tool?: typeof lookupOrder | typeof explode;
  args?: Record<string, unknown>;
  middleware?: ToolMiddleware;
  withEvents?: boolean;
}): Promise<TraceToolpackArtifacts> {
  const tool = options.tool ?? lookupOrder;
  let builder = Agent.create({
    provider: scripted(tool.schema.name, options.args ?? { orderId: '7712' }),
    model: 'mock-1',
    maxIterations: 4,
  })
    .system('support')
    .tool(tool);
  if (options.middleware) builder = builder.act({ beforeTool: [options.middleware] });
  const agent = builder.build();

  const recorder = recordRun(agent);
  await agent.run({ message: 'Order 7712?' });
  const recording = recorder.toRecording();
  recorder.stop();

  return {
    snapshot: agent.getLastSnapshot()!,
    ...(options.withEvents !== false && { events: recording.events }),
  };
}

/* ── the join ─────────────────────────────────────────────────────────── */

describe('inspect_tool_call — the join across four records', () => {
  it('resolves name, step, proposed args, result, outcome and duration in one call', async () => {
    const artifacts = await runAgent({});
    const out = await callTraceTool(traceToolpack(artifacts), 'inspect_tool_call', {
      toolCallId: 'c1',
    });
    expect(out).toContain('TOOL CALL c1 — lookup_order');
    expect(out).toMatch(/step: .*tool-calls#\d+ — drill with trace_node\('.*tool-calls#\d+'\)/);
    expect(out).toContain('proposed by the model: {"orderId":"7712"}');
    expect(out).toContain('warranty ACTIVE');
    expect(out).toContain('outcome: ok');
    expect(out).toMatch(/duration: \d+ms/);
    // The boundary is named on every inspection, not only the interesting ones.
    expect(out).toContain('⚠ boundary: what happened INSIDE the tool is not traced');
  });

  it('resolves the owning step from the COMMIT LOG when no event tail exists', async () => {
    const artifacts = await runAgent({ withEvents: false });
    const out = await callTraceTool(traceToolpack(artifacts), 'inspect_tool_call', {
      toolCallId: 'c1',
    });
    // The step is still found — the fallback reads which committed history
    // first carries the call's result.
    expect(out).toMatch(/step: .*tool-calls#\d+/);
    expect(out).toContain('outcome: ok');
  });

  it('a bad id never throws — it names the real ids instead', async () => {
    const artifacts = await runAgent({});
    const out = await callTraceTool(traceToolpack(artifacts), 'inspect_tool_call', {
      toolCallId: 'not-a-call',
    });
    expect(out).toContain("unknown toolCallId 'not-a-call'");
    expect(out).toContain('c1 (lookup_order)');
  });
});

/* ── the proposed-vs-ran-with split (the reason it exists) ────────────── */

describe('inspect_tool_call — proposed args vs the args that actually ran', () => {
  it('surfaces a before-tool rewrite, naming the rule and its reason', async () => {
    const clamp: ToolMiddleware = {
      name: 'clamp-limit',
      onToolCall: (call) =>
        allow({ ...(call.args as Record<string, unknown>), limit: 5 }, 'page size capped at 5'),
    };
    const artifacts = await runAgent({ middleware: clamp });
    const out = await callTraceTool(traceToolpack(artifacts), 'inspect_tool_call', {
      toolCallId: 'c1',
    });
    expect(out).toContain('proposed by the model: {"orderId":"7712"}');
    expect(out).toContain('CHANGED at before-tool');
    expect(out).toContain("by 'clamp-limit'");
    expect(out).toContain('page size capped at 5');
    expect(out).toContain('"limit":5');
    // And the tool really did run on the rewritten args.
    expect(out).toContain('limit 5');
  });

  it('says plainly when rules looked and changed nothing', async () => {
    const nosy: ToolMiddleware = { name: 'audit-only', onToolCall: () => allow() };
    const artifacts = await runAgent({ middleware: nosy });
    const out = await callTraceTool(traceToolpack(artifacts), 'inspect_tool_call', {
      toolCallId: 'c1',
    });
    expect(out).toContain('ran with: the proposed arguments, unchanged');
  });

  it('says plainly when no rule filed a row at all (different from "allowed")', async () => {
    const artifacts = await runAgent({});
    const out = await callTraceTool(traceToolpack(artifacts), 'inspect_tool_call', {
      toolCallId: 'c1',
    });
    // Named by id since 9.86.1 — a bare `this call` on a persistent result
    // denotes whichever call re-reads it.
    expect(out).toContain("no governance rule filed a row for call 'c1'");
    expect(out).not.toMatch(/\bthis call\b/);
  });
});

/* ── outcomes ─────────────────────────────────────────────────────────── */

describe('inspect_tool_call — outcomes', () => {
  it('reports a denial with the rule that refused and why', async () => {
    const refuse: ToolMiddleware = {
      name: 'no-lookups',
      onToolCall: () => deny('lookups are frozen during the incident'),
    };
    const artifacts = await runAgent({ middleware: refuse });
    const out = await callTraceTool(traceToolpack(artifacts), 'inspect_tool_call', {
      toolCallId: 'c1',
    });
    expect(out).toContain("outcome: denied by 'no-lookups'");
    expect(out).toContain('lookups are frozen during the incident');
  });

  it('reports a thrown tool as an error, not as a normal result', async () => {
    const artifacts = await runAgent({ tool: explode, args: {} });
    const out = await callTraceTool(traceToolpack(artifacts), 'inspect_tool_call', {
      toolCallId: 'c1',
    });
    expect(out).toContain('outcome: error — the tool threw or returned a failure');
  });
});

/* ── a call the paused batch never dispatched (9.113.0) ───────────────── */

/**
 * The model batches three calls and the MIDDLE one asks a person
 * (`requestInput`). On resume the third call is SETTLED: the library answers it
 * with a fixed sentence and brackets it (`tool_end { durationMs: 0 }`, the
 * sentence as its `result`), and never executes it
 * (`core/agent/stages/toolCalls.ts` · "── The batch settlement (9.113.0)").
 * Its history message and both halves of its bracket carry `notDispatched`,
 * the one owner of "this call never ran". The join must read that marker.
 * Reading the bracket as the record of a call that ran would tell a debugging
 * model that the call ran with its arguments and returned the sentence in 0ms.
 *
 * `evicted`: two more rounds under `slidingWindow({ keepRecentTurns: 1 })`
 * with the pin off, so the batch turn has left the final history by the
 * time the run ends. The call's own step still committed it.
 *
 * `reused`: after the resume the model proposes a call under the settled
 * id `c3` again, and that call RUNS — a provider may reuse an id across turns.
 */
async function settledBatch(
  options: { withEvents?: boolean; evicted?: boolean; reused?: 'ran' | 'threw' } = {},
): Promise<TraceToolpackArtifacts> {
  const tools = ['first', 'second', 'third', 'move'].map((name) =>
    defineTool({
      name,
      description: `the ${name} tool`,
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        if (name === 'second') {
          return requestInput({
            id: 'year',
            question: 'Which year?',
            fields: [{ id: 'year', type: 'number', required: true }],
          });
        }
        // `third` only ever runs as the REUSED call (the batch's is settled):
        // slow enough that its bracket's duration is never the settlement's
        // 0ms, or throwing, so its outcome is its own.
        if (name === 'third' && options.reused === 'threw') throw new Error('third failed');
        if (name === 'third') await new Promise((done) => setTimeout(done, 25));
        return `${name} ran`;
      },
    }),
  );
  const batch = {
    toolCalls: [
      { id: 'c1', name: 'first', args: {} },
      { id: 'c2', name: 'second', args: {} },
      { id: 'c3', name: 'third', args: { q: 'x' } },
    ],
  };
  const moves = options.evicted
    ? [
        { toolCalls: [{ id: 'm1', name: 'move', args: {} }] },
        { toolCalls: [{ id: 'm2', name: 'move', args: {} }] },
      ]
    : [];
  const reuse =
    options.reused !== undefined ? [{ toolCalls: [{ id: 'c3', name: 'third', args: {} }] }] : [];
  let builder = Agent.create({
    provider: mock({ replies: [batch, ...moves, ...reuse, { content: 'done' }] }),
    model: 'mock',
    maxIterations: 8,
    ...(options.evicted && { keepLastToolResults: false as const }),
  }).tools(tools);
  if (options.evicted) builder = builder.window(slidingWindow({ keepRecentTurns: 1 }));
  const agent = builder.build();

  const paused = await agent.run({ message: 'go' });
  if (!isInputPause(paused)) throw new Error('expected an input pause');
  const recorder = recordRun(agent);
  await agent.resume(paused.checkpoint, {
    requestId: paused.awaitingInput.requestId,
    values: { year: 2026 },
  });
  const recording = recorder.toRecording();
  recorder.stop();
  return {
    snapshot: agent.getLastSnapshot()!,
    ...(options.withEvents !== false && { events: recording.events }),
  };
}

/** A detached copy with every `notDispatched` key removed from plain objects,
 *  at any depth (anything else — a Map, a class instance — is kept as is). */
function withoutMarker<T>(value: T): T {
  const scrub = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(scrub);
    if (node === null || typeof node !== 'object') return node;
    const proto = Object.getPrototypeOf(node) as unknown;
    if (proto !== Object.prototype && proto !== null) return node;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (key !== 'notDispatched') out[key] = scrub(child);
    }
    return out;
  };
  return scrub(structuredClone(value)) as T;
}

/** The lines a settled call must never be described with. */
function expectNoRunClaims(out: string): void {
  expect(out).not.toContain('the tool threw or returned a failure');
  expect(out).not.toContain('ran with: the proposed arguments');
  expect(out).not.toContain('outcome: ok');
  expect(out).not.toMatch(/duration: \d+ms/);
  expect(out).not.toContain('arguments in, result out');
}

describe('inspect_tool_call — a call the paused batch never dispatched (9.113.0)', () => {
  const OUTCOME =
    "outcome: not dispatched — the run paused on call 'c2' to 'second', earlier in the same " +
    "batch, and resumed without executing call 'c3'";

  it('reads the marker off the history message: never ran, no duration, nothing inside', async () => {
    const out = await callTraceTool(traceToolpack(await settledBatch()), 'inspect_tool_call', {
      toolCallId: 'c3',
    });
    expect(out).toContain('TOOL CALL c3 — third');
    expect(out).toContain("ran with: nothing — call 'c3' was never executed.");
    // The result line is the sentence the model read, verbatim.
    expect(out).toContain("result: \"Tool 'third' was not executed on that call");
    expect(out).toContain(OUTCOME);
    expect(out).toContain("duration: none — call 'c3' was never executed.");
    expect(out).toContain("inside: nothing — call 'c3' never reached the tool.");
    expectNoRunClaims(out);
  });

  it('the paused call itself keeps the join it always had', async () => {
    const out = await callTraceTool(traceToolpack(await settledBatch()), 'inspect_tool_call', {
      toolCallId: 'c2',
    });
    expect(out).toContain('TOOL CALL c2 — second');
    expect(out).toContain(
      "ran with: the proposed arguments — no governance rule filed a row for call 'c2'.",
    );
    expect(out).toContain('outcome: ok');
    expect(out).toMatch(/duration: \d+ms/);
    expect(out).not.toContain('not dispatched');
  });

  it('with no event tail the marker still decides — never "ok" for a call that did not run', async () => {
    const out = await callTraceTool(
      traceToolpack(await settledBatch({ withEvents: false })),
      'inspect_tool_call',
      { toolCallId: 'c3' },
    );
    expect(out).toContain(OUTCOME);
    expect(out).toContain("duration: none — call 'c3' was never executed.");
    expectNoRunClaims(out);
  });

  it('the bracket speaks first: with every history marker scrubbed, its typed field alone still says so', async () => {
    // Since the field rides the stream too (`ToolEndPayload.notDispatched`),
    // the event tail answers on its own — the history is the fallback, not a
    // requirement.
    const artifacts = await settledBatch();
    const scrubbed = { ...artifacts, snapshot: withoutMarker(artifacts.snapshot) };
    expect(JSON.stringify(scrubbed.snapshot)).not.toContain('notDispatched');
    const out = await callTraceTool(traceToolpack(scrubbed), 'inspect_tool_call', {
      toolCallId: 'c3',
    });
    expect(out).toContain(OUTCOME);
    expect(out).toContain("duration: none — call 'c3' was never executed.");
    expectNoRunClaims(out);
  });

  it('a bracket without the field is silence, not a denial: the history marker still decides', async () => {
    const artifacts = await settledBatch();
    const events = (artifacts.events ?? []).map((event) => withoutMarker(event));
    expect(JSON.stringify(events)).not.toContain('notDispatched');
    const out = await callTraceTool(traceToolpack({ ...artifacts, events }), 'inspect_tool_call', {
      toolCallId: 'c3',
    });
    expect(out).toContain(OUTCOME);
    expectNoRunClaims(out);
  });

  it('a window that evicted the batch turn: the bracket answers, with no history message left to read', async () => {
    const artifacts = await settledBatch({ evicted: true });
    // The precondition: the final history no longer carries the settled
    // message, and the event tail still brackets it with the field.
    const final = (artifacts.snapshot.sharedState as { history?: readonly LLMMessage[] }).history;
    expect((final ?? []).some((m) => m.toolCallId === 'c3')).toBe(false);
    const out = await callTraceTool(traceToolpack(artifacts), 'inspect_tool_call', {
      toolCallId: 'c3',
    });
    expect(out).toContain(OUTCOME);
    expect(out).toContain("ran with: nothing — call 'c3' was never executed.");
    expect(out).toContain("duration: none — call 'c3' was never executed.");
    expectNoRunClaims(out);
  });

  it("evicted, and the bracket's field scrubbed: the marker is read from the history the call's own step committed", async () => {
    // The history fallback's last arm (`traceToolpack.ts` · `settledInHistory`):
    // the final history has lost the message and the tail's brackets carry no
    // field, so the only marker left is in the `history` the resume step
    // itself committed. The tail still names the call, which is how the join
    // knows the id at all — with no tail and an evicted history the call is
    // unknown, and the tool says so rather than guessing.
    const artifacts = await settledBatch({ evicted: true });
    const events = (artifacts.events ?? []).map((event) => withoutMarker(event));
    expect(JSON.stringify(events)).not.toContain('notDispatched');
    const final = (artifacts.snapshot.sharedState as { history?: readonly LLMMessage[] }).history;
    expect((final ?? []).some((m) => m.toolCallId === 'c3')).toBe(false);
    const out = await callTraceTool(traceToolpack({ ...artifacts, events }), 'inspect_tool_call', {
      toolCallId: 'c3',
    });
    expect(out).toContain(OUTCOME);
    expect(out).toContain("ran with: nothing — call 'c3' was never executed.");
    expect(out).toContain("duration: none — call 'c3' was never executed.");
    expectNoRunClaims(out);
  });

  /** The bracket halves of one kind for `c3`, in tail order. */
  const bracketsOf = (artifacts: TraceToolpackArtifacts, kind: 'tool_start' | 'tool_end') =>
    (artifacts.events ?? []).filter(
      (event) =>
        event.type === `agentfootprint.stream.${kind}` &&
        (event.payload as { toolCallId?: string }).toolCallId === 'c3',
    );

  it('a provider that reuses the settled id for a call that then RAN: that call decides — its step, outcome and duration', async () => {
    // The join reads the LATEST result for an id; the marker follows the same
    // rule on the stream and in history, so the call that ran is not reported
    // as the one that was settled. The outcome and the duration are read off
    // the LAST `tool_end` for the id (`traceToolpack.ts` ·
    // `buildInspectToolCall`), and the step off the first bracket of a call
    // that ran (`bracketsFor`) — never the settlement's, which comes first on
    // the tail.
    const artifacts = await settledBatch({ reused: 'ran' });
    const ends = bracketsOf(artifacts, 'tool_end');
    const starts = bracketsOf(artifacts, 'tool_start');
    // The precondition: two brackets for the id, the settled one first, each
    // on its own step.
    expect(ends.map((e) => 'notDispatched' in (e.payload as object))).toEqual([true, false]);
    const [settledStep, ranStep] = starts.map(
      (e) => (e.meta as { runtimeStageId?: string }).runtimeStageId,
    );
    expect(ranStep).toBeDefined();
    expect(ranStep).not.toBe(settledStep);
    const out = await callTraceTool(traceToolpack(artifacts), 'inspect_tool_call', {
      toolCallId: 'c3',
    });
    expect(out).not.toContain('not dispatched');
    expect(out).toContain(`step: ${ranStep} —`);
    expect(out).toContain('outcome: ok');
    // The call that ran waited 25ms; the settlement's bracket says 0ms.
    const ranMs = (ends[1]!.payload as { durationMs: number }).durationMs;
    expect(ranMs).toBeGreaterThanOrEqual(20);
    expect(out).toContain(`duration: ${ranMs}ms`);
    expect(out).not.toContain('duration: 0ms');
  });

  it('a provider that reuses the settled id for a call that then THREW: the outcome is its error, never the settlement’s silence', async () => {
    const artifacts = await settledBatch({ reused: 'threw' });
    const ends = bracketsOf(artifacts, 'tool_end');
    expect(ends.map((e) => (e.payload as { error?: boolean }).error)).toEqual([undefined, true]);
    const out = await callTraceTool(traceToolpack(artifacts), 'inspect_tool_call', {
      toolCallId: 'c3',
    });
    expect(out).toContain('outcome: error — the tool threw or returned a failure');
    expect(out).not.toContain('outcome: ok');
  });
});

/* ── an id a provider reused ──────────────────────────────────────────── */

describe('inspect_tool_call — an id a provider reused: the latest call decides', () => {
  it('two calls under one id and no settlement: the outcome and duration are the LATEST call’s, the one the result line shows', async () => {
    // A provider may reuse an id across turns. The join reads the LATEST
    // result for the id, so the outcome and the duration come off the LAST
    // `tool_end` for it — never a first call's `ok` and its 1ms printed
    // beside a second call's failure.
    let calls = 0;
    const flaky = defineTool({
      name: 'flaky',
      description: 'answers once, then fails slowly',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        calls++;
        if (calls === 1) return 'first answer';
        await new Promise((done) => setTimeout(done, 25));
        throw new Error('second call failed');
      },
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'flaky', args: {} }] },
          { toolCalls: [{ id: 'c1', name: 'flaky', args: {} }] },
          { content: 'done' },
        ],
      }),
      model: 'mock',
      maxIterations: 6,
    })
      .tool(flaky)
      .build();
    const recorder = recordRun(agent);
    await agent.run({ message: 'go' });
    const recording = recorder.toRecording();
    recorder.stop();
    const ends = recording.events.filter(
      (event) =>
        event.type === 'agentfootprint.stream.tool_end' &&
        (event.payload as { toolCallId?: string }).toolCallId === 'c1',
    );
    // The precondition: two brackets for the id — the first ok, the second
    // an error — and neither carries the settlement's marker.
    expect(ends.map((e) => (e.payload as { error?: boolean }).error)).toEqual([undefined, true]);
    expect(ends.filter((e) => 'notDispatched' in (e.payload as object))).toEqual([]);
    const out = await callTraceTool(
      traceToolpack({ snapshot: agent.getLastSnapshot()!, events: recording.events }),
      'inspect_tool_call',
      { toolCallId: 'c1' },
    );
    expect(out).toContain('second call failed');
    expect(out).toContain('outcome: error — the tool threw or returned a failure');
    const lastMs = (ends[1]!.payload as { durationMs: number }).durationMs;
    expect(lastMs).toBeGreaterThanOrEqual(20);
    expect(out).toContain(`duration: ${lastMs}ms`);
  });
});

/* ── honest absence ───────────────────────────────────────────────────── */

describe('inspect_tool_call — honest absence', () => {
  it('marks the duration unavailable (⚠) when the artifacts carry no event tail', async () => {
    const artifacts = await runAgent({ withEvents: false });
    const out = await callTraceTool(traceToolpack(artifacts), 'inspect_tool_call', {
      toolCallId: 'c1',
    });
    expect(out).toContain('duration: ⚠ unavailable');
    expect(out).toContain('The commit log records what each step WROTE and has no clock');
    // Never a fabricated number.
    expect(out).not.toMatch(/duration: \d+ms/);
  });

  it('still resolves the call from history alone — absence of events is not absence of evidence', async () => {
    const artifacts = await runAgent({ withEvents: false });
    const out = await callTraceTool(traceToolpack(artifacts), 'inspect_tool_call', {
      toolCallId: 'c1',
    });
    expect(out).toContain('TOOL CALL c1 — lookup_order');
    expect(out).toContain('proposed by the model: {"orderId":"7712"}');
  });
});

/* ── security ─────────────────────────────────────────────────────────── */

describe('inspect_tool_call — security', () => {
  /**
   * The join reads the COMMIT LOG, never `snapshot.sharedState`.
   *
   * That distinction is the whole redaction contract and it is invisible
   * on a run with no policy, because both copies say the same thing. So
   * the fixture makes them DISAGREE: `sharedState` carries the raw value
   * (it is the run's live state, unredacted by construction) while the
   * commit log carries the placeholder footprintjs wrote at commit time.
   * Serving the secret would prove the tool read the wrong copy.
   */
  it('reads the redacted commit log, not the live sharedState', async () => {
    const secret = 'SENTINEL-TOOL-RESULT-9182';
    const redactedHistory = [
      { role: 'user', content: 'Order 7712?' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'lookup_order', args: { orderId: '7712' } }],
      },
      { role: 'tool', content: '[REDACTED]', toolCallId: 'c1', toolName: 'lookup_order' },
    ];
    const artifacts: TraceToolpackArtifacts = {
      snapshot: {
        // The live state a leaky reader might reach for.
        sharedState: {
          history: [
            ...redactedHistory.slice(0, 2),
            { role: 'tool', content: secret, toolCallId: 'c1', toolName: 'lookup_order' },
          ],
        },
        executionTree: {
          id: 'tool-calls',
          runtimeStageId: 'tool-calls#0',
          name: 'Tool calls',
          logs: {},
          errors: {},
          metrics: {},
          evals: {},
        },
        commitLog: [
          {
            idx: 0,
            stage: 'Tool calls',
            stageId: 'tool-calls',
            runtimeStageId: 'tool-calls#0',
            trace: [{ path: 'history', verb: 'set' as const }],
            redactedPaths: ['history'],
            overwrite: { history: redactedHistory },
            updates: {},
          },
        ],
        commitValues: 'full',
      } as unknown as TraceToolpackArtifacts['snapshot'],
    };

    const out = await callTraceTool(traceToolpack(artifacts), 'inspect_tool_call', {
      toolCallId: 'c1',
    });
    expect(out).toContain('TOOL CALL c1 — lookup_order'); // the join still works
    expect(out).not.toContain(secret); // …on the redacted copy only
    expect(out).toContain('[REDACTED]'); // the placeholder passes through verbatim
  });
});
