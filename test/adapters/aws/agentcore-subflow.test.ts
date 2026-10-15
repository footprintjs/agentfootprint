/**
 * AgentCore inside footprintjs subflows — an agent that calls an MCP tool HOSTED
 * on AgentCore Runtime and writes its turn to AgentCore Memory with write
 * options, run as a composition member (a SUBFLOW) and side by side in a
 * PARALLEL fan-out.
 *
 *   ATTRIBUTION  each tool call sits under its own branch's runtimeStageId in
 *                the run's record (`tool_start` / `tool_end` meta), each retry is
 *                reported by that branch's own client inside that call, and each
 *                memory write runs in its own branch's write subflow (the
 *                narrative's runtimeStageIds).
 *   ISOLATION    the branches' MCP sessions are disjoint; every memory write
 *                carries the write options of the memory that made it
 *                (`extractionMode: 'SKIP'`, the tenant's namespace) and only its
 *                own branch's answer.
 *   SECRECY      no bearer token, no SDK key and no session id reaches the
 *                recording (snapshot, events, structure) or the narrative.
 *
 * Known, pre-existing, and NOT asserted here: a composition passes its members
 * no run identity, so a member agent's memory runs under the placeholder
 * conversation `'pending'` (`seed.ts` rung 3 with the member's unset run id).
 * That is why the namespace scope below is fixed per request rather than read
 * from the identity — and it is reported separately.
 */

import { narrative } from 'footprintjs/recorders';
import { describe, expect, it } from 'vitest';

import { Agent, Parallel, Sequence, type Tool } from '../../../src/index.js';
import { mock } from '../../../src/doors/providers.js';
import { recordRun } from '../../../src/doors/observe.js';
import { mcpClient } from '../../../src/tool-providers/index.js';
import { agentCoreRuntimeMcpTransport } from '../../../src/adapters/mcp/agentcoreRuntime/transport.js';
import { AgentCoreStore } from '../../../src/adapters/memory/agentcore.js';
import { defineMemory, MEMORY_STRATEGIES, MEMORY_TYPES } from '../../../src/memory/index.js';
import { staticTokens } from '../../../src/identity/staticTokens.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';
import type { ThrottleRetryInfo } from '../../../src/mcp/throttleRetry.js';
import { fakeAgentCoreRuntime, type FakeRuntime } from '../../mcp/fixtures/fakeAgentCoreRuntime.js';
import { AWS_COMMAND_PINS, fakeSdk, type FakeSdk } from './awsCommandPin.js';

const ARN = 'arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/orders_mcp-a1b2c3';
const REGION = 'us-west-2';
const TOKEN = { a: 'SECRET-BEARER-AAAA-5d1e', b: 'SECRET-BEARER-BBBB-0c7f' } as const;
const SDK_KEYS = { accessKeyId: 'AKIA-SECRET-ID-2222', secretAccessKey: 'SECRET-ACCESS-KEY-3333' };
const SCOPE = { tenantid: 'acme' };

/** The hosted MCP server: one tool, refused busy once per session before it runs. */
function ordersRuntime(): FakeRuntime {
  return fakeAgentCoreRuntime({
    tools: [{ name: 'lookup_order', answer: (args) => `order ${String(args['id'])} is shipped` }],
    busyCalls: { lookup_order: 1 },
  });
}

/** AgentCore Memory through a fake SDK that records every command. */
function memoryService(): { store: AgentCoreStore; sdk: FakeSdk } {
  const row = AWS_COMMAND_PINS.find((p) => p.adapter === 'AgentCoreStore');
  if (!row) throw new Error('no AgentCoreStore pin');
  const sdk = fakeSdk(row, { ListEventsCommand: { events: [] } });
  // An SDK that MODELS CreateEvent's extraction fields (as 3.1152.0 does).
  const module = {
    ...sdk.module,
    CreateEventInput$: [
      3,
      'com.amazonaws.bedrockagentcore',
      'CreateEventInput',
      0,
      ['memoryId', 'actorId', 'eventTimestamp', 'payload', 'extractionMode', 'extractionConfig'],
    ],
  };
  return { store: new AgentCoreStore({ memoryId: 'mem-1', _sdk: module }), sdk };
}

/** One branch's tools, its retry reports, and the call in flight when each fired. */
async function branchTools(runtime: FakeRuntime, token: string) {
  const retries: { info: ThrottleRetryInfo; toolCallId?: string }[] = [];
  let inFlight: string | undefined;
  const client = await mcpClient({
    name: 'orders',
    transport: agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      // One client per branch: the documented shape for a carried session.
      session: 'reuse',
      auth: { bearer: staticTokens({ runtime: token }), fetch: runtime.https },
      retry: {
        onRetry: (info) =>
          retries.push({ info, ...(inFlight !== undefined && { toolCallId: inFlight }) }),
      },
    }),
  });
  const tools: Tool[] = (await client.tools()).map((tool) => ({
    ...tool,
    execute: async (args, ctx) => {
      inFlight = ctx.toolCallId;
      try {
        return await tool.execute(args, ctx);
      } finally {
        inFlight = undefined;
      }
    },
  }));
  return { tools, retries, close: () => client.close() };
}

/** An agent that looks one order up, answers with what the tool said, and remembers the turn. */
function orderAgent(
  orderId: string,
  tools: readonly Tool[],
  memoryId: string,
  store: AgentCoreStore,
) {
  return Agent.create({
    provider: mock({
      chunkDelayMs: 0,
      respond: (req) => {
        const toolReply = [...req.messages].reverse().find((m) => m.role === 'tool');
        return toolReply
          ? { content: `Answer: ${String(toolReply.content)}` }
          : { toolCalls: [{ id: `call-${orderId}`, name: 'lookup_order', args: { id: orderId } }] };
      },
    }),
    model: 'mock',
    maxIterations: 4,
  })
    .system('You look orders up and remember what you found.')
    .tools([...tools])
    .memory(
      defineMemory({
        id: memoryId,
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
        store,
        writeOptions: { extraction: 'skip' },
        namespaceScope: SCOPE,
      }),
    )
    .build();
}

/** The narrative recorder's lines, as they rode the snapshot. */
function narrativeOf(recording: unknown): { runtimeStageId?: string; text?: string }[] {
  const rows = (recording as { snapshot?: { recorders?: { id: string; data?: unknown }[] } })
    .snapshot?.recorders;
  const row = rows?.find((r) => r.id.startsWith('combined-narrative'));
  return (row?.data ?? []) as { runtimeStageId?: string; text?: string }[];
}

/** The CreateEvent inputs, with the entry each one wrote decoded. */
function createdEvents(sdk: FakeSdk) {
  return sdk.sent
    .filter((s) => s.command === 'CreateEventCommand')
    .map((s) => {
      const payload = s.input['payload'] as { blob: string }[];
      const entry = JSON.parse(payload[0]?.blob ?? '{}') as {
        value?: { role?: string; content?: string };
      };
      return { input: s.input, role: entry.value?.role, content: entry.value?.content ?? '' };
    });
}

describe('AgentCore tools + memory — inside a PARALLEL fan-out', () => {
  async function fanOut() {
    const runtime = ordersRuntime();
    const memory = memoryService();
    const a = await branchTools(runtime, TOKEN.a);
    const b = await branchTools(runtime, TOKEN.b);
    const flow = Parallel.create()
      .branch('a', orderAgent('A-100', a.tools, 'memA', memory.store))
      .branch('b', orderAgent('B-200', b.tools, 'memB', memory.store))
      .mergeWithFn((results) => JSON.stringify(results))
      .build();
    flow.attach(narrative());
    const recorder = recordRun(flow);
    const events: AgentfootprintEvent[] = [];
    flow.on('*', (e) => events.push(e));
    const answer = JSON.parse(String(await flow.run({ message: 'look both orders up' }))) as Record<
      string,
      string
    >;
    await a.close();
    await b.close();
    const recording = recorder.toRecording();
    recorder.stop();
    return { runtime, memory, a, b, events, answer, recording };
  }

  it('ATTRIBUTION — calls, retries and memory writes each sit under their own branch', async () => {
    const { a, b, events, answer, recording } = await fanOut();
    expect(answer['a']).toContain('order A-100 is shipped');
    expect(answer['b']).toContain('order B-200 is shipped');

    // Tool calls: the record's own stage ids.
    for (const e of events.filter((x) => x.type.startsWith('agentfootprint.stream.tool_'))) {
      const id = (e.payload as { toolCallId?: string }).toolCallId;
      expect(e.meta.runtimeStageId.split('/')[0]).toBe(id === 'call-A-100' ? 'a' : 'b');
    }
    // Retries: one per branch, inside that branch's call.
    expect(a.retries.map((r) => r.toolCallId)).toEqual(['call-A-100']);
    expect(b.retries.map((r) => r.toolCallId)).toEqual(['call-B-200']);

    // Memory writes: each memory's write subflow ran under its own branch, and
    // only there.
    const writeStages = narrativeOf(recording)
      .map((line) => line.runtimeStageId ?? '')
      .filter((id) => /sf-memory-write-mem[AB]\/write-messages#\d+$/.test(id));
    expect(writeStages.some((id) => /^a\/.*sf-memory-write-memA\//.test(id))).toBe(true);
    expect(writeStages.some((id) => /^b\/.*sf-memory-write-memB\//.test(id))).toBe(true);
    expect(writeStages.every((id) => /^a\/.*memA\/|^b\/.*memB\//.test(id))).toBe(true);
  });

  it('ISOLATION — disjoint MCP sessions; every memory write carries its options and only its own answer', async () => {
    const { runtime, memory } = await fanOut();
    // MCP: one runtime session per branch, never shared.
    const sessionsOf = (token: string) =>
      new Set(
        runtime.attempts
          .filter((x) => x.authorization === `Bearer ${token}`)
          .map((x) => x.runtimeSessionId),
      );
    const [sa, sb] = [sessionsOf(TOKEN.a), sessionsOf(TOKEN.b)];
    expect([sa.size, sb.size]).toEqual([1, 1]);
    expect([...sa].some((id) => sb.has(id))).toBe(false);

    // Memory: every event asked AgentCore to skip extraction under the tenant's scope.
    const created = createdEvents(memory.sdk);
    expect(created.length).toBeGreaterThanOrEqual(4);
    for (const event of created) {
      expect(event.input['extractionMode']).toBe('SKIP');
      expect(event.input['extractionConfig']).toEqual({ namespaceVariables: SCOPE });
    }
    // ...and each answer written is one branch's, never a blend of both.
    const answers = created.filter((e) => e.role === 'assistant').map((e) => e.content);
    expect(answers.filter((c) => c.includes('A-100'))).toHaveLength(1);
    expect(answers.filter((c) => c.includes('B-200'))).toHaveLength(1);
    expect(answers.some((c) => c.includes('A-100') && c.includes('B-200'))).toBe(false);
  });

  it('SECRECY — no token, no SDK key, no session id in the record or the narrative', async () => {
    const { runtime, recording } = await fanOut();
    const written = JSON.stringify(recording);
    expect(runtime.attempts.some((x) => x.authorization === `Bearer ${TOKEN.a}`)).toBe(true);
    expect(written).not.toContain(TOKEN.a);
    expect(written).not.toContain(TOKEN.b);
    for (const attempt of runtime.attempts) {
      if (attempt.runtimeSessionId) expect(written).not.toContain(attempt.runtimeSessionId);
      if (attempt.mcpSessionId) expect(written).not.toContain(attempt.mcpSessionId);
    }
    // The narrative was there to search — and told both answers.
    const told = JSON.stringify(narrativeOf(recording));
    expect(told).toContain('order A-100 is shipped');
    expect(told).toContain('order B-200 is shipped');
  });
});

describe('AgentCore tools + memory — as a SUBFLOW (a Sequence step), over SigV4', () => {
  it('the call, its retry and the memory write sit at the step; no SDK key is written', async () => {
    const runtime = ordersRuntime();
    const memory = memoryService();
    const retries: ThrottleRetryInfo[] = [];
    const client = await mcpClient({
      name: 'orders',
      transport: agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        session: 'reuse',
        retry: { onRetry: (info) => retries.push(info) },
        client: new (runtime.sdk['BedrockAgentCoreClient'] as new (c: unknown) => never)({
          region: REGION,
          credentials: SDK_KEYS,
          maxAttempts: 1,
        }),
        _sdk: runtime.sdk,
      }),
    });
    const flow = Sequence.create()
      .step('lookup', orderAgent('S-7', await client.tools(), 'memS', memory.store))
      .build();
    flow.attach(narrative());
    const recorder = recordRun(flow);
    const events: AgentfootprintEvent[] = [];
    flow.on('*', (e) => events.push(e));
    const answer = await flow.run({ message: 'where is order S-7?' });
    await client.close();
    const recording = recorder.toRecording();
    recorder.stop();

    expect(String(answer)).toContain('order S-7 is shipped');
    expect(retries).toHaveLength(1);
    const start = events.find((e) => e.type === 'agentfootprint.stream.tool_start');
    expect(start?.meta.runtimeStageId).toMatch(/^step-lookup\/tool-calls#\d+$/);
    expect(
      narrativeOf(recording).some((line) =>
        /^step-lookup\/.*sf-memory-write-memS\/write-messages#\d+$/.test(line.runtimeStageId ?? ''),
      ),
    ).toBe(true);
    const created = createdEvents(memory.sdk);
    expect(created.every((e) => e.input['extractionMode'] === 'SKIP')).toBe(true);
    const written = JSON.stringify(recording);
    expect(written).not.toContain(SDK_KEYS.accessKeyId);
    expect(written).not.toContain(SDK_KEYS.secretAccessKey);
  });
});
