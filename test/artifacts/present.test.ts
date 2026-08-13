/**
 * The `present` tool (9.22.0, Leg 2): auto-attached ONLY when a store is
 * attached (the read_skill seam), it `head`s the ref under the run's scope
 * and its RESULT carries the description snapshot `{kind, mediaType, bytes,
 * label}` — the claim ticket describes the parcel, so an expired artifact
 * still renders an honest placeholder from history. Emits the typed
 * `agentfootprint.artifacts.presented`.
 *
 * Sections: Functional (snapshot in result + presented event) · Refusals
 * (miss lists live refs; error:true) · Integration (name reservation; label
 * precedence) · Regression (no store ⇒ no tool, no reservation — zero-delta).
 */

import { describe, it, expect } from 'vitest';
import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  PRESENT_TOOL_NAME,
  type AgentfootprintEvent,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';

const call = (name: string, id: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});
const final = (content: string) => ({ content, toolCalls: [], stopReason: 'stop' as const });

type Caught = { name: string; payload: Record<string, unknown> };
const artifactCapture = (agent: Agent) => {
  const events: Caught[] = [];
  agent.on('agentfootprint.artifacts.*', (e: AgentfootprintEvent) => {
    events.push({ name: e.type, payload: e.payload as Record<string, unknown> });
  });
  return events;
};

const mintChart = defineTool({
  name: 'mint_chart',
  description: 'store chart data',
  execute: async (_args, ctx) => {
    const meta = await ctx.artifacts.put({
      kind: 'chart/spec',
      mediaType: 'application/json',
      data: { bars: [1, 2, 3] },
      label: 'Q3 sales by region',
    });
    return meta.ref;
  },
});

describe('functional — the snapshot lives inside the tool result, and on the record', () => {
  it('present({ref, as}) returns {presented, ref, as, snapshot} and emits artifacts.presented', async () => {
    const store = inMemoryArtifacts();
    let ref = '';
    const seeder = Agent.create({
      provider: mock({ replies: [call('mint_chart', 's1'), final('ok')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts: store,
    })
      .system('s')
      .tool(mintChart)
      .build();
    seeder.on('agentfootprint.artifacts.minted', (e) => {
      ref = (e.payload as { ref: string }).ref;
    });
    await seeder.run({ message: 'mint' }, { sessionId: 'viz' });

    const agent = Agent.create({
      provider: mock({
        replies: [call(PRESENT_TOOL_NAME, 't1', { ref, as: 'bar-chart' }), final('done')] as never,
      }),
      model: 'mock',
      maxIterations: 3,
      artifacts: store,
    })
      .system('s')
      .build();
    const events = artifactCapture(agent);
    const ends: Record<string, unknown>[] = [];
    agent.on('agentfootprint.stream.tool_end', (e) =>
      ends.push(e.payload as Record<string, unknown>),
    );
    const result = await agent.run({ message: 'show it' }, { sessionId: 'viz' });
    expect(result).toBe('done');

    // The RESULT is the one durable carrier: JSON with the snapshot inside.
    const parsed = JSON.parse(String(ends[0].result)) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      presented: true,
      ref,
      as: 'bar-chart',
      snapshot: {
        kind: 'chart/spec',
        mediaType: 'application/json',
        label: 'Q3 sales by region',
      },
    });
    expect((parsed.snapshot as { bytes: number }).bytes).toBeGreaterThan(0);
    expect(ends[0].error).toBeUndefined();

    // The record: resolved via head (never get — the screen pays later),
    // then the typed presented event.
    expect(events.map((e) => e.name)).toEqual([
      'agentfootprint.artifacts.resolved',
      'agentfootprint.artifacts.presented',
    ]);
    expect(events[0].payload).toMatchObject({ ref, via: 'head', tool: PRESENT_TOOL_NAME });
    expect(events[1].payload).toMatchObject({
      ref,
      as: 'bar-chart',
      snapshot: { kind: 'chart/spec' },
      toolCallId: 't1',
    });
    // Payload bytes never enter an event.
    for (const e of events) {
      expect(JSON.stringify(e.payload)).not.toContain('bars');
    }
  });

  it("the call's label wins over the mint's on the snapshot", async () => {
    const store = inMemoryArtifacts();
    let ref = '';
    const seeder = Agent.create({
      provider: mock({ replies: [call('mint_chart', 's1'), final('ok')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts: store,
    })
      .system('s')
      .tool(mintChart)
      .build();
    seeder.on('agentfootprint.artifacts.minted', (e) => {
      ref = (e.payload as { ref: string }).ref;
    });
    await seeder.run({ message: 'mint' }, { sessionId: 'label' });

    const agent = Agent.create({
      provider: mock({
        replies: [
          call(PRESENT_TOOL_NAME, 't1', { ref, as: 'table', label: 'Renamed for the board' }),
          final('done'),
        ] as never,
      }),
      model: 'mock',
      maxIterations: 3,
      artifacts: store,
    })
      .system('s')
      .build();
    const events = artifactCapture(agent);
    await agent.run({ message: 'show' }, { sessionId: 'label' });
    const presented = events.find((e) => e.name === 'agentfootprint.artifacts.presented');
    expect((presented?.payload.snapshot as { label: string }).label).toBe('Renamed for the board');
  });
});

describe('refusals — a miss teaches, in place, and errors the call', () => {
  it('unknown ref: teaching refusal listing live refs, artifacts.refused op dispatch, error:true', async () => {
    const store = inMemoryArtifacts();
    let liveRef = '';
    const seeder = Agent.create({
      provider: mock({ replies: [call('mint_chart', 's1'), final('ok')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts: store,
    })
      .system('s')
      .tool(mintChart)
      .build();
    seeder.on('agentfootprint.artifacts.minted', (e) => {
      liveRef = (e.payload as { ref: string }).ref;
    });
    await seeder.run({ message: 'mint' }, { sessionId: 'miss' });

    const agent = Agent.create({
      provider: mock({
        replies: [
          call(PRESENT_TOOL_NAME, 't1', { ref: 'art_Gone00000000000000000', as: 'bar-chart' }),
          final('done'),
        ] as never,
      }),
      model: 'mock',
      maxIterations: 3,
      artifacts: store,
    })
      .system('s')
      .build();
    const events = artifactCapture(agent);
    const ends: Record<string, unknown>[] = [];
    agent.on('agentfootprint.stream.tool_end', (e) =>
      ends.push(e.payload as Record<string, unknown>),
    );
    await agent.run({ message: 'show' }, { sessionId: 'miss' });

    const text = String(ends[0].result);
    expect(text).toContain('found nothing under that ref');
    expect(text).toContain('Nothing was presented');
    expect(text).toContain(liveRef); // the correcting listing
    expect(ends[0].error).toBe(true);
    const refused = events.filter((e) => e.name === 'agentfootprint.artifacts.refused');
    expect(refused).toHaveLength(1);
    expect(refused[0].payload).toMatchObject({
      op: 'dispatch',
      reason: 'missing-or-expired',
      ref: 'art_Gone00000000000000000',
      tool: PRESENT_TOOL_NAME,
    });
    // No presented event for a presentation that did not happen.
    expect(events.some((e) => e.name === 'agentfootprint.artifacts.presented')).toBe(false);
  });
});

describe('integration — the name is reserved exactly when the framework attaches it', () => {
  it('a consumer tool named present + a store = refused at build, by name', () => {
    const impostor = defineTool({
      name: PRESENT_TOOL_NAME,
      description: 'my own present',
      execute: () => 'x',
    });
    expect(() =>
      Agent.create({
        provider: mock({ replies: [final('x')] as never }),
        model: 'mock',
        artifacts: inMemoryArtifacts(),
      })
        .system('s')
        .tool(impostor)
        .build(),
    ).toThrowError(/'present' is reserved when an artifact store is attached/);
  });
});

describe('regression — zero-cost without a store', () => {
  it('no store: no present tool exists (unknown-tool path), no reservation, no artifact events', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          call(PRESENT_TOOL_NAME, 't1', { ref: 'art_x', as: 'table' }),
          final('done'),
        ] as never,
      }),
      model: 'mock',
      maxIterations: 3,
    })
      .system('s')
      .build();
    const events = artifactCapture(agent);
    const ends: Record<string, unknown>[] = [];
    agent.on('agentfootprint.stream.tool_end', (e) =>
      ends.push(e.payload as Record<string, unknown>),
    );
    await agent.run({ message: 'show' });
    expect(String(ends[0].result)).toContain('Unknown tool');
    expect(events).toHaveLength(0);
  });

  it('no store: a consumer may keep its OWN present — nobody reserves the name', async () => {
    const mine = defineTool({
      name: PRESENT_TOOL_NAME,
      description: 'consumer-owned present',
      execute: () => 'mine ran',
    });
    const agent = Agent.create({
      provider: mock({ replies: [call(PRESENT_TOOL_NAME, 't1'), final('done')] as never }),
      model: 'mock',
      maxIterations: 3,
    })
      .system('s')
      .tool(mine)
      .build();
    const ends: Record<string, unknown>[] = [];
    agent.on('agentfootprint.stream.tool_end', (e) =>
      ends.push(e.payload as Record<string, unknown>),
    );
    await agent.run({ message: 'go' });
    expect(String(ends[0].result)).toBe('mine ran');
  });
});
