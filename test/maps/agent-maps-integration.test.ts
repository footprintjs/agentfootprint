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
import { PermissionPolicy } from '../../src/security/PermissionPolicy.js';
import type { PermissionChecker, PermissionRequest } from '../../src/adapters/types.js';

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
  nonParkable?: boolean;
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
  if (args.maps !== false)
    builder = builder.maps({
      renewalGrace: 3,
      ...(args.nonParkable === true && { nonParkable: true }),
    });
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

  it('a SELF-CALL at a parked cursor re-engages — it does not get the self-call notice', async () => {
    // 9.84.0 ordering. The self-call arm sits between re-engagement and
    // reachability on purpose: the cursor never left `zone-audit`, so picking it
    // back IS the re-engagement door, and re-engaging beats telling the model
    // about tools the park has just taken off the wire.
    const toolResults: string[] = [];
    const caps = capture();
    const agent = Agent.create({
      provider: mock({
        replies: [
          call('c1', 'screen_open'),
          call('c2', 'screen_open'),
          call('c3', 'screen_open'),
          call('c4', 'read_skill', { id: 'zone-audit' }),
          final,
        ] as never,
      }),
      model: 'mock',
      maxIterations: 8,
    })
      .system('s')
      .tool(screenTool)
      .skillGraph(trapGraph())
      .maps({ renewalGrace: 3 })
      .watch({
        id: 'results',
        onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
          if (e.name === 'agentfootprint.stream.tool_end')
            toolResults.push(String(e.payload?.result ?? ''));
        },
      })
      .watch(caps.recorder)
      .build();
    await agent.run(TRAP_MESSAGE);

    const reengaged = caps.mapEvents.find(
      (e) => e.name === 'agentfootprint.map.engaged' && e.payload.reengaged === true,
    );
    expect(reengaged?.payload).toMatchObject({ by: 'explicit' });
    // The pick was ADMITTED, so neither refusal sentence was ever composed.
    // (Guard against a vacuous pass: the read_skill result really was captured.)
    expect(toolResults.join('\n')).toContain("Skill 'zone-audit' activated");
    expect(toolResults.join('\n')).not.toContain('You are already in');
    expect(toolResults.join('\n')).not.toContain('is not reachable from here');
  });

  /**
   * SECURITY — the self-call skip is scoped to a MOUNTED cursor (9.86.0 fix pass).
   *
   * 9.86.0 stopped asking `skill_read` whenever the requested id was the
   * cursor's own, on the argument that a stay activates nothing, moves nothing
   * and reveals nothing the request did not already carry. That is true of a
   * MOUNTED cursor and false of a PARKED one: parking suppresses the map's
   * contribution and leaves the cursor where it was, so the gate below reads
   * the same id as a RE-ENGAGEMENT and puts the body and its tools back on the
   * wire. Skipping the check there let a role whose policy hides the skill
   * un-park and re-activate it — a call 9.85.0 denied.
   */
  async function parkedSelfCallUnder(visible: readonly string[]) {
    const asked: string[] = [];
    const toolResults: string[] = [];
    const caps = capture();
    const policy = PermissionPolicy.fromRoles(
      { support: ['read_skill', 'screen_open', 'get_zone_info'] },
      'support',
      { skills: { support: [...visible] } },
    );
    const spy: PermissionChecker = {
      name: 'spy',
      ...(policy.governs !== undefined && { governs: policy.governs }),
      check: (req: PermissionRequest) => {
        if (req.capability === 'skill_read') asked.push(req.target);
        return policy.check(req);
      },
    };
    const agent = Agent.create({
      provider: mock({
        replies: [
          call('c1', 'screen_open'),
          call('c2', 'screen_open'),
          call('c3', 'screen_open'),
          call('c4', 'read_skill', { id: 'zone-audit' }),
          final,
        ] as never,
      }),
      model: 'mock',
      maxIterations: 8,
      permissionChecker: spy,
    })
      .system('s')
      .tool(screenTool)
      .skillGraph(trapGraph())
      .maps({ renewalGrace: 3 })
      .watch({
        id: 'results',
        onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
          if (e.name === 'agentfootprint.stream.tool_end')
            toolResults.push(String(e.payload?.result ?? ''));
        },
      })
      .watch(caps.recorder)
      .build();
    await agent.run(TRAP_MESSAGE);
    const reengaged = caps.mapEvents.find(
      (e) => e.name === 'agentfootprint.map.engaged' && e.payload.reengaged === true,
    );
    return { asked, results: toolResults.join('\n'), reengaged, evaluated: caps.evaluated };
  }

  it('a role that may not read the PARKED cursor is refused — re-engagement is a capability, not a no-op', async () => {
    const { asked, results, reengaged, evaluated } = await parkedSelfCallUnder(['billing']);
    // The premise: the map really did park before the pick.
    expect(skippedAt(evaluated, 3)).toContainEqual(
      expect.objectContaining({ id: 'zone-audit', reason: 'parked' }),
    );
    // The dispatch of read_skill was put to the policy, not skipped past it.
    expect(asked).toContain('skill:zone-audit');
    // …and the policy's answer stood: nothing re-engaged, nothing activated.
    expect(results).not.toContain("Skill 'zone-audit' activated");
    expect(results).toContain("Skill 'zone-audit' is not available");
    expect(reengaged).toBeUndefined();
  });

  it('the same call under a role that MAY read it still re-engages — the gate asks, it does not refuse', async () => {
    // Guard against a fix that simply stopped admitting parked members.
    const { asked, results, reengaged } = await parkedSelfCallUnder(['zone-audit', 'billing']);
    expect(asked).toContain('skill:zone-audit');
    expect(results).toContain("Skill 'zone-audit' activated");
    expect(reengaged?.payload).toMatchObject({ by: 'explicit' });
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

  it('refuses a graph that cannot explain its cursor moves', () => {
    // (c) — a hand-written structurally-typed graph with nodes and no
    // `explainNextSkill`. The kernel judges an engagement by WHY the cursor is
    // where it is; with no clause every pass reads "nobody said why" and the
    // kernel is a timer over a fact it never learns. Before the `assumed` rung
    // this failed the OTHER way and silently: an absent clause was written
    // down as `structural`, the strongest non-decaying category, so such a
    // graph could never park anything at all — no event, no warning.
    const mute = {
      skills: [defineSkill({ id: 'a', description: 'a', body: 'A' })],
      nodes: [{ id: 'a' }],
      nextSkill: () => 'a',
      // explainNextSkill: deliberately absent
    };
    expect(() =>
      Agent.create({ provider: mock({ replies: [final] }), model: 'mock' })
        .system('s')
        .skillGraph(mute as never)
        .maps()
        .build(),
    ).toThrow(/cannot explain its cursor moves/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (h) nonParkable — documented as shipped, and unreachable until 9.59.0
// ─────────────────────────────────────────────────────────────────────────

describe('a MANDATORY map never parks, however long the turn ignores it', () => {
  it('.maps({ nonParkable: true }) reaches the kernel and suppresses the park', async () => {
    const { agent, evaluated, mapEvents } = buildTrapAgent({
      nonParkable: true,
      replies: [
        call('c1', 'screen_open'),
        call('c2', 'screen_open'),
        call('c3', 'screen_open'),
        call('c4', 'screen_open'),
        final,
      ],
    });
    await agent.run(TRAP_MESSAGE);
    // Same timeline that parks on pass 4 without the flag — and it does not.
    for (let i = 0; i < 5; i++) expect(activeIdsAt(evaluated, i)).toContain('zone-audit');
    expect(mapEvents.filter((e) => e.name === 'agentfootprint.map.parked')).toEqual([]);

    // It suppresses the PARK, not the MEASUREMENT: the record still shows a
    // map riding every call unused, which is the honest half of the bargain.
    const shared = agent.getLastSnapshot()?.sharedState as {
      mapEngagement?: Array<{ standing: string; idle: number; by: string }>;
    };
    expect(shared.mapEngagement?.[0]?.standing).toBe('engaged');
    expect(shared.mapEngagement?.[0]?.idle).toBeGreaterThanOrEqual(3);
    expect(shared.mapEngagement?.[0]?.by).toBe('lexical');
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
