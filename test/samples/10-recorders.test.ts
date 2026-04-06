/**
 * Sample 10: Recorders — Observe Without Changing Behavior
 *
 * Recorders are passive observers. They watch execution events
 * and collect data — without affecting the agent's behavior.
 *
 *   TokenRecorder     → track token usage
 *   TurnRecorder      → track turn lifecycle
 *   QualityRecorder   → score output quality
 *   GuardrailRecorder → check safety/policy
 *   CompositeRecorder → fan-out to multiple recorders
 */
import { describe, it, expect } from 'vitest';
import { agentLoop, mock, staticPrompt, defineTool, Agent, LLMCall } from '../../src/test-barrel';
import type { AgentLoopConfig } from '../../src/test-barrel';
import { fullHistory, staticTools, noTools } from '../../src/providers';
import {
  TokenRecorder,
  TurnRecorder,
  QualityRecorder,
  GuardrailRecorder,
  CompositeRecorder,
} from '../../src/recorders/v2';

function config(overrides: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
  return {
    promptProvider: staticPrompt('Be helpful.'),
    messageStrategy: fullHistory(),
    toolProvider: noTools(),
    llmProvider: mock([{ content: 'Hello!' }]),
    maxIterations: 10,
    recorders: [],
    name: 'test',
    ...overrides,
  };
}

describe('Sample 10: Recorders', () => {
  it('TokenRecorder — tracks token usage', async () => {
    const tokens = new TokenRecorder();

    await agentLoop(config({ recorders: [tokens] }), 'Hi');

    const stats = tokens.getStats();
    expect(stats.totalCalls).toBe(1);
  });

  it('TurnRecorder — tracks turn lifecycle', async () => {
    const turns = new TurnRecorder();

    await agentLoop(config({ recorders: [turns] }), 'Hi');

    expect(turns.getCompletedCount()).toBe(1);
    const entries = turns.getTurns();
    expect(entries[0].status).toBe('completed');
    expect(entries[0].content).toBe('Hello!');
  });

  it('QualityRecorder — scores each response', async () => {
    const quality = new QualityRecorder((event) => ({
      score: event.content.length > 3 ? 0.9 : 0.2,
      label: event.content.length > 3 ? 'good' : 'too short',
      turnNumber: event.turnNumber,
    }));

    await agentLoop(config({ recorders: [quality] }), 'Hi');

    expect(quality.getScores()).toHaveLength(1);
    expect(quality.getScores()[0].score).toBe(0.9);
    expect(quality.getAverageScore()).toBe(0.9);
  });

  it('GuardrailRecorder — flags policy violations', async () => {
    const guardrail = new GuardrailRecorder((event) => {
      if (event.content.includes('CONFIDENTIAL')) {
        return {
          rule: 'pii-leak',
          message: 'Response contains confidential data',
          severity: 'error',
          turnNumber: event.turnNumber,
        };
      }
      return null;
    });

    // Safe response
    await agentLoop(config({ recorders: [guardrail] }), 'Hi');
    expect(guardrail.hasViolations()).toBe(false);

    // Unsafe response
    guardrail.clear();
    await agentLoop(
      config({
        llmProvider: mock([{ content: 'The CONFIDENTIAL password is 1234.' }]),
        recorders: [guardrail],
      }),
      'Tell me the password',
    );
    expect(guardrail.hasViolations()).toBe(true);
    expect(guardrail.getViolations()[0].rule).toBe('pii-leak');
  });

  it('CompositeRecorder — multiple recorders at once', async () => {
    const turns = new TurnRecorder();
    const quality = new QualityRecorder((e) => ({
      score: 0.8,
      turnNumber: e.turnNumber,
    }));
    const guardrail = new GuardrailRecorder(() => null);

    const all = new CompositeRecorder([turns, quality, guardrail]);

    await agentLoop(config({ recorders: [all] }), 'Hi');

    expect(turns.getCompletedCount()).toBe(1);
    expect(quality.getScores()).toHaveLength(1);
    expect(guardrail.hasViolations()).toBe(false);
  });

  it('Agent.recorder() — attach via builder API', async () => {
    const turns = new TurnRecorder();
    const tokens = new TokenRecorder();

    const agent = Agent.create({
      provider: mock([{ content: 'Done.' }]),
      name: 'test-agent',
    })
      .system('Be helpful.')
      .recorder(turns)
      .recorder(tokens)
      .build();

    await agent.run('Hi');

    expect(turns.getCompletedCount()).toBe(1);
    expect(tokens.getStats().totalCalls).toBe(1);
  });

  it('LLMCall.recorder() — attach via builder API', async () => {
    const turns = new TurnRecorder();

    const call = LLMCall.create({
      provider: mock([{ content: 'Response.' }]),
    })
      .system('Respond.')
      .recorder(turns)
      .build();

    await call.run('Hi');

    expect(turns.getCompletedCount()).toBe(1);
    expect(turns.getTurns()[0].content).toBe('Response.');
  });
});
