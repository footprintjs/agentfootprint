/**
 * A TICKET FILED UNDER A SESSION'S SCOPE IS REDEEMED UNDER IT — whatever the
 * pool holds, and whatever the session store holds.
 *
 * Through the previous release, a pooled door (`agentFactory`) at an open door
 * answered a redemption for a session with no live instance and no stored
 * conversation with the one not-found WITHOUT asking the artifact store. The
 * premise ("such a session has no turn that could have minted anything") was
 * false in two ways the library itself produces:
 *
 *   • an app-owned route files a guide beside a conversation BEFORE its first
 *     chat turn (the seam `handle.artifactsForRequest` exists for exactly
 *     that) — the seam itself answered `'not-found'`, so the library's own
 *     filing door could not file, and a filing made under the session rung
 *     `{ conversationId }` could not be redeemed;
 *   • a tool mints during a first turn that then THROWS — a thrown run
 *     persists nothing, so once the instance was evicted, a ticket the store
 *     still held answered not-found.
 *
 * And the answer depended on the deployment's SHAPE: the shared agent
 * (`agent`) redeemed the same filing that the pooled shape refused.
 *
 * The laws being pinned:
 *   • Whether a ticket exists is the ARTIFACT STORE's answer, asked under the
 *     session's own scope — never the pool's or the session store's.
 *   • Shared and pooled answer the same filing the same way.
 *   • A foreign session is still the one not-found.
 *   • R2-12 holds: a flood of made-up session ids at an open door builds no
 *     pooled lane, evicts nothing, emits nothing — at most ONE reader, outside
 *     the pool, however many ids — and now reads the session store not at all.
 *
 * Test types (Convention 3): regression (the three failures above) · security
 * (the flood, the foreign session) · boundary (no store at all) · performance
 * (zero session-store reads) · integration (through `standingAgent`).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Agent, defineTool, inMemoryArtifacts } from '../../src/index.js';
import type { AgentfootprintEvent } from '../../src/events.js';
import { mock } from '../../src/llm-providers.js';
import { memorySessions, standingAgent } from '../../src/hosting/index.js';
import type {
  HostHandle,
  SessionLifecycle,
  StandingAgentHandle,
  StandingAgentOptions,
} from '../../src/hosting/index.js';
import type { ArtifactStore } from '../../src/artifacts/types.js';
import {
  ALICE,
  NEVER_MINTED,
  filingHost,
  redeem,
  verifier,
  type FilingHost,
} from './turnArtifactsHarness.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.allSettled(closers.map((close) => close()));
  closers.length = 0;
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const guide = (text: string) => ({
  kind: 'note/guide',
  mediaType: 'text/plain',
  data: text,
  label: 'guide',
});

/** A session store that counts what the door asks of it. */
function countingSessions(): {
  sessions: SessionLifecycle;
  reads: { hydrate: number; wake: number };
} {
  const base = memorySessions();
  const reads = { hydrate: 0, wake: 0 };
  const sessions: SessionLifecycle = {
    ...base,
    hydrate: (id) => {
      reads.hydrate += 1;
      return base.hydrate(id);
    },
    persist: (id, envelope) => base.persist(id, envelope),
    onWake: async (id, reason) => {
      reads.wake += 1;
      await base.onWake?.(id, reason);
    },
  };
  return { sessions, reads };
}

interface Door {
  readonly host: FilingHost;
  readonly handle: HostHandle & StandingAgentHandle;
  /** Every agent the door built, in order (the shared agent counts as one). */
  readonly built: Agent[];
  /** Every `artifacts.*` fact any built agent emitted. */
  readonly facts: AgentfootprintEvent[];
  readonly evicted: string[];
  readonly reads: { hydrate: number; wake: number };
}

/** One door, in either deployment shape, over ONE shared artifact store. */
async function door(
  shape: 'shared' | 'pooled',
  options: {
    readonly store?: ArtifactStore | null;
    readonly max?: number;
    readonly verify?: boolean;
  } = {},
): Promise<Door> {
  const store = options.store === undefined ? inMemoryArtifacts() : options.store;
  const built: Agent[] = [];
  const facts: AgentfootprintEvent[] = [];
  const evicted: string[] = [];
  const build = (): Agent => {
    const agent = Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'm',
      ...(store !== null && { artifacts: store }),
    }).build();
    agent.on('agentfootprint.artifacts.*', (event: AgentfootprintEvent) => facts.push(event));
    const close = agent.closeToolSessions.bind(agent);
    agent.closeToolSessions = ((request: { reason?: string }) => {
      if (request?.reason === 'evicted') evicted.push(`agent-${built.indexOf(agent)}`);
      return close(request as never);
    }) as typeof agent.closeToolSessions;
    built.push(agent);
    return agent;
  };
  const { sessions, reads } = countingSessions();
  const host = filingHost();
  const handle = (await standingAgent({
    ...(shape === 'shared'
      ? { agent: build() }
      : { agentFactory: build, maxActiveSessions: options.max ?? 2 }),
    sessions,
    host,
    ...(options.verify === true && { identity: { verify: verifier().verify } }),
  } as StandingAgentOptions<HostHandle>)) as HostHandle & StandingAgentHandle;
  closers.push(() => handle.close());
  return { host, handle, built, facts, evicted, reads };
}

describe('a ticket filed for a session nobody has chatted in yet', () => {
  for (const shape of ['shared', 'pooled'] as const) {
    it(`${shape}: filed through the seam, redeemed on the wire by the same session; a foreign session gets the not-found`, async () => {
      const { host, handle } = await door(shape);
      const seam = await handle.artifactsForRequest({ sessionId: 'never-chatted' });
      if (!seam.bound) throw new Error(`the seam refused: ${seam.reason}`);
      const meta = await seam.artifacts.put(guide('read the guide first'));

      const own = await redeem(host, 'never-chatted', meta.ref);
      expect(own.code).toBeUndefined();
      expect((own.artifact as { data?: unknown } | undefined)?.data).toBe('read the guide first');

      const foreign = await redeem(host, 'someone-else', meta.ref);
      expect(foreign.code).toBe('ERR_ARTIFACT_NOT_FOUND');
    });

    it(`${shape}: filed by the app under the session rung { conversationId }, redeemed on the wire and through the seam`, async () => {
      const store = inMemoryArtifacts();
      const { host, handle } = await door(shape, { store });
      // What an app filing beside a conversation writes: the session rung, the
      // scope a session-only redemption composes.
      const { meta } = await store.put({ conversationId: 'never-chatted' }, guide('guide run'));

      const own = await redeem(host, 'never-chatted', meta.ref);
      expect(own.code).toBeUndefined();
      const seam = await handle.artifactsForRequest({ sessionId: 'never-chatted' });
      if (!seam.bound) throw new Error(`the seam refused: ${seam.reason}`);
      expect((await seam.artifacts.head(meta.ref))?.ref).toBe(meta.ref);

      expect((await redeem(host, 'someone-else', meta.ref)).code).toBe('ERR_ARTIFACT_NOT_FOUND');
      const other = await handle.artifactsForRequest({ sessionId: 'someone-else' });
      if (!other.bound) throw new Error(`the seam refused: ${other.reason}`);
      expect(await other.artifacts.head(meta.ref)).toBeNull();
    });
  }

  it('the pooled shape builds no pooled lane for it and evicts nobody — the one reader answers', async () => {
    const { host, handle, built, evicted } = await door('pooled', { max: 1 });
    await host.deliver({ sessionId: 'real-user', input: 'hi' });
    expect(built).toHaveLength(1);
    const seam = await handle.artifactsForRequest({ sessionId: 'never-chatted' });
    if (!seam.bound) throw new Error(seam.reason);
    const meta = await seam.artifacts.put(guide('g'));
    expect((await redeem(host, 'never-chatted', meta.ref)).code).toBeUndefined();
    await settle();
    expect(built).toHaveLength(2); // real-user's lane + the reader
    expect(evicted).toEqual([]);
    // real-user's lane is still the one serving it.
    await host.deliver({ sessionId: 'real-user', input: 'again' });
    expect(built).toHaveLength(2);
  });

  it('…and its first chat turn redeems the guide on its own lane', async () => {
    const { host, handle } = await door('pooled');
    const seam = await handle.artifactsForRequest({ sessionId: 'later-chats' });
    if (!seam.bound) throw new Error(seam.reason);
    const meta = await seam.artifacts.put(guide('g'));
    await host.deliver({ sessionId: 'later-chats', input: 'hi' });
    expect((await redeem(host, 'later-chats', meta.ref)).code).toBeUndefined();
  });
});

describe('a VERIFYING door still asks ownership first (unchanged)', () => {
  for (const shape of ['shared', 'pooled'] as const) {
    it(`${shape}: a session whose first turn has not persisted is nobody's to open — the seam and the wire answer the one not-found`, async () => {
      const store = inMemoryArtifacts();
      const { host, handle, facts } = await door(shape, { store, verify: true });
      const { meta } = await store.put({ conversationId: 'never-chatted' }, guide('g'));
      expect(
        await handle.artifactsForRequest({ sessionId: 'never-chatted', headers: ALICE }),
      ).toEqual({
        bound: false,
        reason: 'not-found',
      });
      const got = await host.deliver({
        sessionId: 'never-chatted',
        headers: ALICE,
        artifact: { op: 'get', ref: meta.ref },
      });
      expect(got.code).toBe('ERR_ARTIFACT_NOT_FOUND');
      expect(facts).toEqual([]);
    });
  }
});

describe('a ticket a tool minted during a first turn that THREW', () => {
  it('is still redeemed after its instance is evicted — on the wire and through the seam', async () => {
    const store = inMemoryArtifacts();
    const minted: string[] = [];
    const mint = defineTool({
      name: 'mint',
      description: 'mint one dataset',
      execute: async (_args, ctx) => {
        const meta = await ctx.artifacts.put({
          kind: 'dataset/rows',
          mediaType: 'application/json',
          data: [1],
          label: 'rows',
        });
        minted.push(meta.ref);
        return `stored ${meta.ref}`;
      },
    });
    let failNext = true;
    const provider = {
      name: 'fails-after-the-tool',
      async complete(request: { messages?: Array<{ role: string }> }) {
        const sawTool = (request.messages ?? []).some((m) => m.role === 'tool');
        if (failNext && !sawTool) {
          return {
            content: '',
            toolCalls: [{ id: 'c1', name: 'mint', args: {} }],
            stopReason: 'tool_use',
            usage: { input: 1, output: 1 },
          };
        }
        if (failNext) {
          failNext = false;
          throw new Error('provider down after the tool ran');
        }
        return {
          content: 'ok',
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { input: 1, output: 1 },
        };
      },
    };
    const sessions = memorySessions();
    const host = filingHost();
    const handle = (await standingAgent({
      agentFactory: () =>
        Agent.create({ provider: provider as never, model: 'm', artifacts: store })
          .system('s')
          .tool(mint)
          .build(),
      maxActiveSessions: 1,
      sessions,
      host,
    } as StandingAgentOptions<HostHandle>)) as HostHandle & StandingAgentHandle;
    closers.push(() => handle.close());

    const first = await host.deliver({ sessionId: 'sA', input: 'make rows' });
    expect(first.output).toBeUndefined(); // the turn failed…
    expect(minted).toHaveLength(1); // …after its tool minted…
    expect(await sessions.hydrate('sA')).toBeUndefined(); // …and nothing was persisted.

    await host.deliver({ sessionId: 'sB', input: 'hi' }); // evicts sA's instance (cap 1)
    await settle();
    expect(await store.head({ conversationId: 'sA' }, minted[0] as string)).not.toBeNull();

    const after = await redeem(host, 'sA', minted[0] as string);
    expect(after.code).toBeUndefined();
    const seam = await handle.artifactsForRequest({ sessionId: 'sA' });
    if (!seam.bound) throw new Error(seam.reason);
    expect((await seam.artifacts.head(minted[0] as string))?.kind).toBe('dataset/rows');
  });
});

describe('R2-12 still holds — a flood of made-up session ids at an OPEN door', () => {
  it('is the one not-found: no pooled lane, no eviction, nothing emitted, ONE reader however many ids', async () => {
    const { host, handle, built, facts, evicted } = await door('pooled', { max: 2 });
    await host.deliver({ sessionId: 'sA', input: 'hi' });
    expect(built).toHaveLength(1);
    const before = facts.length;

    for (const size of [12, 48]) {
      const flood = await Promise.all(
        Array.from({ length: size }, (_, i) =>
          host.deliver({
            sessionId: `junk-${size}-${i}`,
            artifact: { op: 'head', ref: NEVER_MINTED },
          }),
        ),
      );
      expect(flood.map((d) => d.code)).toEqual(Array(size).fill('ERR_ARTIFACT_NOT_FOUND'));
      const gets = await Promise.all(
        Array.from({ length: size }, (_, i) =>
          host.deliver({
            sessionId: `junk-get-${size}-${i}`,
            artifact: { op: 'get', ref: NEVER_MINTED },
          }),
        ),
      );
      expect(gets.map((d) => d.code)).toEqual(Array(size).fill('ERR_ARTIFACT_NOT_FOUND'));
      await settle();
      expect(built).toHaveLength(2); // sA's lane + the one reader, at 12 and at 48
    }
    expect(evicted).toEqual([]);
    expect(facts.slice(before)).toEqual([]);

    // sA is still served on its own lane, as before.
    await host.deliver({ sessionId: 'sA', input: 'again' });
    expect(built).toHaveLength(2);
    void handle;
  });

  it('a pooled door with NO store answers the teaching refusal, as the shared shape does — and emits nothing for a lane-less session', async () => {
    for (const shape of ['shared', 'pooled'] as const) {
      const { host, facts } = await door(shape, { store: null });
      const got = await host.deliver({
        sessionId: 'nobody',
        artifact: { op: 'get', ref: NEVER_MINTED },
      });
      expect(got.code).toBe('ERR_NO_ARTIFACT_STORE');
      if (shape === 'pooled') expect(facts).toEqual([]);
    }
  });
});

describe('performance — a session-only redemption at an open door reads no session store', () => {
  it('the wire and the seam wake nothing and hydrate nothing (the scope is the request alone)', async () => {
    for (const shape of ['shared', 'pooled'] as const) {
      const { host, handle, reads } = await door(shape);
      for (let i = 0; i < 20; i++) {
        await host.deliver({ sessionId: `s-${i}`, artifact: { op: 'head', ref: NEVER_MINTED } });
        const seam = await handle.artifactsForRequest({ sessionId: `s-${i}` });
        expect(seam.bound).toBe(true);
      }
      expect(reads).toEqual({ hydrate: 0, wake: 0 });
    }
  });

  it('a request carrying a userId still reads the stored identity — once per redemption, once per seam call', async () => {
    const { host, handle, reads } = await door('pooled');
    await host.deliver({
      sessionId: 's-u',
      userId: 'u',
      artifact: { op: 'head', ref: NEVER_MINTED },
    });
    expect(reads).toEqual({ hydrate: 1, wake: 1 });
    expect((await handle.artifactsForRequest({ sessionId: 's-u', userId: 'u' })).bound).toBe(true);
    expect(reads).toEqual({ hydrate: 2, wake: 2 });
  });
});
