/**
 * Sample 06: Tool Strategies
 *
 * Control which tools the LLM can use and how they execute.
 *
 *   staticTools    → fixed tool set
 *   dynamicTools   → tools change based on context
 *   agentAsTool    → wrap an agent as a callable tool
 *   compositeTools → merge multiple tool providers
 */
import { describe, it, expect } from 'vitest';
import { defineTool, agentAsTool } from '../../src/test-barrel';
import type { RunnerLike } from '../../src/test-barrel';
import { staticTools, dynamicTools, compositeTools } from '../../src/providers';

const searchTool = defineTool({
  id: 'search',
  description: 'Search the web',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  handler: async (input) => ({ content: `Found: ${input.q}` }),
});

const submitTool = defineTool({
  id: 'submit',
  description: 'Submit the final answer',
  inputSchema: { type: 'object', properties: { answer: { type: 'string' } } },
  handler: async (input) => ({ content: `Submitted: ${input.answer}` }),
});

const toolCtx = { message: '', turnNumber: 0, loopIteration: 0, messages: [] };

describe('Sample 06: Tool Strategies', () => {
  it('staticTools — same tools every turn', async () => {
    const provider = staticTools([searchTool, submitTool]);
    const decision = await provider.resolve(toolCtx);
    expect(decision.value.map((t) => t.name)).toEqual(['search', 'submit']);

    // Execute a tool call
    const result = await provider.execute!({ id: 'tc1', name: 'search', arguments: { q: 'AI' } });
    expect(result.content).toBe('Found: AI');
  });

  it('dynamicTools — tools change based on context', async () => {
    // Only show submit tool after turn 3
    const provider = dynamicTools((ctx) =>
      ctx.turnNumber > 3 ? [searchTool, submitTool] : [searchTool],
    );

    const early = await provider.resolve({ ...toolCtx, turnNumber: 1 });
    expect(early.value.map((t) => t.name)).toEqual(['search']);

    const late = await provider.resolve({ ...toolCtx, turnNumber: 5 });
    expect(late.value.map((t) => t.name)).toEqual(['search', 'submit']);
  });

  it('agentAsTool — wrap an agent as a tool', async () => {
    // Any RunnerLike can become a tool
    const researchAgent: RunnerLike = {
      run: async (msg) => ({ content: `Researched: ${msg}` }),
    };

    const tool = agentAsTool({
      id: 'research',
      description: 'Delegate research to a specialist agent.',
      runner: researchAgent,
    });

    // The LLM calls it like any other tool
    const result = await tool.handler({ message: 'quantum computing' });
    expect(result.content).toBe('Researched: quantum computing');
  });

  it('compositeTools — merge multiple providers', async () => {
    // Base tools + context-dependent tools
    const provider = compositeTools([
      staticTools([searchTool]),
      dynamicTools((ctx) => (ctx.turnNumber > 2 ? [submitTool] : [])),
    ]);

    const early = await provider.resolve({ ...toolCtx, turnNumber: 1 });
    expect(early.value).toHaveLength(1); // just search

    const late = await provider.resolve({ ...toolCtx, turnNumber: 3 });
    expect(late.value).toHaveLength(2); // search + submit
  });
});
