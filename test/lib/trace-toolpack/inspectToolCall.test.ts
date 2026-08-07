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

import { Agent, allow, defineTool, deny, type ToolMiddleware } from '../../../src/index.js';
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
    expect(out).toContain('no governance rule filed a row for this call');
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
