import { describe, it, expect } from 'vitest';
import { LLMCall, mock } from '../../src/test-barrel';

describe('Scenario: Simple LLM Call', () => {
  it('sends a message and gets a response', async () => {
    const caller = LLMCall.create({ provider: mock([{ content: 'Hello, Alice!' }]) })
      .system('You are a friendly assistant.')
      .build();

    const result = await caller.run('Hi, my name is Alice.');

    expect(result.content).toBe('Hello, Alice!');
    expect(result.messages).toHaveLength(3); // system + user + assistant
  });

  it('generates a narrative trace', async () => {
    const caller = LLMCall.create({ provider: mock([{ content: 'Done.' }]) }).build();

    await caller.run('Do something.');

    const narrative = caller.getNarrativeEntries().map((e) => e.text);
    expect(narrative.length).toBeGreaterThan(0);
    expect(narrative.some((s) => s.includes('SystemPrompt'))).toBe(true);
  });

  it('works without system prompt', async () => {
    const caller = LLMCall.create({ provider: mock([{ content: 'Ok.' }]) }).build();

    const result = await caller.run('No system prompt here.');
    expect(result.content).toBe('Ok.');
    expect(result.messages).toHaveLength(2); // user + assistant (no system)
  });
});
