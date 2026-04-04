/**
 * Swarm gained capabilities — 5-pattern tests.
 *
 * Tests the features Swarm gains from unification with Agent loop:
 * - Structural specialist tracking (invokedSpecialists in scope)
 * - RecorderBridge dispatch
 * - Conversation history across turns
 * - resetConversation
 */
import { describe, it, expect, vi } from 'vitest';
import { Swarm } from '../../src/concepts/Swarm';
import type { LLMProvider, LLMResponse } from '../../src/types';
import type { RunnerLike } from '../../src/types/multiAgent';
import type { AgentRecorder } from '../../src/core';

// ── Helpers ──────────────────────────────────────────────────

function mockProvider(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    chat: vi.fn(async () => {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return response;
    }),
  };
}

function mockRunner(content: string): RunnerLike {
  return {
    run: vi.fn(async () => ({ content, messages: [], iterations: 1 })),
  };
}

function mockRecorder(): AgentRecorder & { events: string[] } {
  const events: string[] = [];
  return {
    events,
    onTurnStart: () => events.push('turnStart'),
    onTurnComplete: () => events.push('turnComplete'),
  };
}

// ── Unit ────────────────────────────────────────────────────

describe('Swarm capabilities — unit', () => {
  it('invokedSpecialists tracked structurally (not narrative matching)', async () => {
    const provider = mockProvider([
      { content: '', toolCalls: [{ id: 'tc1', name: 'coding', arguments: { message: 'fizzbuzz' } }] },
      { content: 'Done.' },
    ]);

    const swarm = Swarm.create({ provider })
      .specialist('coding', 'Code', mockRunner('result'))
      .build();

    const result = await swarm.run('write fizzbuzz');
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].id).toBe('coding');
  });

  it('RecorderBridge dispatches turnStart and turnComplete', async () => {
    const provider = mockProvider([{ content: 'Direct answer.' }]);
    const rec = mockRecorder();

    const swarm = Swarm.create({ provider })
      .specialist('coding', 'Code', mockRunner('result'))
      .recorder(rec)
      .build();

    await swarm.run('hi');
    expect(rec.events).toContain('turnStart');
    expect(rec.events).toContain('turnComplete');
  });

  it('getMessages() returns conversation history', async () => {
    const provider = mockProvider([{ content: 'Hello!' }]);
    const swarm = Swarm.create({ provider })
      .specialist('coding', 'Code', mockRunner('result'))
      .build();

    await swarm.run('hi');
    const messages = swarm.getMessages();
    expect(messages.length).toBeGreaterThan(0);
    // Should include at least system + user messages
    expect(messages.some((m: any) => m.role === 'system')).toBe(true);
    expect(messages.some((m: any) => m.role === 'user')).toBe(true);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('Swarm capabilities — boundary', () => {
  it('no specialists invoked — agents array is empty', async () => {
    const provider = mockProvider([{ content: 'I can answer directly.' }]);
    const swarm = Swarm.create({ provider })
      .specialist('coding', 'Code', mockRunner('result'))
      .build();

    const result = await swarm.run('What is 2+2?');
    expect(result.agents).toHaveLength(0);
  });

  it('resetConversation clears history', async () => {
    const provider = mockProvider([{ content: 'Hi!' }]);
    const swarm = Swarm.create({ provider })
      .specialist('coding', 'Code', mockRunner('result'))
      .build();

    await swarm.run('hi');
    expect(swarm.getMessages().length).toBeGreaterThan(0);

    swarm.resetConversation();
    expect(swarm.getMessages()).toHaveLength(0);
  });

  it('no recorders — no crash (bridge is null)', async () => {
    const provider = mockProvider([{ content: 'Hi!' }]);
    const swarm = Swarm.create({ provider })
      .specialist('coding', 'Code', mockRunner('result'))
      .build();

    // Should not throw even without recorders
    const result = await swarm.run('hi');
    expect(result.content).toBe('Hi!');
  });

  it('invalid specialist ID throws at build time', () => {
    const provider = mockProvider([{ content: 'hi' }]);
    expect(() => {
      Swarm.create({ provider }).specialist('has spaces', 'Bad', mockRunner('x'));
    }).toThrow('Invalid specialist ID');

    expect(() => {
      Swarm.create({ provider }).specialist('', 'Empty', mockRunner('x'));
    }).toThrow('Invalid specialist ID');
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('Swarm capabilities — scenario', () => {
  it('multi-specialist: both tracked in agents array', async () => {
    const provider = mockProvider([
      { content: '', toolCalls: [{ id: 'tc1', name: 'coding', arguments: { message: 'code' } }] },
      { content: '', toolCalls: [{ id: 'tc2', name: 'writing', arguments: { message: 'write' } }] },
      { content: 'Done with both.' },
    ]);

    const swarm = Swarm.create({ provider })
      .specialist('coding', 'Code', mockRunner('code-result'))
      .specialist('writing', 'Write', mockRunner('write-result'))
      .build();

    const result = await swarm.run('Code and write');
    expect(result.agents).toHaveLength(2);
    expect(result.agents.map((a) => a.id)).toEqual(['coding', 'writing']);
  });
});

// ── Property ────────────────────────────────────────────────

describe('Swarm capabilities — property', () => {
  it('recorder events fire in correct order: turnStart before turnComplete', async () => {
    const provider = mockProvider([{ content: 'Done.' }]);
    const rec = mockRecorder();

    const swarm = Swarm.create({ provider })
      .specialist('coding', 'Code', mockRunner('result'))
      .recorder(rec)
      .build();

    await swarm.run('hi');
    const startIdx = rec.events.indexOf('turnStart');
    const endIdx = rec.events.indexOf('turnComplete');
    expect(startIdx).toBeLessThan(endIdx);
  });

  it('invokedSpecialists is empty array (not undefined) when no specialist called', async () => {
    const provider = mockProvider([{ content: 'Direct.' }]);
    const swarm = Swarm.create({ provider })
      .specialist('coding', 'Code', mockRunner('result'))
      .build();

    const result = await swarm.run('hi');
    expect(result.agents).toEqual([]);
  });
});

// ── Security ────────────────────────────────────────────────

describe('Swarm capabilities — security', () => {
  it('conversation history is a defensive copy', async () => {
    const provider = mockProvider([{ content: 'Hi!' }]);
    const swarm = Swarm.create({ provider })
      .specialist('coding', 'Code', mockRunner('result'))
      .build();

    await swarm.run('hi');
    const messages1 = swarm.getMessages();
    const messages2 = swarm.getMessages();
    expect(messages1).not.toBe(messages2); // different array references
    expect(messages1).toEqual(messages2); // same content
  });
});
