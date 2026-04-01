/**
 * BehindTheScenes Narrative Integration Tests
 *
 * Verifies that the new lib/ architecture produces rich, meaningful
 * narratives through footprintjs's CombinedNarrativeRecorder.
 *
 * Tiers:
 * - unit:     single-turn narrative structure, stage names, descriptions
 * - boundary: no tools, no system prompt, empty message
 * - scenario: full ReAct loop narrative, memory narrative, subflow drill-down
 * - property: narrative always array, entries always have required fields
 * - security: error narrative, max iterations narrative
 */

import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../src/lib/concepts/Agent';
import { defineTool } from '../../src/tools';
import { InMemoryStore } from '../../src/adapters/memory/inMemory';
import type { LLMProvider, ToolCall } from '../../src/types';

// ── Helpers ──────────────────────────────────────────────────

function mockProvider(responses: Array<{ content: string; toolCalls?: ToolCall[] }>): LLMProvider {
  let callIndex = 0;
  return {
    chat: vi.fn(async () => {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return response;
    }),
  };
}

const searchTool = defineTool({
  id: 'search',
  description: 'Search the web',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  handler: async ({ q }) => ({ content: `Results for: ${q}` }),
});

// ── Unit Tests ──────────────────────────────────────────────

describe('Narrative — unit', () => {
  it('single-turn produces narrative with all slot subflows', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'Hello!' }]),
    })
      .system('You are helpful.')
      .tool(searchTool)
      .build();

    await agent.run('hi');
    const narrative = agent.getNarrative();

    // Seed stage
    expect(narrative.some((s) => s.includes('Initialize agent loop state'))).toBe(true);
    // Slot subflows
    expect(narrative.some((s) => s.includes('SystemPrompt subflow'))).toBe(true);
    expect(narrative.some((s) => s.includes('Messages subflow'))).toBe(true);
    expect(narrative.some((s) => s.includes('Tools subflow'))).toBe(true);
    // Core stages
    expect(narrative.some((s) => s.includes('Prepend system prompt'))).toBe(true);
    expect(narrative.some((s) => s.includes('Send messages + tools to LLM provider'))).toBe(true);
    expect(narrative.some((s) => s.includes('Parse LLM response'))).toBe(true);
    expect(narrative.some((s) => s.includes('Execute tool calls or finalize'))).toBe(true);
  });

  it('narrative entries have structured fields', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    })
      .system('test')
      .build();

    await agent.run('hi');
    const entries = agent.getNarrativeEntries();

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.type).toBeDefined();
      expect(typeof entry.text).toBe('string');
      expect(typeof entry.depth).toBe('number');
    }
  });

  it('narrative captures scope writes with summarized values', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    })
      .system('You are a test bot.')
      .build();

    await agent.run('hello');
    const narrative = agent.getNarrative();

    // System prompt value appears in narrative
    expect(narrative.some((s) => s.includes('systemPrompt') && s.includes('You are a test bot.'))).toBe(true);
    // Messages tracked
    expect(narrative.some((s) => s.includes('Write messages'))).toBe(true);
  });
});

// ── Boundary Tests ──────────────────────────────────────────

describe('Narrative — boundary', () => {
  it('agent without system prompt skips system prompt in AssemblePrompt', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    }).build();

    await agent.run('hi');
    const narrative = agent.getNarrative();

    // SystemPrompt subflow still runs (always a subflow), but value is empty
    expect(narrative.some((s) => s.includes('SystemPrompt subflow'))).toBe(true);
  });

  it('agent without tools produces empty tool descriptions', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    }).build();

    await agent.run('hi');
    const entries = agent.getNarrativeEntries();

    // Tools subflow should still appear
    const toolsEntry = entries.find((e) => e.text.includes('Tools subflow'));
    expect(toolsEntry).toBeDefined();
  });

  it('empty message still produces full narrative', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    }).build();

    await agent.run('');
    const narrative = agent.getNarrative();
    expect(narrative.length).toBeGreaterThan(0);
  });
});

// ── Scenario Tests ──────────────────────────────────────────

describe('Narrative — scenario', () => {
  it('ReAct loop narrative shows tool execution and loop iteration', async () => {
    const tc: ToolCall = { id: 'tc-1', name: 'search', arguments: { q: 'weather' } };
    const agent = Agent.create({
      provider: mockProvider([
        { content: 'Let me search', toolCalls: [tc] },
        { content: 'The weather is sunny.' },
      ]),
    })
      .system('You can search.')
      .tool(searchTool)
      .build();

    await agent.run('weather?');
    const narrative = agent.getNarrative();

    // Loop iteration visible
    expect(narrative.some((s) => s.includes('pass 1'))).toBe(true);
    // Tool call results in loopCount increment
    expect(narrative.some((s) => s.includes('loopCount') && s.includes('1'))).toBe(true);
    // Final answer stored
    expect(narrative.some((s) => s.includes('result') && s.includes('sunny'))).toBe(true);
    // Break condition
    expect(narrative.some((s) => s.includes('Execution stopped'))).toBe(true);
  });

  it('narrative entries distinguish subflow vs root level stages', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    })
      .system('test')
      .build();

    await agent.run('hi');
    const entries = agent.getNarrativeEntries();

    // Subflow entries
    const subflowEntries = entries.filter((e) => e.type === 'subflow');
    expect(subflowEntries.length).toBeGreaterThanOrEqual(6); // 3 enter + 3 exit

    // Stage entries inside subflows have path-style names
    const subflowStages = entries.filter(
      (e) => e.type === 'stage' && e.stageName?.includes('/'),
    );
    expect(subflowStages.length).toBeGreaterThan(0);
    expect(subflowStages.some((e) => e.stageName?.includes('sf-system-prompt/'))).toBe(true);
    expect(subflowStages.some((e) => e.stageName?.includes('sf-messages/'))).toBe(true);
    expect(subflowStages.some((e) => e.stageName?.includes('sf-tools/'))).toBe(true);
  });

  it('memory agent narrative includes commit-memory stage', async () => {
    const store = new InMemoryStore();
    const agent = Agent.create({
      provider: mockProvider([{ content: 'remembered' }]),
    })
      .memory({ store, conversationId: 'conv-1' })
      .build();

    await agent.run('remember this');
    const narrative = agent.getNarrative();

    // CommitMemory stage should be in narrative
    expect(narrative.some((s) => s.includes('Persist conversation history'))).toBe(true);
  });

  it('multi-turn narrative is independent per run', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'first' }, { content: 'second' }]),
    }).build();

    await agent.run('turn1');
    const narrative1 = agent.getNarrative();

    await agent.run('turn2');
    const narrative2 = agent.getNarrative();

    // Each run produces fresh narrative
    expect(narrative1.length).toBeGreaterThan(0);
    expect(narrative2.length).toBeGreaterThan(0);
    // They should not be identical (different message counts)
    expect(narrative1).not.toEqual(narrative2);
  });
});

// ── Property Tests ──────────────────────────────────────────

describe('Narrative — property', () => {
  it('getNarrative always returns string array', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    }).build();

    // Before run
    expect(Array.isArray(agent.getNarrative())).toBe(true);

    await agent.run('hi');
    const narrative = agent.getNarrative();
    expect(Array.isArray(narrative)).toBe(true);
    for (const line of narrative) {
      expect(typeof line).toBe('string');
    }
  });

  it('getNarrativeEntries always returns array with valid types', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    }).build();

    await agent.run('hi');
    const entries = agent.getNarrativeEntries();

    const validTypes = new Set(['stage', 'step', 'condition', 'fork', 'selector', 'subflow', 'loop', 'break', 'error']);
    for (const entry of entries) {
      expect(validTypes.has(entry.type)).toBe(true);
    }
  });

  it('every stage entry has a stageName', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    })
      .system('test')
      .build();

    await agent.run('hi');
    const entries = agent.getNarrativeEntries();

    const stageEntries = entries.filter((e) => e.type === 'stage');
    expect(stageEntries.length).toBeGreaterThan(0);
    for (const entry of stageEntries) {
      expect(entry.stageName).toBeDefined();
      expect(entry.stageName!.length).toBeGreaterThan(0);
    }
  });

  it('step entries always have depth > 0', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    }).build();

    await agent.run('hi');
    const entries = agent.getNarrativeEntries();

    const stepEntries = entries.filter((e) => e.type === 'step');
    for (const entry of stepEntries) {
      expect(entry.depth).toBeGreaterThan(0);
    }
  });
});

// ── Security Tests ──────────────────────────────────────────

describe('Narrative — security', () => {
  it('provider error produces error narrative', async () => {
    const agent = Agent.create({
      provider: { chat: vi.fn().mockRejectedValue(new Error('API failure')) },
    }).build();

    await expect(agent.run('hi')).rejects.toThrow('API failure');

    // Narrative should exist up to the point of failure
    const narrative = agent.getNarrative();
    expect(narrative.length).toBeGreaterThan(0);
    // Should include stages up to CallLLM
    expect(narrative.some((s) => s.includes('Initialize agent loop state'))).toBe(true);
  });

  it('maxIterations=0 produces narrative without loop', async () => {
    const tc: ToolCall = { id: 'tc-1', name: 'search', arguments: {} };
    const agent = Agent.create({
      provider: mockProvider([
        { content: 'searching', toolCalls: [tc] },
        { content: 'done' },
      ]),
    })
      .tool(searchTool)
      .maxIterations(0)
      .build();

    const result = await agent.run('search');
    const narrative = agent.getNarrative();

    // Should have narrative entries
    expect(narrative.length).toBeGreaterThan(0);
    // With maxIterations=0, should finalize immediately (no tool execution)
    expect(result.iterations).toBe(0);
  });
});
