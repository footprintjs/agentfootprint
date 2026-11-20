/**
 * The compose backstop's WIRING in the tools slot (`core/slots/buildToolsSlot.ts`).
 *
 * No live route reaches the backstop today: every list the merge reads is
 * park-filtered, so the merged wire never contradicts a park
 * (`invariantViolation.test.ts` pins that). So this file simulates the leak
 * at the one seam the slot asks — `composeViolationsOf` is handed a wire that
 * still carries the parked map's tool — and pins what the SLOT does with the
 * answer: it files through the one rail (`agent/integrityFindings.ts`), so the
 * event, the seen-list identity and the dedup all describe the compose seam,
 * once per run.
 *
 * Test type (Convention 3): contract.
 */

import { describe, expect, it, vi } from 'vitest';
import { Agent, defineTool } from '../../src/index.js';
import { defineSkill, skillGraph } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';

vi.mock('../../src/integrity/invariant-violation/check.js', async (importOriginal) => {
  const real = await importOriginal<
    typeof import('../../src/integrity/invariant-violation/check.js')
  >();
  return {
    ...real,
    // The leak, simulated: the parked names are still on the merged wire.
    composeViolationsOf: (
      ...[maps, parked, wire, iteration]: Parameters<typeof real.composeViolationsOf>
    ) =>
      real.composeViolationsOf(
        maps,
        parked,
        { ...wire, names: [...wire.names, ...parked] },
        iteration,
      ),
  };
});

const call = (id: string, name: string) => ({
  content: '',
  toolCalls: [{ id, name, args: {} }],
  stopReason: 'tool_use' as const,
});

function parkedMapAgent() {
  const zoneTool = defineTool({
    name: 'get_zone_info',
    description: 'zone info',
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
  const agent = Agent.create({
    provider: mock({
      replies: [
        call('c1', 'screen_open'),
        call('c2', 'screen_open'),
        call('c3', 'screen_open'),
        call('c4', 'screen_open'),
        call('c5', 'screen_open'),
        { content: 'done', toolCalls: [], stopReason: 'stop' as const },
      ],
    }),
    model: 'mock',
    maxIterations: 8,
  })
    .system('s')
    .tool(screen)
    .skillGraph(graph)
    .maps({ renewalGrace: 3 })
    .build();
  const events: Array<Record<string, unknown>> = [];
  agent.on('agentfootprint.integrity.context_error', (e) => {
    events.push(e.payload as unknown as Record<string, unknown>);
  });
  return { agent, events };
}

describe('contract: the tools slot files the compose backstop on the one rail', () => {
  it('one event per run at the compose seam, and the seen list holds the compose identity', async () => {
    const { agent, events } = parkedMapAgent();
    await agent.run('find the most recent zone redundancy run');

    // Filed once, although the backstop re-detects it on every later pass.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'invariant-violation', seam: 'compose' });
    const seen = (agent.getLastSnapshot()?.sharedState as { integrityFindingIds?: string[] })
      .integrityFindingIds;
    expect(seen?.filter((id) => id.startsWith('invariant-violation '))).toEqual([
      expect.stringMatching(/^invariant-violation @compose /),
    ]);
  });
});
