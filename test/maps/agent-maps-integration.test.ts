/**
 * The maps kernel through the REAL Agent loop (9.58.0): the recorded
 * keyword-trap shape — an entry regex reads a noun as a task — parks the
 * skill map after `renewalGrace` corroboration-free passes, on the record
 * and in the served context; an accepted read_skill pick re-engages it; and
 * an agent that never mounts `.maps()` is byte-identical to before.
 *
 * Test types (Convention 3): integration (the trap, recovery, owned-tool
 * renewal, grouped chart) / security (builder refusal without a graph) /
 * regression (zero-delta without `.maps()` — the cursor law untouched).
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../src/index.js';
import { defineSkill, skillGraph } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';

// ── Toolkit ──────────────────────────────────────────────────────────────

const zoneTool = defineTool<Record<string, never>, string>({
  name: 'get_zone_info',
  description: 'zone info',
  inputSchema: { type: 'object', properties: {} },
  execute: () => 'zones: a, b',
});

const screenTool = defineTool<Record<string, never>, string>({
  name: 'screen_open',
  description: 'open a screen',
  inputSchema: { type: 'object', properties: {} },
  execute: () => 'opened',
});

const trapGraph = () => {
  const zoneAudit = defineSkill({
    id: 'zone-audit',
    description: 'audit zone redundancy',
    body: 'ZONE AUDIT PROCEDURE',
    tools: [zoneTool],
  });
  const billing = defineSkill({
    id: 'billing',
    description: 'billing questions',
    body: 'BILLING PROCEDURE',
  });
  return skillGraph()
    .entry(zoneAudit, { match: { keywords: ['zone'] } })
    .route(zoneAudit, billing)
    .build();
};

const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});
const final = { content: 'done', toolCalls: [], stopReason: 'stop' as const };

type Ev = Record<string, unknown>;
const capture = () => {
  const evaluated: Ev[] = [];
  const mapEvents: Array<{ name: string; payload: Ev }> = [];
  const recorder = {
    id: 'capture-maps',
    onEmit: (e: { name: string; payload?: Ev }) => {
      if (e.name === 'agentfootprint.context.evaluated') evaluated.push(e.payload ?? {});
      if (e.name.startsWith('agentfootprint.map.'))
        mapEvents.push({ name: e.name, payload: e.payload ?? {} });
    },
  };
  return { evaluated, mapEvents, recorder };
};

const buildTrapAgent = (args: {
  replies: readonly unknown[];
  maps?: boolean;
  reactMode?: 'dynamic-grouped';
}) => {
  const caps = capture();
  let builder = Agent.create({
    provider: mock({ replies: args.replies as never }),
    model: 'mock',
    maxIterations: 8,
    ...(args.reactMode && { reactMode: args.reactMode }),
  })
    .system('s')
    .tool(screenTool)
    .skillGraph(trapGraph());
  if (args.maps !== false) builder = builder.maps({ renewalGrace: 3 });
  const agent = builder.watch(caps.recorder).build();
  return { agent, ...caps };
};

const TRAP_MESSAGE = 'find the most recent zone redundancy run';

const activeIdsAt = (evaluated: Ev[], i: number): readonly string[] =>
  (evaluated[i] as { activeIds: string[] }).activeIds;
const skippedAt = (evaluated: Ev[], i: number): ReadonlyArray<{ id: string; reason: string }> =>
  (evaluated[i] as { skippedDetails: Array<{ id: string; reason: string }> }).skippedDetails;

// ─────────────────────────────────────────────────────────────────────────
// Integration — the recorded failure shape, repaired
// ─────────────────────────────────────────────────────────────────────────

describe('integration: the keyword trap parks after renewalGrace idle passes', () => {
  it('engages on the entry match, parks on pass 4, and says so on every record', async () => {
    const { agent, evaluated, mapEvents } = buildTrapAgent({
      replies: [
        call('c1', 'screen_open'),
        call('c2', 'screen_open'),
        call('c3', 'screen_open'),
        call('c4', 'screen_open'),
        final,
      ],
    });
    await agent.run(TRAP_MESSAGE);

    // Pass 1: the guess is engaged and serving — with its four-character witness.
    expect(activeIdsAt(evaluated, 0)).toContain('zone-audit');
    expect(mapEvents[0]).toMatchObject({
      name: 'agentfootprint.map.engaged',
      payload: { mapId: 'skill-map', by: 'lexical', iteration: 1 },
    });
    expect(String(mapEvents[0]!.payload.witness)).toContain('zone');

    // Passes 2–3: idle counts silently; the contribution still rides.
    expect(activeIdsAt(evaluated, 1)).toContain('zone-audit');
    expect(activeIdsAt(evaluated, 2)).toContain('zone-audit');

    // Pass 4: parked — off the wire, ON the record, cursor untouched.
    expect(activeIdsAt(evaluated, 3)).not.toContain('zone-audit');
    expect(skippedAt(evaluated, 3)).toContainEqual(
      expect.objectContaining({ id: 'zone-audit', reason: 'parked' }),
    );
    const parked = mapEvents.find((e) => e.name === 'agentfootprint.map.parked');
    expect(parked?.payload).toMatchObject({ mapId: 'skill-map', idleCalls: 3, by: 'lexical' });

    // The kernel's state is in the snapshot, cursor still on the map's node.
    const shared = agent.getLastSnapshot()?.sharedState as {
      mapEngagement?: Array<{ standing: string }>;
      currentSkillId?: string;
    };
    expect(shared.mapEngagement?.[0]?.standing).toBe('parked');
    expect(shared.currentSkillId).toBe('zone-audit');
  });

  it('an accepted read_skill pick re-engages the parked map on the same pass it serves', async () => {
    const { agent, evaluated, mapEvents } = buildTrapAgent({
      replies: [
        call('c1', 'screen_open'),
        call('c2', 'screen_open'),
        call('c3', 'screen_open'),
        call('c4', 'read_skill', { id: 'billing' }),
        final,
      ],
    });
    await agent.run(TRAP_MESSAGE);

    // Pass 4 parked it (same timeline as above)…
    expect(skippedAt(evaluated, 3)).toContainEqual(
      expect.objectContaining({ id: 'zone-audit', reason: 'parked' }),
    );
    // …the model asked for billing by name; pass 5 re-engages AND serves it.
    expect(activeIdsAt(evaluated, 4)).toContain('billing');
    const reengaged = mapEvents.find(
      (e) => e.name === 'agentfootprint.map.engaged' && e.payload.reengaged === true,
    );
    expect(reengaged?.payload).toMatchObject({ by: 'explicit', iteration: 5 });
  });

  it("calling the map's own tool renews the lease — no park, ever", async () => {
    const { agent, evaluated, mapEvents } = buildTrapAgent({
      replies: [
        call('c1', 'get_zone_info'),
        call('c2', 'get_zone_info'),
        call('c3', 'get_zone_info'),
        call('c4', 'get_zone_info'),
        final,
      ],
    });
    await agent.run(TRAP_MESSAGE);
    for (let i = 0; i < 5; i++) expect(activeIdsAt(evaluated, i)).toContain('zone-audit');
    expect(mapEvents.filter((e) => e.name === 'agentfootprint.map.parked')).toEqual([]);
  });

  it('the grouped chart threads the same state across its extra boundary', async () => {
    const { agent, evaluated, mapEvents } = buildTrapAgent({
      reactMode: 'dynamic-grouped',
      replies: [
        call('c1', 'screen_open'),
        call('c2', 'screen_open'),
        call('c3', 'screen_open'),
        call('c4', 'screen_open'),
        final,
      ],
    });
    await agent.run(TRAP_MESSAGE);
    expect(skippedAt(evaluated, 3)).toContainEqual(
      expect.objectContaining({ id: 'zone-audit', reason: 'parked' }),
    );
    expect(mapEvents.some((e) => e.name === 'agentfootprint.map.parked')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Security — the kernel refuses to mount over nothing
// ─────────────────────────────────────────────────────────────────────────

describe('security: .maps() without a mounted map is refused at build', () => {
  it('throws the teaching refusal', () => {
    expect(() =>
      Agent.create({ provider: mock({ replies: [final] }), model: 'mock' })
        .system('s')
        .maps()
        .build(),
    ).toThrow(/nothing is mounted that the kernel could manage/);
  });

  it('refuses a renewalGrace that is not a positive integer', () => {
    expect(() =>
      Agent.create({ provider: mock({ replies: [final] }), model: 'mock' }).maps({
        renewalGrace: 0,
      }),
    ).toThrow(/renewalGrace must be an integer >= 1/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression — zero-delta without .maps()
// ─────────────────────────────────────────────────────────────────────────

describe('regression: an agent without .maps() is exactly what it was', () => {
  it('no kernel key, no map events, and the trap rides all 30 calls as before', async () => {
    const { agent, evaluated, mapEvents } = buildTrapAgent({
      maps: false,
      replies: [
        call('c1', 'screen_open'),
        call('c2', 'screen_open'),
        call('c3', 'screen_open'),
        call('c4', 'screen_open'),
        final,
      ],
    });
    await agent.run(TRAP_MESSAGE);
    // The shipped (pre-kernel) behavior: the guess rides every pass.
    for (let i = 0; i < 5; i++) expect(activeIdsAt(evaluated, i)).toContain('zone-audit');
    expect(mapEvents).toEqual([]);
    const shared = agent.getLastSnapshot()?.sharedState as Record<string, unknown>;
    expect('mapEngagement' in shared).toBe(false);
    // And no evaluation ever filed a 'parked' skip.
    for (let i = 0; i < 5; i++) {
      expect(skippedAt(evaluated, i).some((s) => s.reason === 'parked')).toBe(false);
    }
  });
});
