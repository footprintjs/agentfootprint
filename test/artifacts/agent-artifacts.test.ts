/**
 * `ctx.artifacts` through the REAL Agent loop (9.21.0): a tool checks data
 * in and gets a ticket; a later tool redeems it; every hop lands on the
 * typed record via `agent.on('agentfootprint.artifacts.*')` — which also
 * pins the bridge + DomainWildcard wiring (the credential-domain lesson:
 * events with no bridge are a healthy-looking silence).
 *
 * Sections: Functional (mint → resolve on the record) · Integration (scope
 * isolation across sessions; anonymous runs die with their run; no-store
 * teaching refusal) · Regression (zero-delta pins: no store + untouched
 * capability ⇒ no events, no new state).
 */

import { describe, it, expect } from 'vitest';
import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  type ArtifactMeta,
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

describe('functional — mint in one tool, redeem in another, all on the record', () => {
  it('put → head → get across two tools, with origin stamped from the run', async () => {
    const store = inMemoryArtifacts();
    let minted: ArtifactMeta | undefined;
    const rows = [{ q: 'Q3', total: 42 }];

    const storeRows = defineTool({
      name: 'store_rows',
      description: 'fetch + check in the dataset',
      execute: async (_args, ctx) => {
        expect(ctx.hasArtifacts).toBe(true);
        minted = await ctx.artifacts.put({
          kind: 'dataset/rows',
          mediaType: 'application/json',
          data: rows,
          label: 'Q3 rows',
        });
        return `stored ${minted.ref} (${minted.bytes} bytes)`;
      },
    });
    const readRows = defineTool({
      name: 'read_rows',
      description: 'redeem the ticket',
      execute: async (_args, ctx) => {
        const ref = (minted as ArtifactMeta).ref;
        const head = await ctx.artifacts.head(ref); // decide from meta…
        if (head === null) return 'NO DATA';
        const got = await ctx.artifacts.get(ref); // …then pay for bytes
        return `kind=${head.kind} rows=${(got?.data as unknown[]).length}`;
      },
    });

    const agent = Agent.create({
      provider: mock({
        replies: [call('store_rows', 't1'), call('read_rows', 't2'), final('done')] as never,
      }),
      model: 'mock',
      maxIterations: 5,
      artifacts: store,
    })
      .system('s')
      .tool(storeRows)
      .tool(readRows)
      .build();

    const events = artifactCapture(agent);
    const result = await agent.run({ message: 'go' });
    expect(result).toBe('done');
    expect(minted).toBeDefined();

    expect(events.map((e) => e.name)).toEqual([
      'agentfootprint.artifacts.minted',
      'agentfootprint.artifacts.resolved',
      'agentfootprint.artifacts.resolved',
    ]);
    const [mintedEv, headEv, getEv] = events;
    expect(mintedEv.payload).toMatchObject({
      ref: minted?.ref,
      kind: 'dataset/rows',
      mediaType: 'application/json',
      label: 'Q3 rows',
      tool: 'store_rows',
    });
    // origin is the run's OWN facts — stamped by the framework, joined to the
    // trace by toolCallId.
    expect(mintedEv.payload.origin).toMatchObject({ toolCallId: 't1' });
    expect((mintedEv.payload.origin as { runId?: string }).runId).toBeDefined();
    expect(minted?.origin?.toolCallId).toBe('t1');
    expect(headEv.payload).toMatchObject({ via: 'head', ref: minted?.ref, tool: 'read_rows' });
    expect(getEv.payload).toMatchObject({ via: 'get', ref: minted?.ref, tool: 'read_rows' });
    // events carry META only — never the payload bytes
    for (const e of events) {
      expect(JSON.stringify(e.payload)).not.toContain('"total":42');
    }
  });
});

describe('integration — a ref alone opens nothing', () => {
  const buildSessionAgent = (store: ReturnType<typeof inMemoryArtifacts>) => {
    let minted: ArtifactMeta | undefined;
    const storeRows = defineTool({
      name: 'store_rows',
      description: 'mint',
      execute: async (_args, ctx) => {
        minted = await ctx.artifacts.put({
          kind: 'dataset/rows',
          mediaType: 'application/json',
          data: [1, 2, 3],
        });
        return `stored ${minted.ref}`;
      },
    });
    const readRows = defineTool({
      name: 'read_rows',
      description: 'redeem',
      execute: async (_args, ctx) => {
        const got = await ctx.artifacts.get((minted as ArtifactMeta).ref);
        return got === null ? 'NO DATA' : 'RESOLVED';
      },
    });
    const build = (replies: unknown[]) =>
      Agent.create({
        provider: mock({ replies: replies as never }),
        model: 'mock',
        maxIterations: 5,
        artifacts: store,
      })
        .system('s')
        .tool(storeRows)
        .tool(readRows)
        .build();
    return { build, mintedRef: () => minted?.ref };
  };

  it('same ref, different SESSION scope → null, and the record says a resolve found nothing', async () => {
    const store = inMemoryArtifacts();
    const { build } = buildSessionAgent(store);

    // session alpha mints…
    const minter = build([call('store_rows', 't1'), final('ok')]);
    await minter.run({ message: 'mint' }, { sessionId: 'session-alpha' });

    // …session beta cannot redeem the same ref
    const stranger = build([call('read_rows', 't2'), final('ok')]);
    const strangerEvents = artifactCapture(stranger);
    await stranger.run({ message: 'read' }, { sessionId: 'session-beta' });
    expect(strangerEvents.map((e) => e.name)).toEqual(['agentfootprint.artifacts.refused']);
    expect(strangerEvents[0].payload).toMatchObject({
      op: 'get',
      reason: 'missing-or-expired',
      tool: 'read_rows',
    });

    // …and session alpha still can, in a LATER RUN of the same session.
    const owner = build([call('read_rows', 't3'), final('ok')]);
    const ownerEvents = artifactCapture(owner);
    await owner.run({ message: 'read' }, { sessionId: 'session-alpha' });
    expect(ownerEvents.map((e) => e.name)).toEqual(['agentfootprint.artifacts.resolved']);
  });

  it('anonymous runs scope to their own runId — the descriptor table dies with the process', async () => {
    const store = inMemoryArtifacts();
    const { build } = buildSessionAgent(store);
    await build([call('store_rows', 't1'), final('ok')]).run({ message: 'mint' });
    const later = build([call('read_rows', 't2'), final('ok')]);
    const events = artifactCapture(later);
    await later.run({ message: 'read' }); // a DIFFERENT anonymous run
    expect(events[0].payload).toMatchObject({ reason: 'missing-or-expired' });
  });

  it('tenant is part of the tuple: identity-carrying runs isolate per tenant', async () => {
    const store = inMemoryArtifacts();
    const { build } = buildSessionAgent(store);
    const minter = build([call('store_rows', 't1'), final('ok')]);
    await minter.run(
      { message: 'mint' },
      { sessionId: 'shared-conv', identity: { tenant: 'acme', conversationId: 'shared-conv' } },
    );
    const otherTenant = build([call('read_rows', 't2'), final('ok')]);
    const events = artifactCapture(otherTenant);
    await otherTenant.run(
      { message: 'read' },
      { sessionId: 'shared-conv', identity: { tenant: 'globex', conversationId: 'shared-conv' } },
    );
    expect(events[0].payload).toMatchObject({ op: 'get', reason: 'missing-or-expired' });
  });

  it('with NO store: ctx.hasArtifacts is false and every verb is a teaching refusal on the record', async () => {
    const probe = defineTool({
      name: 'probe',
      description: 'tries the store',
      execute: async (_args, ctx) => {
        expect(ctx.hasArtifacts).toBe(false);
        await ctx.artifacts.put({ kind: 'k', mediaType: 't', data: 'x' });
        return 'unreachable';
      },
    });
    const agent = Agent.create({
      provider: mock({ replies: [call('probe', 't1'), final('done')] as never }),
      model: 'mock',
      maxIterations: 4,
    })
      .system('s')
      .tool(probe)
      .build();
    const events = artifactCapture(agent);
    const toolEnds: Record<string, unknown>[] = [];
    agent.on('agentfootprint.stream.tool_end', (e) =>
      toolEnds.push(e.payload as Record<string, unknown>),
    );
    await agent.run({ message: 'go' });
    // the model read the teaching refusal as the tool result
    expect(String(toolEnds[0]?.result)).toContain('Agent.create({ ..., artifacts })');
    // and the record shows the refusal by name
    expect(events.map((e) => e.name)).toEqual(['agentfootprint.artifacts.refused']);
    expect(events[0].payload).toMatchObject({ op: 'put', reason: 'no-store', tool: 'probe' });
  });
});

describe('regression — zero-delta when unused', () => {
  it('no store + a tool that never touches ctx.artifacts ⇒ ZERO artifact events, result as before', async () => {
    const plain = defineTool({
      name: 'plain',
      description: 'no artifacts anywhere',
      execute: () => 'plain result',
    });
    const agent = Agent.create({
      provider: mock({ replies: [call('plain', 't1'), final('done')] as never }),
      model: 'mock',
      maxIterations: 4,
    })
      .system('s')
      .tool(plain)
      .build();
    const artifactEvents = artifactCapture(agent);
    const allEvents: string[] = [];
    agent.on('*', (e) => allEvents.push(e.type));
    const result = await agent.run({ message: 'go' });
    expect(result).toBe('done');
    expect(artifactEvents).toEqual([]);
    expect(allEvents.some((t) => t.startsWith('agentfootprint.artifacts.'))).toBe(false);
    // and the snapshot grew no artifact-flavored state
    const state = agent.getSnapshot()?.sharedState as Record<string, unknown>;
    expect(Object.keys(state).some((k) => k.toLowerCase().includes('artifact'))).toBe(false);
  });

  it('a store ATTACHED but never used ⇒ still zero artifact events', async () => {
    const plain = defineTool({ name: 'plain', description: 'x', execute: () => 'ok' });
    const agent = Agent.create({
      provider: mock({ replies: [call('plain', 't1'), final('done')] as never }),
      model: 'mock',
      maxIterations: 4,
      artifacts: inMemoryArtifacts(),
    })
      .system('s')
      .tool(plain)
      .build();
    const events = artifactCapture(agent);
    await agent.run({ message: 'go' });
    expect(events).toEqual([]);
  });
});
