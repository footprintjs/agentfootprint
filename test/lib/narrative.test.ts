/**
 * BehindTheScenes Narrative Integration Tests
 *
 * Verifies that the agent renderer produces rich, LLM-optimized narratives
 * through footprintjs's CombinedNarrativeRecorder + NarrativeRenderer.
 *
 * Tiers:
 * - unit:     single-turn narrative structure, stage names, promoted keys
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
  it('single-turn produces narrative with agent-styled stages and subflows', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'Hello!' }]),
    })
      .system('You are helpful.')
      .tool(searchTool)
      .build();

    await agent.run('hi');
    const narrative = agent.getNarrative();

    // Seed stage (agent renderer format)
    expect(narrative.some((s) => s.includes('[Seed]'))).toBe(true);
    // Slot subflows (agent renderer labels)
    expect(narrative.some((s) => s.includes('Preparing system prompt'))).toBe(true);
    expect(narrative.some((s) => s.includes('Preparing conversation history'))).toBe(true);
    expect(narrative.some((s) => s.includes('Resolving available tools'))).toBe(true);
    // Core stages
    expect(narrative.some((s) => s.includes('[AssemblePrompt]'))).toBe(true);
    expect(narrative.some((s) => s.includes('[CallLLM]'))).toBe(true);
    expect(narrative.some((s) => s.includes('[ParseResponse]'))).toBe(true);
    expect(narrative.some((s) => s.includes('[RouteResponse]') || s.includes('[Finalize]'))).toBe(
      true,
    );
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

  it('actual values shown for key scope variables', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    })
      .system('You are a test bot.')
      .build();

    await agent.run('hello');
    const narrative = agent.getNarrative();

    // System prompt shows actual text
    expect(
      narrative.some((s) => s.includes('System prompt:') && s.includes('You are a test bot.')),
    ).toBe(true);
    // Parsed response shows type
    expect(narrative.some((s) => s.includes('Parsed:') && s.includes('final'))).toBe(true);
  });

  it('messages shown with count and role breakdown', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    })
      .system('test')
      .build();

    await agent.run('hello');
    const narrative = agent.getNarrative();

    // Messages formatted with count
    expect(narrative.some((s) => s.includes('Messages:') && s.includes('user'))).toBe(true);
  });

  it('internal keys (memory_*, loopCount, adapter internals) suppressed', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    })
      .system('test')
      .build();

    await agent.run('hello');
    const narrative = agent.getNarrative();

    // Internal plumbing keys should NOT appear
    // Note: loopCount and maxIterations are visible loop state (not suppressed)
    expect(narrative.some((s) => s.includes('adapterResult'))).toBe(false);
    // adapterRawResponse is now shown (contains LLM reasoning + token usage)
    expect(narrative.some((s) => s.includes('memory_'))).toBe(false);
    // Enrichment summaries suppressed (actual values shown instead)
    expect(narrative.some((s) => s.includes('llmCall'))).toBe(false);
    expect(narrative.some((s) => s.includes('promptSummary'))).toBe(false);
  });

  it('all reads suppressed (only writes in narrative)', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    }).build();

    await agent.run('hi');
    const entries = agent.getNarrativeEntries();

    // No step entries should contain "Read"
    const stepEntries = entries.filter((e) => e.type === 'step');
    expect(stepEntries.every((e) => !e.text.includes('Read '))).toBe(true);
  });
});

// ── Boundary Tests ──────────────────────────────────────────

describe('Narrative — boundary', () => {
  it('agent without system prompt still has subflow entry', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    }).build();

    await agent.run('hi');
    const narrative = agent.getNarrative();

    // SystemPrompt subflow still runs (agent renderer label)
    expect(narrative.some((s) => s.includes('Preparing system prompt'))).toBe(true);
  });

  it('agent without tools still has subflow entry', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    }).build();

    await agent.run('hi');
    const entries = agent.getNarrativeEntries();

    // Tools subflow should still appear (agent renderer label)
    const toolsEntry = entries.find((e) => e.text.includes('Resolving available tools'));
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
  it('ReAct loop narrative shows tool loop and result', async () => {
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

    // Loop iteration (agent renderer format)
    expect(narrative.some((s) => s.includes('Tool loop iteration 1'))).toBe(true);
    // Tool call visible via parsedResponse (actual value, not enrichment summary)
    expect(narrative.some((s) => s.includes('Parsed:') && s.includes('tool_calls'))).toBe(true);
    // Final result
    expect(narrative.some((s) => s.includes('Result:') && s.includes('sunny'))).toBe(true);
    // Agent completed (agent renderer format)
    expect(narrative.some((s) => s.includes('Agent completed'))).toBe(true);
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
    const subflowStages = entries.filter((e) => e.type === 'stage' && e.stageName?.includes('/'));
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

    // CommitMemory stage (agent renderer format)
    expect(narrative.some((s) => s.includes('[CommitMemory]'))).toBe(true);
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
    expect(narrative1).not.toEqual(narrative2);
  });

  it('actual scope values provide LLM-actionable context', async () => {
    const tc: ToolCall = { id: 'tc-1', name: 'search', arguments: { q: 'test' } };
    const agent = Agent.create({
      provider: mockProvider([{ content: 'searching', toolCalls: [tc] }, { content: 'found it' }]),
    })
      .system('You are a search agent.')
      .tool(searchTool)
      .build();

    await agent.run('find something');
    const narrative = agent.getNarrative();

    // System prompt shows actual text
    expect(
      narrative.some((s) => s.includes('System prompt:') && s.includes('You are a search agent.')),
    ).toBe(true);
    // Tool descriptions show tool names
    expect(narrative.some((s) => s.includes('Tools:') && s.includes('search'))).toBe(true);
    // Parsed response for first call (tool_calls with tool name)
    expect(narrative.some((s) => s.includes('Parsed:') && s.includes('tool_calls'))).toBe(true);
    // Parsed response for second call (final with content preview)
    expect(narrative.some((s) => s.includes('Parsed:') && s.includes('final'))).toBe(true);
    // Result shows final content
    expect(narrative.some((s) => s.includes('Result:') && s.includes('found it'))).toBe(true);
    // Enrichment summaries are suppressed (actual values shown instead)
    expect(narrative.some((s) => s.includes('LLM:'))).toBe(false);
    expect(narrative.some((s) => s.includes('Prompt:'))).toBe(false);
    expect(narrative.some((s) => s.includes('Response:'))).toBe(false);
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

    const validTypes = new Set([
      'stage',
      'step',
      'condition',
      'fork',
      'selector',
      'subflow',
      'loop',
      'break',
      'error',
      'pause',
      'resume',
      'emit',
    ]);
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

  it('stageId present on stage entries for time-travel sync', async () => {
    const agent = Agent.create({
      provider: mockProvider([{ content: 'ok' }]),
    })
      .system('test')
      .build();

    await agent.run('hi');
    const entries = agent.getNarrativeEntries();

    const stageEntries = entries.filter((e) => e.type === 'stage');
    for (const entry of stageEntries) {
      expect(entry.stageId).toBeDefined();
      expect(typeof entry.stageId).toBe('string');
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
    // Should include [Seed] stage
    expect(narrative.some((s) => s.includes('[Seed]'))).toBe(true);
  });

  it('maxIterations=0 produces narrative without loop', async () => {
    const tc: ToolCall = { id: 'tc-1', name: 'search', arguments: {} };
    const agent = Agent.create({
      provider: mockProvider([{ content: 'searching', toolCalls: [tc] }, { content: 'done' }]),
    })
      .tool(searchTool)
      .maxIterations(0)
      .build();

    const result = await agent.run('search');
    const narrative = agent.getNarrative();

    // Should have narrative entries
    expect(narrative.length).toBeGreaterThan(0);
    // With maxIterations=0, should finalize immediately
    expect(result.iterations).toBe(0);
  });
});
