/**
 * A runtime-hosted MCP tool inside footprintjs subflows — the scenario that
 * decides whether the session and retry strategies hold up where agents
 * actually run: as a composition's member, and side by side in a fan-out.
 *
 * Three things are checked, each against the run's own record:
 *
 *   ATTRIBUTION  every tool call, and every retry inside it, belongs to the
 *                runtimeStageId of the stage that made it. A retry is reported
 *                by the client it ran on (`retry.onRetry`); the call in flight
 *                on that client names the toolCallId; the run's
 *                `stream.tool_start` for that toolCallId names the stage.
 *   ISOLATION    session ids never cross a branch: each branch's requests carry
 *                its own runtime and MCP session, the two sets are disjoint,
 *                and a shared 'per-call' client sends no session id at all.
 *   SECRECY      no credential — a bearer token, an SDK client's keys — and no
 *                session id reaches the recording (snapshot, events, structure)
 *                or the narrative.
 *
 * One client per branch is the documented shape for 'reuse' ("one transport is
 * one session — build one client per conversation"); the test builds exactly
 * that, and the last case shows the 'per-call' alternative for a shared client.
 */

import { narrative } from 'footprintjs/recorders';
import { describe, expect, it } from 'vitest';

import { Agent, Parallel, Sequence, type Tool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { recordRun } from '../../src/doors/observe.js';
import { mcpClient } from '../../src/tool-providers/index.js';
import { agentCoreRuntimeMcpTransport } from '../../src/adapters/mcp/agentcoreRuntime/transport.js';
import { staticTokens } from '../../src/identity/staticTokens.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import type { ThrottleRetryInfo } from '../../src/mcp/throttleRetry.js';
import { fakeAgentCoreRuntime, type FakeRuntime } from './fixtures/fakeAgentCoreRuntime.js';

const ARN = 'arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/orders_mcp-a1b2c3';
const REGION = 'us-west-2';

const TOKEN = { a: 'SECRET-BEARER-AAAA-91c2', b: 'SECRET-BEARER-BBBB-47e0' } as const;
const SDK_KEYS = { accessKeyId: 'AKIA-SECRET-ID-0000', secretAccessKey: 'SECRET-ACCESS-KEY-1111' };

/** The hosted server: one tool, refused busy twice per session before it runs. */
function ordersRuntime(): FakeRuntime {
  return fakeAgentCoreRuntime({
    tools: [{ name: 'lookup_order', answer: (args) => `order ${String(args['id'])} is shipped` }],
    busyCalls: { lookup_order: 2 },
  });
}

/** What the test watches on one client: its retries, and the call in flight when each fired. */
interface Watch {
  readonly retries: { readonly info: ThrottleRetryInfo; readonly toolCallId?: string }[];
  inFlight?: string;
}

/**
 * Wrap a client's tools so the call in flight is known — the instrument that
 * turns "client A retried" into "toolCallId X retried". It changes nothing the
 * agent sees: same schema, same result.
 */
function watched(tools: readonly Tool[], watch: Watch): Tool[] {
  return tools.map((tool) => ({
    ...tool,
    execute: async (args, ctx) => {
      watch.inFlight = ctx.toolCallId;
      try {
        return await tool.execute(args, ctx);
      } finally {
        watch.inFlight = undefined;
      }
    },
  }));
}

/** An agent that looks one order up and answers with what the tool said. */
function orderAgent(orderId: string, tools: readonly Tool[]): Agent {
  return Agent.create({
    provider: mock({
      chunkDelayMs: 0,
      respond: (req) => {
        const messages = (req as { messages: { role: string; content?: unknown }[] }).messages;
        const toolReply = [...messages].reverse().find((m) => m.role === 'tool');
        return toolReply
          ? { content: `Answer: ${String(toolReply.content)}` }
          : {
              toolCalls: [{ id: `call-${orderId}`, name: 'lookup_order', args: { id: orderId } }],
            };
      },
    }),
    model: 'mock',
    maxIterations: 4,
  })
    .system('You look orders up.')
    .tools([...tools])
    .build();
}

/** A branch's client, its watch, and the transport it rides. */
async function branchClient(
  runtime: FakeRuntime,
  auth: 'sigv4' | { token: string },
): Promise<{ tools: Tool[]; watch: Watch; close: () => Promise<void> }> {
  const watch: Watch = { retries: [] };
  const client = await mcpClient({
    name: 'orders',
    transport: agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      retry: {
        onRetry: (info) =>
          watch.retries.push({
            info,
            ...(watch.inFlight !== undefined && { toolCallId: watch.inFlight }),
          }),
      },
      ...(auth === 'sigv4'
        ? {
            // A client the caller built, holding its own keys — they must never
            // reach anything this library writes.
            client: new (runtime.sdk['BedrockAgentCoreClient'] as new (c: unknown) => never)({
              region: REGION,
              credentials: SDK_KEYS,
            }),
            _sdk: runtime.sdk,
          }
        : { auth: { bearer: staticTokens({ runtime: auth.token }), fetch: runtime.https } }),
    }),
  });
  return { tools: watched(await client.tools(), watch), watch, close: () => client.close() };
}

/** The tool_start event of a call, which names the stage that made it. */
function stageOf(events: readonly AgentfootprintEvent[], toolCallId: string | undefined): string {
  const start = events.find(
    (e) =>
      e.type === 'agentfootprint.stream.tool_start' &&
      (e.payload as { toolCallId?: string }).toolCallId === toolCallId,
  );
  return start?.meta.runtimeStageId ?? '(no tool_start)';
}

/** Everything a run left behind that anyone can read later, as one string. */
function everythingWritten(recording: unknown): string {
  return JSON.stringify(recording);
}

/** The narrative recorder's lines, as they rode the snapshot. */
function narrativeOf(recording: unknown): string {
  const rows = (recording as { snapshot?: { recorders?: { id: string; data?: unknown }[] } })
    .snapshot?.recorders;
  const row = rows?.find((r) => r.id.startsWith('combined-narrative'));
  return JSON.stringify(row?.data ?? []);
}

describe('runtime-hosted MCP — as a SUBFLOW (a Sequence step)', () => {
  it('the call and both retries belong to the step’s tool-calls stage; the SDK keys stay out', async () => {
    const runtime = ordersRuntime();
    const branch = await branchClient(runtime, 'sigv4');
    const flow = Sequence.create().step('lookup', orderAgent('S-7', branch.tools)).build();
    flow.attach(narrative());
    const recorder = recordRun(flow);
    const events: AgentfootprintEvent[] = [];
    flow.on('*', (e) => events.push(e));

    const answer = await flow.run({ message: 'where is order S-7?' });
    await branch.close();
    const recording = recorder.toRecording();
    recorder.stop();

    expect(String(answer)).toContain('order S-7 is shipped');
    // ATTRIBUTION — two retries, both inside the one call, both at the step.
    expect(branch.watch.retries.map((r) => r.info.attempt)).toEqual([2, 3]);
    for (const retry of branch.watch.retries) {
      expect(retry.toolCallId).toBe('call-S-7');
      expect(stageOf(events, retry.toolCallId)).toMatch(/^step-lookup\/tool-calls#\d+$/);
    }
    // The call itself: three attempts on the wire, two refused.
    expect(runtime.calls().map((c) => c.refusedBusy)).toEqual([true, true, false]);
    // SECRECY — the caller's SDK keys are the client's, and never ours.
    const written = everythingWritten(recording);
    expect(written).not.toContain(SDK_KEYS.accessKeyId);
    expect(written).not.toContain(SDK_KEYS.secretAccessKey);
    // The run's session never enters the run's record either: it is transport state.
    for (const attempt of runtime.attempts) {
      if (attempt.runtimeSessionId) expect(written).not.toContain(attempt.runtimeSessionId);
      if (attempt.mcpSessionId) expect(written).not.toContain(attempt.mcpSessionId);
    }
    // The narrative rode the snapshot, told the tool's result — and so was part
    // of what was searched above, not a row that happened to be missing.
    expect(narrativeOf(recording)).toContain('order S-7 is shipped');
  });
});

describe('runtime-hosted MCP — inside a PARALLEL fan-out', () => {
  async function fanOut() {
    const runtime = ordersRuntime();
    const a = await branchClient(runtime, { token: TOKEN.a });
    const b = await branchClient(runtime, { token: TOKEN.b });
    const flow = Parallel.create()
      .branch('a', orderAgent('A-100', a.tools))
      .branch('b', orderAgent('B-200', b.tools))
      .mergeWithFn((results) => JSON.stringify(results))
      .build();
    flow.attach(narrative());
    const recorder = recordRun(flow);
    const events: AgentfootprintEvent[] = [];
    flow.on('*', (e) => events.push(e));
    const answer = await flow.run({ message: 'look both orders up' });
    await a.close();
    await b.close();
    const recording = recorder.toRecording();
    recorder.stop();
    return { runtime, a, b, events, answer, recording };
  }

  it('ATTRIBUTION — each branch’s call and retries land on that branch’s stage', async () => {
    const { a, b, events, answer } = await fanOut();
    const results = JSON.parse(String(answer)) as Record<string, string>;
    expect(results['a']).toContain('order A-100 is shipped');
    expect(results['b']).toContain('order B-200 is shipped');

    for (const [branch, watch] of [
      ['a', a.watch],
      ['b', b.watch],
    ] as const) {
      expect(watch.retries).toHaveLength(2);
      for (const retry of watch.retries) {
        expect(stageOf(events, retry.toolCallId)).toMatch(
          new RegExp(`^${branch}/tool-calls#\\d+$`),
        );
      }
    }
    // And the calls themselves: every tool event of a branch's call sits under
    // that branch, and nowhere else.
    for (const e of events.filter((x) => x.type.startsWith('agentfootprint.stream.tool_'))) {
      const id = (e.payload as { toolCallId?: string }).toolCallId;
      const branch = id === 'call-A-100' ? 'a' : id === 'call-B-200' ? 'b' : undefined;
      expect(branch, `unexpected tool call ${String(id)}`).toBeDefined();
      expect(e.meta.subflowPath[0]).toBe(branch);
    }
  });

  it('ISOLATION — a branch’s requests carry only its own sessions; the sets are disjoint', async () => {
    const { runtime } = await fanOut();
    const byBranch = (token: string) =>
      runtime.attempts.filter((x) => x.authorization === `Bearer ${token}`);
    const attemptsA = byBranch(TOKEN.a);
    const attemptsB = byBranch(TOKEN.b);
    expect(attemptsA.length + attemptsB.length).toBe(runtime.attempts.length);

    const sessions = (attempts: typeof attemptsA) => ({
      runtime: new Set(attempts.map((x) => x.runtimeSessionId)),
      mcp: new Set(attempts.filter((x) => x.rpcMethod !== 'initialize').map((x) => x.mcpSessionId)),
    });
    const sa = sessions(attemptsA);
    const sb = sessions(attemptsB);
    // One of each per branch ('reuse')...
    expect([sa.runtime.size, sa.mcp.size, sb.runtime.size, sb.mcp.size]).toEqual([1, 1, 1, 1]);
    // ...never the other branch's.
    expect([...sa.runtime].some((id) => sb.runtime.has(id))).toBe(false);
    expect([...sa.mcp].some((id) => sb.mcp.has(id))).toBe(false);
    // And each branch's tool call carried its own order, under its own session.
    expect(attemptsA.filter((x) => x.toolName).every((x) => x.args?.['id'] === 'A-100')).toBe(true);
    expect(attemptsB.filter((x) => x.toolName).every((x) => x.args?.['id'] === 'B-200')).toBe(true);
  });

  it('SECRECY — neither bearer token, nor any session id, reaches the record or the narrative', async () => {
    const { runtime, recording } = await fanOut();
    const written = everythingWritten(recording);
    // The tokens WERE used — the control that makes the absence mean something.
    expect(runtime.attempts.some((x) => x.authorization === `Bearer ${TOKEN.a}`)).toBe(true);
    expect(written).not.toContain(TOKEN.a);
    expect(written).not.toContain(TOKEN.b);
    for (const attempt of runtime.attempts) {
      if (attempt.runtimeSessionId) expect(written).not.toContain(attempt.runtimeSessionId);
      if (attempt.mcpSessionId) expect(written).not.toContain(attempt.mcpSessionId);
    }
    // Both branches' tool results are in the narrative that was searched.
    const told = narrativeOf(recording);
    expect(told).toContain('order A-100 is shipped');
    expect(told).toContain('order B-200 is shipped');
  });

  it("ISOLATION — one SHARED 'per-call' client: no request carries any session id", async () => {
    const runtime = ordersRuntime();
    const client = await mcpClient({
      name: 'orders',
      transport: agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        session: 'per-call',
        _sdk: runtime.sdk,
      }),
    });
    const tools = await client.tools();
    const flow = Parallel.create()
      .branch('a', orderAgent('A-100', tools))
      .branch('b', orderAgent('B-200', tools))
      .mergeWithFn((results) => JSON.stringify(results))
      .build();
    const answer = JSON.parse(String(await flow.run({ message: 'both' }))) as Record<
      string,
      string
    >;
    await client.close();

    expect(answer['a']).toContain('order A-100 is shipped');
    expect(answer['b']).toContain('order B-200 is shipped');
    expect(runtime.attempts.every((x) => x.mcpSessionId === undefined)).toBe(true);
    expect(runtime.attempts.every((x) => x.runtimeSessionId === undefined)).toBe(true);
  });
});
