/**
 * A PARKED MAP MUST SAY SO ON THE WIRE — and its tools must actually leave.
 *
 * ── The defect ──────────────────────────────────────────────────────────
 * Every honesty signal about parking landed on the RECORD: the `'parked'`
 * skip reason, the `agentfootprint.map.parked` event. The model reads none of
 * them. So even though re-engagement was reachable, the model had to GUESS
 * that re-picking a skill it appears to already be in means something. A door
 * the model cannot see is not a door.
 *
 * And on the DEFAULT posture the wire did not merely stay silent — it said the
 * opposite. `.maps()` documents that parking stops "the prompt fragment AND
 * tools". With `scopeTools` false (the default for flat graphs until 10.0.0) a
 * skill's tools are pre-loaded into the STATIC registry and ride from
 * iteration 1 whatever the cursor says, so only the fragment stopped. The
 * model was shown a parked skill's tools, invited to call them, while that
 * skill's instructions had silently vanished and nothing anywhere explained
 * either fact.
 *
 * ── What is pinned here ─────────────────────────────────────────────────
 * 1. The park card reaches the SYSTEM PROMPT, naming cursor and engagement as
 *    SEPARATE fields, the reason, and the way back.
 * 2. The parked map's tools are GONE from `req.tools` — on the default
 *    posture, which is the case that was broken.
 * 3. Nothing of the sort appears while the map is engaged, and an agent
 *    without `.maps()` is untouched.
 * 4. The model can act on what it is told: it re-picks a member and the map
 *    comes back, tools and all.
 *
 * Test types: integration (the wire) / regression (zero-delta when unmounted).
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../src/index.js';
import { defineSkill, skillGraph } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';
import type { LLMRequest } from '../../src/adapters/types.js';

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
  return skillGraph().entry(zoneAudit, { match: { keywords: ['zone'] } }).route(zoneAudit, billing).build();
};

const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});
const final = { content: 'done', toolCalls: [], stopReason: 'stop' as const };
const TRAP = 'find the most recent zone redundancy run';

/**
 * One iteration's wire, snapshotted at the moment it was sent.
 *
 * SNAPSHOTTED, not referenced: the framework reuses and mutates the
 * `LLMRequest` object across iterations, so holding the reference and reading
 * `.tools` after the run reports the LAST call's tools for every entry — which
 * looks exactly like "the feature never worked".
 */
interface WireCall {
  readonly toolNames: readonly string[];
  readonly systemPrompt: string;
}

/** Build the trap agent, capturing the exact request each iteration sent. */
const buildWireAgent = (replies: readonly unknown[], opts: { maps?: boolean } = {}) => {
  const wire: WireCall[] = [];
  const script = [...replies];
  let i = 0;
  let builder = Agent.create({
    provider: mock({
      respond: (req: LLMRequest) => {
        wire.push({
          toolNames: (req.tools ?? []).map((t) => t.name),
          systemPrompt: req.systemPrompt ?? '',
        });
        const next = script[i++] ?? final;
        return next as never;
      },
    }),
    model: 'mock',
    maxIterations: 8,
  })
    .system('s')
    .tool(screenTool)
    .skillGraph(trapGraph());
  // NOTE: no `scopeTools` anywhere — this is the DEFAULT posture, the one the
  // documentation's promise was false on.
  if (opts.maps !== false) builder = builder.maps({ renewalGrace: 3 });
  return { agent: builder.build(), wire };
};

const toolNamesAt = (wire: readonly WireCall[], i: number): readonly string[] =>
  wire[i]?.toolNames ?? [];
const systemAt = (wire: readonly WireCall[], i: number): string => wire[i]?.systemPrompt ?? '';

describe('the wire says PARKED, and separates cursor from engagement', () => {
  it('the park card reaches the system prompt with reason and the way back', async () => {
    const { agent, wire } = buildWireAgent([
      call('c1', 'screen_open'),
      call('c2', 'screen_open'),
      call('c3', 'screen_open'),
      call('c4', 'screen_open'),
      final,
    ]);
    await agent.run(TRAP);

    // Passes 1–3: engaged. Nothing about parking anywhere on the wire.
    for (const i of [0, 1, 2]) {
      expect(systemAt(wire, i)).toContain('ZONE AUDIT PROCEDURE');
      expect(systemAt(wire, i)).not.toContain('PARKED');
    }

    // Pass 4: parked. The fragment is gone AND the model is told why.
    const parkedPrompt = systemAt(wire, 3);
    expect(parkedPrompt).not.toContain('ZONE AUDIT PROCEDURE');

    // CURSOR and ENGAGEMENT as separate, named fields — the teaching move.
    expect(parkedPrompt).toContain('cursor: zone-audit');
    expect(parkedPrompt).toContain('(unchanged)');
    expect(parkedPrompt).toContain('engagement: PARKED');
    // A reason, so the state is not arbitrary.
    expect(parkedPrompt).toMatch(/reason: [a-z]/);
    // The way back, named as a concrete call the model can make…
    expect(parkedPrompt).toContain('re-engage: available');
    expect(parkedPrompt).toContain('read_skill');
    expect(parkedPrompt).toContain('zone-audit, billing');
    // …and the one sentence that stops it reading as a cursor move.
    expect(parkedPrompt).toContain('not POSITION');
  });

  it('the parked map’s TOOLS leave the wire — on the DEFAULT scopeTools posture', async () => {
    const { agent, wire } = buildWireAgent([
      call('c1', 'screen_open'),
      call('c2', 'screen_open'),
      call('c3', 'screen_open'),
      call('c4', 'screen_open'),
      final,
    ]);
    await agent.run(TRAP);

    // While engaged, the map's tool is offered — that is the whole point of it.
    expect(toolNamesAt(wire, 0)).toContain('get_zone_info');

    // Parked: gone. This is the assertion that was false before 9.59.0 — the
    // schema kept riding, so the model was shown tools for a skill whose
    // instructions had just disappeared.
    expect(toolNamesAt(wire, 3)).not.toContain('get_zone_info');

    // And nothing else was collateral damage: the agent-level tool stays.
    expect(toolNamesAt(wire, 3)).toContain('screen_open');
  });

  it('the model can act on the card: a re-pick brings the map back, tools and all', async () => {
    const { agent, wire } = buildWireAgent([
      call('c1', 'screen_open'),
      call('c2', 'screen_open'),
      call('c3', 'screen_open'),
      // Pass 4 is where the card first appears. The model does what it says.
      call('c4', 'read_skill', { id: 'zone-audit' }),
      final,
    ]);
    await agent.run(TRAP);

    expect(systemAt(wire, 3)).toContain('engagement: PARKED');
    // Pass 5: re-engaged. Fragment back, tool back, card gone.
    expect(systemAt(wire, 4)).toContain('ZONE AUDIT PROCEDURE');
    expect(systemAt(wire, 4)).not.toContain('engagement: PARKED');
    expect(toolNamesAt(wire, 4)).toContain('get_zone_info');
  });
});

describe('regression: nothing changes for an agent without the kernel', () => {
  it('no card, and the map’s tools ride every call, exactly as before', async () => {
    const { agent, wire } = buildWireAgent(
      [
        call('c1', 'screen_open'),
        call('c2', 'screen_open'),
        call('c3', 'screen_open'),
        call('c4', 'screen_open'),
        final,
      ],
      { maps: false },
    );
    await agent.run(TRAP);
    for (let i = 0; i < 4; i++) {
      expect(systemAt(wire, i)).not.toContain('PARKED');
      expect(systemAt(wire, i)).not.toContain('Map status');
      expect(toolNamesAt(wire, i)).toContain('get_zone_info');
    }
  });
});
