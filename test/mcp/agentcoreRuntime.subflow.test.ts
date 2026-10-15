/**
 * A runtime-hosted MCP tool inside footprintjs subflows — the scenario that
 * decides whether the session and retry strategies hold up where agents
 * actually run: as a composition's member, and side by side in a fan-out.
 *
 * Three things are checked:
 *
 *   ATTRIBUTION  every tool call belongs to the runtimeStageId of the stage
 *                that made it — read off the run's OWN record (`tool_start` /
 *                `tool_end` meta). Every retry ran inside that call: a retry is
 *                reported by the client it ran on (`retry.onRetry`), and this
 *                test's in-flight probe links the report to the call's
 *                toolCallId. Stated plainly: the run record does not carry
 *                retries yet — routing them through a shared attempt record is a
 *                separate footprintjs packet, and the decision it will route is
 *                the one small function `sessionBusy`.
 *   ISOLATION    session ids never cross a branch: each branch's requests carry
 *                its own runtime and MCP session, the two sets are disjoint, and
 *                a shared client on the default ('per-call') sends no session id
 *                at all. For 'reuse' this holds BY CONSTRUCTION — one client per
 *                branch, each its own runtime session — and this guards it.
 *   SECRECY      no credential — a bearer token, an SDK client's keys — and no
 *                session id reaches the recording (snapshot, events, structure)
 *                or the narrative: on the happy path, when the retries run out,
 *                when the service answers a call with a 5xx, and when an auth
 *                failure's message quotes the signed request back.
 *
 * One client per branch is the documented shape for 'reuse' ("one client is one
 * session — build one client per conversation"); the test builds exactly that,
 * and one case shows the default, 'per-call', for a shared client.
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

/**
 * A branch's client, its watch, and the transport it rides:
 *   'sigv4'          — the SDK client the TRANSPORT builds (its own retry off);
 *   'sigv4-callers'  — a client the CALLER built, holding its own keys;
 *   { token }        — a bearer token over the HTTPS endpoint.
 */
async function branchClient(
  runtime: FakeRuntime,
  auth: 'sigv4' | 'sigv4-callers' | { token: string },
  maxAttempts?: number,
): Promise<{ tools: Tool[]; watch: Watch; close: () => Promise<void> }> {
  const watch: Watch = { retries: [] };
  const client = await mcpClient({
    name: 'orders',
    transport: agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      // One client per branch is the documented shape for 'reuse'.
      session: 'reuse',
      retry: {
        ...(maxAttempts !== undefined && { maxAttempts }),
        onRetry: (info) =>
          watch.retries.push({
            info,
            ...(watch.inFlight !== undefined && { toolCallId: watch.inFlight }),
          }),
      },
      ...(auth === 'sigv4'
        ? { _sdk: runtime.sdk }
        : auth === 'sigv4-callers'
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
    const branch = await branchClient(runtime, 'sigv4-callers');
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

  it("ISOLATION — one SHARED client on the default ('per-call'): no request carries any session id", async () => {
    const runtime = ordersRuntime();
    const client = await mcpClient({
      name: 'orders',
      // No `session` option: the default is the one that is safe to share.
      transport: agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
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

describe('runtime-hosted MCP — SECRECY when it goes wrong', () => {
  /** Run `flow`, recording everything a reader could see later. */
  async function recorded(flow: Parallel | Sequence, message: string) {
    flow.attach(narrative());
    const recorder = recordRun(flow);
    const answer = await flow.run({ message });
    const recording = recorder.toRecording();
    recorder.stop();
    return { answer, written: everythingWritten(recording) };
  }

  it('retries exhausted in a fan-out: each branch gives up on its own, and nothing secret is written', async () => {
    const runtime = fakeAgentCoreRuntime({
      tools: [{ name: 'lookup_order', answer: () => 'never served' }],
      busyCalls: { lookup_order: 99 },
    });
    const a = await branchClient(runtime, { token: TOKEN.a }, 2);
    const b = await branchClient(runtime, { token: TOKEN.b }, 2);
    const flow = Parallel.create()
      .branch('a', orderAgent('A-100', a.tools))
      .branch('b', orderAgent('B-200', b.tools))
      .mergeWithFn((results) => JSON.stringify(results))
      .build();
    const { answer, written } = await recorded(flow, 'look both orders up');
    await a.close();
    await b.close();

    // Bounded: two attempts per call, one retry reported per branch, then the
    // refusal reached the tool — the model was told, nothing hung.
    expect(runtime.calls()).toHaveLength(4);
    expect([a.watch.retries.length, b.watch.retries.length]).toEqual([1, 1]);
    expect(String(answer)).not.toContain('never served');
    expect(written).not.toContain(TOKEN.a);
    expect(written).not.toContain(TOKEN.b);
    for (const attempt of runtime.attempts) {
      if (attempt.runtimeSessionId) expect(written).not.toContain(attempt.runtimeSessionId);
      if (attempt.mcpSessionId) expect(written).not.toContain(attempt.mcpSessionId);
    }
  });

  it('a 5xx from the service, as a subflow: sent ONCE by the transport’s own client, nothing secret written', async () => {
    const runtime = fakeAgentCoreRuntime({
      tools: [{ name: 'lookup_order', answer: () => 'never served' }],
      sdkFailures: { lookup_order: { name: 'InternalServerException', status: 500 } },
    });
    // The transport's OWN SDK client — the fake re-sends a server fault the way
    // the SDK's standard policy does (up to `maxAttempts`, default 3), so this
    // fails if the transport ever stops building its client with retry off.
    const branch = await branchClient(runtime, 'sigv4');
    const flow = Sequence.create().step('lookup', orderAgent('S-7', branch.tools)).build();
    const { written } = await recorded(flow, 'where is order S-7?');
    await branch.close();

    // ONE attempt at the call: a 5xx may be the record of work that ran.
    expect(runtime.calls()).toHaveLength(1);
    expect(runtime.clientConfigs[0]).toMatchObject({ maxAttempts: 1 });
    expect(branch.watch.retries).toEqual([]);
    for (const attempt of runtime.attempts) {
      if (attempt.runtimeSessionId) expect(written).not.toContain(attempt.runtimeSessionId);
      if (attempt.mcpSessionId) expect(written).not.toContain(attempt.mcpSessionId);
    }
  });

  it('an auth failure that QUOTES the signed request, as a subflow: the model, record and narrative never see it', async () => {
    const SECURITY_TOKEN = 'SECRET-SESSION-TOKEN-5d2e';
    const runtime = fakeAgentCoreRuntime({
      tools: [{ name: 'lookup_order', answer: () => 'never served' }],
      sdkFailures: {
        lookup_order: {
          name: 'InvalidSignatureException',
          status: 403,
          // How AWS answers a signature mismatch: the canonical request it
          // expected — every signed header, with its value.
          message: (input) =>
            'The request signature we calculated does not match the signature you provided. ' +
            "The Canonical String for this request should have been\n'POST\n" +
            `x-amz-security-token:${SECURITY_TOKEN}\n` +
            `mcp-session-id:${String(input['mcpSessionId'])}\n` +
            `x-amzn-bedrock-agentcore-runtime-session-id:${String(input['runtimeSessionId'])}'`,
        },
      },
    });
    const branch = await branchClient(runtime, 'sigv4');
    const flow = Sequence.create().step('lookup', orderAgent('S-7', branch.tools)).build();
    const events: AgentfootprintEvent[] = [];
    flow.on('*', (e) => events.push(e));
    const { answer, written } = await recorded(flow, 'where is order S-7?');
    await branch.close();

    // The control: the call really was refused, once, and the model was told
    // WHAT failed — the type and the status.
    expect(runtime.calls()).toHaveLength(1);
    expect(String(answer)).toContain('InvalidSignatureException (HTTP 403)');
    const sessionIds = runtime.attempts.flatMap((a) =>
      [a.runtimeSessionId, a.mcpSessionId].filter((id): id is string => id !== undefined),
    );
    expect(sessionIds.length).toBeGreaterThan(0);
    for (const text of [String(answer), written, JSON.stringify(events)]) {
      expect(text).not.toContain(SECURITY_TOKEN);
      for (const id of sessionIds) expect(text).not.toContain(id);
    }
  });

  it('a caller-built client keeps its OWN retry policy — the documented reason to set maxAttempts: 1', async () => {
    const runtime = fakeAgentCoreRuntime({
      tools: [{ name: 'lookup_order', answer: () => 'never served' }],
      sdkFailures: { lookup_order: { name: 'InternalServerException', status: 500 } },
    });
    // No maxAttempts on the caller's client: the SDK's default policy applies,
    // and the fake re-sends the server fault three times. This is the case the
    // `client` option's docs warn about.
    const branch = await branchClient(runtime, 'sigv4-callers');
    const flow = Sequence.create().step('lookup', orderAgent('S-7', branch.tools)).build();
    const { written } = await recorded(flow, 'where is order S-7?');
    await branch.close();
    expect(runtime.calls()).toHaveLength(3);
    expect(written).not.toContain(SDK_KEYS.accessKeyId);
    expect(written).not.toContain(SDK_KEYS.secretAccessKey);
  });
});
