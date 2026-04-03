/**
 * buildSwarmLoop — 5-pattern tests.
 *
 * Tests the Swarm loop with specialist lazy subflow branches.
 * The decider reads parsedResponse.toolCalls[0].name to route to specialists.
 */
import { describe, it, expect } from 'vitest';
import { FlowChartExecutor } from 'footprintjs';
import { buildSwarmLoop } from '../../../src/lib/swarm';
import { mock, Agent } from '../../../src';

// ── Helpers ─────────────────────────────────────────────────

function makeSpecialist(id: string, response: string) {
  return Agent.create({
    provider: mock([{ content: response }]),
    name: id,
  }).system(`You are the ${id} specialist.`).build();
}

function buildAndRun(config: Parameters<typeof buildSwarmLoop>[0], message: string) {
  const { chart } = buildSwarmLoop(config, { message });
  const executor = new FlowChartExecutor(chart as any);
  return executor.run().then(() => {
    const snapshot = executor.getSnapshot();
    const state = snapshot?.sharedState ?? {};
    return { state, executor, narrative: executor.getNarrative() };
  });
}

// ── Unit ────────────────────────────────────────────────────

describe('buildSwarmLoop — unit', () => {
  it('builds a valid flowchart with spec', () => {
    const { chart, spec } = buildSwarmLoop(
      {
        provider: mock([{ content: 'hello' }]),
        systemPrompt: 'Route to specialists.',
        specialists: [{ id: 'coding', description: 'Code specialist', runner: makeSpecialist('coding', 'done') }],
      },
      { message: 'test' },
      { captureSpec: true },
    );
    expect(chart).toBeDefined();
    expect(chart.root).toBeDefined();
    expect(spec).toBeDefined();
  });

  it('finalizes when LLM responds without tool calls', async () => {
    const { state } = await buildAndRun(
      {
        provider: mock([{ content: 'I can answer directly: hello!' }]),
        specialists: [{ id: 'coding', description: 'Code', runner: makeSpecialist('coding', 'done') }],
      },
      'Say hello',
    );
    expect(state.result).toBe('I can answer directly: hello!');
  });

  it('routes to specialist when LLM calls specialist tool', async () => {
    const { state } = await buildAndRun(
      {
        provider: mock([
          // Turn 1: LLM calls the 'coding' specialist tool
          { content: 'Delegating to coding specialist.', toolCalls: [{ id: 'tc-1', name: 'coding', arguments: { message: 'Write a function' } }] },
          // Turn 2: LLM sees specialist result, generates final answer
          { content: 'The coding specialist wrote the function.' },
        ]),
        specialists: [
          { id: 'coding', description: 'Write code', runner: makeSpecialist('coding', 'function add(a, b) { return a + b; }') },
          { id: 'writing', description: 'Write content', runner: makeSpecialist('writing', 'A haiku') },
        ],
      },
      'Write a function',
    );
    expect(state.result).toBe('The coding specialist wrote the function.');
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('buildSwarmLoop — boundary', () => {
  it('respects maxIterations', async () => {
    // LLM always calls specialist — should stop at maxIterations
    const responses = Array.from({ length: 5 }, () => ({
      content: 'calling',
      toolCalls: [{ id: 'tc', name: 'coding', arguments: { message: 'more' } }],
    }));
    responses.push({ content: 'forced stop' } as any);

    // Specialist needs enough mock responses for multiple calls
    const specialistRunner = Agent.create({
      provider: mock(Array.from({ length: 5 }, () => ({ content: 'done' }))),
      name: 'coding',
    }).system('Code specialist').build();

    const { state } = await buildAndRun(
      {
        provider: mock(responses),
        specialists: [{ id: 'coding', description: 'Code', runner: specialistRunner }],
        maxIterations: 2,
      },
      'test',
    );
    const loopCount = (state.loopCount as number) ?? 0;
    expect(loopCount).toBeLessThanOrEqual(3);
  });

  it('unknown tool call goes to final (no matching specialist)', async () => {
    const { state } = await buildAndRun(
      {
        provider: mock([
          { content: 'calling unknown', toolCalls: [{ id: 'tc', name: 'unknown_tool', arguments: {} }] },
        ]),
        specialists: [{ id: 'coding', description: 'Code', runner: makeSpecialist('coding', 'done') }],
      },
      'test',
    );
    // Unknown tool → 'final' branch → result is the LLM's content
    expect(state.result).toBe('calling unknown');
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('buildSwarmLoop — scenario', () => {
  it('specialist subflow result appears as tool message in conversation', async () => {
    const { state } = await buildAndRun(
      {
        provider: mock([
          { content: 'Asking coding specialist.', toolCalls: [{ id: 'tc-1', name: 'coding', arguments: { message: 'Write hello world' } }] },
          { content: 'The specialist wrote: console.log("hello")' },
        ]),
        specialists: [
          { id: 'coding', description: 'Write code', runner: makeSpecialist('coding', 'console.log("hello world")') },
        ],
      },
      'Write hello world',
    );

    // Messages should include: system, user, assistant (tool call), tool (specialist result), assistant (final)
    const messages = state.messages as any[];
    const toolMessages = messages.filter((m: any) => m.role === 'tool');
    expect(toolMessages.length).toBeGreaterThanOrEqual(1);
    // Specialist result is in the tool message
    expect(toolMessages[0].content).toContain('console.log');
  });

  it('spec shows RouteSpecialist decider with specialist branches', () => {
    const { spec } = buildSwarmLoop(
      {
        provider: mock([{ content: '' }]),
        specialists: [
          { id: 'coding', description: 'Code', runner: makeSpecialist('coding', '') },
          { id: 'writing', description: 'Write', runner: makeSpecialist('writing', '') },
        ],
      },
      { message: '' },
      { captureSpec: true },
    );

    // Spec should contain RouteSpecialist with branches
    const specStr = JSON.stringify(spec);
    expect(specStr).toContain('RouteSpecialist');
    expect(specStr).toContain('coding');
    expect(specStr).toContain('writing');
    expect(specStr).toContain('Finalize');
  });
});

// ── Property ────────────────────────────────────────────────

describe('buildSwarmLoop — property', () => {
  it('specialist subflow is lazy — only built when selected', async () => {
    let codingBuilt = false;
    let writingBuilt = false;

    const codingRunner = {
      run: async (msg: string) => ({ content: `coded: ${msg}` }),
      toFlowChart: () => {
        codingBuilt = true;
        return makeSpecialist('coding', '').toFlowChart();
      },
    };
    const writingRunner = {
      run: async (msg: string) => ({ content: `wrote: ${msg}` }),
      toFlowChart: () => {
        writingBuilt = true;
        return makeSpecialist('writing', '').toFlowChart();
      },
    };

    await buildAndRun(
      {
        provider: mock([
          { content: 'coding', toolCalls: [{ id: 'tc', name: 'coding', arguments: { message: 'test' } }] },
          { content: 'done' },
        ]),
        specialists: [
          { id: 'coding', description: 'Code', runner: codingRunner as any },
          { id: 'writing', description: 'Write', runner: writingRunner as any },
        ],
      },
      'test',
    );

    // Only coding was built (selected by LLM), writing was NOT built (lazy)
    expect(codingBuilt).toBe(true);
    expect(writingBuilt).toBe(false);
  });
});

// ── Security ────────────────────────────────────────────────

describe('buildSwarmLoop — security', () => {
  it('maxIterations prevents infinite specialist loops', async () => {
    const responses = Array.from({ length: 20 }, () => ({
      content: 'loop',
      toolCalls: [{ id: 'tc', name: 'coding', arguments: { message: 'again' } }],
    }));

    const specialistRunner = Agent.create({
      provider: mock(Array.from({ length: 20 }, () => ({ content: 'done' }))),
      name: 'coding',
    }).system('Code specialist').build();

    const { state } = await buildAndRun(
      {
        provider: mock(responses),
        specialists: [{ id: 'coding', description: 'Code', runner: specialistRunner }],
        maxIterations: 3,
      },
      'test',
    );

    const loopCount = (state.loopCount as number) ?? 0;
    expect(loopCount).toBeLessThanOrEqual(3);
  });
});
