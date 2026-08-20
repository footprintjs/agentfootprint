/**
 * The ownership edge, stamped at registration (9.60.0) — the identity a
 * checker reads and never infers.
 *
 * Test types (Convention 3): unit (defineTool refusals + passthrough) /
 * integration (the record attributes a stamped tool to its OWNING
 * subsystem, and an unstamped one to 'registry' exactly as before).
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';

const final = { content: 'done', toolCalls: [], stopReason: 'stop' as const };

describe('unit: defineTool carries the stamp, or refuses a blank half', () => {
  it('passes a well-formed owner through verbatim', () => {
    const t = defineTool({
      name: 'get_zone_info',
      description: 'z',
      inputSchema: { type: 'object', properties: {} },
      owner: { kind: 'skill', id: 'zone-audit' },
      execute: () => 'ok',
    });
    expect(t.owner).toEqual({ kind: 'skill', id: 'zone-audit' });
  });

  it('refuses a blank half by name — a wrong join is worse than none', () => {
    expect(() =>
      defineTool({
        name: 'bad',
        description: 'b',
        inputSchema: { type: 'object', properties: {} },
        owner: { kind: 'skill', id: '' },
        execute: () => 'ok',
      }),
    ).toThrow(/identity edge/);
  });
});

describe('integration: the record reads the stamp', () => {
  it('a stamped tool is attributed to its owner; an unstamped one stays registry', async () => {
    const stamped = defineTool({
      name: 'owned_tool',
      description: 'o',
      inputSchema: { type: 'object', properties: {} },
      owner: { kind: 'skill', id: 'zone-audit' },
      execute: () => 'ok',
    });
    const plain = defineTool({
      name: 'plain_tool',
      description: 'p',
      inputSchema: { type: 'object', properties: {} },
      execute: () => 'ok',
    });
    const rows: Array<{
      sourceId?: string;
      source?: string;
      reason?: string;
      contentSummary?: string;
    }> = [];
    const agent = Agent.create({ provider: mock({ replies: [final] }), model: 'mock' })
      .system('s')
      .tool(stamped)
      .tool(plain)
      .build();
    agent.on('agentfootprint.context.injected', (e) => {
      const p = e.payload as {
        slot?: string;
        source?: string;
        sourceId?: string;
        reason?: string;
        contentSummary?: string;
      };
      if (p.slot === 'tools') rows.push(p);
    });
    await agent.run('hello');
    const owned = rows.find((r) => r.contentSummary?.startsWith('owned_tool'));
    const unowned = rows.find((r) => r.sourceId === 'plain_tool');
    expect(owned).toMatchObject({ source: 'skill', sourceId: 'zone-audit' });
    expect(owned?.reason).toContain("skill 'zone-audit'");
    expect(unowned).toMatchObject({ source: 'registry', reason: 'tool registry' });
  });
});
