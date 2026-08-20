/**
 * invariant-violation at the write seam — T1 and T2's shape.
 *
 * The recorded failure: a subsystem written PARKED while four tools it
 * owns keep riding the wire. This pins that it fires ONCE with both
 * channels as witnesses, that the healthy park is silent, and that every
 * fence holds (unknown serving set, engaged maps, foreign tools).
 *
 * Test types (Convention 3): functional (the recorded shape) / contract
 * (the fences, and inertness — the finding never resolves) / regression
 * (one finding across ten compositions, via identity dedup).
 */

import { describe, expect, it } from 'vitest';
import { invariantViolationsOf } from '../../src/integrity/invariant-violation/check.js';
import { dedupeContextErrors } from '../../src/integrity/finding/types.js';

const parked = {
  mapId: 'zone-audit',
  standing: 'parked' as const,
  iteration: 4,
  ownedToolNames: ['t1', 't2', 't3', 't4'],
};
const wire = (...names: string[]) => ({ names, provenance: 'tools slot' });

describe('functional: the recorded suspended-tools contradiction', () => {
  it('fires once, naming the guilty write and every tool still on the wire', () => {
    const found = invariantViolationsOf(parked, wire('t1', 't2', 't3', 't4', 'screen_open'));
    expect(found).toHaveLength(1);
    const f = found[0]!;
    expect(f.kind).toBe('invariant-violation');
    expect(f.seam).toBe('write');
    expect(f.epoch).toBe(4);
    // Both channels are on the record as witnesses — neither is preferred.
    expect(f.witnesses.map((w) => w.value)).toContain('suspended');
    expect(f.witnesses.map((w) => w.value)).toContain('available');
    // The subjects name the map AND each offending tool, so a reader can act.
    expect(f.subjects).toContainEqual({ kind: 'map', id: 'zone-audit' });
    expect(f.subjects).toContainEqual({ kind: 'tool', id: 't3' });
    expect(f.message).toContain('4 tool(s)');
  });

  it('ten compositions of the same defect deduplicate to one finding', () => {
    const filings = Array.from({ length: 10 }, () =>
      invariantViolationsOf(parked, wire('t1', 't2', 't3', 't4')),
    ).flat();
    expect(filings).toHaveLength(10);
    expect(dedupeContextErrors(filings)).toHaveLength(1);
  });
});

describe('contract: the fences, and inertness', () => {
  it('a park whose tools really left the wire is healthy — no finding', () => {
    expect(invariantViolationsOf(parked, wire('screen_open'))).toEqual([]);
  });

  it('an ENGAGED map serving its own tools is the normal case', () => {
    expect(invariantViolationsOf({ ...parked, standing: 'engaged' }, wire('t1', 't2'))).toEqual([]);
  });

  it('an unknown serving set is incomparable — silence, never a guess', () => {
    expect(invariantViolationsOf(parked, undefined)).toEqual([]);
  });

  it('a foreign tool with a similar name is not this map’s problem', () => {
    expect(invariantViolationsOf(parked, wire('t5', 'other_tool'))).toEqual([]);
  });

  it('the finding resolves nothing: it names the pair and says the write stands', () => {
    const f = invariantViolationsOf(parked, wire('t1'))[0]!;
    expect(f.message).toMatch(/nothing here resolves which/);
    expect(f.message).toMatch(/the write always lands/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — the compose backstop through the REAL loop: the provider
// shadowing leak (provider wins the wire, skill wins dispatch, park holds
// out only the skill's copy)
// ─────────────────────────────────────────────────────────────────────────

import { Agent, defineTool } from '../../src/index.js';
import { defineSkill, skillGraph } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';

const call = (id: string, name: string) => ({
  content: '',
  toolCalls: [{ id, name, args: {} }],
  stopReason: 'tool_use' as const,
});
const done = { content: 'done', toolCalls: [], stopReason: 'stop' as const };

function trapAgent(withShadowingProvider: boolean) {
  const zoneTool = defineTool({
    name: 'get_zone_info',
    description: 'zone info (skill copy)',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'zones',
  });
  const screen = defineTool({
    name: 'screen_open',
    description: 's',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'ok',
  });
  const zoneAudit = defineSkill({
    id: 'zone-audit',
    description: 'audit',
    body: 'Z',
    tools: [zoneTool],
  });
  const billing = defineSkill({ id: 'billing', description: 'b', body: 'B' });
  const graph = skillGraph()
    .entry(zoneAudit, { match: { keywords: ['zone'] } })
    .route(zoneAudit, billing)
    .build();
  const events: Array<Record<string, unknown>> = [];
  let b = Agent.create({
    provider: mock({
      replies: [
        call('c1', 'screen_open'),
        call('c2', 'screen_open'),
        call('c3', 'screen_open'),
        call('c4', 'screen_open'),
        done,
      ],
    }),
    model: 'mock',
    maxIterations: 8,
  })
    .system('s')
    .tool(screen)
    .skillGraph(graph)
    .maps({ renewalGrace: 3 });
  if (withShadowingProvider) {
    b = b.toolProvider({
      id: 'shadow-provider',
      // A provider copy of the SKILL's tool name: wins the wire by merge
      // order, is untouched by the park hold-out — the live leak.
      list: () => [
        defineTool({
          name: 'get_zone_info',
          description: 'zone info (provider copy)',
          inputSchema: { type: 'object', properties: {} },
          execute: () => 'provider zones',
        }),
      ],
    });
  }
  const agent = b.build();
  agent.on('agentfootprint.integrity.context_error', (e) => {
    events.push(e.payload as unknown as Record<string, unknown>);
  });
  return { agent, events };
}

describe('integration: the compose backstop fires on the provider-shadowing leak', () => {
  it('a parked map whose tool name a provider still serves → ONE finding, typed', async () => {
    const { agent, events } = trapAgent(true);
    await agent.run('find the most recent zone redundancy run');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'invariant-violation',
      seam: 'compose',
    });
    expect(String(events[0]!.message)).toContain('get_zone_info');
  });

  it('the healthy park (no shadowing provider) files nothing', async () => {
    const { agent, events } = trapAgent(false);
    await agent.run('find the most recent zone redundancy run');
    expect(events).toEqual([]);
  });
});

describe('integration: the grouped chart threads the dedup across its extra boundary', () => {
  it('one finding, not one per pass, under reactMode dynamic-grouped', async () => {
    const zoneTool = defineTool({
      name: 'get_zone_info',
      description: 'zone info (skill copy)',
      inputSchema: { type: 'object', properties: {} },
      execute: () => 'zones',
    });
    const screen = defineTool({
      name: 'screen_open',
      description: 's',
      inputSchema: { type: 'object', properties: {} },
      execute: () => 'ok',
    });
    const zoneAudit = defineSkill({
      id: 'zone-audit',
      description: 'a',
      body: 'Z',
      tools: [zoneTool],
    });
    const billing = defineSkill({ id: 'billing', description: 'b', body: 'B' });
    const graph = skillGraph()
      .entry(zoneAudit, { match: { keywords: ['zone'] } })
      .route(zoneAudit, billing)
      .build();
    const events: unknown[] = [];
    const agent = Agent.create({
      provider: mock({
        replies: [
          call('g1', 'screen_open'),
          call('g2', 'screen_open'),
          call('g3', 'screen_open'),
          call('g4', 'screen_open'),
          done,
        ],
      }),
      model: 'mock',
      maxIterations: 8,
      reactMode: 'dynamic-grouped',
    })
      .system('s')
      .tool(screen)
      .skillGraph(graph)
      .maps({ renewalGrace: 3 })
      .toolProvider({
        id: 'shadow-provider',
        list: () => [
          defineTool({
            name: 'get_zone_info',
            description: 'zone info (provider copy)',
            inputSchema: { type: 'object', properties: {} },
            execute: () => 'provider zones',
          }),
        ],
      })
      .build();
    agent.on('agentfootprint.integrity.context_error', (e) => events.push(e.payload));
    await agent.run('find the most recent zone redundancy run');
    expect(events).toHaveLength(1);
  });
});
