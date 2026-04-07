/**
 * Sample 20: Explain — Grounding Analysis & Hallucination Detection
 *
 * Extract what tools returned (sources of truth) vs what the LLM said (claims).
 * Compare them to detect hallucinations — without a separate eval pipeline.
 *
 * Uses getGroundingSources() and getLLMClaims() from agentfootprint/explain.
 * These work on narrative entries — the data is already collected during traversal.
 */
import { describe, it, expect, vi } from 'vitest';
import { Agent, defineTool, mock } from '../../src/test-barrel';
import { getGroundingSources, getLLMClaims, getFullLLMContext } from '../../src/explain.barrel';
import type { LLMResponse, ToolCall } from '../../src/test-barrel';

// ── Tools ────────────────────────────────────────────────────

const lookupProduct = defineTool({
  id: 'lookup_product',
  description: 'Look up product details by name',
  inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
  handler: async ({ name }) => ({
    content: JSON.stringify({
      name: 'MacBook Pro 16"',
      price: 2499,
      stock: 23,
      rating: 4.8,
    }),
  }),
});

// ── Tests ────────────────────────────────────────────────────

describe('Sample 20: Explain — Grounding Analysis', () => {
  it('getGroundingSources extracts tool results as sources of truth', async () => {
    const tc: ToolCall = { id: 'tc-1', name: 'lookup_product', arguments: { name: 'MacBook' } };
    const provider = mock([
      { content: '', toolCalls: [tc] },
      { content: 'The MacBook Pro 16" costs $2,499 and has a 4.8 rating with 23 units in stock.' },
    ]);

    const agent = Agent.create({ provider })
      .system('You are a product expert.')
      .tool(lookupProduct)
      .verbose() // full values in narrative
      .build();

    await agent.run('Tell me about the MacBook');

    // Extract grounding sources from narrative entries
    const entries = agent.getNarrativeEntries();
    const sources = getGroundingSources(entries);

    // Should find the tool result
    expect(sources.length).toBeGreaterThanOrEqual(1);
    expect(sources[0].content).toContain('MacBook Pro');
    expect(sources[0].parsed).toHaveProperty('price', 2499);
  });

  it('getLLMClaims extracts what the LLM said', async () => {
    const tc: ToolCall = { id: 'tc-1', name: 'lookup_product', arguments: { name: 'MacBook' } };
    const provider = mock([
      { content: '', toolCalls: [tc] },
      { content: 'The MacBook Pro costs $2,499 with 23 in stock.' },
    ]);

    const agent = Agent.create({ provider }).system('Product expert.').tool(lookupProduct).build();

    await agent.run('MacBook info');
    const claims = getLLMClaims(agent.getNarrativeEntries());

    expect(claims.length).toBeGreaterThanOrEqual(1);
    expect(claims.some((c) => c.content.includes('2,499'))).toBe(true);
  });

  it('detect hallucination: LLM claims something not in sources', async () => {
    const tc: ToolCall = { id: 'tc-1', name: 'lookup_product', arguments: { name: 'MacBook' } };
    // LLM HALLUCSINATES: says "free shipping" which is NOT in tool result
    const provider = mock([
      { content: '', toolCalls: [tc] },
      { content: 'The MacBook Pro costs $2,499 with free shipping and a 5-year warranty.' },
    ]);

    const agent = Agent.create({ provider }).system('Product expert.').tool(lookupProduct).build();

    await agent.run('MacBook details');
    const entries = agent.getNarrativeEntries();
    const sources = getGroundingSources(entries);
    const claims = getLLMClaims(entries);

    // Simple grounding check: does the claim mention things NOT in sources?
    const sourceText = sources.map((s) => s.content).join(' ');
    const finalClaim = claims.find((c) => c.type === 'final');

    // "free shipping" is NOT in the tool result
    expect(sourceText).not.toContain('free shipping');
    expect(finalClaim?.content).toContain('free shipping');
    // → This is a hallucination: the LLM claimed "free shipping" but no source supports it
  });

  it('getFullLLMContext provides complete snapshot', async () => {
    const tc: ToolCall = { id: 'tc-1', name: 'lookup_product', arguments: { name: 'MacBook' } };
    const provider = mock([{ content: '', toolCalls: [tc] }, { content: 'Great product!' }]);

    const agent = Agent.create({ provider }).system('Expert.').tool(lookupProduct).build();

    await agent.run('Tell me');
    const context = getFullLLMContext(agent.getNarrativeEntries());

    expect(context.systemPrompt).toContain('Expert');
    expect(context.sources.length).toBeGreaterThanOrEqual(1);
    expect(context.claims.length).toBeGreaterThanOrEqual(1);
  });
});
