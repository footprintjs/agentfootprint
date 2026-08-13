/**
 * Artifact resolution over the wire (9.23.0) — the hosting leg of
 * render-by-ref, pinned over a REAL socket.
 *
 * The laws being pinned:
 *   • THE CRITICAL PIN — cross-session isolation over the wire: session B
 *     asking for session A's ref gets the SAME not-found shape as a ref that
 *     never existed — same status, same code, same words (modulo the ref
 *     itself). A distinguishable error would let a caller probe scopes it
 *     does not own.
 *   • Scope parity: a ref is redeemed under EXACTLY the scope the run's tools
 *     minted it in — the session rung for a plain served session, the
 *     identity-composed rung (`principal` from the transport's userId) on a
 *     wire that carries one. Same session + wrong identity ⇒ the same
 *     not-found.
 *   • An op-carrying body NEVER becomes a model turn — not for the two known
 *     ops, and not for a typo'd one (that is the accepted-and-silently-wrong
 *     failure; it refuses by name instead).
 *   • Zero-cost / teaching refusal: no store ⇒ ERR_NO_ARTIFACT_STORE naming
 *     the attach (`Agent.create({ artifacts })`), 501, and an
 *     `artifacts.refused` fact (`no-store`) on the record.
 *   • Events: a wire redemption rides the EXISTING artifacts.resolved /
 *     artifacts.refused, exactly once per fact (the raw store emits nothing;
 *     the capability binding is the one emitter), with NO `tool` field — the
 *     redeemer was the hosting door, not a tool.
 *   • The expired pane: an expired ref answers the same not-found, so the
 *     screen renders its stated absence from the present snapshot.
 *   • A session awaiting a decision still redeems — history reload re-draws
 *     panes while a question is outstanding.
 *   • A host without `reply.artifact` answers the named not-carried refusal,
 *     never silence.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Agent, defineTool, inMemoryArtifacts } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { askHuman } from '../../src/core/pause.js';
import type { AgentfootprintEvent } from '../../src/index.js';
import type { ArtifactMeta } from '../../src/index.js';
import {
  headerValue,
  httpHost,
  jsonWireWith,
  memorySessions,
  nodeHost,
  standingAgent,
} from '../../src/hosting/index.js';
import type { HostHandle, HttpWire } from '../../src/hosting/index.js';
import { inProcessHost } from './testHost.js';

// ─── Helpers ─────────────────────────────────────────────────────────

const call = (name: string, id: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});
const final = (content: string) => ({ content, toolCalls: [], stopReason: 'stop' as const });

/** POST one JSON body to the invoke path; return status + parsed body. */
async function post(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${url}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/**
 * An agent whose one tool mints a dataset through `ctx.artifacts` — the same
 * door every run's tools use — and hands the meta out through a closure.
 * `mintedPerCall` collects one meta per turn served, in order.
 */
function mintingAgent(store: ReturnType<typeof inMemoryArtifacts>, replies: number) {
  const minted: ArtifactMeta[] = [];
  let llmCalls = 0;
  const rows = [{ q: 'Q3', total: 42 }];
  const storeRows = defineTool({
    name: 'store_rows',
    description: 'mint the dataset',
    execute: async (_args, ctx) => {
      const meta = await ctx.artifacts.put({
        kind: 'dataset/rows',
        mediaType: 'application/json',
        data: rows,
        label: 'Q3 rows',
      });
      minted.push(meta);
      return `stored ${meta.ref}`;
    },
  });
  const script: unknown[] = [];
  for (let i = 0; i < replies; i++) script.push(call('store_rows', `t${i}`), final('stored'));
  const provider = mock({ replies: script as never });
  const counting = {
    name: 'counting',
    complete: (req: never) => {
      llmCalls += 1;
      return (provider as unknown as { complete: (r: never) => unknown }).complete(req);
    },
  };
  const agent = Agent.create({
    provider: counting as never,
    model: 'mock',
    maxIterations: 4,
    artifacts: store,
  })
    .system('s')
    .tool(storeRows)
    .build();
  return { agent, minted, rows, llmCalls: () => llmCalls };
}

const capture = (agent: Agent) => {
  const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
  agent.on('agentfootprint.artifacts.*', (e: AgentfootprintEvent) => {
    events.push({ name: e.type, payload: e.payload as Record<string, unknown> });
  });
  return events;
};

const handles: HostHandle[] = [];
afterEach(async () => {
  await Promise.allSettled(handles.map((h) => h.close()));
  handles.length = 0;
});

async function serveMinting(replies = 2) {
  const store = inMemoryArtifacts();
  const built = mintingAgent(store, replies);
  const handle = await standingAgent({
    agent: built.agent,
    sessions: memorySessions(),
    host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
  });
  handles.push(handle);
  return { ...built, store, url: handle.url };
}

// ─── Integration — redeem the ticket the session's own run minted ───

describe('integration — head then get, over HTTP, under the session scope', () => {
  it('artifact-head answers meta; artifact-get adds data; the model is never consulted', async () => {
    const served = await serveMinting(1);
    const turn = await post(served.url, { input: 'go', sessionId: 's-a' });
    expect(turn.status).toBe(200);
    expect(served.minted).toHaveLength(1);
    const ref = served.minted[0].ref;
    const llmCallsAfterTurn = served.llmCalls();

    const head = await post(served.url, { op: 'artifact-head', ref, sessionId: 's-a' });
    expect(head.status).toBe(200);
    const headArtifact = head.body.artifact as Record<string, unknown>;
    expect(headArtifact.ref).toBe(ref);
    expect(headArtifact.meta).toMatchObject({
      ref,
      kind: 'dataset/rows',
      mediaType: 'application/json',
      label: 'Q3 rows',
    });
    // head is the render decision: meta only, never the payload.
    expect('data' in headArtifact).toBe(false);
    expect(JSON.stringify(head.body)).not.toContain('"total":42');

    const got = await post(served.url, { op: 'artifact-get', ref, sessionId: 's-a' });
    expect(got.status).toBe(200);
    const gotArtifact = got.body.artifact as Record<string, unknown>;
    expect(gotArtifact.meta).toMatchObject({ ref, kind: 'dataset/rows' });
    expect(gotArtifact.data).toEqual(served.rows);

    // A redemption is not a turn: the two ops consumed no model call.
    expect(served.llmCalls()).toBe(llmCallsAfterTurn);
  });

  it('the session rides the header exactly as a conversation request does', async () => {
    const served = await serveMinting(1);
    await post(served.url, { input: 'go' }, { 'x-session-id': 's-h' });
    const ref = served.minted[0].ref;
    const viaHeader = await post(
      served.url,
      { op: 'artifact-head', ref },
      { 'x-session-id': 's-h' },
    );
    expect(viaHeader.status).toBe(200);
  });

  it('a session awaiting a decision still redeems — panes re-draw while a question is outstanding', async () => {
    const store = inMemoryArtifacts();
    const pauser = defineTool({
      name: 'ask',
      description: 'asks',
      execute: async () => askHuman('approve?'),
    });
    const agent = Agent.create({
      provider: mock({ replies: [call('ask', 't1'), final('done')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts: store,
    })
      .system('s')
      .tool(pauser)
      .build();
    const handle = await standingAgent({
      agent,
      sessions: memorySessions(),
      host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
    });
    handles.push(handle);

    // Seed a ticket under the session's scope, then pause the run.
    const put = await store.put(
      { conversationId: 's-p' },
      { kind: 'chart/spec', mediaType: 'application/json', data: { bars: [1] } },
    );
    const paused = await post(handle.url, { input: 'go', sessionId: 's-p' });
    expect(paused.status).toBe(202);

    const head = await post(handle.url, {
      op: 'artifact-head',
      ref: put.meta.ref,
      sessionId: 's-p',
    });
    expect(head.status).toBe(200);
    expect((head.body.artifact as { meta: ArtifactMeta }).meta.kind).toBe('chart/spec');
  });
});

// ─── Security — THE CRITICAL PIN ─────────────────────────────────────

describe('security — cross-session isolation over the wire', () => {
  it("another session's ref and a never-minted ref answer the SAME not-found shape", async () => {
    const served = await serveMinting(1);
    await post(served.url, { input: 'go', sessionId: 's-a' });
    const ref = served.minted[0].ref;

    // Session A resolves its own ref — the control.
    const own = await post(served.url, { op: 'artifact-get', ref, sessionId: 's-a' });
    expect(own.status).toBe(200);

    // Session B presenting A's ref, and session B presenting garbage.
    const foreign = await post(served.url, { op: 'artifact-get', ref, sessionId: 's-b' });
    const missing = await post(served.url, {
      op: 'artifact-get',
      ref: 'art_neverWasMintedAnywhere',
      sessionId: 's-b',
    });

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body.code).toBe('ERR_ARTIFACT_NOT_FOUND');
    expect(missing.body.code).toBe('ERR_ARTIFACT_NOT_FOUND');
    // Byte-identical but for the ref itself: substitute the refs and the two
    // refusals must be the same words. Anything distinguishable would let a
    // caller probe scopes it does not own.
    const normalize = (body: Record<string, unknown>, r: string): string =>
      JSON.stringify(body).split(r).join('<REF>');
    expect(normalize(foreign.body, ref)).toBe(
      normalize(missing.body, 'art_neverWasMintedAnywhere'),
    );

    // …and both ride the same wire shape as any head miss.
    const foreignHead = await post(served.url, { op: 'artifact-head', ref, sessionId: 's-b' });
    expect(foreignHead.status).toBe(404);
    expect(foreignHead.body.code).toBe('ERR_ARTIFACT_NOT_FOUND');
  });

  it('identity-composed scope: the wire redeems under exactly the tuple the run minted in', async () => {
    // A dialect that carries WHO — the managed-runtime shape — built on the
    // same shipped wire, reading userId from a header.
    const base = jsonWireWith();
    const userWire: HttpWire = {
      ...base,
      readRequest(facts) {
        const read = base.readRequest(facts);
        const userId = headerValue(facts, 'x-user-id');
        return { ...read, ...(userId !== undefined && { userId }) };
      },
    };
    const store = inMemoryArtifacts();
    const built = mintingAgent(store, 1);
    const handle = await standingAgent({
      agent: built.agent,
      sessions: memorySessions(),
      host: httpHost({
        name: 'userWireHost',
        wire: userWire,
        invokePath: '/invoke',
        healthPath: '/health',
        port: 0,
        hostname: '127.0.0.1',
      }),
    });
    handles.push(handle);

    // The run is served FOR u1: its tools minted under { s-u, principal: u1 }.
    await post(handle.url, { input: 'go', sessionId: 's-u' }, { 'x-user-id': 'u1' });
    const ref = built.minted[0].ref;

    // The same identity redeems; the same session WITHOUT it does not; a
    // different user does not — and both misses are the one not-found.
    const sameIdentity = await post(
      handle.url,
      { op: 'artifact-get', ref, sessionId: 's-u' },
      { 'x-user-id': 'u1' },
    );
    expect(sameIdentity.status).toBe(200);
    expect((sameIdentity.body.artifact as { data: unknown }).data).toEqual(built.rows);

    const noIdentity = await post(handle.url, { op: 'artifact-get', ref, sessionId: 's-u' });
    expect(noIdentity.status).toBe(404);
    expect(noIdentity.body.code).toBe('ERR_ARTIFACT_NOT_FOUND');

    const wrongUser = await post(
      handle.url,
      { op: 'artifact-get', ref, sessionId: 's-u' },
      { 'x-user-id': 'u2' },
    );
    expect(wrongUser.status).toBe(404);
    expect(wrongUser.body.code).toBe('ERR_ARTIFACT_NOT_FOUND');
  });

  it('an expired ref answers the same not-found — the screen renders its stated absence', async () => {
    const served = await serveMinting(1);
    const put = await served.store.put(
      { conversationId: 's-e' },
      {
        kind: 'chart/spec',
        mediaType: 'application/json',
        data: { bars: [1] },
        expiresAt: Date.now() + 20,
      },
    );
    await new Promise((r) => setTimeout(r, 35));
    const gone = await post(served.url, {
      op: 'artifact-head',
      ref: put.meta.ref,
      sessionId: 's-e',
    });
    expect(gone.status).toBe(404);
    expect(gone.body.code).toBe('ERR_ARTIFACT_NOT_FOUND');
  });
});

// ─── Unit — the refusals teach ───────────────────────────────────────

describe('unit — refusals, each naming its fix', () => {
  it('no store: 501, ERR_NO_ARTIFACT_STORE, names the attach, and lands on the record', async () => {
    const agent = Agent.create({
      provider: mock({ replies: [final('hi')] as never }),
      model: 'mock',
    })
      .system('s')
      .build();
    const events = capture(agent);
    const handle = await standingAgent({
      agent,
      sessions: memorySessions(),
      host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
    });
    handles.push(handle);

    const refused = await post(handle.url, {
      op: 'artifact-head',
      ref: 'art_x',
      sessionId: 's-1',
    });
    expect(refused.status).toBe(501);
    expect(refused.body.code).toBe('ERR_NO_ARTIFACT_STORE');
    expect(String(refused.body.error)).toContain('Agent.create');
    expect(String(refused.body.error)).toContain('artifacts');
    expect(events).toEqual([
      {
        name: 'agentfootprint.artifacts.refused',
        payload: { op: 'head', reason: 'no-store', ref: 'art_x' },
      },
    ]);
  });

  it('no session: 400, ERR_ARTIFACT_SESSION_REQUIRED — a ref alone opens nothing', async () => {
    const served = await serveMinting(1);
    const refused = await post(served.url, { op: 'artifact-get', ref: 'art_x' });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('ERR_ARTIFACT_SESSION_REQUIRED');
    expect(String(refused.body.error)).toContain('sessionId');
  });

  it('an unknown op refuses by name and NEVER becomes a model turn', async () => {
    const served = await serveMinting(1);
    const before = served.llmCalls();
    const refused = await post(served.url, {
      op: 'artifact-list',
      ref: 'art_x',
      sessionId: 's-1',
    });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('ERR_INVALID_WIRE_OP');
    expect(String(refused.body.error)).toContain('artifact-head');
    expect(String(refused.body.error)).toContain('artifact-get');
    expect(served.llmCalls()).toBe(before);
  });

  it('a known op without ref refuses by name, teaching where refs come from', async () => {
    const served = await serveMinting(1);
    const refused = await post(served.url, { op: 'artifact-head', sessionId: 's-1' });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('ERR_INVALID_WIRE_OP');
    expect(String(refused.body.error)).toContain("'ref'");
  });

  it('a host without reply.artifact answers the named not-carried refusal', async () => {
    const store = inMemoryArtifacts();
    await store.put(
      { conversationId: 's-1' },
      { kind: 'chart/spec', mediaType: 'application/json', data: { bars: [1] } },
    );
    const agent = Agent.create({
      provider: mock({ replies: [final('hi')] as never }),
      model: 'mock',
      artifacts: store,
    })
      .system('s')
      .build();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions: memorySessions(), host });
    handles.push(handle);

    const page = await store.list({ conversationId: 's-1' });
    const delivered = await host.deliver({
      input: '',
      sessionId: 's-1',
      artifact: { op: 'head', ref: page.artifacts[0].ref },
    });
    expect(delivered.code).toBe('ERR_ARTIFACT_NOT_CARRIED');
    expect(delivered.error).toContain('reply.artifact');
  });
});

// ─── Events — one emission per fact, no tool, no double ─────────────

describe('events — resolution rides the existing record exactly once', () => {
  it('a wire head + get emit two resolved facts with NO tool field; a miss emits one refused', async () => {
    const served = await serveMinting(1);
    await post(served.url, { input: 'go', sessionId: 's-a' });
    const ref = served.minted[0].ref;
    const events = capture(served.agent);

    await post(served.url, { op: 'artifact-head', ref, sessionId: 's-a' });
    await post(served.url, { op: 'artifact-get', ref, sessionId: 's-a' });
    await post(served.url, { op: 'artifact-get', ref, sessionId: 's-b' });

    expect(events.map((e) => e.name)).toEqual([
      'agentfootprint.artifacts.resolved',
      'agentfootprint.artifacts.resolved',
      'agentfootprint.artifacts.refused',
    ]);
    expect(events[0].payload).toEqual({
      ref,
      via: 'head',
      kind: 'dataset/rows',
      bytes: expect.any(Number) as unknown,
    });
    expect(events[1].payload).toMatchObject({ ref, via: 'get' });
    expect(events[2].payload).toEqual({ op: 'get', reason: 'missing-or-expired', ref });
    // The redeemer was the hosting door: no phantom tool on any payload.
    for (const e of events) expect('tool' in e.payload).toBe(false);
    // Meta only, never bytes.
    for (const e of events) expect(JSON.stringify(e.payload)).not.toContain('"total":42');
  });
});

// ─── Regression — the pooled shape resolves on the session's own lane ─

describe('regression — pooled agents, one shared store', () => {
  it('agentFactory: the wire resolves a pooled session ref; a stranger session gets the one not-found', async () => {
    const store = inMemoryArtifacts();
    const minted: ArtifactMeta[] = [];
    const factory = () => {
      const storeRows = defineTool({
        name: 'store_rows',
        description: 'mint',
        execute: async (_args, ctx) => {
          const meta = await ctx.artifacts.put({
            kind: 'dataset/rows',
            mediaType: 'application/json',
            data: [1, 2, 3],
          });
          minted.push(meta);
          return `stored ${meta.ref}`;
        },
      });
      return Agent.create({
        provider: mock({ replies: [call('store_rows', 't1'), final('stored')] as never }),
        model: 'mock',
        maxIterations: 3,
        artifacts: store,
      })
        .system('s')
        .tool(storeRows)
        .build();
    };
    const handle = await standingAgent({
      agentFactory: factory,
      sessions: memorySessions(),
      host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
    });
    handles.push(handle);

    await post(handle.url, { input: 'go', sessionId: 's-pool' });
    const ref = minted[0].ref;
    const own = await post(handle.url, { op: 'artifact-get', ref, sessionId: 's-pool' });
    expect(own.status).toBe(200);
    expect((own.body.artifact as { data: unknown }).data).toEqual([1, 2, 3]);

    const stranger = await post(handle.url, { op: 'artifact-get', ref, sessionId: 's-other' });
    expect(stranger.status).toBe(404);
    expect(stranger.body.code).toBe('ERR_ARTIFACT_NOT_FOUND');
  });
});
