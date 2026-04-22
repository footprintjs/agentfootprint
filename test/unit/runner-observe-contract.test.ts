/**
 * Runner observer contract — every agentfootprint runner must expose the
 * same `.observe()` surface and emit the same AgentStreamEvent sequence
 * for a run. This is what Lens (and any other observer) relies on.
 *
 * Five pattern tests exercise the full consumer circle:
 *   1. Agent — ReAct loop emits turn_start/llm/tool/turn_end
 *   2. LLMCall — single-call concept emits turn_start/llm/turn_end
 *   3. Multi-subscriber — many observers on one runner each see events
 *   4. Unsubscribe + re-subscribe — stop() actually stops the flow
 *   5. Error isolation — a throwing observer never crashes a run
 */
import { describe, expect, it } from 'vitest';
import { Agent, LLMCall, defineTool, mock } from '../../src';
import type { AgentStreamEvent } from '../../src/streaming';

describe('Runner observer contract — the pattern Lens depends on', () => {
  it('1. Agent.observe() captures every event in a ReAct turn', async () => {
    const agent = Agent.create({
      provider: mock([
        {
          content: 'I will use the tool.',
          toolCalls: [{ id: 't1', name: 'echo', arguments: { msg: 'hi' } }],
        },
        { content: 'Done.' },
      ]),
      name: 'test-agent',
    })
      .tool(
        defineTool({
          id: 'echo',
          description: 'Echo',
          handler: async ({ msg }) => ({ content: String(msg) }),
        }),
      )
      .build();

    const events: AgentStreamEvent[] = [];
    agent.observe((e) => events.push(e));

    await agent.run('start');

    const types = events.map((e) => e.type);
    expect(types).toContain('turn_start');
    expect(types).toContain('llm_start');
    expect(types).toContain('llm_end');
    expect(types).toContain('tool_start');
    expect(types).toContain('tool_end');
    expect(types).toContain('turn_end');

    // turn_start fires first; turn_end fires last
    expect(types[0]).toBe('turn_start');
    expect(types[types.length - 1]).toBe('turn_end');
  });

  it('2. LLMCall.observe() captures turn_start → llm_* → turn_end', async () => {
    const caller = LLMCall.create({
      provider: mock([{ content: 'Hello back.' }]),
    })
      .system('You are helpful.')
      .build();

    const events: AgentStreamEvent[] = [];
    caller.observe((e) => events.push(e));

    await caller.run('Hello');

    const types = events.map((e) => e.type);
    expect(types).toContain('turn_start');
    expect(types).toContain('llm_start');
    expect(types).toContain('llm_end');
    expect(types).toContain('turn_end');
    // No tool events — LLMCall doesn't loop and doesn't use tools
    expect(types).not.toContain('tool_start');
  });

  it('3. Multiple observers on one runner each see every event', async () => {
    const agent = Agent.create({
      provider: mock([{ content: 'done' }]),
      name: 'multi-obs',
    }).build();

    const obsA: string[] = [];
    const obsB: string[] = [];
    const obsC: string[] = [];
    agent.observe((e) => obsA.push(e.type));
    agent.observe((e) => obsB.push(e.type));
    agent.observe((e) => obsC.push(e.type));

    await agent.run('hi');

    expect(obsA).toEqual(obsB);
    expect(obsB).toEqual(obsC);
    expect(obsA.length).toBeGreaterThan(0);
  });

  it('4. observe() returns a stop() that actually stops event delivery', async () => {
    const agent = Agent.create({
      provider: mock([{ content: 'first' }, { content: 'second' }]),
      name: 'stop-test',
    }).build();

    const events: string[] = [];
    const stop = agent.observe((e) => events.push(e.type));

    await agent.run('first turn');
    const countAfterFirst = events.length;
    expect(countAfterFirst).toBeGreaterThan(0);

    stop();

    await agent.run('second turn');
    // No new events after unsubscribe
    expect(events.length).toBe(countAfterFirst);
  });

  it('5. A throwing observer never crashes the run', async () => {
    const agent = Agent.create({
      provider: mock([{ content: 'survived' }]),
      name: 'error-isolation',
    }).build();

    // Naughty observer always throws
    agent.observe(() => {
      throw new Error('I am a broken observer');
    });

    const goodEvents: string[] = [];
    agent.observe((e) => goodEvents.push(e.type));

    // Run completes successfully despite the throwing observer
    const result = await agent.run('hello');

    expect(result.content).toBe('survived');
    // The well-behaved observer still got every event
    expect(goodEvents).toContain('turn_start');
    expect(goodEvents).toContain('turn_end');
  });
});
