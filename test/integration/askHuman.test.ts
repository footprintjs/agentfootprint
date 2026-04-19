/**
 * Integration test: Agent with ask_human tool — pause/resume end-to-end.
 *
 * Verifies the full ask_human stack:
 *   - LLM calls ask_human → ExecuteTools subflow detects marker
 *   - Pausable subflow throws PauseSignal with the question
 *   - Executor catches pause, returns paused: true
 *   - agent.resume(humanResponse) continues the loop
 *   - The human's answer becomes the tool result for the next LLM call
 *
 * Gap in coverage before this test: askHuman.test.ts only validated the
 * tool definition itself, never that the pause actually fires through
 * the subflow → decider → executor stack.
 */

import { describe, it, expect } from 'vitest';
import { Agent, askHuman, mock } from '../../src/test-barrel';
import { agentObservability } from '../../src/recorders/agentObservability';

describe('askHuman — integration', () => {
  it('pauses the agent loop when LLM calls ask_human', async () => {
    const agent = Agent.create({
      provider: mock([
        {
          content: 'I need clarification.',
          toolCalls: [
            {
              id: 'call_1',
              name: 'ask_human',
              arguments: { question: 'Which city for weather?' },
            },
          ],
        },
      ]),
    })
      .tool(askHuman())
      .maxIterations(10)
      .build();

    const result = await agent.run('Get me the weather report.');

    expect(result.paused).toBe(true);
    expect(result.pauseData?.question).toBe('Which city for weather?');
  });

  it('does NOT loop through ask_human multiple times (regression guard)', async () => {
    // Before the pause fix, an ask_human call would execute as a regular tool,
    // yielding a placeholder result like "[Waiting for human response to: ...]"
    // and the LLM would be re-invoked — burning all maxIterations.
    const provider = mock(
      Array(10).fill({
        content: 'Still need input.',
        toolCalls: [
          {
            id: 'call_x',
            name: 'ask_human',
            arguments: { question: 'Clarify?' },
          },
        ],
      }),
    );
    const agent = Agent.create({ provider }).tool(askHuman()).maxIterations(10).build();

    const result = await agent.run('Go');

    expect(result.paused).toBe(true);
    // If the pause fires on the first ask_human call, only ONE LLM call happens.
    expect(provider.getCallCount()).toBe(1);
  });

  it('pauses when memoryPipeline is enabled (regression: Live Chat scenario)', async () => {
    // Live Chat wires .memoryPipeline() + .system() + askHuman. Reproduce
    // that shape to catch interactions between memory-read/write subflows,
    // the ExecuteTools pausable subflow, and finalize routing.
    const { defaultPipeline, InMemoryStore: PipelineStore } = await import(
      '../../src/memory.barrel'
    );
    const pipeline = defaultPipeline({ store: new PipelineStore() });
    const agent = Agent.create({
      provider: mock([
        {
          content: 'Need more info.',
          toolCalls: [{ id: 'c1', name: 'ask_human', arguments: { question: 'Which movie?' } }],
        },
      ]),
    })
      .system('You are a helpful assistant.')
      .tool(askHuman())
      .memoryPipeline(pipeline)
      .maxIterations(10)
      .build();

    const result = await agent.run('Search for movie review', {
      identity: { conversationId: 'live-chat' },
    });

    expect(result.paused).toBe(true);
    expect(result.pauseData?.question).toBe('Which movie?');
  });

  it('pauses with full Live Chat stack — system + memory + recorder + streaming', async () => {
    const { defaultPipeline, InMemoryStore: PipelineStore } = await import(
      '../../src/memory.barrel'
    );
    const pipeline = defaultPipeline({ store: new PipelineStore() });
    const obs = agentObservability();
    const builder = Agent.create({
      provider: mock([
        {
          content: 'I need clarification.',
          toolCalls: [{ id: 'c1', name: 'ask_human', arguments: { question: 'Which city?' } }],
        },
      ]),
    })
      .system('You are a helpful assistant.')
      .tool(askHuman())
      .streaming(true)
      .memoryPipeline(pipeline)
      .maxIterations(10);
    (builder as any).recorder(obs);
    const agent = builder.build();

    const result = await agent.run('Weather?', {
      identity: { conversationId: 'live-chat' },
      onToken: () => {
        /* no-op */
      },
    });

    expect(result.paused).toBe(true);
    expect(result.pauseData?.question).toBe('Which city?');
  });

  it('resumes with the human response as the tool result', async () => {
    const agent = Agent.create({
      provider: mock([
        {
          content: 'I need clarification.',
          toolCalls: [{ id: 'call_1', name: 'ask_human', arguments: { question: 'City?' } }],
        },
        { content: 'The weather in London is sunny.' },
      ]),
    })
      .tool(askHuman())
      .maxIterations(5)
      .build();

    const first = await agent.run('Weather?');
    expect(first.paused).toBe(true);

    const final = await agent.resume('London');
    expect(final.paused).toBeFalsy();
    expect(final.content).toBe('The weather in London is sunny.');
  });
});
