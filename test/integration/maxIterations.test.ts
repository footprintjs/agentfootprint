/**
 * Integration test: maxIterations exhaustion + repeated-failure escalation.
 *
 * Reproduces the Live Chat scenario where the LLM retries the same failing
 * tool call until `maxIterations` is hit. Verifies:
 *   Fix A — `result.maxIterationsReached === true` is surfaced, Finalize sets
 *           an explanatory `content` instead of an empty string, and the
 *           `turn_end` stream event carries `reason: 'maxIterations'`.
 *   Fix B — After 3 identical failures, the tool result content gains an
 *           `escalation` field urging the LLM to change tack.
 */

import { describe, it, expect } from 'vitest';
import { Agent, defineTool, mock, type AgentStreamEvent } from '../../src/test-barrel';

describe('maxIterations exhaustion — Fix A', () => {
  it('surfaces maxIterationsReached flag and explanatory content', async () => {
    // Tool that always fails validation — LLM keeps retrying with bad args.
    const failingTool = defineTool({
      id: 'broken',
      description: 'broken',
      inputSchema: {
        type: 'object',
        properties: { expr: { type: 'string' } },
        required: ['expr'],
      },
      handler: async () => ({ content: 'unreachable' }),
    });

    const badCall = { id: 'c', name: 'broken', arguments: {} };
    const provider = mock(
      Array(5).fill({
        content: 'still trying',
        toolCalls: [badCall],
      }),
    );

    const agent = Agent.create({ provider }).tools([failingTool]).maxIterations(3).build();

    const result = await agent.run('go');

    expect(result.maxIterationsReached).toBe(true);
    // Content should NOT be empty — either the LLM's last reasoning or our synthesized fallback.
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('emits turn_end stream event with reason: "maxIterations"', async () => {
    const failingTool = defineTool({
      id: 'broken',
      description: 'broken',
      inputSchema: {
        type: 'object',
        properties: { expr: { type: 'string' } },
        required: ['expr'],
      },
      handler: async () => ({ content: 'unreachable' }),
    });

    const provider = mock(
      Array(5).fill({
        content: 'still trying',
        toolCalls: [{ id: 'c', name: 'broken', arguments: {} }],
      }),
    );
    const agent = Agent.create({ provider }).tools([failingTool]).maxIterations(2).build();

    const events: AgentStreamEvent[] = [];
    await agent.run('go', { onEvent: (e) => events.push(e) });

    const turnEnd = events.find((e) => e.type === 'turn_end');
    expect(turnEnd).toBeDefined();
    expect(turnEnd && 'reason' in turnEnd && turnEnd.reason).toBe('maxIterations');
  });

  it('does NOT set maxIterationsReached on normal completion', async () => {
    const agent = Agent.create({ provider: mock([{ content: 'hello' }]) }).build();
    const result = await agent.run('hi');
    expect(result.maxIterationsReached).toBeFalsy();
    expect(result.content).toBe('hello');
  });
});

describe('maxIterations — composition gap (Fix A)', () => {
  it('safeDecider writes maxIterationsReached to shared scope — visible to any default branch', async () => {
    // Regression guard for the review: previously the flag was set inside the
    // Agent-specific `createFinalizeStage`, which meant Swarm and any custom
    // routing that used a non-Finalize `defaultBranch` never surfaced the
    // "agent gave up" signal. The fix moves the write into `safeDecider`, so
    // it lands on the shared scope BEFORE any branch runs — every routing
    // topology can read it.
    //
    // We verify the scope write directly via the execution snapshot (the
    // single source of truth for any downstream composition).
    const failingTool = defineTool({
      id: 'broken',
      description: 'broken',
      inputSchema: {
        type: 'object',
        properties: { expr: { type: 'string' } },
        required: ['expr'],
      },
      handler: async () => ({ content: 'unreachable' }),
    });
    const provider = mock(
      Array(6).fill({
        content: 'still trying',
        toolCalls: [{ id: 'c', name: 'broken', arguments: {} }],
      }),
    );
    const agent = Agent.create({ provider }).tools([failingTool]).maxIterations(3).build();

    await agent.run('go');

    const snap = agent.getSnapshot();
    const state = (snap?.sharedState ?? {}) as Record<string, unknown>;
    // Scope key set by safeDecider, independent of which branch finalizes.
    expect(state.maxIterationsReached).toBe(true);
    // loopCount equals the cap at force-route time.
    expect(state.loopCount).toBe(3);
  });
});

describe('repeated-failure escalation — Fix B', () => {
  it('injects escalation field after 3 identical failing calls', async () => {
    const failingTool = defineTool({
      id: 'broken',
      description: 'broken',
      inputSchema: {
        type: 'object',
        properties: { expr: { type: 'string' } },
        required: ['expr'],
      },
      handler: async () => ({ content: 'unreachable' }),
    });

    const badCall = { id: 'c', name: 'broken', arguments: {} };
    // The agent calls the LLM `maxIterations + 1` times: every non-final turn
    // advances loopCount, and the (maxIter+1)th call is what safeDecider
    // force-finalizes. Give the mock enough responses for the whole arc.
    const provider = mock(
      Array(6).fill({
        content: 'still trying',
        toolCalls: [badCall],
      }),
    );
    const agent = Agent.create({ provider }).tools([failingTool]).maxIterations(5).build();

    const result = await agent.run('go');

    // Collect tool result messages in order
    const toolResults = result.messages
      .filter((m) => m.role === 'tool')
      .map((m) => (typeof m.content === 'string' ? m.content : ''));

    // 1st and 2nd failures: plain error, no escalation yet.
    expect(toolResults[0]).not.toContain('escalation');
    expect(toolResults[1]).not.toContain('escalation');
    // 3rd failure onward: escalation field present.
    expect(toolResults[2]).toContain('escalation');
    expect(toolResults[2]).toContain('repeatedFailures');
    expect(toolResults[2]).toContain('3');
  });

  it('does NOT escalate when different arguments are used', async () => {
    const failingTool = defineTool({
      id: 'broken',
      description: 'broken',
      inputSchema: {
        type: 'object',
        properties: { expr: { type: 'string' } },
        required: ['expr'],
      },
      handler: async () => ({ content: 'unreachable' }),
    });

    // Each call uses DIFFERENT args — no repetition, no escalation.
    const provider = mock([
      { content: 'try 1', toolCalls: [{ id: 'c1', name: 'broken', arguments: { wrong1: 1 } }] },
      { content: 'try 2', toolCalls: [{ id: 'c2', name: 'broken', arguments: { wrong2: 2 } }] },
      { content: 'try 3', toolCalls: [{ id: 'c3', name: 'broken', arguments: { wrong3: 3 } }] },
      { content: 'done' },
    ]);
    const agent = Agent.create({ provider }).tools([failingTool]).maxIterations(5).build();

    const result = await agent.run('go');

    const toolResults = result.messages
      .filter((m) => m.role === 'tool')
      .map((m) => (typeof m.content === 'string' ? m.content : ''));
    for (const r of toolResults) {
      expect(r).not.toContain('escalation');
    }
  });

  it('periodic re-emit: escalation fires at every Nth multiple of the threshold', async () => {
    const failingTool = defineTool({
      id: 'broken',
      description: 'broken',
      inputSchema: {
        type: 'object',
        properties: { expr: { type: 'string' } },
        required: ['expr'],
      },
      handler: async () => ({ content: 'unreachable' }),
    });

    const badCall = { id: 'c', name: 'broken', arguments: {} };
    // 6 identical failures — threshold is 3, so escalation fires at
    // failures #3 and #6 (both multiples of 3) — two escalations total.
    // Failures #1, #2, #4, #5 are bare.
    const provider = mock(
      Array(7).fill({
        content: 'still trying',
        toolCalls: [badCall],
      }),
    );
    const agent = Agent.create({ provider }).tools([failingTool]).maxIterations(6).build();

    const result = await agent.run('go');
    const toolResults = result.messages
      .filter((m) => m.role === 'tool')
      .map((m) => (typeof m.content === 'string' ? m.content : ''));

    // Exactly the multiples of threshold carry escalation; others are bare.
    expect(toolResults[0]).not.toContain('escalation'); // fail #1
    expect(toolResults[1]).not.toContain('escalation'); // fail #2
    expect(toolResults[2]).toContain('escalation'); //    fail #3 ← fires
    expect(toolResults[2]).toContain('"repeatedFailures":3');
    expect(toolResults[3]).not.toContain('escalation'); // fail #4
    expect(toolResults[4]).not.toContain('escalation'); // fail #5
    expect(toolResults[5]).toContain('escalation'); //    fail #6 ← fires again
    expect(toolResults[5]).toContain('"repeatedFailures":6');
  });

  it('builder .maxIdenticalFailures(0) disables escalation entirely', async () => {
    const failingTool = defineTool({
      id: 'broken',
      description: 'broken',
      inputSchema: {
        type: 'object',
        properties: { expr: { type: 'string' } },
        required: ['expr'],
      },
      handler: async () => ({ content: 'unreachable' }),
    });

    const badCall = { id: 'c', name: 'broken', arguments: {} };
    const provider = mock(
      Array(6).fill({
        content: 'still trying',
        toolCalls: [badCall],
      }),
    );
    const agent = Agent.create({ provider })
      .tools([failingTool])
      .maxIterations(5)
      .maxIdenticalFailures(0)
      .build();

    const result = await agent.run('go');
    const toolResults = result.messages.filter((m) => m.role === 'tool');
    for (const r of toolResults) {
      expect(typeof r.content === 'string' && r.content).not.toContain('escalation');
    }
  });

  it('builder .maxIdenticalFailures(2) fires on 2nd identical failure', async () => {
    const failingTool = defineTool({
      id: 'broken',
      description: 'broken',
      inputSchema: {
        type: 'object',
        properties: { expr: { type: 'string' } },
        required: ['expr'],
      },
      handler: async () => ({ content: 'unreachable' }),
    });

    const badCall = { id: 'c', name: 'broken', arguments: {} };
    const provider = mock(
      Array(5).fill({
        content: 'still trying',
        toolCalls: [badCall],
      }),
    );
    const agent = Agent.create({ provider })
      .tools([failingTool])
      .maxIterations(4)
      .maxIdenticalFailures(2)
      .build();

    const result = await agent.run('go');
    const toolResults = result.messages
      .filter((m) => m.role === 'tool')
      .map((m) => (typeof m.content === 'string' ? m.content : ''));
    expect(toolResults[0]).not.toContain('escalation');
    expect(toolResults[1]).toContain('escalation');
    expect(toolResults[1]).toContain('2');
  });

  it('validation errors include expectedSchema + receivedArguments for self-correction', async () => {
    const failingTool = defineTool({
      id: 'typed',
      description: 'typed tool',
      inputSchema: {
        type: 'object',
        properties: { expr: { type: 'string' } },
        required: ['expr'],
      },
      handler: async () => ({ content: 'unreachable' }),
    });

    const agent = Agent.create({
      provider: mock([
        { content: 'c', toolCalls: [{ id: 'c1', name: 'typed', arguments: { wrong: 1 } }] },
        { content: 'done' },
      ]),
    })
      .tools([failingTool])
      .maxIterations(5)
      .build();

    const result = await agent.run('go');
    const toolResult = result.messages.find((m) => m.role === 'tool');
    expect(toolResult).toBeDefined();
    const parsed = JSON.parse(typeof toolResult!.content === 'string' ? toolResult!.content : '{}');
    expect(parsed.expectedSchema).toBeDefined();
    expect(parsed.expectedSchema.required).toEqual(['expr']);
    expect(parsed.receivedArguments).toEqual({ wrong: 1 });
  });

  it('parallel mode: identical failures across turns still trigger escalation', async () => {
    // Even with .parallelTools(true), repeated failures ACROSS turns should
    // still be detected via the (name, args) key when the LLM reissues the
    // same failing call on a later turn.
    const failingTool = defineTool({
      id: 'broken',
      description: 'broken',
      inputSchema: {
        type: 'object',
        properties: { expr: { type: 'string' } },
        required: ['expr'],
      },
      handler: async () => ({ content: 'unreachable' }),
    });
    const badCall = { id: 'c', name: 'broken', arguments: {} };
    const provider = mock(
      Array(7).fill({
        content: 'try',
        toolCalls: [badCall],
      }),
    );
    const agent = Agent.create({ provider })
      .tools([failingTool])
      .parallelTools(true)
      .maxIterations(5)
      .build();

    const result = await agent.run('go');
    const toolResults = result.messages
      .filter((m) => m.role === 'tool')
      .map((m) => (typeof m.content === 'string' ? m.content : ''));
    // By the 3rd identical call, escalation fires. maxIterations=5 allows
    // up to 5 failures, so we expect one escalation at #3 (not yet #6).
    const escalated = toolResults.filter((r) => r.includes('escalation'));
    expect(escalated.length).toBe(1);
  });

  it('does NOT escalate successful calls', async () => {
    const goodTool = defineTool({
      id: 'echo',
      description: 'echo',
      inputSchema: { type: 'object' },
      handler: async () => ({ content: 'ok' }),
    });

    // Three successful identical calls — no escalation (errors only).
    const provider = mock([
      { content: 'a', toolCalls: [{ id: 'c1', name: 'echo', arguments: {} }] },
      { content: 'b', toolCalls: [{ id: 'c2', name: 'echo', arguments: {} }] },
      { content: 'c', toolCalls: [{ id: 'c3', name: 'echo', arguments: {} }] },
      { content: 'done' },
    ]);
    const agent = Agent.create({ provider }).tools([goodTool]).maxIterations(5).build();

    const result = await agent.run('go');
    const toolResults = result.messages.filter((m) => m.role === 'tool');
    for (const m of toolResults) {
      expect(typeof m.content === 'string' && m.content).not.toContain('escalation');
    }
  });
});
