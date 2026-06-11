/**
 * The two conversational doors over the toolpack — `traceDebugAgent`
 * (dedicated) and `.selfExplain()` (in-conversation, inline + delegate).
 * Convention-3 tiers: unit (lazy toolpack) · functional (skill gating,
 * catalog shapes) · integration (real multi-turn agent answering from its
 * own previous run) · security (B13: never the in-flight run; honest
 * no-run answer; rotation isolates turns) · performance (memo).
 */
import { describe, expect, it } from 'vitest';

import { Agent, defineTool, mock } from '../../../src/index';
import {
  callTraceTool,
  lazyTraceToolpack,
  NO_COMPLETED_RUN_MESSAGE,
  traceDebugAgent,
  traceToolpack,
  type TraceToolpackArtifacts,
} from '../../../src/observe';

/* ── fixtures ─────────────────────────────────────────────────────────── */

const lookupOrder = defineTool<{ orderId: string }, string>({
  name: 'lookup_order',
  description: 'Look up an order by id',
  inputSchema: {
    type: 'object',
    properties: { orderId: { type: 'string' } },
    required: ['orderId'],
  },
  execute: ({ orderId }) => `Order ${orderId}: purchased 47 days ago, price $480.`,
});

interface ProviderReq {
  systemPrompt?: string;
  messages: { role: string; content?: unknown }[];
  tools?: { name: string }[];
}

const toolNames = (req: ProviderReq): string[] => (req.tools ?? []).map((t) => t.name);
const lastToolText = (req: ProviderReq): string => {
  const msg = [...req.messages].reverse().find((m) => m.role === 'tool');
  return msg ? String(msg.content) : '';
};

/**
 * A scripted main agent: turn 1 calls lookup_order then answers; later
 * turns answer why-questions by activating self-explain → run_overview →
 * echoing the overview's first lines (so tests can assert the evidence).
 */
function buildScriptedAgent(
  selfExplainOpts?: Parameters<ReturnType<typeof Agent.create>['selfExplain']>[0],
) {
  const catalogs: string[][] = []; // tool names the model saw, per LLM call
  const provider = mock({
    chunkDelayMs: 0,
    respond: (req: ProviderReq) => {
      catalogs.push(toolNames(req));
      const names = toolNames(req);
      const lastTool = lastToolText(req);
      // trace tools unlocked → walk the trace, then answer with the evidence
      if (names.includes('run_overview')) {
        if (lastTool.includes('TRACE RUN OVERVIEW') || lastTool === NO_COMPLETED_RUN_MESSAGE) {
          return `EXPLained: ${lastTool.slice(0, 1500)}`;
        }
        return { toolCalls: [{ id: 'o1', name: 'run_overview', args: {} }] };
      }
      // delegate door → one explain_run call, then echo its answer
      if (names.includes('explain_run')) {
        if (!lastTool || lastTool.includes('activated for the next iteration')) {
          return { toolCalls: [{ id: 'e1', name: 'explain_run', args: { question: 'why?' } }] };
        }
        return `EXPLained: ${lastTool.slice(0, 400)}`;
      }
      // a why-question with the skill available → activate it
      const userText = String(req.messages.find((m) => m.role === 'user')?.content ?? '');
      if (/why/i.test(userText) && names.includes('read_skill')) {
        if (lastTool.includes('Skill') || lastTool.includes('skill')) {
          // activation confirmed; next iteration carries the tools
          return { toolCalls: [{ id: 'noop', name: 'read_skill', args: { id: 'self-explain' } }] };
        }
        return { toolCalls: [{ id: 's1', name: 'read_skill', args: { id: 'self-explain' } }] };
      }
      // normal work: look the order up once (refund asks only), then answer
      if (/refund/i.test(userText) && names.includes('lookup_order') && !lastTool) {
        return { toolCalls: [{ id: 't1', name: 'lookup_order', args: { orderId: 'A-1001' } }] };
      }
      return 'Refund APPROVED for order A-1001.';
    },
  });
  let builder = Agent.create({ provider, model: 'mock-1', maxIterations: 6 }).system(
    'You are a refunds assistant.',
  );
  builder = builder.tool(lookupOrder).selfExplain(selfExplainOpts ?? {});
  return { agent: builder.build(), catalogs };
}

const contentOf = (out: unknown): string =>
  typeof out === 'object' && out !== null && 'content' in out
    ? String((out as { content: unknown }).content)
    : String(out);

/* ── unit — the lazy toolpack ─────────────────────────────────────────── */

describe('lazyTraceToolpack — late-bound artifacts', () => {
  it('serves the honest no-run answer from every tool before a run exists', async () => {
    const tools = lazyTraceToolpack(() => undefined);
    expect(tools.map((t) => t.schema.name)).toEqual([
      'run_overview',
      'trace_node',
      'trace_slice',
      'who_wrote',
      'get_value',
    ]);
    for (const tool of tools) {
      // minimal valid args per tool so validation passes and execute runs
      const args =
        tool.schema.name === 'run_overview'
          ? {}
          : tool.schema.name === 'who_wrote'
          ? { key: 'x' }
          : tool.schema.name === 'get_value'
          ? { runtimeStageId: 'a#0', key: 'x' }
          : tool.schema.name === 'trace_slice'
          ? { runtimeStageId: 'a#0' }
          : { runtimeStageId: 'a#0' };
      expect(await callTraceTool([tool], tool.schema.name, args)).toBe(NO_COMPLETED_RUN_MESSAGE);
    }
  });

  it('template schemas bake no step-id enums (ids are unknowable pre-run)', () => {
    const tools = lazyTraceToolpack(() => undefined);
    const node = tools.find((t) => t.schema.name === 'trace_node')!;
    const props = (node.schema.inputSchema as { properties: Record<string, { enum?: unknown }> })
      .properties;
    expect(props.runtimeStageId.enum).toBeUndefined();
  });

  it('rebinds when the resolved snapshot changes — and memoizes while it does not', async () => {
    const { agent } = buildScriptedAgent();
    await agent.run({ message: 'Refund order A-1001?' });
    const first: TraceToolpackArtifacts = { snapshot: agent.getLastSnapshot()! };
    let current = first;
    const tools = lazyTraceToolpack(() => current);
    const overviewA = await callTraceTool(tools, 'run_overview', {});
    expect(overviewA).toContain('TRACE RUN OVERVIEW');
    expect(overviewA).toContain('tool-calls ×1'); // turn 1 executed one tool round

    await agent.run({ message: 'Thanks!' }); // turn 2: direct answer, no tool round
    current = { snapshot: agent.getLastSnapshot()! };
    const overviewB = await callTraceTool(tools, 'run_overview', {});
    expect(overviewB).toContain('TRACE RUN OVERVIEW');
    expect(overviewB).not.toContain('tool-calls ×'); // re-bound: the new run has no tool stage
  });
});

/* ── functional + integration — the in-conversation door ─────────────── */

describe('.selfExplain() — inline mode', () => {
  it('answers a why-question from its OWN previous turn, with the catalog gated until activation', async () => {
    const { agent, catalogs } = buildScriptedAgent();

    const turn1 = contentOf(await agent.run({ message: 'Refund order A-1001?' }));
    expect(turn1).toContain('APPROVED');

    const turn2Start = catalogs.length; // scope the capture to turn 2
    const turn2 = contentOf(await agent.run({ message: 'Why did you approve it?' }));
    expect(turn2).toContain('TRACE RUN OVERVIEW'); // answered from the trace
    expect(turn2).toContain('execution steps'); // overview substance, not echo

    // catalog gating: turn 2's FIRST call carries read_skill but NOT the
    // trace tools; only post-activation calls carry run_overview.
    const turn2Calls = catalogs.slice(turn2Start);
    expect(turn2Calls.length).toBeGreaterThan(1);
    expect(turn2Calls[0]).toContain('read_skill');
    expect(turn2Calls[0]).not.toContain('run_overview');
    const withTrace = turn2Calls.find((names) => names.includes('run_overview'));
    expect(withTrace).toBeDefined();
    // the trace tools arrive alongside the production tool, not instead of it
    expect(withTrace).toContain('lookup_order');
  });

  it('B13: the explained run is the PREVIOUS completed turn, never the in-flight one', async () => {
    const { agent } = buildScriptedAgent();
    await agent.run({ message: 'Refund order A-1001?' }); // turn 1: HAS a tool call
    const why = contentOf(await agent.run({ message: 'Why?' }));
    // the overview describes turn 1 — ONE tool round, TWO llm calls. The
    // in-flight turn 2 would show read_skill/run_overview rounds instead.
    expect(why).toContain('TRACE RUN OVERVIEW');
    expect(why).toContain('tool-calls ×1');
    expect(why).toContain('call-llm ×2');
  });

  it('rotation: turn N+1 explains turn N — evidence advances with the conversation', async () => {
    const { agent } = buildScriptedAgent();
    await agent.run({ message: 'Refund order A-1001?' }); // turn 1: tool call
    const whyTurn1 = contentOf(await agent.run({ message: 'Why did you approve?' }));
    expect(whyTurn1).toContain('tool-calls ×1'); // turn 1's shape: one tool round
    expect(whyTurn1).toContain('call-llm ×2');

    const whyTurn2 = contentOf(await agent.run({ message: 'And why did you say that?' }));
    // turn 3 explains TURN 2 (the previous why-turn): read_skill + run_overview
    // rounds → a different shape than turn 1. Evidence advanced with the turns.
    expect(whyTurn2).toContain('TRACE RUN OVERVIEW');
    expect(whyTurn2).toContain('call-llm ×3');
  });

  it('first-turn why-question gets the honest no-run answer', async () => {
    const { agent } = buildScriptedAgent();
    const answer = contentOf(await agent.run({ message: 'Why would you approve refunds?' }));
    expect(answer).toContain('No completed run is available yet');
  });

  it('consumer instruction is APPENDED to the recommended body, never replacing it', async () => {
    const seen: string[] = [];
    const provider = mock({
      chunkDelayMs: 0,
      respond: (req: ProviderReq) => {
        seen.push(req.systemPrompt ?? '');
        const names = toolNames(req);
        if (
          /why/i.test(String(req.messages.find((m) => m.role === 'user')?.content ?? '')) &&
          names.includes('read_skill') &&
          !lastToolText(req)
        ) {
          return { toolCalls: [{ id: 's1', name: 'read_skill', args: { id: 'self-explain' } }] };
        }
        return 'done';
      },
    });
    const agent = Agent.create({ provider, model: 'mock-1', maxIterations: 4 })
      .system('Base.')
      .selfExplain({ instruction: 'CITE-ORDER-IDS' })
      .build();
    await agent.run({ message: 'hello' });
    await agent.run({ message: 'why?' });
    const activated = seen.find((sp) => sp.includes('run_overview first'));
    expect(activated).toBeDefined(); // our methodology landed
    expect(activated).toContain('CITE-ORDER-IDS'); // theirs appended
  });

  it('double .selfExplain() throws at build configuration time', () => {
    const builder = Agent.create({ provider: mock({ reply: 'x' }), model: 'm' }).selfExplain();
    expect(() => builder.selfExplain()).toThrow(/already enabled/);
  });

  it('a FAILED run still captures — "why did you fail?" answers from its trace', async () => {
    let failNext = false;
    const catalogs: string[][] = [];
    const provider = mock({
      chunkDelayMs: 0,
      respond: (req: ProviderReq) => {
        catalogs.push(toolNames(req));
        if (failNext) {
          failNext = false;
          throw new Error('provider exploded mid-turn');
        }
        const t = lastToolText(req);
        if (toolNames(req).includes('run_overview')) {
          if (t.includes('TRACE RUN OVERVIEW')) return `EXPLained: ${t.slice(0, 1500)}`;
          return { toolCalls: [{ id: 'o1', name: 'run_overview', args: {} }] };
        }
        if (/why/i.test(String(req.messages.find((m) => m.role === 'user')?.content ?? ''))) {
          return { toolCalls: [{ id: 's1', name: 'read_skill', args: { id: 'self-explain' } }] };
        }
        return 'fine';
      },
    });
    const agent = Agent.create({ provider, model: 'mock-1', maxIterations: 6 })
      .system('s')
      .selfExplain()
      .build();

    await agent.run({ message: 'hello' }); // turn 1 completes
    failNext = true;
    await expect(agent.run({ message: 'do the thing' })).rejects.toThrow(/exploded/); // turn 2 FAILS
    const why = contentOf(await agent.run({ message: 'Why did you fail?' }));
    // the captured evidence is the FAILED turn 2 (its trace exists), not turn 1
    expect(why).toContain('TRACE RUN OVERVIEW');
  });

  it('reserved trace-tool names fail loud at build (the slot dedup would silently shadow them)', () => {
    const shadow = defineTool<{ x: string }, string>({
      name: 'run_overview',
      description: 'consumer tool with a colliding name',
      inputSchema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
      execute: ({ x }) => x,
    });
    const builder = Agent.create({ provider: mock({ reply: 'x' }), model: 'm' })
      .tool(shadow)
      .selfExplain();
    expect(() => builder.build()).toThrow(/reserved by \.selfExplain/);
    // delegate mode reserves only explain_run — run_overview is then fine
    const okBuilder = Agent.create({ provider: mock({ reply: 'x' }), model: 'm' })
      .tool(shadow)
      .selfExplain({ delegate: { provider: mock({ reply: 'y' }), model: 'd' } });
    expect(() => okBuilder.build()).not.toThrow();
  });

  it("reactMode 'classic' fails loud — frozen slots could never surface the trace tools", () => {
    const builder = Agent.create({
      provider: mock({ reply: 'x' }),
      model: 'm',
      reactMode: 'classic',
    });
    expect(() => builder.selfExplain()).toThrow(/per-iteration slot recomposition/);
  });
});

describe('.selfExplain() — delegate mode (the cheap-model switch)', () => {
  it('unlocks ONE explain_run tool and answers via a nested debugger on the delegate provider', async () => {
    const innerCatalogs: string[][] = [];
    const delegateProvider = mock({
      chunkDelayMs: 0,
      respond: (req: ProviderReq) => {
        innerCatalogs.push(toolNames(req));
        const lastTool = lastToolText(req);
        if (lastTool.includes('TRACE RUN OVERVIEW')) {
          return `DELEGATE-VERDICT: ${lastTool.slice(0, 120)}`;
        }
        return { toolCalls: [{ id: 'd1', name: 'run_overview', args: {} }] };
      },
    });
    const { agent, catalogs } = buildScriptedAgent({
      delegate: { provider: delegateProvider, model: 'mock-cheap' },
    });

    await agent.run({ message: 'Refund order A-1001?' });
    const why = contentOf(await agent.run({ message: 'Why did you approve?' }));

    expect(why).toContain('DELEGATE-VERDICT'); // the nested agent answered
    // outer catalog gets explain_run (one tool), never the raw trace tools
    const withExplain = catalogs.find((names) => names.includes('explain_run'));
    expect(withExplain).toBeDefined();
    expect(withExplain).not.toContain('run_overview');
    // inner catalog is the full toolpack
    expect(innerCatalogs[0]).toContain('run_overview');
    expect(innerCatalogs[0]).toContain('trace_slice');
  });
});

/* ── the dedicated door ───────────────────────────────────────────────── */

describe('traceDebugAgent — the dedicated debugger', () => {
  async function completedRunArtifacts(): Promise<TraceToolpackArtifacts> {
    const { agent } = buildScriptedAgent();
    await agent.run({ message: 'Refund order A-1001?' });
    return { snapshot: agent.getLastSnapshot()! };
  }

  it('walks a completed run and answers with evidence; the catalog IS the toolpack', async () => {
    const artifacts = await completedRunArtifacts();
    const catalogs: string[][] = [];
    const provider = mock({
      chunkDelayMs: 0,
      respond: (req: ProviderReq) => {
        catalogs.push(toolNames(req));
        const lastTool = lastToolText(req);
        if (lastTool.includes('TRACE RUN OVERVIEW')) return `VERDICT: ${lastTool.slice(0, 160)}`;
        return { toolCalls: [{ id: 'q1', name: 'run_overview', args: {} }] };
      },
    });
    const debuggerAgent = traceDebugAgent({ artifacts, provider, model: 'mock-cheap' });
    const out = contentOf(await debuggerAgent.run({ message: 'Why was it approved?' }));
    expect(out).toContain('VERDICT');
    expect(out).toContain('TRACE RUN OVERVIEW');
    expect(catalogs[0]).toEqual(
      expect.arrayContaining([
        'run_overview',
        'trace_node',
        'trace_slice',
        'who_wrote',
        'get_value',
      ]),
    );
  });

  it('system prompt = methodology + consumer instruction', async () => {
    const artifacts = await completedRunArtifacts();
    let sysSeen = '';
    const provider = mock({
      chunkDelayMs: 0,
      respond: (req: ProviderReq) => {
        sysSeen = req.systemPrompt ?? '';
        return 'ok';
      },
    });
    await traceDebugAgent({
      artifacts,
      provider,
      model: 'mock-1',
      instruction: 'DOMAIN-HINT-42',
    }).run({ message: 'hi' });
    expect(sysSeen).toContain('run_overview first');
    expect(sysSeen).toContain('DOMAIN-HINT-42');
  });
});

/* ── boundary honesty ─────────────────────────────────────────────────── */

describe('tool-boundary honesty marker', () => {
  it("trace_node on the agent's tool-execution step names the consumer-system boundary", async () => {
    const { agent } = buildScriptedAgent();
    await agent.run({ message: 'Refund order A-1001?' });
    const snapshot = agent.getLastSnapshot()!;
    const log = (snapshot.commitLog ?? []) as { runtimeStageId: string }[];
    const toolStep = log.find((b) => {
      const stagePart = b.runtimeStageId.split('#')[0];
      return stagePart.split('/').pop() === 'tool-calls';
    });
    expect(toolStep).toBeDefined(); // turn 1 executed a tool
    const tools = traceToolpack({ snapshot });
    const node = await callTraceTool(tools, 'trace_node', {
      runtimeStageId: toolStep!.runtimeStageId,
    });
    expect(node).toContain('⚠ boundary: tool execution happens in consumer systems');
    // and a non-tool step does NOT carry the boundary line
    const other = log.find((b) => b.runtimeStageId.split('#')[0].split('/').pop() === 'call-llm');
    if (other) {
      const llmNode = await callTraceTool(tools, 'trace_node', {
        runtimeStageId: other.runtimeStageId,
      });
      expect(llmNode).not.toContain('⚠ boundary: tool execution');
    }
  });
});
