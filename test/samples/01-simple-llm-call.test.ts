/**
 * Sample 01: Simple LLM Call
 *
 * The simplest pattern — send a message, get a response.
 * No tools, no loops, no conversation history.
 * LLMCall is the building block for everything else.
 */
import { describe, it, expect } from 'vitest';
import { LLMCall, mock } from '../../src';

describe('Sample 01: Simple LLM Call', () => {
  it('sends a message and gets a response', async () => {
    // Create a mock LLM that returns a fixed response
    const llm = mock([{ content: 'The capital of France is Paris.' }]);

    // Build a simple LLM call with a system prompt
    const call = LLMCall.create({ provider: llm }).system('You are a geography expert.').build();

    // Run it
    const result = await call.run('What is the capital of France?');

    expect(result.content).toBe('The capital of France is Paris.');
  });

  it('produces a narrative of what happened', async () => {
    const call = LLMCall.create({ provider: mock([{ content: 'Done.' }]) })
      .system('Be helpful.')
      .build();

    await call.run('Hello');

    // Every run produces a narrative — a human-readable trace
    const narrative = call.getNarrative();
    expect(narrative.length).toBeGreaterThan(0);
  });

  it('produces an execution snapshot', async () => {
    const call = LLMCall.create({ provider: mock([{ content: 'Done.' }]) }).build();

    await call.run('Hello');

    // Snapshot captures the full execution state — for debugging and replay
    const snapshot = call.getSnapshot();
    expect(snapshot).toBeDefined();
  });
});
