/**
 * A limit that cuts a turn short SAYS SO (8.14.0).
 *
 * Two limits can end a ReAct loop while the model is still asking for tools:
 * `maxIterations`, and — new in 8.14.0 — a `costBudget` set to halt. In both
 * cases the run hands back whatever content the last call produced, which for
 * a call that returned only tool calls is the empty string.
 *
 * Through 8.13.0 that was the whole story. `agent.run()` resolved to `""`,
 * `cost.limit_hit` never fired for iterations, nothing was committed, and the
 * only trace was a `route_decided` rationale nobody was subscribed to. An
 * empty string reaching a user is indistinguishable from a bug.
 *
 * It does NOT throw, and that is the argued part. 8.6.0 raises for an
 * outstanding credential consent because that is a FAULT — the run hands back
 * a plausible answer for work a tool never did. A limit the consumer set
 * firing is the limit working, and the answer is sometimes real (a model can
 * return content AND tool calls). So: an event, a committed record, and a
 * warning when the answer is empty.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Agent } from '../../src/index.js';
import { defineTool } from '../../src/core/tools.js';
import { mock } from '../../src/llm-providers.js';
import type { LLMProvider, LLMResponse } from '../../src/adapters/types.js';
import type { AgentState } from '../../src/core/agent/types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const looker = defineTool({
  name: 'look',
  description: 'look something up',
  inputSchema: { type: 'object', properties: {} },
  execute: () => 'RESULT',
} as never);

const call = (i: number) => ({ toolCalls: [{ id: `c${i}`, name: 'look', args: {} }] });

function stoppedEarlyOf(agent: Agent): AgentState['stoppedEarly'] {
  return (agent.getLastSnapshot()?.sharedState as Pick<AgentState, 'stoppedEarly'>).stoppedEarly;
}

describe('maxIterations with pending tool calls (8.14.0)', () => {
  it('emits cost.limit_hit{max_iterations} — the kind the payload already reserved', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hits: { kind: string; limit: number; actual: number; action: string }[] = [];
    const agent = Agent.create({
      provider: mock({ replies: [call(0), call(1), call(2), call(3)] as never }),
      model: 'm',
    })
      .tool(looker as never)
      .maxIterations(2)
      .build();
    agent.on('agentfootprint.cost.limit_hit', (e) => hits.push(e.payload));

    const answer = await agent.run({ message: 'hi' });

    expect(answer).toBe('');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe('max_iterations');
    expect(hits[0]!.limit).toBe(2);
    expect(hits[0]!.actual).toBe(2);
    expect(hits[0]!.action).toBe('abort');
  });

  it('commits the fact, so it is provable after the run and not just observable during it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = Agent.create({
      provider: mock({ replies: [call(0), call(1), call(2), call(3)] as never }),
      model: 'm',
    })
      .tool(looker as never)
      .maxIterations(2)
      .build();
    await agent.run({ message: 'hi' });

    const cut = stoppedEarlyOf(agent);
    expect(cut).toBeDefined();
    expect(cut!.reason).toBe('max-iterations');
    expect(cut!.iteration).toBe(2);
    expect(cut!.pendingToolCalls).toBe(1);
    expect(cut!.answerWasEmpty).toBe(true);

    // `agent.stoppedEarly()` is the short way to the same value, never a
    // second source of it.
    expect(agent.stoppedEarly()).toEqual(cut);
  });

  it('warns once — an empty answer reaching a user looks exactly like a bug', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = Agent.create({
      provider: mock({ replies: [call(0), call(1), call(2), call(3)] as never }),
      model: 'm',
    })
      .tool(looker as never)
      .maxIterations(2)
      .build();
    await agent.run({ message: 'hi' });

    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('stopped at'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('maxIterations was reached');
    expect(lines[0]).toContain('agent.stoppedEarly()');
  });

  it('does NOT throw — a limit you set firing is the limit working', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = Agent.create({
      provider: mock({ replies: [call(0), call(1), call(2), call(3)] as never }),
      model: 'm',
    })
      .tool(looker as never)
      .maxIterations(2)
      .build();
    await expect(agent.run({ message: 'hi' })).resolves.toBe('');
  });

  it('a model that returned CONTENT alongside its tool calls keeps that answer', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let n = 0;
    const chatty: LLMProvider = {
      name: 'chatty',
      complete: async (): Promise<LLMResponse> => {
        n++;
        return {
          content: 'here is what I have so far',
          toolCalls: [{ id: `c${n}`, name: 'look', args: {} }],
          usage: { input: 10, output: 10 },
          stopReason: 'end_turn',
        };
      },
    };
    const agent = Agent.create({ provider: chatty, model: 'm' })
      .tool(looker as never)
      .maxIterations(2)
      .build();

    const answer = await agent.run({ message: 'hi' });
    // The partial answer is real and is returned. It is still an early stop.
    expect(answer).toBe('here is what I have so far');
    expect(stoppedEarlyOf(agent)!.answerWasEmpty).toBe(false);
  });

  it('is ABSENT on a normal finish, however many iterations it took', async () => {
    const agent = Agent.create({
      provider: mock({ replies: [call(0), { content: 'FINAL' }] as never }),
      model: 'm',
    })
      .tool(looker as never)
      .maxIterations(2)
      .build();

    const answer = await agent.run({ message: 'hi' });
    expect(answer).toBe('FINAL');
    // Iteration 2 of 2 — the budget was fully spent, and the model was done.
    // That is not an early stop and must not be reported as one.
    expect(agent.stoppedEarly()).toBeUndefined();
  });
});

describe("costBudget { onExceed: 'halt' } (8.14.0)", () => {
  const pricingTable = { name: 'p', pricePerToken: () => 1 };

  it('a bare number still WARNS and still finishes — byte-identical to 8.13', async () => {
    const hits: { action: string }[] = [];
    const agent = Agent.create({
      provider: mock({ replies: [call(0), call(1), { content: 'FINAL' }] as never }),
      model: 'm',
      costBudget: 0.0000001,
      pricingTable,
    })
      .tool(looker as never)
      .maxIterations(8)
      .build();
    agent.on('agentfootprint.cost.limit_hit', (e) => hits.push(e.payload));

    expect(await agent.run({ message: 'hi' })).toBe('FINAL');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.action).toBe('warn');
    expect(agent.stoppedEarly()).toBeUndefined();
  });

  it("'halt' stops the loop at the next boundary and says why", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rationales: string[] = [];
    const agent = Agent.create({
      provider: mock({ replies: [call(0), call(1), call(2), { content: 'FINAL' }] as never }),
      model: 'm',
      costBudget: { usd: 0.0000001, onExceed: 'halt' },
      pricingTable,
    })
      .tool(looker as never)
      .maxIterations(8)
      .build();
    agent.on('agentfootprint.agent.route_decided', (e) =>
      rationales.push(e.payload.rationale ?? ''),
    );

    const answer = await agent.run({ message: 'hi' });

    // Never mid-call: the call that crossed the budget completed and was
    // billed. What halting decides is that there will not be another one.
    expect(answer).not.toBe('FINAL');
    expect(rationales.some((r) => r.includes('costBudget reached'))).toBe(true);

    const cut = agent.stoppedEarly();
    expect(cut).toBeDefined();
    expect(cut!.reason).toBe('cost-budget');
    expect(cut!.pendingToolCalls).toBeGreaterThan(0);
  });

  it("'halt' reports action: 'abort' on the event — ONCE, with the real budget", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hits: { action: string; kind: string; limit: number }[] = [];
    const agent = Agent.create({
      provider: mock({ replies: [call(0), call(1), call(2), { content: 'FINAL' }] as never }),
      model: 'm',
      costBudget: { usd: 0.0000001, onExceed: 'halt' },
      pricingTable,
    })
      .tool(looker as never)
      .maxIterations(8)
      .build();
    agent.on('agentfootprint.cost.limit_hit', (e) => hits.push(e.payload));
    await agent.run({ message: 'hi' });

    // EXACTLY one. `emitCostTick` already fires the one-shot crossing event at
    // the moment it happens, and it is the only place that knows the budget.
    // The route decider deliberately does NOT emit a second one for a cost
    // halt: two events for one crossing would double-count it, and the second
    // could only report the cumulative spend as `limit`, which it is not.
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe('max_cost');
    expect(hits[0]!.action).toBe('abort');
    expect(hits[0]!.limit).toBe(0.0000001);
  });

  it("'warn' spelled out behaves exactly like the bare number", async () => {
    const hits: { action: string }[] = [];
    const agent = Agent.create({
      provider: mock({ replies: [call(0), call(1), { content: 'FINAL' }] as never }),
      model: 'm',
      costBudget: { usd: 0.0000001, onExceed: 'warn' },
      pricingTable,
    })
      .tool(looker as never)
      .maxIterations(8)
      .build();
    agent.on('agentfootprint.cost.limit_hit', (e) => hits.push(e.payload));

    expect(await agent.run({ message: 'hi' })).toBe('FINAL');
    expect(hits[0]!.action).toBe('warn');
  });

  it('an agent that never crosses the budget is untouched', async () => {
    const hits: unknown[] = [];
    const agent = Agent.create({
      provider: mock({ replies: [call(0), { content: 'FINAL' }] as never }),
      model: 'm',
      costBudget: { usd: 1_000_000, onExceed: 'halt' },
      pricingTable,
    })
      .tool(looker as never)
      .maxIterations(8)
      .build();
    agent.on('agentfootprint.cost.limit_hit', (e) => hits.push(e.payload));

    expect(await agent.run({ message: 'hi' })).toBe('FINAL');
    expect(hits).toHaveLength(0);
    expect(agent.stoppedEarly()).toBeUndefined();
  });
});
