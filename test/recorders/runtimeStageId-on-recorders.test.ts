/**
 * Verify runtimeStageId flows through to all Map-based recorders.
 *
 * 5 patterns:
 * 1. Simple LLM call — TokenRecorder has runtimeStageId per call
 * 2. Agent with tools — ToolUsageRecorder has runtimeStageId
 * 3. Multi-iteration loop — each iteration has unique runtimeStageId
 * 4. ExplainRecorder iterations — runtimeStageId on each EvalIteration
 * 5. getByKey() lookup — O(1) access by runtimeStageId
 */
import { describe, it, expect } from 'vitest';
import { Agent, mock, defineTool } from '../../src/test-barrel';
import { TokenRecorder } from '../../src/recorders/TokenRecorder';
import { ToolUsageRecorder } from '../../src/recorders/ToolUsageRecorder';
import { CostRecorder } from '../../src/recorders/CostRecorder';
import { ExplainRecorder } from '../../src/recorders/ExplainRecorder';

const searchTool = defineTool({
  id: 'search',
  description: 'Search',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  handler: async ({ q }: { q: string }) => ({ content: `Results for ${q}` }),
});

describe('runtimeStageId on recorders', () => {
  it('TokenRecorder — each LLM call has a unique runtimeStageId', async () => {
    const tokens = new TokenRecorder();
    const agent = Agent.create({
      provider: mock([
        { content: '', toolCalls: [{ id: 'tc1', name: 'search', arguments: { q: 'test' } }] },
        { content: 'Done.' },
      ]),
    })
      .tool(searchTool)
      .recorder(tokens)
      .build();

    await agent.run('Search');

    const stats = tokens.getStats();
    expect(stats.totalCalls).toBe(2);
    // Each call has a runtimeStageId
    for (const call of stats.calls) {
      expect(call.runtimeStageId).toBeDefined();
      expect(call.runtimeStageId!.length).toBeGreaterThan(0);
    }
    // They are unique
    const ids = stats.calls.map((c) => c.runtimeStageId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ToolUsageRecorder — tool call has runtimeStageId', async () => {
    const tools = new ToolUsageRecorder();
    const agent = Agent.create({
      provider: mock([
        { content: '', toolCalls: [{ id: 'tc1', name: 'search', arguments: { q: 'test' } }] },
        { content: 'Done.' },
      ]),
    })
      .tool(searchTool)
      .recorder(tools)
      .build();

    await agent.run('Search');

    const map = tools.getMap();
    expect(map.size).toBeGreaterThan(0);
    for (const [key, event] of map) {
      expect(key.length).toBeGreaterThan(0);
      expect(event.toolName).toBe('search');
    }
  });

  it('CostRecorder — each entry has runtimeStageId', async () => {
    const cost = new CostRecorder({
      pricingTable: { mock: { input: 1, output: 2 } },
    });
    const agent = Agent.create({
      provider: mock([{ content: 'Hello!' }]),
    })
      .recorder(cost)
      .build();

    await agent.run('Hi');

    const entries = cost.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].runtimeStageId).toBeDefined();
  });

  it('ExplainRecorder — each iteration has runtimeStageId', async () => {
    const explain = new ExplainRecorder();
    const agent = Agent.create({
      provider: mock([
        { content: '', toolCalls: [{ id: 'tc1', name: 'search', arguments: { q: 'ai' } }] },
        { content: 'AI is great.' },
      ]),
    })
      .tool(searchTool)
      .recorder(explain)
      .build();

    await agent.run('Tell me about AI');

    const report = explain.explain();
    expect(report.iterations).toHaveLength(2);
    // Iteration 0 (tool-calling) has runtimeStageId
    expect(report.iterations[0].runtimeStageId).toBeDefined();
    // Iteration 1 (final answer) has runtimeStageId
    expect(report.iterations[1].runtimeStageId).toBeDefined();
    // They are unique
    expect(report.iterations[0].runtimeStageId).not.toBe(report.iterations[1].runtimeStageId);
  });

  it('getByKey() — O(1) lookup by runtimeStageId', async () => {
    const tokens = new TokenRecorder();
    const agent = Agent.create({
      provider: mock([
        { content: '', toolCalls: [{ id: 'tc1', name: 'search', arguments: { q: 'x' } }] },
        { content: 'Done.' },
      ]),
    })
      .tool(searchTool)
      .recorder(tokens)
      .build();

    await agent.run('Go');

    const stats = tokens.getStats();
    const firstCall = stats.calls[0];
    const key = firstCall.runtimeStageId!;

    // getByKey returns the same entry
    const lookup = tokens.getByKey(key);
    expect(lookup).toBeDefined();
    expect(lookup!.model).toBe(firstCall.model);
    expect(lookup!.inputTokens).toBe(firstCall.inputTokens);

    // Missing key returns undefined
    expect(tokens.getByKey('nonexistent#999')).toBeUndefined();
  });
});
